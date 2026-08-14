/** Routine reads/writes, over `store/routines`. */

import type { Routine } from '../../shared/types'
import { getRoutine, listRoutines, markRoutineRun, saveRoutine } from '../store/routines'
import { errorMessage } from './errors'

export const routines = {
  async get(id: string): Promise<Routine | null> {
    const routine = getRoutine(id)
    if (!routine) return null
    if (!Array.isArray(routine.steps)) routine.steps = []
    return routine
  },

  async list(botId?: string): Promise<Routine[]> {
    return listRoutines(botId)
  },

  async save(routine: Routine): Promise<Routine> {
    try {
      return saveRoutine(routine)
    } catch (err) {
      console.warn(`[agent] routine save failed: ${errorMessage(err)}`)
      return routine
    }
  },

  /** Stamp `lastRunAt` after a replay. */
  async markRun(id: string): Promise<void> {
    try {
      markRoutineRun(id)
    } catch (err) {
      console.warn(`[agent] routine run stamp failed: ${errorMessage(err)}`)
    }
  }
}
