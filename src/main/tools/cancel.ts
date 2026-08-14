/**
 * Cancellation helpers built on the `AbortSignal` carried by `ToolContext`.
 */

import { ToolError } from './errors'
import type { ToolContext } from './types'

/** Refuse to start work the user has already stopped. */
export function throwIfAborted(ctx: ToolContext, what: string): void {
  if (ctx.signal?.aborted) throw new ToolError(`${what} was cancelled before it started.`)
}

/**
 * Reject as soon as the run is aborted, without leaking the abort listener.
 * The underlying work is not itself interrupted — callers that can interrupt
 * (process spawn, HTTP) pass the signal down as well.
 */
export function raceAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined, what: string): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(new ToolError(`${what} was cancelled.`))
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new ToolError(`${what} was cancelled.`))
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    )
  })
}

/** A signal that aborts when either input aborts. Callers must `dispose()`. */
export function linkSignals(
  a: AbortSignal | undefined,
  timeoutMs: number
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs)
  const onAbort = (): void => controller.abort(new Error('cancelled'))
  if (a) {
    if (a.aborted) controller.abort(new Error('cancelled'))
    else a.addEventListener('abort', onAbort, { once: true })
  }
  return {
    signal: controller.signal,
    dispose: (): void => {
      clearTimeout(timer)
      a?.removeEventListener('abort', onAbort)
    }
  }
}
