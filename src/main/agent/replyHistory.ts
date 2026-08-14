/**
 * Has this session already heard this reply?
 *
 * The backstop against a stalled exchange: when two bots have nothing left to
 * add they restate themselves rather than stopping, and the handoff cap alone
 * would let that run a dozen turns on the user's tokens.
 *
 * Cross-turn only. Repetition *inside* one reply is a different fault with a
 * different cause — see `repetition.ts`.
 */

/** Signatures kept per session; older ones stop mattering once the work moves on. */
const KEEP = 6

const recentReplies = new Map<string, string[]>()

/**
 * Comparable form of a reply.
 *
 * Normalising away punctuation, emoji and case makes near-identical turns —
 * the same greeting reworded — compare equal.
 *
 * The WHOLE reply is compared. Truncating the signature to its first 240
 * characters made two bots that open the same way — a shared preamble, a
 * restated goal, the moderator's own framing echoed back — indistinguishable
 * however differently they went on. A genuinely new reply carrying a real
 * handoff then read as a repeat, and `turnAction` answers a repeat by dropping
 * the handoff and ending the exchange, so the collaboration died silently on
 * the first substantial turn.
 */
export function replySignature(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function isRepeatReply(sessionId: string, text: string): boolean {
  const signature = replySignature(text)
  if (signature.length < 24) return false

  const seen = recentReplies.get(sessionId) ?? []
  const repeat = seen.includes(signature)
  recentReplies.set(sessionId, [...seen, signature].slice(-KEEP))
  return repeat
}

/** Called when the user speaks: a new instruction makes the history irrelevant. */
export function clearReplyHistory(sessionId: string): void {
  recentReplies.delete(sessionId)
}
