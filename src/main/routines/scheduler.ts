/** Durable in-app scheduler for recorded routines. */

import type { Routine, Session } from '../../shared/types'
import { loopFn } from '../ipc/agentRuntime'
import { getBot } from '../store/bots'
import { listRoutines, markRoutineRun } from '../store/routines'
import { allSessions, createSession, renameSession } from '../store/sessions'
import { cronIsDue } from './cron'

const TICK_MS = 30_000

let timer: ReturnType<typeof setInterval> | undefined
let ticking = false
const running = new Set<string>()

function targetSession(routine: Routine): Session {
  // Include the routine identity so two same-named routines never race inside
  // one session and cause one another to be rejected as "already busy".
  const title = `Scheduled: ${routine.name} (${routine.id.slice(0, 8)})`
  const existing = allSessions()
    .filter((session) =>
      !session.archived &&
      session.title === title &&
      session.botIds.length === 1 &&
      session.botIds[0] === routine.botId
    )
    .sort((a, b) => b.updatedAt - a.updatedAt)[0]
  if (existing) return existing
  const created = createSession([routine.botId])
  return renameSession(created.id, title) ?? created
}

async function runScheduled(routine: Routine, now: number): Promise<void> {
  if (running.has(routine.id) || !getBot(routine.botId)) return
  running.add(routine.id)
  try {
    const run = await loopFn('runRoutine')
    if (!run) {
      console.warn(`[openbot/scheduler] agent runtime unavailable for "${routine.name}"`)
      return
    }

    // Stamp before starting. The 30-second timer can fire again while the replay
    // is waiting for approval; this makes that occurrence exactly-once in-process.
    markRoutineRun(routine.id, now)
    const session = targetSession(routine)
    await run(routine.id, session.id)
  } catch (err) {
    console.error(`[openbot/scheduler] routine "${routine.name}" failed`, err)
  } finally {
    running.delete(routine.id)
  }
}

export async function tickRoutineScheduler(now = Date.now()): Promise<void> {
  if (ticking) return
  ticking = true
  try {
    const due = listRoutines().filter((routine) => {
      const cron = routine.trigger.kind === 'schedule' ? routine.trigger.cron : undefined
      if (!cron || running.has(routine.id)) return false
      return cronIsDue(cron, routine.lastRunAt ?? routine.createdAt, now)
    })
    // Do not hold the scheduler clock open for a replay that can run for hours.
    // Each routine owns its promise and its running guard; later ticks can still
    // start unrelated work on time.
    for (const routine of due) void runScheduled(routine, now)
  } finally {
    ticking = false
  }
}

export function startRoutineScheduler(): void {
  if (timer) return
  void tickRoutineScheduler()
  timer = setInterval(() => void tickRoutineScheduler(), TICK_MS)
  timer.unref?.()
}

export function stopRoutineScheduler(): void {
  if (timer) clearInterval(timer)
  timer = undefined
}
