/** Token estimation. Deliberately cheap: windowing only needs the right order of magnitude. */

import type { ProviderMessage } from './contracts'
import { imageCount, textOf } from './contracts'

/** ~4 characters per token, the usual approximation for BPE tokenisers. */
export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}

/** Per-message envelope overhead (role, separators, tool metadata). */
const MESSAGE_OVERHEAD = 6
/** Images cost far more than their text; charge a flat, conservative price. */
const IMAGE_COST = 800

export function estimateMessageTokens(message: ProviderMessage): number {
  let total = MESSAGE_OVERHEAD + estimateTokens(textOf(message))
  if (message.reasoning) total += estimateTokens(message.reasoning)
  for (const call of message.toolCalls ?? []) {
    total += estimateTokens(call.name) + estimateTokens(JSON.stringify(call.args ?? {}))
  }
  return total + imageCount(message) * IMAGE_COST
}

export function estimateMessagesTokens(messages: ProviderMessage[]): number {
  let total = 0
  for (const message of messages) total += estimateMessageTokens(message)
  return total
}

/**
 * Trim text so it costs at most `maxTokens`.
 *
 * The ellipsis is charged for. Appending it to a full-width slice made the
 * result one character — and so one token — over the limit it was asked for,
 * which the budgeter could never close: every message it shrank came back a
 * token too big, and the prompt stayed over the window.
 */
export function fitToTokens(text: string, maxTokens: number): string {
  const maxChars = Math.max(0, maxTokens * 4)
  if (text.length <= maxChars) return text
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`
}
