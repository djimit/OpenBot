/**
 * Board algebra — the kanban rules, with no idea that disk exists.
 *
 * Every function takes a board and returns the next board, or `null` when the
 * card or column it was pointed at is not there. Keeping it pure means the
 * awkward cases — a drop inside the same column, a column removed out from
 * under its cards — are decided in one place, and `projects.ts` only has to
 * persist the answer.
 *
 * Card and column text arrives from the renderer, so it is clipped here too:
 * the board is the only thing these functions can be trusted with.
 */

import { randomUUID } from 'node:crypto'
import type { Board, BoardCard, BoardColumn } from '../../shared/types'
import { countOpenCards, rehomeColumn } from '../../shared/projects'

/** A buggy or hostile renderer must not be able to grow a board without end. */
const MAX_COLUMNS = 24
const MAX_CARDS_PER_COLUMN = 500
const TITLE_MAX = 200
const NOTES_MAX = 4000
const NAME_MAX = 60
const REF_MAX = 128

/** Trim, fall back, and cap — the same treatment every text field gets. */
function clip(value: unknown, fallback: string, max: number): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  return (raw || fallback).slice(0, max)
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(Math.trunc(value), min), max)
}

function columnOf(board: Board, cardId: string): BoardColumn | undefined {
  return board.columns.find((column) => column.cards.some((card) => card.id === cardId))
}

function withColumns(board: Board, columns: BoardColumn[]): Board {
  return { ...board, columns }
}

/** Ids and timestamps are ours; only the text comes from the caller. */
export function makeCard(partial: Partial<BoardCard>): BoardCard {
  const now = Date.now()
  const card: BoardCard = {
    id: randomUUID(),
    title: clip(partial.title, 'New card', TITLE_MAX),
    notes: typeof partial.notes === 'string' ? partial.notes.slice(0, NOTES_MAX) : '',
    createdAt: now,
    updatedAt: now
  }
  if (typeof partial.botId === 'string' && partial.botId) {
    card.botId = partial.botId.slice(0, REF_MAX)
  }
  if (typeof partial.sessionId === 'string' && partial.sessionId) {
    card.sessionId = partial.sessionId.slice(0, REF_MAX)
  }
  return card
}

/**
 * A full column refuses a new card. Moving one in is still allowed, so that
 * removing a column can never strand the cards it hands on.
 */
export function insertCard(board: Board, columnId: string, partial: Partial<BoardCard>): Board | null {
  const into = board.columns.find((column) => column.id === columnId)
  if (!into || into.cards.length >= MAX_CARDS_PER_COLUMN) return null
  const card = makeCard(partial)
  return withColumns(
    board,
    board.columns.map((column) =>
      column.id === columnId ? { ...column, cards: [...column.cards, card] } : column
    )
  )
}

function mergeCard(card: BoardCard, patch: Partial<BoardCard>): BoardCard {
  const next: BoardCard = { ...card, updatedAt: Date.now() }
  if (patch.title !== undefined) next.title = clip(patch.title, card.title, TITLE_MAX)
  if (patch.notes !== undefined) {
    next.notes = typeof patch.notes === 'string' ? patch.notes.slice(0, NOTES_MAX) : ''
  }
  if (patch.botId !== undefined) next.botId = clip(patch.botId, '', REF_MAX)
  if (patch.sessionId !== undefined) next.sessionId = clip(patch.sessionId, '', REF_MAX)
  // An empty assignment means "unassign", not "assign to nothing".
  if (!next.botId) delete next.botId
  if (!next.sessionId) delete next.sessionId
  return next
}

/** Identity and creation time stay ours whatever the patch claims. */
export function patchCard(board: Board, cardId: string, patch: Partial<BoardCard>): Board | null {
  if (!columnOf(board, cardId)) return null
  return withColumns(
    board,
    board.columns.map((column) => ({
      ...column,
      cards: column.cards.map((card) => (card.id === cardId ? mergeCard(card, patch) : card))
    }))
  )
}

