/**
 * Coercing a stored project document into a valid `Project`.
 *
 * Separate from the CRUD module for the same reason `sessionSchema.ts` is: a
 * normaliser is what stands between a hand-edited or older file and the rest of
 * the app, and it should be readable without the operations around it.
 */

import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import type { Board, BoardCard, BoardColumn, Project, ProjectTag } from '../../shared/types'
import { DEFAULT_COLUMNS } from '../../shared/types'

export const CWD_MAX = 1024
const BOT_IDS_MAX = 64

/** Stored shape: a project and its board in one record. */
export interface StoredProject extends Project {
  board: Board
}

export function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .slice(0, BOT_IDS_MAX)
}

export function text(value: unknown, fallback: string, max: number): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  return (raw || fallback).slice(0, max)
}

/** Tags are user-invented, so normalise rather than restrict: trim, lowercase, dedupe. */
export function normaliseTags(value: unknown): ProjectTag[] {
  const seen = new Set<string>()
  for (const tag of stringList(value)) {
    const clean = tag.trim().toLowerCase().slice(0, 24)
    if (clean) seen.add(clean)
  }
  return [...seen].slice(0, 8)
}

function normaliseCard(raw: unknown, index: number): BoardCard | null {
  if (typeof raw !== 'object' || raw === null) return null
  const v = raw as Record<string, unknown>
  const now = Date.now()
  return {
    id: typeof v['id'] === 'string' && v['id'] ? v['id'] : randomUUID(),
    title: text(v['title'], `Card ${index + 1}`, 200),
    notes: typeof v['notes'] === 'string' ? v['notes'].slice(0, 4000) : '',
    ...(typeof v['botId'] === 'string' && v['botId'] ? { botId: v['botId'] } : {}),
    ...(typeof v['sessionId'] === 'string' && v['sessionId'] ? { sessionId: v['sessionId'] } : {}),
    createdAt: typeof v['createdAt'] === 'number' ? v['createdAt'] : now,
    updatedAt: typeof v['updatedAt'] === 'number' ? v['updatedAt'] : now
  }
}

/** Did this stored board ever get to say which column means "finished"? */
function declaresDone(rawColumns: unknown[]): boolean {
  return rawColumns.some(
    (entry) =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as Record<string, unknown>)['done'] === 'boolean'
  )
}

export function normaliseBoard(raw: unknown, projectId: string): Board {
  const v = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const rawColumns = Array.isArray(v['columns']) ? v['columns'] : []

  const columns: BoardColumn[] = rawColumns
    .map((entry, i): BoardColumn | null => {
      if (typeof entry !== 'object' || entry === null) return null
      const c = entry as Record<string, unknown>
      return {
        id: typeof c['id'] === 'string' && c['id'] ? c['id'] : randomUUID(),
        name: text(c['name'], `Column ${i + 1}`, 60),
        // Written even when false, unlike `archived` on the project: the
        // presence of the key is what tells a migrated board from one stored
        // before the flag existed, so an absent `false` would be read as
        // "never asked" and re-guessed on the next load.
        done: c['done'] === true,
        cards: (Array.isArray(c['cards']) ? c['cards'] : [])
          .map(normaliseCard)
          .filter((card): card is BoardCard => card !== null)
      }
    })
    .filter((column): column is BoardColumn => column !== null)

  /*
   * MIGRATION — boards on disk that predate the `done` flag.
   *
   * Their counts were produced by a rule that read completion off position:
   * everything outside the LAST column was outstanding. Applying exactly that
   * rule once, here, is what keeps upgrade silent — nobody opens the app to
   * find their open count has moved. From then on the stored flags are taken
   * literally, including a board the user has left with no finished column.
   *
   * Only when nothing in the set declares a flag: a board that says `false`
   * everywhere has already been through this and means it.
   */
  const last = columns[columns.length - 1]
  if (last && !declaresDone(rawColumns)) last.done = true

  return {
    projectId,
    // A board with no columns cannot be used, so fall back to the default set.
    columns: columns.length ? columns : DEFAULT_COLUMNS.map((c) => ({ ...c, cards: [] })),
    updatedAt: typeof v['updatedAt'] === 'number' ? v['updatedAt'] : Date.now()
  }
}



export function normaliseProject(raw: unknown): StoredProject | null {
  if (typeof raw !== 'object' || raw === null) return null
  const v = raw as Record<string, unknown>
  const id = typeof v['id'] === 'string' ? v['id'] : ''
  if (!id) return null
  const now = Date.now()

  const project: StoredProject = {
    id,
    name: text(v['name'], 'Untitled project', 120),
    emoji: text(v['emoji'], '\u{1F4C1}', 8),
    color: text(v['color'], '#7c9cff', 24),
    tags: normaliseTags(v['tags']),
    cwd: text(v['cwd'], homedir(), CWD_MAX),
    botIds: stringList(v['botIds']),
    createdAt: typeof v['createdAt'] === 'number' ? v['createdAt'] : now,
    updatedAt: typeof v['updatedAt'] === 'number' ? v['updatedAt'] : now,
    board: normaliseBoard(v['board'], id)
  }
  if (v['archived'] === true) project.archived = true
  return project
}
