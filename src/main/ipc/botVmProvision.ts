/**
 * Creating a private VM: the one run that may be in flight, the progress the
 * bot editor polls, and the channels that start, watch, cancel or discard it.
 *
 * The run state is module-level rather than per-call because the renderer asks
 * about it on a separate channel from the one that started it — a status poll
 * and a cancel both have to find the same `AbortController` the provisioning
 * call is waiting on.
 */

import type {
  ComputerProbeResult,
  ComputerTarget,
  VmProvisionProgress,
  VmProvisionStatus,
  VmProvisionResult
} from '../../shared/types'
import {
  destroyAppleVm,
  discardProvisionalAppleVm,
  provisionAppleVm
} from '../vm/appleVmSupervisor'
import { asComputerTarget, probeTarget } from './botComputerTarget'
import { CHANNELS } from './channels'
import { handle, handleVoid } from './handler'
import { asId } from './validate'

const PROVISION_DEADLINE_MS = 40 * 60_000

interface ProvisionRun {
  controller: AbortController
  startedAt: number
  cancelRequested: boolean
  timedOut: boolean
}

let activeProvision: ProvisionRun | undefined
let currentProvisionStatus: VmProvisionStatus = {
  active: false,
  stage: 'idle',
  detail: 'Ready to create a private VM.',
  updatedAt: Date.now()
}

function updateProvisionStatus(
  progress: VmProvisionProgress,
  active: boolean,
  startedAt?: number
): void {
  currentProvisionStatus = {
    ...progress,
    active,
    ...(startedAt === undefined ? {} : { startedAt }),
    updatedAt: Date.now()
  }
}

export function registerVmProvisionIpc(): void {
  handle<ComputerProbeResult>(
    CHANNELS.botsProbeTarget,
    ([target, botId]) =>
      probeTarget(asComputerTarget(target), botId === undefined ? undefined : asId(botId)),
    (_args, error) => ({
      ok: false,
      detail: error instanceof Error ? error.message : 'The computer target could not be checked.'
    })
  )

  handle<VmProvisionResult>(
    CHANNELS.botsProvisionTarget,
    async () => {
      if (activeProvision) {
        return { ok: false, error: 'A private VM is already being created. You can cancel it from the bot editor.' }
      }

      const run: ProvisionRun = {
        controller: new AbortController(),
        startedAt: Date.now(),
        cancelRequested: false,
        timedOut: false
      }
      activeProvision = run
      updateProvisionStatus(
        { stage: 'preparing-runtime', detail: 'Preparing the native VM runtime…' },
        true,
        run.startedAt
      )
      const deadline = setTimeout(() => {
        run.timedOut = true
        run.controller.abort(new DOMException('VM setup deadline exceeded', 'TimeoutError'))
      }, PROVISION_DEADLINE_MS)
      let target: Extract<ComputerTarget, { kind: 'vm' }> | undefined
      try {
        target = await provisionAppleVm(run.controller.signal, (progress) => {
          if (activeProvision === run && !run.controller.signal.aborted) {
            updateProvisionStatus(progress, true, run.startedAt)
          }
        })
        if (run.controller.signal.aborted) throw new Error('VM operation cancelled.')

        updateProvisionStatus(
          { stage: 'checking-vm', detail: 'Checking isolated files, processes, and Chromium…' },
          true,
          run.startedAt
        )
        const probe = await probeTarget(target, undefined, run.controller.signal)
        if (!probe.ok) throw new Error(probe.detail ?? 'The new box did not become ready.')
        target.capabilities = probe.capabilities ?? []
        const { token: _credential, ...rendererTarget } = target
        updateProvisionStatus(
          { stage: 'ready', detail: 'Private VM ready.' },
          false,
          run.startedAt
        )
        return {
          ok: true,
          target: { ...rendererTarget, hasToken: true },
          detail: 'Private VM created. Its files and signed-in Chromium profile persist until this bot is deleted.'
        }
      } catch (error) {
        if (target) await destroyAppleVm(target).catch(() => undefined)
        const fallback = error instanceof Error ? error.message : 'The private box could not be created.'
        const cancelled = run.cancelRequested
        const detail = run.timedOut
          ? 'VM setup stopped after 40 minutes. Check the network and try again.'
          : cancelled
            ? 'VM setup cancelled.'
            : fallback
        updateProvisionStatus(
          { stage: cancelled ? 'cancelled' : 'failed', detail },
          false,
          run.startedAt
        )
        return { ok: false, error: detail }
      } finally {
        clearTimeout(deadline)
        if (activeProvision === run) activeProvision = undefined
      }
    },
    (_args, error) => ({
      ok: false,
      error: error instanceof Error ? error.message : 'The private box could not be created.'
    })
  )

  handle<VmProvisionStatus>(
    CHANNELS.botsProvisionStatus,
    () => ({ ...currentProvisionStatus }),
    () => ({ ...currentProvisionStatus })
  )

  handle<VmProvisionStatus>(
    CHANNELS.botsCancelProvision,
    () => {
      const run = activeProvision
      if (!run || !currentProvisionStatus.active) return { ...currentProvisionStatus }
      run.cancelRequested = true
      updateProvisionStatus(
        { stage: 'cancelling', detail: 'Stopping VM setup and cleaning up…' },
        true,
        run.startedAt
      )
      run.controller.abort(new DOMException('VM setup cancelled', 'AbortError'))
      return { ...currentProvisionStatus }
    },
    () => ({ ...currentProvisionStatus })
  )

  handleVoid(CHANNELS.botsDiscardTarget, async ([raw]) => {
    const target = asComputerTarget(raw)
    if (target.kind !== 'vm' || target.managed !== 'apple-vm') return
    await discardProvisionalAppleVm(target)
  })
}
