/**
 * Projects — a folder of work with its own bots, chats and board.
 *
 * One `projects/<id>.json` per project. The board lives inside the project
 * record rather than in its own collection: a board is meaningless without its
 * project, and keeping them together means one atomic write per change.
 */

import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import type { Board, BoardCard, BoardColumn, Project, ProjectTag, Session } from '../../shared/types'
import { DEFAULT_COLUMNS } from '../../shared/types'
import {
  appendColumn,
  dropCard,
  dropColumn,
  insertCard,
  patchCard,
  relocateCard,
  markColumnDone,
  renameColumnIn
} from './board'
import { JsonCollection } from './collection'
import {
  CWD_MAX,
  normaliseBoard,
  normaliseProject,
  normaliseTags,
  stringList,
  text,
  type StoredProject
} from './projectSchema'

export type { StoredProject }
import { projectsDir } from './paths'
import { unfileSessionsFrom } from './sessions'

/** Renderer input is unbounded until it is bounded here. */
const collection = new JsonCollection<StoredProject>(projectsDir, normaliseProject)

export async function loadProjects(): Promise<void> {
  await collection.load()
}

export function listProjects(): StoredProject[] {
  return collection.all().sort((a, b) => b.updatedAt - a.updatedAt)
}

/**
 * True when a project file existed at load but could not be read.
 *
 * Absence of a project must not be treated as deletion while this holds — see
 * `unfileOrphanedSessions`, which permanently strips the filing from every chat
 * it believes is orphaned.
 */
export function projectsLoadWasIncomplete(): boolean {
  return collection.loadWasIncomplete
}

export function getProject(id: string): StoredProject | null {
  return collection.get(id)
}

export function createProject(partial: Partial<Project>): StoredProject {
  const now = Date.now()
  const id = randomUUID()
  return collection.put({
    id,
    name: text(partial.name, 'New project', 120),
    emoji: text(partial.emoji, '📁', 8),
    color: text(partial.color, '#7c9cff', 24),
    tags: normaliseTags(partial.tags),
    cwd: text(partial.cwd, homedir(), CWD_MAX),
    botIds: stringList(partial.botIds),
    createdAt: now,
    updatedAt: now,
    board: { projectId: id, columns: DEFAULT_COLUMNS.map((c) => ({ ...c, cards: [] })), updatedAt: now }
  })
}

/** Merge a patch, keeping the board and identity fields out of reach. */
export function updateProject(id: string, patch: Partial<Project>): StoredProject | null {
  const current = collection.get(id)
  if (!current) return null
  const next: StoredProject = {
    ...current,
    ...(patch.name !== undefined ? { name: text(patch.name, current.name, 120) } : {}),
    ...(patch.emoji !== undefined ? { emoji: text(patch.emoji, current.emoji, 8) } : {}),
    ...(patch.color !== undefined ? { color: text(patch.color, current.color, 24) } : {}),
    ...(patch.tags !== undefined ? { tags: normaliseTags(patch.tags) } : {}),
    ...(patch.cwd !== undefined ? { cwd: text(patch.cwd, current.cwd, CWD_MAX) } : {}),
    ...(patch.botIds !== undefined ? { botIds: stringList(patch.botIds) } : {}),
    ...(patch.archived !== undefined ? { archived: patch.archived === true } : {}),
    id: current.id,
    board: current.board,
    createdAt: current.createdAt,
    updatedAt: Date.now()
  }
  // Absent rather than false, so what is written matches what is read back.
  if (!next.archived) delete next.archived
  return collection.put(next)
}

/**
 * Delete a project, unfiling its chats so they revert to loose chats instead
 * of pointing at an id that is gone — which would leave them in neither the
 * project nor the loose list. Returns the sessions that changed.
 */
export function removeProject(id: string): Session[] {
  if (!collection.delete(id)) return []
  return unfileSessionsFrom(id)
}

