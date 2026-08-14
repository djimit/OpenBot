/**
 * Builds the `ToolContext` handed to every tool handler.
 *
 * The important part is the approval wiring. Tools in this app ask for approval
 * themselves, with a far better description than the loop could compose (a diff, the
 * exact command). So the loop does not pre-prompt for those; it hands them the gate and
 * lets them describe their own action.
 *
 * A mutating tool that does *not* self-approve is pre-approved by the executor instead —
 * see `SELF_APPROVING`. Once a call has been approved either way, a further ask inside the
 * same call is honoured without prompting again.
 */

import type { ApprovalRequest, Bot, Session, Settings, ToolCall } from '../../shared/types'
import type { ToolContext, ToolHost } from './contracts'
import { broadcast } from './events'
import { detailFor, kindForTool, summarise, targetForCall } from './approvalPolicy'
import { requestApproval } from './approval'
import { handoff, listBots, saveMemoryEntry, setTodos } from './sessionActions'
import { delegateBackgroundTask } from '../tasks'

/**
 * Tools that raise their own approval, with their own summary. Everything else that
 * mutates is gated by the executor before it runs.
 *
 * Every computer-use tool belongs here: they all go through `tools/computer/gate.ts`,
 * which builds a card carrying a live preview frame of the screen. Leaving one out did
 * not add a second prompt — the executor's generic card simply won the latch first, and
 * the user approved screen control without ever seeing the screen.
 */
export const SELF_APPROVING: ReadonlySet<string> = new Set([
  'shell',
  'write_file',
  'edit_file',
  'fetch',
  'remember',
  'click',
  'double_click',
  'type_text',
  'key_press',
  'scroll',
  'drag',
  'open_app',
  'navigate',
  'screenshot'
])

export interface ToolContextInput {
  session: Session
  bot: Bot
  settings: Settings
  call: ToolCall
  messageId: string
  signal: AbortSignal
  /** True when the executor already gated this call. */
  preApproved: boolean
}

const host: ToolHost = {
  saveMemory: (entry) => saveMemoryEntry(entry),
  setTodos: (sessionId, todos) => void setTodos(sessionId, todos),
  handoff: async (sessionId, fromBotId, toBotId, reason) => {
    await handoff(sessionId, fromBotId, toBotId, reason)
  },
  delegateTask: (sessionId, fromBotId, toBotId, prompt, title) =>
    delegateBackgroundTask(sessionId, fromBotId, toBotId, prompt, title),
  listBots: () => listBots()
}

export function buildToolContext(input: ToolContextInput): ToolContext {
  const { session, bot, call, signal } = input
  let granted = input.preApproved

  return {
    sessionId: session.id,
    botId: bot.id,
    cwd: session.cwd,
    signal,
    emit: (event) => broadcast(event),
    computerTarget: bot.computerTarget ?? { kind: 'local' },
    callId: call.id,
    messageId: input.messageId,
    settings: input.settings,
    host,
    requestApproval: async (request: ApprovalRequest) => {
      // The user already approved this specific call; do not ask twice for it — unless
      // the tool marked this particular action as one that is always confirmed.
      if (granted && !request?.force) return true
      const target = targetForCall(call)
      const outcome = await requestApproval({
        sessionId: session.id,
        toolName: request?.toolName || call.name,
        call,
        target,
        kind: request?.kind ?? kindForTool(call.name),
        summary: request?.summary ?? summarise(call.name, call, target),
        detail: request?.detail ?? detailFor(call),
        preview: request?.preview,
        force: request?.force === true,
        requestId: request?.id,
        signal
      })
      if (outcome.approved) granted = true
      return outcome.approved
    }
  }
}
