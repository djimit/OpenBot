/**
 * Routines — recorded step sequences a bot can replay.
 * One `routines/<id>.json` per routine.
 */

import { randomUUID } from 'node:crypto'
import type { Routine, RoutineStep, RoutineStepKind } from '../../shared/types'
import { JsonCollection } from './collection'
import { routinesDir } from './paths'
import { isValidCron } from '../routines/cron'

const STEP_KINDS: ReadonlyArray<RoutineStepKind> = [
  'observe',
  'click',
  'double_click',
  'type',
  'key',
  'scroll',
  'drag',
  'open_app',
  'navigate',
  'wait',
  'tool',
  'assert'
]

function normaliseSteps(value: unknown): RoutineStep[] {
  if (!Array.isArray(value)) return []
  const out: RoutineStep[] = []
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) continue
    const source = raw as Record<string, unknown>
    const kind = source['kind']
    if (!(STEP_KINDS as ReadonlyArray<string>).includes(kind as string)) continue
    const step: RoutineStep = {
      id: typeof source['id'] === 'string' && source['id'] ? source['id'] : randomUUID(),
      kind: kind as RoutineStepKind,
      intent: typeof source['intent'] === 'string' ? source['intent'] : ''
    }
    const params = source['params']
    if (typeof params === 'object' && params !== null && !Array.isArray(params)) {
      step.params = params as Record<string, unknown>
    }
    if (typeof source['reference'] === 'string') step.reference = source['reference']
    out.push(step)
  }
  return out
}

function normaliseRoutine(raw: unknown): Routine | null {
  if (typeof raw !== 'object' || raw === null) return null
  const value = raw as Record<string, unknown>
  const id = typeof value['id'] === 'string' ? value['id'] : ''
  if (!id) return null
  const trigger = value['trigger']
  const requestedTriggerKind =
    typeof trigger === 'object' && trigger !== null && (trigger as Record<string, unknown>)['kind'] === 'schedule'
      ? 'schedule'
      : 'manual'
  const cron =
    typeof trigger === 'object' && trigger !== null
      ? (trigger as Record<string, unknown>)['cron']
      : undefined

  const routine: Routine = {
    id,
    botId: typeof value['botId'] === 'string' ? value['botId'] : '',
    name: typeof value['name'] === 'string' && value['name'] ? value['name'] : 'Untitled routine',
    description: typeof value['description'] === 'string' ? value['description'] : '',
    steps: normaliseSteps(value['steps']),
    trigger: {
      kind: requestedTriggerKind === 'schedule' && typeof cron === 'string' && isValidCron(cron)
        ? 'schedule'
        : 'manual'
    },
    replayMode: value['replayMode'] === 'literal' ? 'literal' : 'adaptive',
    createdAt: typeof value['createdAt'] === 'number' ? value['createdAt'] : Date.now()
  }
  if (routine.trigger.kind === 'schedule' && typeof cron === 'string') routine.trigger.cron = cron.trim()
  if (typeof value['lastRunAt'] === 'number') routine.lastRunAt = value['lastRunAt']
  return routine
}

const collection = new JsonCollection<Routine>(routinesDir, normaliseRoutine)

export async function loadRoutines(): Promise<void> {
  await collection.load()
}

/** All routines, newest first; optionally filtered to one bot. */
export function listRoutines(botId?: string): Routine[] {
  const all = collection.all()
  const filtered = botId ? all.filter((routine) => routine.botId === botId) : all
  return filtered.sort((a, b) => b.createdAt - a.createdAt)
}

export function getRoutine(id: string): Routine | null {
  return collection.get(id)
}

/** Upsert a routine — used by the recorder when it finishes capturing. */
export function saveRoutine(routine: Routine): Routine {
  return collection.put(normaliseRoutine(routine) ?? routine)
}

export function createRoutine(partial: Partial<Routine> = {}): Routine {
  const routine: Routine = {
    id: randomUUID(),
    botId: partial.botId ?? '',
    name: partial.name?.trim() || 'New routine',
    description: partial.description ?? '',
    steps: normaliseSteps(partial.steps),
    trigger: partial.trigger ?? { kind: 'manual' },
    replayMode: partial.replayMode === 'literal' ? 'literal' : 'adaptive',
    createdAt: Date.now()
  }
  return collection.put(routine)
}

export function updateRoutine(id: string, patch: Partial<Routine>): Routine | null {
  const existing = collection.get(id)
  if (!existing) return null
  const next = { ...existing, ...patch, id: existing.id, createdAt: existing.createdAt }
  if (existing.trigger.kind !== 'schedule' && patch.trigger?.kind === 'schedule') {
    // Scheduling starts now. Do not interpret the routine's original recording
    // date as downtime and immediately run a newly enabled old routine.
    next.lastRunAt = Date.now()
  }
  return collection.put(normaliseRoutine(next) ?? existing)
}

/** Stamp a successful (or attempted) replay. */
export function markRoutineRun(id: string, at = Date.now()): Routine | null {
  const existing = collection.get(id)
  if (!existing) return null
  return collection.put({ ...existing, lastRunAt: at })
}

export function removeRoutine(id: string): boolean {
  return collection.delete(id)
}

/** Delete every manual or scheduled routine owned by a deleted bot. */
export function removeRoutinesForBot(botId: string): number {
  let removed = 0
  for (const routine of collection.all()) {
    if (routine.botId === botId && collection.delete(routine.id)) removed += 1
  }
  return removed
}

/** Conventional name the agent loop's recorder resolves `saveRoutine` by. */
export const save = saveRoutine

/** Conventional short name for `updateRoutine`. */
export const update = updateRoutine
