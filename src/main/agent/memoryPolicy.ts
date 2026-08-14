/**
 * When a finished turn is allowed to spend a second model call on memory.
 *
 * Extraction reads as a cheap afterthought, and on a direct model API it is
 * one: a short JSON completion. On an agent CLI the same call spawns a whole
 * second agent process for every completed turn — captured argv,
 * `claude --print … --permission-mode acceptEdits …` — billable, running its
 * own tool loop, and never asked for by anyone. That is not something to do
 * behind the user's back, so it is off there unless they say otherwise.
 */

import type { Settings } from '../../shared/types'
import type { TurnMode } from './backendMode'

export type MemoryExtraction = NonNullable<Settings['memoryExtraction']>

/** Direct model APIs only — the cheap case, and the one this was designed for. */
export const DEFAULT_MEMORY_EXTRACTION: MemoryExtraction = 'api'

export function extractionAllowed(settings: Settings, mode: TurnMode): boolean {
  const choice = settings.memoryExtraction ?? DEFAULT_MEMORY_EXTRACTION
  if (choice === 'off') return false
  return choice === 'all' || mode !== 'supervised'
}
