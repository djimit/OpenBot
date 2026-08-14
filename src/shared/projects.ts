/**
 * Projects: a folder of work with its own bots, chats and board.
 *
 * A chat on its own is fine for a question. Sustained work needs somewhere for
 * the bots, the conversations and the outstanding tasks to live together, so a
 * project owns all three.
 */

/**
 * How a project is filed. `work` and `personal` are built in because almost
 * everyone wants that split; anything else is a free-text tag the user invents,
 * so the sidebar can group by whatever they actually use.
 */
export type ProjectTag = string

export const BUILT_IN_TAGS: readonly ProjectTag[] = ['work', 'personal']

export interface Project {
  id: string
  name: string
  emoji: string
  color: string
  /** Filing tags — `work`, `personal`, or anything the user types. */
  tags: ProjectTag[]
  /** Working directory bots default to inside this project. */
  cwd: string
  /** Bots assigned here. A bot may belong to several projects. */
  botIds: string[]
  archived?: boolean
  createdAt: number
  updatedAt: number
}

/* ── Board ───────────────────────────────────────────────────────── */

export interface BoardCard {
  id: string
  title: string
  notes: string
  /** Bot responsible for this card. */
  botId?: string
  /** Chat opened from this card, so work and conversation stay linked. */
  sessionId?: string
  createdAt: number
  updatedAt: number
}

export interface BoardColumn {
  id: string
  name: string
  /**
   * Work that reaches this column is finished.
   *
   * Completion is a property of the column, never of where it sits. It used to
   * be read off position — everything outside the LAST column was outstanding —
   * so adding a column to the right of "Done" silently reclassified every
   * finished card as outstanding work, in the sidebar badge, the project page
   * and the board header at once. `countOpenCards` below is the only rule now.
   *
   * Optional because boards written before the flag existed have no such key;
   * `normaliseBoard` migrates those on read.
   */
  done?: boolean
  /** Card order within the column is the array order. */
  cards: BoardCard[]
}

export interface Board {
  projectId: string
  columns: BoardColumn[]
  updatedAt: number
}

/**
 * Columns created with a new project. Work finishes in the last one.
 *
 * Every entry states its flag, including the three that are false: a column set
 * where nothing declares one is read as a board that predates the flag, and a
 * new project must never be mistaken for one — deleting "Done" from a board of
 * silent columns would hand the title to whichever column ended up last.
 */
export const DEFAULT_COLUMNS: ReadonlyArray<{ id: string; name: string; done: boolean }> = [
  { id: 'todo', name: 'To do', done: false },
  { id: 'doing', name: 'In progress', done: false },
  { id: 'review', name: 'Review', done: false },
  { id: 'done', name: 'Done', done: true }
]

/**
 * True for a column set that predates the `done` flag — nothing in it declares
 * one either way, so its author never had the choice.
 */
function undeclared(columns: ReadonlyArray<BoardColumn>): boolean {
  return !columns.some((column) => typeof column.done === 'boolean')
}

/**
 * Whether the column at `index` is where work finishes.
 *
 * THE MIGRATION RULE, in one place because the store, the normaliser and the
 * board UI must all agree on it:
 *
 *   - if any column in the set declares `done`, the declarations are taken
 *     literally, and a set where every one says `false` has no finished column
 *     at all. That state is reachable — the user can untick the last tick — and
 *     guessing a replacement would reinstate the position rule that caused the
 *     bug, so nothing is finished and every card counts as open.
 *   - if none declares it, the set was stored before the flag and the LAST
 *     column is read as the finished one. That is exactly what the old
 *     position-based count hardcoded, so no board's numbers move on upgrade.
 *
 * The guess only ever fires once per board: `normaliseBoard` writes an explicit
 * flag onto every column the first time a stored project is read.
 */
export function isColumnDone(columns: ReadonlyArray<BoardColumn>, index: number): boolean {
  const column = columns[index]
  if (!column) return false
  if (undeclared(columns)) return index === columns.length - 1
  return column.done === true
}

/** Outstanding work: every card that is not sitting in a finished column. */
export function countOpenCards(columns: ReadonlyArray<BoardColumn>): number {
  return columns.reduce(
    (total, column, index) => (isColumnDone(columns, index) ? total : total + column.cards.length),
    0
  )
}

/**
 * Where a removed column's cards go: the column immediately to its left, or the
 * new leftmost one when the removed column was already first.
 *
 * Shared so the store's behaviour and the delete confirmation's wording cannot
 * drift apart — a confirmation that names the wrong destination is the same
 * class of bug as one that claims the cards are deleted, which they never are.
 * Null when the column is unknown or is the only one, both of which refuse the
 * removal outright.
 */
export function rehomeColumn(
  columns: ReadonlyArray<BoardColumn>,
  columnId: string
): BoardColumn | null {
  const index = columns.findIndex((column) => column.id === columnId)
  if (index === -1 || columns.length <= 1) return null
  const remaining = columns.filter((column) => column.id !== columnId)
  return remaining[Math.max(0, index - 1)] ?? null
}

export interface ProjectSummary {
  id: string
  name: string
  emoji: string
  color: string
  tags: ProjectTag[]
  botCount: number
  sessionCount: number
  /** Cards outside the project's finished column(s) — what is still outstanding. */
  openCards: number
  archived?: boolean
  updatedAt: number
}
