/**
 * IPC for `OpenBotApi.routines`. Reads come straight from the store; replay
 * and recording are delegated to the agent loop, and whatever the recorder
 * hands back is persisted here so a routine is never lost.
 */

import type { Routine } from '../../shared/types'
import { getBot } from '../store/bots'
import {
  getRoutine,
  listRoutines,
  markRoutineRun,
  removeRoutine,
  saveRoutine,
  updateRoutine
} from '../store/routines'
import { getSession } from '../store/sessions'
import { AGENT_UNAVAILABLE, loopFn } from './agentRuntime'
import { broadcast } from './broadcast'
import { CHANNELS } from './channels'
import { emptyArray, handle, handleVoid, nullResult } from './handler'
import { asId, asOptionalId, asPatch, asString } from './validate'
import { isValidCron } from '../routines/cron'

/**
 * Only the four fields the UI can edit survive the bridge. Identity, the
 * recorded steps and the creation time are ours — a patch cannot reach them,
 * so a malformed or hostile payload can never rewrite what was recorded.
 */
function editablePatch(value: unknown): Partial<Routine> {
  const patch = asPatch<Routine>(value)
  const out: Partial<Routine> = {}

  if (typeof patch.name === 'string') {
    const name = patch.name.trim().slice(0, 200)
    if (name) out.name = name
  }
  if (typeof patch.description === 'string') {
    out.description = patch.description.slice(0, 4000)
  }
  if (patch.replayMode === 'literal' || patch.replayMode === 'adaptive') {
    out.replayMode = patch.replayMode
  }
  // The store's normaliser has the last word on the trigger's shape.
  if (typeof patch.trigger === 'object' && patch.trigger !== null && !Array.isArray(patch.trigger)) {
    if (patch.trigger.kind === 'manual') out.trigger = { kind: 'manual' }
    else if (patch.trigger.kind === 'schedule' && typeof patch.trigger.cron === 'string' && isValidCron(patch.trigger.cron)) {
      out.trigger = { kind: 'schedule', cron: patch.trigger.cron.trim() }
    } else {
      throw new TypeError('A scheduled routine needs a valid five-field cron expression.')
    }
  }
  return out
}

/** Returned only when `update` fails outright, so the renderer still renders. */
function placeholderRoutine(id: string): Routine {
  return {
    id,
    botId: '',
    name: 'Unavailable',
    description: '',
    steps: [],
    trigger: { kind: 'manual' },
    replayMode: 'adaptive',
    createdAt: Date.now()
  }
}

export function registerRoutineIpc(): void {
  handle<Routine[]>(CHANNELS.routinesList, ([botId]) => listRoutines(asOptionalId(botId)), emptyArray)

  handle<Routine | null>(CHANNELS.routinesGet, ([id]) => getRoutine(asId(id)), nullResult)

  handle<Routine>(
    CHANNELS.routinesUpdate,
    ([id, patch]) => {
      const routineId = asId(id)
      const updated = updateRoutine(routineId, editablePatch(patch))
      if (!updated) throw new TypeError(`unknown routine: ${routineId}`)
      return updated
    },
    (args) => {
      const id = typeof args[0] === 'string' ? args[0] : ''
      return (id ? getRoutine(id) : null) ?? placeholderRoutine(id)
    }
  )

  handleVoid(CHANNELS.routinesRemove, ([id]) => {
    removeRoutine(asId(id))
  })

  handleVoid(CHANNELS.routinesRun, async ([id, sessionId]) => {
    const routineId = asId(id)
    const session = asId(sessionId)
    if (!getRoutine(routineId)) {
      broadcast({ type: 'error', sessionId: session, message: 'That routine no longer exists.' })
      return
    }
    if (!getSession(session)) {
      broadcast({ type: 'error', sessionId: session, message: 'That conversation no longer exists.' })
      return
    }
    const run = await loopFn('runRoutine')
    if (!run) {
      broadcast({ type: 'error', sessionId: session, message: AGENT_UNAVAILABLE })
      broadcast({ type: 'done', sessionId: session })
      return
    }
    markRoutineRun(routineId)
    await run(routineId, session)
  })

  handleVoid(CHANNELS.routinesStartRecording, async ([botId, name]) => {
    const id = asId(botId)
    const label = asString(name, 200).trim() || 'New routine'
    if (!getBot(id)) throw new TypeError(`unknown bot: ${id}`)
    const start = await loopFn('startRecording')
    if (!start) {
      broadcast({ type: 'recording-state', state: 'idle', stepCount: 0 })
      return
    }
    await start(id, label)
  })

  handle<Routine | null>(
    CHANNELS.routinesStopRecording,
    async () => {
      const stop = await loopFn('stopRecording')
      if (!stop) {
        broadcast({ type: 'recording-state', state: 'idle', stepCount: 0 })
        return null
      }
      const routine = await stop()
      if (!routine) return null
      // Persist regardless of whether the recorder already saved it.
      return saveRoutine(routine)
    },
    nullResult
  )
}
