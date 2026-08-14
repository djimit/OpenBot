/**
 * Local per-bot Linux VMs backed by Apple's Virtualization.framework runtime.
 *
 * This is the lifecycle surface the rest of the app talks to — provision,
 * start, suspend, restart, destroy, and the garbage collection that keeps
 * abandoned boxes from accumulating. It also owns the only mutable state:
 * which VMs are drafts, which are mid-provision, and which are already
 * starting. The mechanics live beside it: `appleContainerRuntime` makes the
 * runtime and image available, `appleVmBox` creates and refreshes the system
 * layer, `appleVmOwnership` proves a container is ours, and `loopbackBridge`
 * keeps the endpoint stable across reboots.
 */

import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { cp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { boxesDir } from '../store/paths'
import { ensureImage, resetAppleContainerCaches, runtime, runtimeBinary } from './appleContainerRuntime'
import {
  builtMainDir,
  refreshGuestRuntime,
  restoreMissingManagedVm,
  runManagedVm,
  upgradeManagedVm
} from './appleVmBox'
import {
  assertOwned,
  managedVmName,
  ownerMarker,
  parseContainerJson,
  vmIp,
  type AppleContainerInfo
} from './appleVmOwnership'
import {
  commandRunner,
  setCommandRunner,
  type CommandResult,
  type CommandRunner
} from './commandRunner'
import { bridgeFor, closeBridge, createLoopbackBridge, targetPort } from './loopbackBridge'
import type { ProgressReporter, VmTarget } from './types'

export type { CommandResult, CommandRunner } from './commandRunner'
export { controlTokenHash } from './appleVmBox'
export { managedVmName } from './appleVmOwnership'

const provisional = new Map<string, VmTarget>()
const provisioning = new Set<string>()
const starting = new Map<string, Promise<void>>()

/** Test seam; production never replaces the process runner. */
export function setAppleVmCommandRunnerForTests(runner?: CommandRunner): void {
  setCommandRunner(runner)
  resetAppleContainerCaches()
}

/** Create a persistent VM and return its write-only control credential. */
export async function provisionAppleVm(
  signal?: AbortSignal,
  report: ProgressReporter = () => undefined
): Promise<VmTarget> {
  const binary = await runtime(signal, report)
  await ensureImage(binary, signal, report)
  if (signal?.aborted) throw new Error('VM operation cancelled.')

  report({ stage: 'starting-vm', detail: 'Creating the bot\'s private Linux VM…' })
  const vmId = randomUUID()
  const token = randomBytes(32).toString('base64url')
  const name = managedVmName(vmId)
  const root = join(boxesDir(), vmId)
  const workspace = join(root, 'workspace')
  const guestRuntime = join(root, 'runtime')
  await mkdir(workspace, { recursive: true })
  await cp(builtMainDir(), guestRuntime, { recursive: true, force: true })
  const bridge = await createLoopbackBridge(vmId)
  let created = false
  provisioning.add(vmId)
  try {
    await runManagedVm(binary, vmId, token, signal)
    created = true
    const info = await assertOwned(
      binary,
      { kind: 'vm', vmId, endpoint: `http://127.0.0.1:${bridge.port}`, managed: 'apple-vm' },
      signal
    )
    bridge.remoteIp = vmIp(info)
    const target: VmTarget = {
      kind: 'vm',
      vmId,
      endpoint: `http://127.0.0.1:${bridge.port}`,
      token,
      managed: 'apple-vm'
    }
    provisional.set(vmId, target)
    return target
  } catch (error) {
    closeBridge(vmId)
    if (created) await commandRunner(binary, ['delete', '--force', name], { timeoutMs: 30_000 }).catch(() => undefined)
    await rm(root, { recursive: true, force: true }).catch(() => undefined)
    throw error
  } finally {
    provisioning.delete(vmId)
  }
}

export function startAppleVm(target: VmTarget, signal?: AbortSignal, token?: string): Promise<void> {
  const current = starting.get(target.vmId)
  if (current) return current
  const work = startAppleVmOnce(target, signal, token).finally(() => {
    if (starting.get(target.vmId) === work) starting.delete(target.vmId)
  })
  starting.set(target.vmId, work)
  return work
}

async function startAppleVmOnce(target: VmTarget, signal?: AbortSignal, token?: string): Promise<void> {
  const binary = await runtime(signal)
  let info: AppleContainerInfo
  try {
    info = await assertOwned(binary, target, signal)
  } catch (error) {
    info = await restoreMissingManagedVm(binary, target, token, error, signal)
  }
  info = await upgradeManagedVm(binary, target, info, token, signal)
  const refreshed = await refreshGuestRuntime(binary, target, info, signal)
  if (refreshed) info = await assertOwned(binary, target, signal)
  if (info.status?.state !== 'running') {
    await commandRunner(binary, ['start', managedVmName(target.vmId)], { timeoutMs: 60_000, signal })
    info = await assertOwned(binary, target, signal)
  }
  const port = targetPort(target)
  let bridge = bridgeFor(target.vmId)
  if (!bridge || bridge.port !== port) bridge = await createLoopbackBridge(target.vmId, port)
  bridge.remoteIp = vmIp(info)
}

/** Execute an explicit human-entered command as root inside an owned box. */
export async function runAppleVmAdminCommand(
  target: VmTarget,
  token: string,
  command: string,
  signal?: AbortSignal
): Promise<CommandResult> {
  const clean = command.trim()
  if (!clean) throw new Error('Enter a command to run in the VM.')
  if (clean.length > 16_384 || clean.includes('\0')) throw new Error('The VM command is too large or malformed.')
  await startAppleVm(target, signal, token)
  const binary = await runtime(signal)
  await assertOwned(binary, target, signal)
  return await commandRunner(binary, [
    'exec',
    '--user', '0:0',
    '--env', 'HOME=/root',
    '--env', 'DISPLAY=:99',
    '--workdir', '/workspace',
    managedVmName(target.vmId),
    '/usr/bin/timeout', '--signal=KILL', '14m', '/bin/bash', '-lc', clean
  ], { timeoutMs: 15 * 60_000, signal, acceptNonZero: true })
}

export async function suspendAppleVm(target: VmTarget, signal?: AbortSignal): Promise<void> {
  const binary = await runtime(signal)
  await assertOwned(binary, target, signal)
  closeBridge(target.vmId)
  await commandRunner(binary, ['stop', '--time', '10', managedVmName(target.vmId)], { timeoutMs: 30_000, signal })
}

/** Cleanly restart an owned VM while preserving its mounted workspace/profile. */
export async function restartAppleVm(
  target: VmTarget,
  token: string,
  signal?: AbortSignal
): Promise<void> {
  const binary = await runtime(signal)
  const info = await assertOwned(binary, target, signal)
  closeBridge(target.vmId)
  if (info.status?.state === 'running') {
    await commandRunner(binary, ['stop', '--time', '10', managedVmName(target.vmId)], {
      timeoutMs: 30_000,
      signal
    })
  }
  await startAppleVm(target, signal, token)
}

export async function destroyAppleVm(target: VmTarget, signal?: AbortSignal): Promise<void> {
  const binary = await runtime(signal)
  await assertOwned(binary, target, signal)
  closeBridge(target.vmId)
  await commandRunner(binary, ['delete', '--force', managedVmName(target.vmId)], { timeoutMs: 60_000, signal })
  await rm(join(boxesDir(), target.vmId), { recursive: true, force: true })
  provisional.delete(target.vmId)
}

/** A renderer may discard drafts, but can never destroy an adopted bot VM. */
export async function discardProvisionalAppleVm(target: VmTarget, signal?: AbortSignal): Promise<void> {
  const draft = provisional.get(target.vmId)
  if (!draft) return
  await destroyAppleVm(draft, signal)
}

/** The VM now belongs to a persisted bot and must survive app shutdown. */
export function adoptAppleVm(vmId: string): void {
  provisional.delete(vmId)
}

/** Main-process-only lookup so a provisioned credential never enters the renderer. */
export function provisionalAppleVmToken(vmId: string): string | undefined {
  return provisional.get(vmId)?.token
}

/** Remove drafts that were provisioned but never attached to a saved bot. */
export async function cleanupProvisionalAppleVms(): Promise<void> {
  const targets = [...provisional.values()]
  provisional.clear()
  await Promise.all(targets.map((target) => destroyAppleVm(target).catch((error) => {
    console.warn('[openbot/vm] could not clean up provisional VM', target.vmId, error)
  })))
}

/** Remove owned VMs whose bot document was deleted while the runtime was offline. */
export async function cleanupOrphanedAppleVms(liveVmIds: ReadonlySet<string>): Promise<void> {
  // Startup garbage collection must never trigger the large first-use runtime
  // download. Provisioning is the only operation that may install it.
  const binary =
    process.env['OPENBOT_VM_RUNTIME']?.trim() ||
    (existsSync('/usr/local/bin/container') ? '/usr/local/bin/container' : undefined) ||
    (existsSync(runtimeBinary()) ? runtimeBinary() : undefined)
  if (!binary) return
  try {
    await commandRunner(binary, ['system', 'status'], { timeoutMs: 10_000 })
  } catch {
    // Never start services or install a kernel just to perform optional GC.
    // A later launch retries once provisioning has brought the runtime up.
    return
  }
  const listed = await commandRunner(binary, ['list', '--all', '--format', 'json'], { timeoutMs: 15_000 })
  for (const info of parseContainerJson(listed.stdout)) {
    const labels = info.configuration?.labels
    const vmId = labels?.['com.openbot.vm-id'] ?? ''
    if (
      labels?.['com.openbot.managed'] !== 'true' ||
      labels?.['com.openbot.owner'] !== ownerMarker() ||
      !/^[a-f0-9-]{36}$/.test(vmId) ||
      liveVmIds.has(vmId) ||
      provisional.has(vmId) ||
      provisioning.has(vmId)
    ) continue
    const target: VmTarget = {
      kind: 'vm',
      vmId,
      endpoint: 'http://127.0.0.1:1',
      managed: 'apple-vm'
    }
    try {
      await assertOwned(binary, target)
      await commandRunner(binary, ['delete', '--force', managedVmName(vmId)], { timeoutMs: 60_000 })
      closeBridge(vmId)
      await rm(join(boxesDir(), vmId), { recursive: true, force: true })
      console.info('[openbot/vm] removed orphaned managed VM', vmId)
    } catch (error) {
      console.warn('[openbot/vm] could not remove orphaned managed VM', vmId, error)
    }
  }
}
