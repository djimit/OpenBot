import type { OpenBotApi } from '../../../shared/types'

/**
 * Access to the preload bridge. Nothing else in the renderer touches
 * `window.openbot` directly, so a missing bridge fails in exactly one place.
 */
export function tryBridge(): OpenBotApi | null {
  return (window as unknown as { openbot?: OpenBotApi }).openbot ?? null
}

/** Use only after boot has confirmed the bridge exists. */
export function bridge(): OpenBotApi {
  const api = tryBridge()
  if (!api) throw new Error('The agent bridge is unavailable.')
  return api
}

export function errText(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  return 'Something went wrong.'
}
