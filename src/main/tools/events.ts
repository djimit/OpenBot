/**
 * Emitting streaming events back to the renderer.
 *
 * `AgentEvent` is a locked union with no dedicated "partial tool output" case,
 * so incremental output is published as repeated `tool-result` events carrying
 * the same `callId` and `detail.partial === true`; the renderer replaces the
 * row in place and the final event clears the flag.
 */

import type { AgentEvent, ToolResult } from '../../shared/types'
import type { ToolContext } from './types'

/** Emit without ever letting a renderer-side failure break a tool. */
export function safeEmit(ctx: ToolContext, event: AgentEvent): void {
  try {
    ctx.emit(event)
  } catch {
    /* the event sink is best-effort */
  }
}

/** Publish a partial `ToolResult`. No-op when the host gave us no `messageId`. */
export function emitPartial(ctx: ToolContext, result: Omit<ToolResult, 'callId'>): void {
  if (!ctx.messageId) return
  safeEmit(ctx, {
    type: 'tool-result',
    sessionId: ctx.sessionId,
    messageId: ctx.messageId,
    result: { ...result, callId: ctx.callId ?? '' }
  })
}

/** Publish a captured frame so the UI can mirror what the agent sees. */
export function emitFrame(ctx: ToolContext, base64Png: string): void {
  safeEmit(ctx, { type: 'computer-frame', sessionId: ctx.sessionId, screenshot: base64Png })
}

/**
 * Rate-limits a stream of updates so a chatty process cannot flood IPC.
 * Returns a function that runs `flush` at most once per `intervalMs`.
 */
export function throttle(intervalMs: number, flush: () => void): { tick(): void; final(): void } {
  let last = 0
  return {
    tick(): void {
      const now = Date.now()
      if (now - last < intervalMs) return
      last = now
      flush()
    },
    final(): void {
      last = Date.now()
      flush()
    }
  }
}
