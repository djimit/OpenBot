import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { locateCard, openCardCount, type DragState, type DropTarget } from '../lib/board'
import {
  addCard,
  addColumn,
  columnDoneReady,
  moveCard,
  openCardChat,
  removeColumn,
  renameColumn,
  setColumnDone,
  store,
  useAppState
} from '../state'
import { CardEditor } from './CardEditor'
import { IconPlus } from './Icons'
import { KanbanColumn } from './KanbanColumn'
import { Modal } from './Modal'
import './KanbanBoard.css'

/** The project's board: columns of cards, drag and drop, and a card editor. */
export function KanbanBoard(): ReactNode {
  const { board, boardLoading, currentProjectId, projects, bots } = useAppState()
  const [drag, setDrag] = useState<DragState | null>(null)
  const [drop, setDrop] = useState<DropTarget | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [movedId, setMovedId] = useState<string | null>(null)
  const [columnName, setColumnName] = useState('')
  const [addingColumn, setAddingColumn] = useState(false)

  const project = projects.find((p) => p.id === currentProjectId) ?? null
  const botMap = useMemo(() => new Map(bots.map((b) => [b.id, b] as const)), [bots])
  const editing = editingId ? locateCard(board, editingId)?.card ?? null : null
  const columns = board?.columns ?? []

  // The flag is consumed by the card that remounts on the new board, so it is
  // spent the moment that board arrives — success or rollback alike.
  useEffect(() => setMovedId(null), [board])

  const clearDrag = (): void => {
    setDrag(null)
    setDrop(null)
  }

  /** Dragover fires continuously, so only a genuinely new slot re-renders. */
  const hover = (target: DropTarget): void =>
    setDrop((current) => (current && current.columnId === target.columnId && current.index === target.index ? current : target))

  const commitDrop = (target: DropTarget): void => {
    if (drag) void moveCard(drag.cardId, target.columnId, target.index)
    clearDrag()
  }

  const chat = (cardId: string): void => {
    const found = locateCard(board, cardId)
    if (found) void openCardChat(found.card)
  }

  const commitColumn = (): void => {
    const clean = columnName.trim()
    if (!clean) return
    void addColumn(clean)
    setColumnName('')
    setAddingColumn(false)
  }

  const cardTotal = columns.reduce((total, c) => total + c.cards.length, 0)
  // Read once per render, not per column: an older preload cannot store the
  // flag, and a toggle that quietly forgets is worse than no toggle at all.
  const canMarkDone = columnDoneReady()

  return (
    <Modal
      title={project ? `${project.emoji} ${project.name}` : 'Board'}
      subtitle={`${cardTotal} card${cardTotal === 1 ? '' : 's'} · ${openCardCount(board)} open`}
      size="xl"
      onClose={() => store.setModal(null)}
      actions={
        columns.length > 0 ? (
          <button type="button" className="ob-btn ob-btn-sm" onClick={() => setAddingColumn(true)}>
            <IconPlus size={12} />
            Column
          </button>
        ) : null
      }
    >
      <div className={`ob-kb${editing ? ' is-editing' : ''}`}>
        {boardLoading ? (
          <p className="ob-hint">Loading board…</p>
        ) : !board ? (
          <p className="ob-notice ob-notice-error" role="alert">
            That board could not be opened.
          </p>
        ) : (
          <div className="ob-kb-scroll" onDragEnd={clearDrag}>
            {columns.length === 0 && !addingColumn ? (
              <div className="ob-empty">
                <h3 className="ob-empty-title">An empty board</h3>
                <p className="ob-empty-body">Columns are the stages work moves through. Start with one and add cards to it.</p>
                <button type="button" className="ob-btn ob-btn-primary" onClick={() => setAddingColumn(true)}>
                  Add the first column
                </button>
              </div>
            ) : null}

            {columns.map((column) => (
              <KanbanColumn
                key={column.id}
                column={column}
                columns={columns}
                bots={botMap}
                activeCardId={editingId}
                movedCardId={movedId}
                drag={drag}
                drop={drop}
                removable={columns.length > 1}
                onDragStart={setDrag}
                onDragEnd={clearDrag}
                onDragOver={hover}
                onDrop={commitDrop}
                onOpenCard={setEditingId}
                onChatCard={chat}
                onMoveCard={(cardId, toColumnId, visualIndex) => {
                  setMovedId(cardId)
                  void moveCard(cardId, toColumnId, visualIndex)
                }}
                onAddCard={(title) => void addCard(column.id, title)}
                onRename={(name) => void renameColumn(column.id, name)}
                onRemove={() => void removeColumn(column.id)}
                {...(canMarkDone ? { onToggleDone: (done: boolean) => void setColumnDone(column.id, done) } : {})}
              />
            ))}

            {addingColumn ? (
              <form
                className="ob-kb-newcol"
                onSubmit={(e) => {
                  e.preventDefault()
                  commitColumn()
                }}
              >
                <input
                  className="ob-input"
                  value={columnName}
                  autoFocus
                  maxLength={40}
                  placeholder="Column name"
                  aria-label="New column name"
                  onChange={(e) => setColumnName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.stopPropagation()
                      setColumnName('')
                      setAddingColumn(false)
                    }
                  }}
                />
                <div className="ob-kb-newcol-foot">
                  <button type="submit" className="ob-btn ob-btn-sm ob-btn-primary" disabled={!columnName.trim()}>
                    Add
                  </button>
                  <button
                    type="button"
                    className="ob-btn ob-btn-sm ob-btn-ghost"
                    onClick={() => {
                      setColumnName('')
                      setAddingColumn(false)
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : columns.length > 0 ? (
              <button type="button" className="ob-kb-addcol" onClick={() => setAddingColumn(true)}>
                <IconPlus size={12} />
                Add column
              </button>
            ) : null}
          </div>
        )}

        {editing ? (
          <aside
            className="ob-kb-drawer"
            aria-label="Card editor"
            onKeyDown={(e) => {
              // Escape closes the drawer, not the board: typed notes are only in
              // the field until Save, and the modal would take them with it.
              if (e.key !== 'Escape') return
              e.stopPropagation()
              setEditingId(null)
            }}
          >
            <CardEditor card={editing} bots={bots} onClose={() => setEditingId(null)} />
          </aside>
        ) : null}
      </div>
    </Modal>
  )
}
