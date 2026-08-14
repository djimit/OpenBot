/**
 * Runaway guards.
 *
 * Two independent caps stop a turn that has stopped making progress:
 *   · iterations      — model round-trips within one user turn (tool use loops)
 *   · handoffs        — consecutive bot-to-bot passes without user input (ping-pong)
 *
 * Both are counted per session and reset when the user speaks again.
 */

export const MAX_ITERATIONS = 25
/**
 * Consecutive bot-to-bot handoffs before the user is asked to step in.
 *
 * Real collaboration — one bot plans, another builds, the first reviews, they
 * revise — needs several rounds, so a tight cap cuts the work off mid-flight.
 * It stays bounded so two bots cannot loop indefinitely on the user's tokens.
 */
export const MAX_CONSECUTIVE_HANDOFFS = 12

interface Counters {
  iterations: number
  handoffs: number
}

const counters = new Map<string, Counters>()

function countersFor(sessionId: string): Counters {
  let c = counters.get(sessionId)
  if (!c) {
    c = { iterations: 0, handoffs: 0 }
    counters.set(sessionId, c)
  }
  return c
}

/** Called when the user sends a message: a fresh turn starts with fresh budgets. */
export function resetTurn(sessionId: string): void {
  counters.set(sessionId, { iterations: 0, handoffs: 0 })
}

export function forget(sessionId: string): void {
  counters.delete(sessionId)
}

/** Consume one iteration. False means the cap is reached and the turn must end. */
export function takeIteration(sessionId: string): boolean {
  const c = countersFor(sessionId)
  if (c.iterations >= MAX_ITERATIONS) return false
  c.iterations++
  return true
}

export function iterationsUsed(sessionId: string): number {
  return countersFor(sessionId).iterations
}

/** Consume one handoff. False means the handoff must be refused. */
export function takeHandoff(sessionId: string): boolean {
  const c = countersFor(sessionId)
  if (c.handoffs >= MAX_CONSECUTIVE_HANDOFFS) return false
  c.handoffs++
  return true
}

export function handoffsUsed(sessionId: string): number {
  return countersFor(sessionId).handoffs
}

/** A turn that ends without handing off clears the ping-pong counter. */
/** Handovers still allowed before the user is asked to step in. */
export function handoffsLeft(sessionId: string): number {
  return Math.max(0, MAX_CONSECUTIVE_HANDOFFS - handoffsUsed(sessionId))
}

export function clearHandoffs(sessionId: string): void {
  countersFor(sessionId).handoffs = 0
}

export function iterationCapMessage(sessionId: string): string {
  return (
    `Stopped after ${iterationsUsed(sessionId)} tool iterations — the safety cap for a ` +
    `single turn (${MAX_ITERATIONS}). The work so far is kept above. Send another ` +
    `message to continue, ideally with a narrower next step.`
  )
}

export function handoffCapMessage(sessionId: string): string {
  return (
    `Handoff refused: ${handoffsUsed(sessionId)} consecutive handoffs already happened ` +
    `without user input (cap ${MAX_CONSECUTIVE_HANDOFFS}). Answer directly with what you ` +
    `have, or ask the user how to proceed.`
  )
}
