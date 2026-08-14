/**
 * Bot-to-bot handoff.
 *
 * A `handoff` call switches `session.activeBotId` and lets the loop continue as the
 * receiving bot, which sees the full shared transcript plus a short brief. Two guards
 * apply: the target must already be part of the session, and consecutive handoffs are
 * capped so two bots cannot ping-pong a turn away.
 */

import type { Bot, Session, ToolCall } from '../../shared/types'
import { asString, asStringArray } from './json'
import { broadcast } from './events'
import { handoffCapMessage, takeHandoff } from './limits'
import { bots, sessions } from './sessionGateway'
import { askedSelfNotice, incomingBrief, quotedAsk, toolBrief } from './handoffBrief'

export interface HandoffResult {
  ok: boolean
  /** Message shown to the model as the tool result. */
  message: string
  toBotId?: string
  toBotName?: string
  reason?: string
  /** System note injected into the receiving bot's first turn. */
  note?: string
}

/**
 * Note left for the receiving bot's next turn.
 *
 * The orchestrated loop takes it straight from the result, but a supervised (agent-CLI)
 * turn hands off through the MCP gateway, outside our loop — so the note is parked here
 * and collected when that turn ends.
 */
const pendingNotes = new Map<string, string>()

export function takePendingNote(sessionId: string): string | null {
  const note = pendingNotes.get(sessionId) ?? null
  pendingNotes.delete(sessionId)
  return note
}

export function clearPendingNote(sessionId: string): void {
  pendingNotes.delete(sessionId)
}

export function parseHandoffArgs(call: ToolCall): {
  to: string
  reason: string
  note: string
} {
  const args = call.args ?? {}
  const to = asString(args['to'] ?? args['botId'] ?? args['bot'] ?? args['target']).trim()
  const reason = asString(args['reason'] ?? args['why'] ?? args['summary']).trim()
  const note = asString(args['note'] ?? args['brief'] ?? args['context']).trim()
  return { to, reason, note }
}

/** Every bot in this session, in `session.botIds` order. */
export async function sessionRoster(session: Session): Promise<Bot[]> {
  return bots.many(asStringArray(session.botIds))
}

/**
 * The outcome of a text-driven handover.
 *
 * A refusal carries the sentence to show, because both refusals used to be
 * silent: `handoffTo` returned null, the turn read that as "carry on", and the
 * `ACTION:` line had already been cut out of the reply — so the user could not
 * tell that a handover had been refused, or even that a question had been
 * asked. The tool path has always answered with `handoffCapMessage()`; this
 * path now says the same thing.
 */
export type TextHandoff = { ok: true; note: string } | { ok: false; notice: string }

/**
 * Hand over because the reply's `ACTION: ASK <teammate>` line said so.
 *
 * The tool path (`performHandoff`) cannot be used by agent-CLI backends — they
 * run their own tool loop, and pi has no MCP client — so this text-driven path
 * is what actually makes multi-bot work on those backends. Same guards apply:
 * the target must be in the session, and the ping-pong cap still holds.
 */
export async function handoffTo(
  session: Session,
  fromBot: Bot,
  target: Bot,
  question: string
): Promise<TextHandoff> {
  if (target.id === fromBot.id) return { ok: false, notice: askedSelfNotice(fromBot.name) }
  if (!takeHandoff(session.id)) return { ok: false, notice: handoffCapMessage(session.id) }

  await sessions.update(session, (fresh) => {
    fresh.activeBotId = target.id
  })

  broadcast({
    type: 'handoff',
    sessionId: session.id,
    fromBotId: fromBot.id,
    toBotId: target.id,
    reason: quotedAsk(question) || 'no reason given'
  })
  broadcast({ type: 'session-updated', session })

  /*
   * Not parked in `pendingNotes`: this brief is returned to the turn that asked for
   * the handoff and travels on from there. Parking it as well would leave it for the
   * NEXT supervised turn to collect, and that turn would report a handoff it never
   * made — its own FINAL discarded, the floor handed back to itself.
   */
  return { ok: true, note: incomingBrief(fromBot.name, question) }
}

export async function performHandoff(
  session: Session,
  fromBot: Bot,
  call: ToolCall
): Promise<HandoffResult> {
  const { to, reason, note } = parseHandoffArgs(call)
  if (!to) {
    return { ok: false, message: 'Handoff failed: no target bot given. Pass the bot id in "to".' }
  }

  const participants = await bots.many(asStringArray(session.botIds))
  const target = resolveTarget(participants, to)

  if (!target) {
    const roster = participants.map((b) => `${b.id} (${b.name})`).join(', ') || 'none'
    return {
      ok: false,
      message:
        `Handoff failed: "${to}" is not part of this session. Bots available here: ${roster}. ` +
        `The user has to add a bot to the session before you can hand off to it.`
    }
  }

  if (target.id === fromBot.id) {
    return { ok: false, message: 'Handoff failed: that is you. Continue the work yourself.' }
  }

  if (!takeHandoff(session.id)) {
    return { ok: false, message: handoffCapMessage(session.id) }
  }

  await sessions.update(session, (fresh) => {
    fresh.activeBotId = target.id
  })

  const cleanReason = reason || 'no reason given'
  broadcast({
    type: 'handoff',
    sessionId: session.id,
    fromBotId: fromBot.id,
    toBotId: target.id,
    reason: cleanReason
  })
  broadcast({ type: 'session-updated', session })

  const brief = toolBrief({
    fromName: fromBot.name,
    fromId: fromBot.id,
    toName: target.name,
    reason: cleanReason,
    note
  })
  pendingNotes.set(session.id, brief)

  return {
    ok: true,
    toBotId: target.id,
    toBotName: target.name,
    reason: cleanReason,
    note: brief,
    message: `Handed off to ${target.name} (${target.id}). They take the conversation from here.`
  }
}

function resolveTarget(participants: Bot[], wanted: string): Bot | null {
  const needle = wanted.toLowerCase()
  return (
    participants.find((b) => b.id === wanted) ??
    participants.find((b) => b.id.toLowerCase() === needle) ??
    participants.find((b) => b.name.toLowerCase() === needle) ??
    null
  )
}
