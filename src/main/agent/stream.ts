/**
 * Consumes one backend stream and fans it out to the renderer.
 *
 * Owns the delta events for a single assistant message. Whether a model calls tools
 * natively or through the prompted fallback is the adapter's business — by the time
 * chunks arrive here they are already normalised, and agent-CLI adapters deliberately
 * render their own tool activity as text so nothing is executed twice.
 */

import type { ToolCall } from '../../shared/types'
import type { ChatChunk } from './contracts'
import { broadcast } from './events'
import { asRecord } from './json'
import { normaliseCall } from './backendGateway'

export interface StreamTurnInput {
  sessionId: string
  messageId: string
  stream: AsyncIterable<ChatChunk>
  signal: AbortSignal
  /** Active model's window, so usage can be shown as a proportion. */
  contextWindow?: number
  /**
   * Called for every chunk that carried something — proof the backend is still
   * working.
   *
   * A supervised turn is bounded by an inactivity clock rather than by total
   * duration, and this is what resets it.
   */
  onActivity?: () => void
}

export interface StreamTurnResult {
  text: string
  reasoning: string
  calls: ToolCall[]
  aborted: boolean
  /**
   * The stream failed partway through. Reported rather than thrown so the
   * caller still has whatever was streamed before it broke: a CLI that answers
   * and then dies has said something real, and dropping it would leave the user
   * with an error where half an answer had already appeared on screen.
   */
  error?: unknown
}

/**
 * Did this chunk carry anything at all?
 *
 * Every object used to count, empty ones included: `{ type: 'text', delta: '' }`
 * and types this loop does nothing with. A backend that emits empty keepalives —
 * or one wedged in a loop emitting a no-op — held the twenty-minute idle timeout
 * open indefinitely, which is precisely the case the clock exists to catch.
 */
function carriedContent(chunk: ChatChunk): boolean {
  switch (chunk.type) {
    case 'text':
    case 'reasoning':
      return (chunk.delta ?? '') !== ''
    case 'tool_call':
      return Boolean(chunk.call)
    case 'usage':
      return Boolean(chunk.usage)
    case 'done':
      return true
    default:
      return false
  }
}

export async function streamAssistantTurn(input: StreamTurnInput): Promise<StreamTurnResult> {
  const { sessionId, messageId, signal } = input

  let text = ''
  let reasoning = ''
  const calls: ToolCall[] = []
  let aborted = false
  let error: unknown

  try {
    for await (const chunk of input.stream) {
      if (signal.aborted) {
        aborted = true
        break
      }
      if (!chunk || typeof chunk !== 'object') continue
      if (carriedContent(chunk)) input.onActivity?.()

      if (chunk.type === 'text') {
        const delta = chunk.delta ?? ''
        if (!delta) continue
        text += delta
        broadcast({ type: 'text-delta', sessionId, messageId, delta })
      } else if (chunk.type === 'reasoning') {
        const delta = chunk.delta ?? ''
        if (!delta) continue
        reasoning += delta
        broadcast({ type: 'reasoning-delta', sessionId, messageId, delta })
      } else if (chunk.type === 'tool_call' && chunk.call) {
        const call = normaliseCall(asRecord(chunk.call))
        if (!call.name) continue
        calls.push(call)
        broadcast({ type: 'tool-call', sessionId, messageId, call })
      } else if (chunk.type === 'usage' && chunk.usage) {
        // Context accounting from the backend; the UI turns it into a ratio.
        broadcast({
          type: 'token-usage',
          sessionId,
          usage: chunk.usage,
          ...(input.contextWindow ? { contextWindow: input.contextWindow } : {})
        })
      } else if (chunk.type === 'done') {
        break
      }
    }
  } catch (err) {
    error = err
  }

  return { text, reasoning, calls, aborted, error }
}
