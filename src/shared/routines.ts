/**
 * Routines: workflows captured by demonstration, then replayed.
 *
 * `literal` replays captured coordinates directly; `adaptive` re-derives each
 * step from its `intent` plus a fresh screenshot, which survives UI drift.
 */

export type RoutineStepKind =
  | 'observe'
  | 'click'
  | 'double_click'
  | 'type'
  | 'key'
  | 'scroll'
  | 'drag'
  | 'open_app'
  | 'navigate'
  | 'wait'
  | 'tool'
  | 'assert'

export interface RoutineStep {
  id: string
  kind: RoutineStepKind
  /** Natural-language description, used when replaying adaptively. */
  intent: string
  /** Literal coordinates/keys captured at record time. */
  params?: Record<string, unknown>
  /** base64 PNG captured at record time, for visual re-anchoring. */
  reference?: string
}

export interface Routine {
  id: string
  botId: string
  name: string
  description: string
  steps: RoutineStep[]
  trigger: { kind: 'manual' | 'schedule'; cron?: string }
  replayMode: 'literal' | 'adaptive'
  createdAt: number
  lastRunAt?: number
}

export type RecordingState = 'idle' | 'recording' | 'paused'
