/**
 * The VM's system layer: how a box is created, recreated, and kept in step with
 * the app that supervises it.
 *
 * The container itself is disposable — the bind-mounted `/workspace` and the
 * host-side credential are not. Everything here is written so that recreating
 * the system layer, whether after an OpenBOT upgrade or after the runtime lost
 * the container, leaves the bot's identity, endpoint and files untouched.
 */

import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { cp, rename, rm } from 'node:fs/promises'
import { app } from 'electron'
import { join } from 'node:path'
import { boxesDir } from '../store/paths'
import { ensureImage, IMAGE, sha256File } from './appleContainerRuntime'
import {
  assertOwned,
  managedVmName,
  ownerMarker,
  parseContainerJson,
  type AppleContainerInfo
} from './appleVmOwnership'
import { commandRunner } from './commandRunner'
import { closeBridge, DAEMON_PORT } from './loopbackBridge'
import type { VmTarget } from './types'

export const BOX_LAYOUT_VERSION = '4'

export function controlTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function builtMainDir(): string {
  // Recursive fs.cp cannot traverse an asar archive. A real directory is
  // shipped beside app.asar and copied into each VM's private host directory.
  const path = app.isPackaged
    ? join(process.resourcesPath, 'guest-runtime')
    : join(app.getAppPath(), 'out', 'main')
  if (!existsSync(join(path, 'vmDaemon.js'))) {
    throw new Error('The guest daemon has not been built. Run npm run build before provisioning a VM.')
  }
  return path
}

/**
 * Start the long-lived daemon as the host user inside the VM. The system layer
 * stays writable for explicit human administration, but the bot itself never
 * receives root and this privileged path is not part of the guest HTTP API.
 */
export async function runManagedVm(
  binary: string,
  vmId: string,
  token: string,
  signal?: AbortSignal
): Promise<void> {
  const name = managedVmName(vmId)
  const root = join(boxesDir(), vmId)
  const workspace = join(root, 'workspace')
  const guestRuntime = join(root, 'runtime')
  const uid = typeof process.getuid === 'function' ? process.getuid() : 1000
  const gid = typeof process.getgid === 'function' ? process.getgid() : 1000
  await commandRunner(binary, [
    'run', '--detach',
    '--name', name,
    '--label', 'com.openbot.managed=true',
    '--label', `com.openbot.vm-id=${vmId}`,
    '--label', `com.openbot.owner=${ownerMarker()}`,
    '--label', `com.openbot.box-layout=${BOX_LAYOUT_VERSION}`,
    '--cap-drop', 'ALL',
    '--init',
    '--memory', '2G',
    '--cpus', '2',
    '--user', `${uid}:${gid}`,
    '--tmpfs', '/tmp',
    '--mount', `type=bind,source=${guestRuntime},target=/opt/openbot,readonly`,
    '--mount', `type=bind,source=${workspace},target=/workspace`,
    '--env', `OPENBOT_VM_ID=${vmId}`,
    '--env', `OPENBOT_VM_TOKEN_SHA256=${controlTokenHash(token)}`,
    '--env', 'OPENBOT_VM_BIND_HOST=0.0.0.0',
    '--env', `OPENBOT_VM_PORT=${DAEMON_PORT}`,
    '--env', 'OPENBOT_BOX_ROOT=/workspace',
    '--env', 'OPENBOT_CHROMIUM_BIN=/usr/bin/chromium',
    '--env', 'OPENBOT_DESKTOP=1',
    '--env', 'DISPLAY=:99',
    '--env', 'HOME=/workspace/.home',
    IMAGE
  ], { timeoutMs: 120_000, signal })
}

/**
 * A failed system-layer upgrade must not strand a bot forever after its old
 * immutable container was removed. Recreate only when the runtime confirms
 * that no object with this name exists and the private host-side box remains.
 */
export async function restoreMissingManagedVm(
  binary: string,
  target: VmTarget,
  token: string | undefined,
  originalError: unknown,
  signal?: AbortSignal
): Promise<AppleContainerInfo> {
  const listed = await commandRunner(binary, ['list', '--all', '--format', 'json'], {
    timeoutMs: 15_000,
    signal
  })
  if (parseContainerJson(listed.stdout).some((entry) => entry.id === managedVmName(target.vmId))) {
    throw originalError
  }
  const root = join(boxesDir(), target.vmId)
  if (
    !token?.trim() ||
    !existsSync(join(root, 'workspace')) ||
    !existsSync(join(root, 'runtime', 'vmDaemon.js'))
  ) {
    throw originalError
  }
  await ensureImage(binary, signal)
  await runManagedVm(binary, target.vmId, token, signal)
  return await assertOwned(binary, target, signal)
}

/**
 * Version 1 boxes had an immutable root and no possible administration path.
 * Recreate only that system layer; the bind-mounted workspace, Chromium
 * profile, VM id, endpoint and credential all survive the upgrade.
 */
export async function upgradeManagedVm(
  binary: string,
  target: VmTarget,
  info: AppleContainerInfo,
  token?: string,
  signal?: AbortSignal
): Promise<AppleContainerInfo> {
  if (info.configuration?.labels?.['com.openbot.box-layout'] === BOX_LAYOUT_VERSION) return info
  if (!token?.trim()) {
    throw new Error('The VM needs a one-time system upgrade, but its credential could not be unlocked.')
  }

  await ensureImage(binary, signal)
  closeBridge(target.vmId)
  if (info.status?.state === 'running') {
    await commandRunner(binary, ['stop', '--time', '10', managedVmName(target.vmId)], {
      timeoutMs: 30_000,
      signal
    })
  }
  await commandRunner(binary, ['delete', '--force', managedVmName(target.vmId)], {
    timeoutMs: 60_000,
    signal
  })
  try {
    await runManagedVm(binary, target.vmId, token, signal)
  } catch (error) {
    await commandRunner(binary, ['delete', '--force', managedVmName(target.vmId)], {
      timeoutMs: 30_000
    }).catch(() => undefined)
    throw new Error(`The VM system upgrade did not complete: ${error instanceof Error ? error.message : String(error)}`)
  }
  return await assertOwned(binary, target, signal)
}

/** Refresh a persisted box after an OpenBOT upgrade, then reload its daemon. */
export async function refreshGuestRuntime(
  binary: string,
  target: VmTarget,
  info: AppleContainerInfo,
  signal?: AbortSignal
): Promise<boolean> {
  const source = builtMainDir()
  const destination = join(boxesDir(), target.vmId, 'runtime')
  const sourceEntry = join(source, 'vmDaemon.js')
  const destinationEntry = join(destination, 'vmDaemon.js')
  const current = existsSync(destinationEntry) ? await sha256File(destinationEntry) : ''
  const next = await sha256File(sourceEntry)
  if (current === next) return false

  closeBridge(target.vmId)
  if (info.status?.state === 'running') {
    await commandRunner(binary, ['stop', '--time', '10', managedVmName(target.vmId)], {
      timeoutMs: 30_000,
      signal
    })
  }

  const staging = `${destination}.next-${randomUUID()}`
  await rm(staging, { recursive: true, force: true })
  try {
    await cp(source, staging, { recursive: true, force: true })
    await rm(destination, { recursive: true, force: true })
    await rename(staging, destination)
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined)
  }
  return true
}
