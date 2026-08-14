/**
 * Board arithmetic, kept pure so the drag layer and the keyboard menu agree on
 * what "move this card there" means.
 *
 * Index convention: `toIndex` is the position in the destination column *after*
 * the card has been lifted out of its old place — the remove-then-insert order
 * the store applies. A drop indicator drawn between two cards is a *visual*
 * index, which is one higher than that when the card is dragged downwards
 * inside its own column, so translate before sending anything to the bridge.
 */

import type { Board, BoardCard, BoardColumn } from '../../../shared/types'
import { countOpenCards } from '../../../shared/projects'

export interface CardLocation {
  columnId: string
  index: number
  card: BoardCard
}

/** The card currently under the pointer, and where it came from. */
export interface DragState {
  cardId: string
  fromColumnId: string
}

/** Where the drop indicator sits: a column and a *visual* slot between cards. */
export interface DropTarget {
  columnId: string
  index: number
}

export function locateCard(board: Board | null, cardId: string): CardLocation | null {
  if (!board) return null
  for (const column of board.columns) {
    const index = column.cards.findIndex((c) => c.id === cardId)
    if (index >= 0) return { columnId: column.id, index, card: column.cards[index] as BoardCard }
  }
  return null
}

export function columnOf(board: Board | null, columnId: string): BoardColumn | null {
  return board?.columns.find((c) => c.id === columnId) ?? null
}

/**
 * Cards outside the finished column(s) — the same "still outstanding" rule as
 * the summary, because it is literally the same function. The two used to be
 * separate copies of "everything but the last column", so the board header and
 * the sidebar badge were wrong together whenever a column was added.
 */
export function openCardCount(board: Board | null): number {
  if (!board) return 0
  return countOpenCards(board.columns)
}

/**
 * Translates a visual drop position into a store index, or null when the move
 * would leave the card exactly where it already is.
 */
export function insertionIndex(board: Board | null, cardId: string, toColumnId: string, visualIndex: number): number | null {
  const from = locateCard(board, cardId)
  const target = columnOf(board, toColumnId)
  if (!from || !target) return null
  const sameColumn = from.columnId === toColumnId
  const size = sameColumn ? target.cards.length - 1 : target.cards.length
  let index = Math.max(0, Math.min(visualIndex, sameColumn ? target.cards.length : size))
  if (sameColumn && index > from.index) index -= 1
  index = Math.max(0, Math.min(index, size))
  if (sameColumn && index === from.index) return null
  return index
}

/** The board as it will look once the move lands — used for the optimistic patch. */
export function withCardMoved(board: Board, cardId: string, toColumnId: string, toIndex: number): Board {
  const from = locateCard(board, cardId)
  if (!from) return board
  const columns = board.columns.map((column) =>
    column.id === from.columnId ? { ...column, cards: column.cards.filter((c) => c.id !== cardId) } : column
  )
  return {
    ...board,
    columns: columns.map((column) => {
      if (column.id !== toColumnId) return column
      const cards = [...column.cards]
      cards.splice(Math.max(0, Math.min(toIndex, cards.length)), 0, from.card)
      return { ...column, cards }
    })
  }
}

/** Every tag in use across the given projects, built-ins first, then alphabetical. */
export function collectTags(sources: ReadonlyArray<{ tags: string[] }>, builtIn: readonly string[]): string[] {
  const seen = new Set<string>(builtIn)
  for (const source of sources) for (const tag of source.tags) seen.add(tag)
  const extra = [...seen].filter((t) => !builtIn.includes(t)).sort((a, b) => a.localeCompare(b))
  return [...builtIn, ...extra]
}
