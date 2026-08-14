/** Identifier and clock primitives for agent-generated records. */

let seq = 0

/** Collision-resistant id with a readable prefix (`msg_`, `call_`, `step_`…). */
export function newId(prefix = 'id'): string {
  seq = (seq + 1) % 0xffffff
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}${Math.random()
    .toString(36)
    .slice(2, 8)}`
}

/** Single clock source, so tests can stub one function. */
export function now(): number {
  return Date.now()
}
