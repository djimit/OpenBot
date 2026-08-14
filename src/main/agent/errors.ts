/** Error normalisation. The loop must never surface a raw thrown value to the UI. */

import { stringifySafe } from './json'

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || err.name
  if (typeof err === 'string') return err
  return stringifySafe(err, 500)
}

/** True for user-initiated stops and stream aborts, which are not real failures. */
export function isAbortError(err: unknown): boolean {
  if (!err) return false
  if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
    return true
  }
  const msg = errorMessage(err).toLowerCase()
  return (
    msg.includes('aborted') ||
    msg.includes('abort error') ||
    msg.includes('cancelled') ||
    msg.includes('canceled')
  )
}
