/** Credential-safe handover between an agent turn and the human VM controls. */

import { randomUUID } from 'node:crypto'
import type { HumanHelpRequest, ToolResult } from '../../../shared/types'
import type { Tool } from '../types'

interface PendingHelp {
  request: HumanHelpRequest
  finish: (returned: boolean) => void
  cleanup: () => void
}

const pending = new Map<string, PendingHelp>()

export const requestHelpTool: Tool = {
  schema: {
    name: 'request_help',
    description:
      'Pause and ask the user to take control of the private computer. Use this for sign-in, ' +
      'SSO, passkeys, 2FA, CAPTCHAs, payment confirmation, or any step that needs a human. ' +
      'The tool returns only after the user hands the computer back, then continue the task.',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'A short explanation of exactly what the user needs to do.' }
      },
      required: ['reason']
    },
    mutating: false,
    computerUse: true
  },
  async handler(args, ctx): Promise<ToolResult> {
    if (!ctx.computerTarget || ctx.computerTarget.kind === 'local') {
      return result(ctx.callId, false, 'Human takeover is available only for a private browser or VM computer.')
    }
    const reason = typeof args['reason'] === 'string' ? args['reason'].trim().slice(0, 500) : ''
    if (!reason) return result(ctx.callId, false, 'Explain what human action is needed in “reason”.')
    if (ctx.signal.aborted) return result(ctx.callId, false, 'Human control ended because the run was stopped.')

    const request: HumanHelpRequest = {
      id: randomUUID(),
      sessionId: ctx.sessionId,
      botId: ctx.botId,
      reason,
      createdAt: Date.now()
    }

    const returned = await new Promise<boolean>((resolve) => {
      const abort = (): void => finish(false)
      const cleanup = (): void => ctx.signal.removeEventListener('abort', abort)
      const finish = (value: boolean): void => {
        const active = pending.get(request.id)
        if (!active) return
        pending.delete(request.id)
        cleanup()
        ctx.emit({ type: 'human-help-resolved', requestId: request.id, sessionId: request.sessionId })
        resolve(value)
      }
      pending.set(request.id, { request, finish, cleanup })
      ctx.signal.addEventListener('abort', abort, { once: true })
      if (ctx.signal.aborted) {
        abort()
        return
      }
      ctx.emit({ type: 'human-help-request', request })
    })

    return returned
      ? result(ctx.callId, true, 'The user handed the private computer back. Continue from the current screen.')
      : result(ctx.callId, false, 'Human control ended because the run was stopped.')
  }
}

export function returnHumanControl(requestId: string): boolean {
  const active = pending.get(requestId)
  if (!active) return false
  active.finish(true)
  return true
}

export function cancelHumanHelpForSession(sessionId: string): void {
  for (const active of [...pending.values()]) {
    if (active.request.sessionId === sessionId) active.finish(false)
  }
}

function result(callId: string | undefined, ok: boolean, output: string): ToolResult {
  return { callId: callId ?? `help-${Date.now()}`, name: 'request_help', ok, output }
}