/** Drop a deleted bot from project rosters and unassign its board cards. */
export function removeBotFromProjects(botId: string): StoredProject[] {
  if (!botId) return []
  const touched: StoredProject[] = []
  for (const project of collection.all()) {
    const inRoster = project.botIds.includes(botId)
    const onBoard = project.board.columns.some((column) =>
      column.cards.some((card) => card.botId === botId)
    )
    if (!inRoster && !onBoard) continue

    const board: Board = {
      ...project.board,
      columns: project.board.columns.map((column) => ({
        ...column,
        cards: column.cards.map((card) => {
          if (card.botId !== botId) return card
          const next = { ...card, updatedAt: Date.now() }
          delete next.botId
          return next
        })
      })),
      updatedAt: Date.now()
    }
    const next = collection.put({
      ...project,
      botIds: project.botIds.filter((id) => id !== botId),
      board,
      updatedAt: Date.now()
    })
    touched.push(next)
  }
  return touched
}

/**
 * Drop a deleted chat from the cards that opened it.
 *
 * `removeBotFromProjects` above has always existed; the session equivalent
 * never did, and `removeSession` is a bare delete. So a card kept pointing at a
 * chat that was gone, the renderer short-circuited on `card.sessionId` forever
 * with "That conversation could not be opened", and `CardEditor` offers no
 * unlink control — the only way out was deleting the card and building it
 * again. Clearing the link puts the card back to "not started yet", which is
 * what it now is.
 */
export function unlinkSessionFromCards(sessionId: string): StoredProject[] {
  if (!sessionId) return []
  const touched: StoredProject[] = []
  for (const project of collection.all()) {
    const linked = project.board.columns.some((column) =>
      column.cards.some((card) => card.sessionId === sessionId)
    )
    if (!linked) continue

    const now = Date.now()
    const board: Board = {
      ...project.board,
      columns: project.board.columns.map((column) => ({
        ...column,
        cards: column.cards.map((card) => {
          if (card.sessionId !== sessionId) return card
          const next = { ...card, updatedAt: now }
          delete next.sessionId
          return next
        })
      })),
      updatedAt: now
    }
    touched.push(collection.put({ ...project, board, updatedAt: now }))
  }
  return touched
}

/* ── board ───────────────────────────────────────────────────────── */

/**
 * Apply a board mutation and persist it inside the project record.
 *
 * `fn` returning null means the card or column was not found, so nothing is
 * written and the caller gets null back. One `put` per change keeps the
 * project and its board in a single atomic write.
 */
function mutateBoard(projectId: string, fn: (board: Board) => Board | null): Board | null {
  const project = collection.get(projectId)
  if (!project) return null
  const next = fn(project.board)
  if (!next) return null
  const now = Date.now()
  const board: Board = { ...next, projectId, updatedAt: now }
  collection.put({ ...project, board, updatedAt: now })
  return board
}

export function getBoard(projectId: string): Board | null {
  return collection.get(projectId)?.board ?? null
}

export function addCard(
  projectId: string,
  columnId: string,
  card: Partial<BoardCard>
): Board | null {
  return mutateBoard(projectId, (board) => insertCard(board, columnId, card))
}

export function updateCard(
  projectId: string,
  cardId: string,
  patch: Partial<BoardCard>
): Board | null {
  return mutateBoard(projectId, (board) => patchCard(board, cardId, patch))
}

/** Drag and drop: within a column or across columns, index clamped to range. */
export function moveCard(
  projectId: string,
  cardId: string,
  toColumnId: string,
  toIndex: number
): Board | null {
  return mutateBoard(projectId, (board) => relocateCard(board, cardId, toColumnId, toIndex))
}

export function removeCard(projectId: string, cardId: string): Board | null {
  return mutateBoard(projectId, (board) => dropCard(board, cardId))
}

export function addColumn(projectId: string, name: string): Board | null {
  return mutateBoard(projectId, (board) => appendColumn(board, name))
}

export function setColumnDone(projectId: string, columnId: string, done: boolean): Board | null {
  return mutateBoard(projectId, (board) => markColumnDone(board, columnId, done))
}

export function renameColumn(projectId: string, columnId: string, name: string): Board | null {
  return mutateBoard(projectId, (board) => renameColumnIn(board, columnId, name))
}

/** The column's cards move to the first remaining column rather than dying. */
export function removeColumn(projectId: string, columnId: string): Board | null {
  return mutateBoard(projectId, (board) => dropColumn(board, columnId))
}
