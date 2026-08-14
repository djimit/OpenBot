/** Approval-preserving proxy for filesystem and shell tools inside a bot VM. */

import type { ToolCall, ToolResult } from '../../../shared/types'
import { approve } from '../approval'
import { describeError } from '../errors'
import { settingsOf } from '../settings'
import type { ToolContext } from '../types'
import { getComputerProvider } from './index'
import { hasVmBoxCapabilities } from './vmProtocol'
import { VmComputerProvider } from './vmProvider'

const MAX_APPROVAL_ROUNDS = 8

export function vmTargetSupportsTools(target: ToolContext['computerTarget']): boolean {
  return target?.kind === 'vm' && hasVmBoxCapabilities(target.capabilities)
}

export async function runVmTool(call: ToolCall, ctx: ToolContext): Promise<ToolResult> {
  const target = ctx.computerTarget
  if (!target || target.kind !== 'vm') return failed(call, 'The VM execution target is missing.')
  if (!hasVmBoxCapabilities(target.capabilities)) {
    return failed(
      call,
      `VM ${target.vmId} has not advertised isolated file and process execution. ` +
        'The call was refused instead of running on the host.'
    )
  }

  const provider = getComputerProvider(target, { dataDir: ctx.dataDir, botId: ctx.botId })
  if (!(provider instanceof VmComputerProvider)) {
    return failed(call, 'The VM execution provider could not be created.')
  }

  const approvals: string[] = []
  try {
    for (let round = 0; round < MAX_APPROVAL_ROUNDS; round += 1) {
      const response = await provider.callBoxTool(
        { call, approvals, settings: settingsOf(ctx) },
        ctx.signal
      )
      if (response.result) return { ...response.result, callId: call.id, name: call.name }

      const remote = response.approval
      const request = {
        ...remote.request,
        detail: `Execution target: VM ${target.vmId}\n\n${remote.request.detail}`
      }
      const granted = await approve(ctx, request, { force: remote.request.force === true })
      if (!granted) {
        return failed(call, `The user declined ${remote.request.summary} on VM ${target.vmId}.`)
      }
      approvals.push(remote.signature)
    }
    return failed(call, 'The VM tool requested too many distinct approvals and was stopped.')
  } catch (error) {
    return failed(call, describeError(error, call.name))
  }
}

function failed(call: ToolCall, output: string): ToolResult {
  return { callId: call.id, name: call.name, ok: false, output }
}
