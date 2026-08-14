/**
 * Routine recording.
 *
 * While recording, every tool call a bot actually executes is captured as a `RoutineStep`
 * with the natural-language intent behind it and — for computer-use steps — the screenshot
 * that was on screen, so an adaptive replay can re-anchor visually.
 *
 * One recording at a time: `stopRecording()` takes no arguments in the IPC contract.
 */

import type { Routine, RoutineStep, RoutineStepKind, ToolCall, ToolResult } from '../../shared/types'
import { broadcast } from './events'
import { newId, now } from './ids'
import { routines } from './routineGateway'
import { stringifySafe } from './json'
import { firstSentence, truncate } from './text'

/** Tool name → step kind. Anything unmapped is a generic `tool` step. */
const KINDS: Record<string, RoutineStepKind> = {
  screenshot: 'observe',
  click: 'click',
  double_click: 'double_click',
  type_text: 'type',
  key_press: 'key',
  scroll: 'scroll',
  drag: 'drag',
  open_app: 'open_app',
  navigate: 'navigate'
}

/** Key used to remember which tool produced a step, without disturbing its params. */
export const TOOL_PARAM_KEY = '_tool'

interface Recording {
  botId: string
  name: string
  steps: RoutineStep[]
  startedAt: number
}

let active: Recording | null = null
/** Most recent computer frame seen, used when a step has no screenshot of its own. */
let lastFrame: string | undefined

export function recordingState(): 'idle' | 'recording' | 'paused' {
  return active ? 'recording' : 'idle'
}

export function isRecording(): boolean {
  return active !== null
}

export function recordingBotId(): string | null {
  return active?.botId ?? null
}

export function startRecording(botId: string, name: string): void {
  active = { botId, name: name.trim() || 'Untitled routine', steps: [], startedAt: now() }
  lastFrame = undefined
  broadcast({ type: 'recording-state', state: 'recording', stepCount: 0 })
}

/** Remember the latest frame so non-visual steps still get a reference image. */
export function noteFrame(screenshot: string | undefined): void {
  if (screenshot) lastFrame = screenshot
}

export interface CaptureInput {
  botId: string
  call: ToolCall
  result: ToolResult
  /** The assistant's own words leading into the call, when there were any. */
  intent?: string
}

export function captureToolStep(input: CaptureInput): void {
  if (!active || input.botId !== active.botId) return
  if (!input.result.ok) return

  const kind = KINDS[input.call.name] ?? 'tool'
  const step: RoutineStep = {
    id: newId('step'),
    kind,
    intent: buildIntent(input),
    params: { ...(input.call.args ?? {}), [TOOL_PARAM_KEY]: input.call.name },
    reference: input.result.screenshot ?? lastFrame
  }

  active.steps.push(step)
  noteFrame(input.result.screenshot)
  broadcast({ type: 'recording-step', step })
  broadcast({ type: 'recording-state', state: 'recording', stepCount: active.steps.length })
}

export async function stopRecording(): Promise<Routine | null> {
  const recording = active
  active = null
  lastFrame = undefined
  broadcast({ type: 'recording-state', state: 'idle', stepCount: recording?.steps.length ?? 0 })

  if (!recording || recording.steps.length === 0) return null

  const usesComputer = recording.steps.some((s) => s.kind !== 'tool' && s.kind !== 'observe')
  const routine: Routine = {
    id: newId('routine'),
    botId: recording.botId,
    name: recording.name,
    description: describeRoutine(recording),
    steps: recording.steps,
    trigger: { kind: 'manual' },
    // Computer-use routines drift with the UI, so they default to re-planning each step.
    replayMode: usesComputer ? 'adaptive' : 'literal',
    createdAt: now()
  }

  return routines.save(routine)
}

function describeRoutine(recording: Recording): string {
  const first = recording.steps[0]?.intent ?? ''
  return truncate(
    `${recording.steps.length} recorded steps${first ? `, starting with: ${first}` : ''}`,
    300
  )
}

function buildIntent(input: CaptureInput): string {
  const spoken = firstSentence(input.intent ?? '', 160)
  if (spoken) return spoken
  return describeCall(input.call)
}

/** Readable fallback intent when the model narrated nothing before acting. */
export function describeCall(call: ToolCall): string {
  const args = call.args ?? {}
  switch (call.name) {
    case 'click':
    case 'double_click':
      return `Click ${labelFor(args)}`
    case 'type_text':
      return `Type ${truncate(String(args['text'] ?? ''), 60)}`
    case 'key_press':
      return `Press ${String(args['key'] ?? args['keys'] ?? '')}`
    case 'scroll':
      return `Scroll ${String(args['direction'] ?? '')}`.trim()
    case 'open_app':
      return `Open ${String(args['app'] ?? args['name'] ?? '')}`
    case 'navigate':
      return `Go to ${String(args['url'] ?? '')}`
    case 'screenshot':
      return 'Look at the screen'
    default:
      return `Run ${call.name} with ${truncate(stringifySafe(args, 200), 200)}`
  }
}

function labelFor(args: Record<string, unknown>): string {
  const label = args['label'] ?? args['target'] ?? args['selector']
  if (typeof label === 'string' && label.trim()) return label.trim()
  const x = args['x']
  const y = args['y']
  if (typeof x === 'number' && typeof y === 'number') return `the element at (${x}, ${y})`
  return 'the target element'
}
