/**
 * Reading the `ACTION:` line a multi-bot reply ends with, and acting on it.
 *
 * Two steps, either side of the commit: `readAction` decides what actually gets stored
 * as the reply, `applyAction` moves the floor once it has been. Single-bot sessions have
 * no protocol to read, so both are no-ops there.
 */

import type { Bot, Message, Session } from '../../shared/types'
import type { ExchangeAction } from './exchange'
import type { TurnInput, TurnResult } from './turnTypes'
import type { TurnMode } from './backendMode'
import { addNotice } from './messages'
import { handoffTo, sessionRoster } from './handoff'
import { isRepeatReply } from './replyHistory'
import { parseAction } from './exchange'
import { safeLine } from './untrusted'

export interface ReadAction {
  roster: Bot[]
  action: ExchangeAction | null
  /** What belongs in the transcript: the reply with any ACTION line taken out. */
  content: string
  /** Multi-bot turn that produced no ACTION line, so the floor could not move. */
  actionMissing: boolean
}

/**
 * In a multi-bot session the reply carries a trailing `ACTION:` line naming
 * who speaks next. Parse it before committing: `prose` is the reply with that
 * line taken out, because it is plumbing rather than something to read.
 */
export async function readAction(session: Session, reply: string): Promise<ReadAction> {
  const roster = await sessionRoster(session)
  const action = roster.length > 1 ? parseAction(reply, roster.map((b) => b.name)) : null
  return {
    roster,
    action,
    content: action ? action.prose : reply,
    // No line at all: the floor cannot move, which the loop answers with one nudge.
    actionMissing: action ? !action.hasActionLine : false
  }
}

/**
 * Move the floor if the committed reply asked to. Returns the finished `TurnResult` when
 * the turn ends here, or null to carry on with tool execution.
 */
export async function applyAction(
  input: TurnInput,
  read: ReadAction,
  message: Message,
  mode: TurnMode
): Promise<TurnResult | null> {
  const { action, roster } = read
  if (!action) return null

  /*
   * Stop a stalled exchange. Two bots with nothing left to do will restate
   * themselves and keep handing over, burning the whole handoff budget on
   * pleasantries — so a repeated reply ends the exchange instead of passing on.
   */
  if (!input.retry && isRepeatReply(input.session.id, message.content)) {
    return { status: 'final', message, mode }
  }

  if (action.verb !== 'ASK' || !action.target) return null

  const target = roster.find((b) => b.name.toLowerCase() === action.target?.toLowerCase())
  if (!target) return null

  const outcome = await handoffTo(input.session, input.bot, target, action.text)
  if (outcome.ok) {
    // Defanged here too: the ask is repeated verbatim in the moderator's own
    // line, which is the last thing the receiving bot reads before it writes.
    const request = safeLine(action.text, 300)
    return { status: 'handoff', message, mode, note: outcome.note, request }
  }

  /*
   * Refused. Both refusals — the ping-pong cap, and a bot asking itself — used
   * to end the turn with no sign at all: the `ACTION:` line had already been
   * stripped from the reply, so the user saw an answer that simply stopped, and
   * the question the bot had asked was nowhere. Say what happened.
   */
  await addNotice(input.session, input.bot, outcome.notice)
  return { status: 'final', message, mode }
}
