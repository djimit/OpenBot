/**
 * Event fan-out to the renderer.
 *
 * A broadcast must never throw into the loop, and in-process listeners (tests,
 * tooling) see the same stream the window does.
 */

import type { AgentEvent } from '../../shared/types'
import { broadcast as sendToWindows } from '../ipc/broadcast'
import { errorMessage } from './errors'

type Listener = (event: AgentEvent) => void

const listeners = new Set<Listener>()

export function onAgentEvent(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function broadcast(event: AgentEvent): void {
  for (const listener of listeners) {
    try {
      listener(event)
    } catch {
      /* a bad listener must never break the loop */
    }
  }
  try {
    sendToWindows(event)
  } catch (err) {
    console.warn(`[agent] broadcast failed: ${errorMessage(err)}`)
  }
}

export function broadcastError(sessionId: string, message: string): void {
  broadcast({ type: 'error', sessionId, message })
}
