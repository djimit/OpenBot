/**
 * What the next iteration of the exchange loop inherits.
 *
 * Two cases that look similar and must not behave the same:
 *
 *   - a NUDGE is the same turn asked again, so everything the turn was handed
 *     carries over unchanged. Clearing it first meant a bot nudged for a missing
 *     ACTION line forgot the handoff note that started it, and answered the
 *     retry with no idea what it had been asked.
 *   - a HANDOFF moves the floor, so "the user addressed you" stops being true of
 *     anyone. Leaving it set meant that after a handover and a hand back, the
 *     moderator told the receiving bot "the user asked you directly — answer
 *     them, not your teammates", which suppressed the very handoff it was
 *     asking for, and the teammate's real question never reached the last user
 *     message where instruction-following is strongest.
 */

export interface TurnCarry {
  /** System-prompt sections for the next turn — a handoff note, a routine brief. */
  extras: string[]
  /** Message the next reply answers, when it is answering a teammate. */
  replyTo: string | null
  /** Bot the USER addressed, or null once the floor has moved. */
  addressed: string | null
}

export interface Given {
  extras: string[]
  replyTo: string | null
}

/** A nudge re-runs the same turn: it inherits exactly what that turn was given. */
export function carryAfterNudge(given: Given, addressed: string | null): TurnCarry {
  return { extras: given.extras, replyTo: given.replyTo, addressed }
}

/** A handoff hands the floor on, and with it the right to be "the addressed one". */
export function carryAfterHandoff(note: string | undefined, messageId: string): TurnCarry {
  return { extras: note ? [note] : [], replyTo: messageId, addressed: null }
}

/**
 * Did the model produce nothing at all?
 *
 * Committed as-is, that left an empty assistant bubble with no explanation,
 * which reads as the app having lost the reply rather than the model having
 * produced none. Reasoning counts: an agent CLI often says everything it has to
 * say through its tool narration.
 */
export function isEmptyTurn(reply: string, reasoning: string, callCount: number): boolean {
  return !reply.trim() && !reasoning.trim() && callCount === 0
}