/**
 * The drag-and-drop primitive, for moves within a column as well as between
 * them. The card leaves its old slot first, so `toIndex` is read against the
 * column as it will look once that gap has closed — which is what a drop
 * inside the same column means. Out-of-range indices clamp to the ends.
 */
export function relocateCard(
  board: Board,
  cardId: string,
  toColumnId: string,
  toIndex: number
): Board | null {
  const card = columnOf(board, cardId)?.cards.find((entry) => entry.id === cardId)
  if (!card) return null
  const destination = board.columns.findIndex((column) => column.id === toColumnId)
  if (destination === -1) return null

  const columns = board.columns.map((column) => ({
    ...column,
    cards: column.cards.filter((entry) => entry.id !== cardId)
  }))
  const target = columns[destination]
  const cards = [...target.cards]
  cards.splice(clamp(toIndex, 0, cards.length), 0, { ...card, updatedAt: Date.now() })
  columns[destination] = { ...target, cards }
  return withColumns(board, columns)
}

export function dropCard(board: Board, cardId: string): Board | null {
  if (!columnOf(board, cardId)) return null
  return withColumns(
    board,
    board.columns.map((column) => ({
      ...column,
      cards: column.cards.filter((card) => card.id !== cardId)
    }))
  )
}

export function appendColumn(board: Board, name: string): Board | null {
  if (board.columns.length >= MAX_COLUMNS) return null
  // `done: false` is stated, not left off: a set where no column declares the
  // flag is read as pre-flag data and has its last column guessed at, and a
  // column the user just added must never be able to trigger that guess.
  const column: BoardColumn = {
    id: randomUUID(),
    name: clip(name, 'New column', NAME_MAX),
    done: false,
    cards: []
  }
  return withColumns(board, [...board.columns, column])
}

export function renameColumnIn(board: Board, columnId: string, name: string): Board | null {
  const current = board.columns.find((column) => column.id === columnId)
  if (!current) return null
  return withColumns(
    board,
    board.columns.map((column) =>
      column.id === columnId ? { ...column, name: clip(name, current.name, NAME_MAX) } : column
    )
  )
}

/**
 * Marks a column as the one work finishes in, or stops treating it as such.
 *
 * Explicit because the alternative — inferring it from the column's position —
 * is the bug this flag exists to kill: appending a column used to turn every
 * finished card back into outstanding work. Several columns may be marked; a
 * board with none has nothing finished, which `countOpenCards` honours rather
 * than guessing.
 */
export function markColumnDone(board: Board, columnId: string, done: boolean): Board | null {
  if (!board.columns.some((column) => column.id === columnId)) return null
  return withColumns(
    board,
    board.columns.map((column) => (column.id === columnId ? { ...column, done } : column))
  )
}

/**
 * Cards outlive their column: they move to the nearest column that remains —
 * the one to its left, or the new leftmost when it was already first — rather
 * than vanishing with it. The last column cannot be removed at all, because a
 * board with nowhere to put a card is not a board.
 *
 * Nearest rather than first: emptying the far-right column used to fling its
 * cards all the way back to the backlog, and the destination is what the
 * delete confirmation promises, so both read `rehomeColumn`.
 */
export function dropColumn(board: Board, columnId: string): Board | null {
  const doomed = board.columns.find((column) => column.id === columnId)
  const home = rehomeColumn(board.columns, columnId)
  if (!doomed || !home) return null
  return withColumns(
    board,
    board.columns
      .filter((column) => column.id !== columnId)
      .map((column) =>
        column.id === home.id ? { ...column, cards: [...column.cards, ...doomed.cards] } : column
      )
  )
}

/** Outstanding work: every card outside the column(s) marked as finished. */
export function openCardCount(board: Board): number {
  return countOpenCards(board.columns)
}
