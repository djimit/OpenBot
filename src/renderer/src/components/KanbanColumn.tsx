import { useRef, useState, type DragEvent, type ReactNode } from 'react'
import type { BoardColumn, Bot } from '../../../shared/types'
import { isColumnDone, rehomeColumn } from '../../../shared/projects'
import type { DragState, DropTarget } from '../lib/board'
import { IconCheck, IconClose, IconPencil, IconPlus, IconTrash } from './Icons'
import { KanbanCard } from './KanbanCard'
import './KanbanColumn.css'

interface KanbanColumnProps {
  column: BoardColumn
  columns: BoardColumn[]
  bots: Map<string, Bot>
  activeCardId: string | null
  /** Card the Move menu just relocated — it takes focus back when it remounts. */
  movedCardId: string | null
  drag: DragState | null
  drop: DropTarget | null
  removable: boolean
  onDragStart: (state: DragState) => void
  onDragEnd: () => void
  onDragOver: (target: DropTarget) => void
  onDrop: (target: DropTarget) => void
  onOpenCard: (cardId: string) => void
  onChatCard: (cardId: string) => void
  onMoveCard: (cardId: string, toColumnId: string, visualIndex: number) => void
  onAddCard: (title: string) => void
  onRename: (name: string) => void
  onRemove: () => void
  /** Absent when the build cannot persist the flag — the toggle is then left out. */
  onToggleDone?: (done: boolean) => void
}

/** The visual slot the pointer is nearest: before the card it is above, else last. */
function slotAt(list: HTMLElement, clientY: number): number {
  const cards = Array.from(list.querySelectorAll<HTMLElement>('[data-card]'))
  for (let i = 0; i < cards.length; i += 1) {
    const rect = cards[i].getBoundingClientRect()
    if (clientY < rect.top + rect.height / 2) return i
  }
  return cards.length
}

