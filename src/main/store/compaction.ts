/**
 * Bounds what a session file can grow to.
 *
 * A session is rewritten whole on every debounced save, so its size is a cost
 * paid on each message rather than once. Text is cheap; the payloads are not —
 * a single computer-use frame is a multi-megabyte base64 PNG, and twenty of
 * them in one chat means twenty megabytes re-serialised every time the user
 * types. That is the growth this bounds.
 *
 * Scope is deliberately narrow — only screen captures, and only on messages
 * that have already scrolled out of the recent window. Three things it used to
 * do have been removed, because each cost more than it saved:
 *
 *   - dropping attachment bytes "since a path can re-read them": nothing in the
 *     app ever re-reads one. The bytes ARE the attachment, and a `selection` is
 *     the user's own highlighted text, which no path can reconstruct.
 *   - truncating tool output to 4 000 chars: below the 8 000 the model context
 *     already allows, so it shrank what the model could see rather than the
 *     file, and it was the one branch that was not idempotent.
 *   - anything to the conversation itself, which is never touched.
 *
 * What remains is the growth that actually mattered: a computer-use frame is a
 * multi-megabyte base64 PNG, and the session is rewritten whole on every save,
 * so twenty frames meant twenty megabytes re-serialised on every message.
 *
 * The honest cost: a frame older than the window cannot be scrolled back to,
 * and a very long computer-use turn sees its own oldest frames disappear from
 * context. The window is sized so an ordinary turn never reaches that.
 *
 * Everything here is idempotent — a second pass returns the very same object —
 * which is what makes it safe to run on every write.
 */

import type { Message, Session, ToolResult } from '../../shared/types'

/**
 * Messages at the end of the chat that keep every payload intact.
 *
 * Sized to cover a whole computer-use turn: the model must not watch its own
 * recent history change shape while it is still working through a task.
 */
const KEEP_RICH = 60

/** Serialised `detail` above this is replaced — a renderer hint, not content. */
const DETAIL_LIMIT = 262_144

export function compactSession(session: Session): Session {
  const messages = session.messages ?? []
  const cutoff = messages.length - KEEP_RICH
  if (cutoff <= 0) return session

  let changed = false
  const next = messages.map((message, index) => {
    if (index >= cutoff) return message
    const compacted = compactMessage(message)
    if (compacted !== message) changed = true
    return compacted
  })

  // Returning the same object when nothing moved keeps the caller's identity
  // checks meaningful, and avoids a pointless write.
  return changed ? { ...session, messages: next } : session
}

function compactMessage(message: Message): Message {
  const result = message.toolResult ? compactResult(message.toolResult) : message.toolResult
  if (result === message.toolResult) return message

  // Spread carries every other field; only the result is replaced.
  return { ...message, toolResult: result }
}

function compactResult(result: ToolResult): ToolResult {
  const oversizedDetail = result.detail !== undefined && serialisedSize(result.detail) > DETAIL_LIMIT

  if (!result.screenshot && !oversizedDetail) return result

  const next: ToolResult = { ...result, compacted: true }
  delete next.screenshot
  if (oversizedDetail) next.detail = { compacted: true }
  return next
}

/**
 * Cost of a `detail` payload, without throwing on a cycle or a bigint that a
 * tool put there — an unserialisable detail would break the save anyway, so it
 * is treated as oversized and replaced.
 */
function serialisedSize(detail: unknown): number {
  try {
    return JSON.stringify(detail)?.length ?? 0
  } catch {
    return DETAIL_LIMIT + 1
  }
}