/** One column: its cards, a drop indicator while dragging, and its own editing. */
export function KanbanColumn(props: KanbanColumnProps): ReactNode {
  const { column, columns, bots, activeCardId, drag, drop, removable } = props
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(column.name)
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)
  /** Set by Escape so the blur that follows abandons the rename instead of saving it. */
  const cancelled = useRef(false)

  const dropIndex = drop && drop.columnId === column.id ? drop.index : null
  const count = column.cards.length
  const done = isColumnDone(columns, columns.findIndex((c) => c.id === column.id))
  /*
   * Where `dropColumn` will actually put these cards. The confirmation used to
   * offer "and its cards", which reads as "the cards go too" — they never did,
   * and people left dead columns standing rather than risk it. Naming the
   * destination comes from the same helper the store moves them with, so the
   * promise cannot drift from the behaviour.
   */
  const home = rehomeColumn(columns, column.id)

  const commitRename = (): void => {
    setRenaming(false)
    const clean = name.trim()
    if (cancelled.current || !clean || clean === column.name) return
    props.onRename(clean)
  }

  const track = (e: DragEvent<HTMLDivElement>): void => {
    if (!drag) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    props.onDragOver({ columnId: column.id, index: slotAt(e.currentTarget, e.clientY) })
  }

  const commitAdd = (): void => {
    const clean = title.trim()
    if (!clean) return
    props.onAddCard(clean)
    setTitle('')
  }

  return (
    <section
      className={`ob-kb-col${done ? ' is-done' : ''}`}
      aria-label={`${column.name}, ${column.cards.length} card${count === 1 ? '' : 's'}${done ? ', work finishes here' : ''}`}
    >
      <header className="ob-kb-col-head">
        {renaming ? (
          <input
            className="ob-input ob-kb-col-rename"
            value={name}
            autoFocus
            aria-label={`Rename ${column.name}`}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') {
                e.stopPropagation()
                cancelled.current = true
                setName(column.name)
                setRenaming(false)
              }
            }}
          />
        ) : (
          <>
            <h3 className="ob-kb-col-name">{column.name}</h3>
            <span className="ob-kb-col-count">{column.cards.length}</span>
            <span className="ob-kb-col-actions">
              <button type="button" className="ob-icon-btn" aria-label={`Add a card to ${column.name}`} onClick={() => setAdding(true)}>
                <IconPlus size={11} />
              </button>
              <button
                type="button"
                className="ob-icon-btn"
                aria-label={`Rename ${column.name}`}
                onClick={() => {
                  cancelled.current = false
                  setName(column.name)
                  setRenaming(true)
                }}
              >
                <IconPencil size={11} />
              </button>
              {props.onToggleDone ? (
                <button
                  type="button"
                  className="ob-icon-btn"
                  aria-pressed={done}
                  aria-label={
                    done
                      ? `Stop treating ${column.name} as finished work`
                      : `Mark ${column.name} as finished work`
                  }
                  title={done ? 'Work in this column is finished' : 'Mark this column as finished work'}
                  onClick={() => props.onToggleDone?.(!done)}
                >
                  <IconCheck size={11} />
                </button>
              ) : null}
              {removable ? (
                confirmRemove ? (
                  <>
                    <button
                      type="button"
                      className="ob-icon-btn"
                      aria-label={
                        home
                          ? `Confirm deleting ${column.name} and moving its cards to ${home.name}`
                          : `Confirm deleting ${column.name}`
                      }
                      onClick={props.onRemove}
                    >
                      <IconCheck size={11} />
                    </button>
                    <button type="button" className="ob-icon-btn" aria-label="Cancel delete" onClick={() => setConfirmRemove(false)}>
                      <IconClose size={11} />
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="ob-icon-btn"
                    aria-label={`Delete ${column.name}`}
                    title={home ? `Delete ${column.name} — its cards move to ${home.name}` : `Delete ${column.name}`}
                    onClick={() => setConfirmRemove(true)}
                  >
                    <IconTrash size={11} />
                  </button>
                )
              ) : null}
            </span>
          </>
        )}
      </header>

      <div
        className={`ob-kb-col-body${dropIndex !== null ? ' is-target' : ''}`}
        onDragOver={track}
        onDrop={(e) => {
          if (!drag) return
          e.preventDefault()
          props.onDrop({ columnId: column.id, index: slotAt(e.currentTarget, e.clientY) })
        }}
      >
        {column.cards.length === 0 && dropIndex === null ? (
          <p className="ob-kb-col-empty">Nothing here yet.</p>
        ) : null}

        {column.cards.map((card, index) => (
          <div key={card.id} className="ob-kb-slot">
            {dropIndex === index ? <span className="ob-kb-drop" aria-hidden="true" /> : null}
            <KanbanCard
              card={card}
              column={column}
              index={index}
              columns={columns}
              bot={card.botId ? bots.get(card.botId) : undefined}
              active={activeCardId === card.id}
              dragging={drag?.cardId === card.id}
              refocus={props.movedCardId === card.id}
              onDragStart={() => props.onDragStart({ cardId: card.id, fromColumnId: column.id })}
              onDragEnd={props.onDragEnd}
              onOpen={() => props.onOpenCard(card.id)}
              onChat={() => props.onChatCard(card.id)}
              onMove={(toColumnId, visualIndex) => props.onMoveCard(card.id, toColumnId, visualIndex)}
            />
          </div>
        ))}
        {dropIndex !== null && dropIndex >= column.cards.length ? <span className="ob-kb-drop" aria-hidden="true" /> : null}
      </div>

      {adding ? (
        <form
          className="ob-kb-col-add"
          onSubmit={(e) => {
            e.preventDefault()
            commitAdd()
          }}
        >
          <input
            className="ob-input"
            value={title}
            autoFocus
            placeholder="What needs doing?"
            aria-label={`New card in ${column.name}`}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation()
                setTitle('')
                setAdding(false)
              }
            }}
          />
          <div className="ob-kb-col-add-foot">
            <button type="submit" className="ob-btn ob-btn-sm ob-btn-primary" disabled={!title.trim()}>
              Add card
            </button>
            <button
              type="button"
              className="ob-btn ob-btn-sm ob-btn-ghost"
              onClick={() => {
                setTitle('')
                setAdding(false)
              }}
            >
              Done
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className="ob-kb-col-addbtn" onClick={() => setAdding(true)}>
          <IconPlus size={11} />
          Add a card
        </button>
      )}
    </section>
  )
}
