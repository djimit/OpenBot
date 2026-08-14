import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { BoardCard, BoardColumn, Bot } from '../../../shared/types'
import { menuPlacement, type MenuPlacement } from '../lib/menuPlacement'
import { BotAvatar } from './BotAvatar'
import { IconChat, IconGrip, IconMove, IconNote } from './Icons'
import './KanbanCard.css'

interface KanbanCardProps {
  card: BoardCard
  column: BoardColumn
  index: number
  columns: BoardColumn[]
  bot?: Bot
  active: boolean
  dragging: boolean
  /** This card was just moved by the menu: take focus back after the remount. */
  refocus: boolean
  onDragStart: () => void
  onDragEnd: () => void
  onOpen: () => void
  onChat: () => void
  /** Takes a *visual* slot index — the same vocabulary the drop indicator uses. */
  onMove: (toColumnId: string, visualIndex: number) => void
}

/** One card: draggable for the mouse, with a Move menu for the keyboard. */
export function KanbanCard(props: KanbanCardProps): ReactNode {
  const { card, column, index, columns, bot, active, dragging, refocus } = props
  const { onDragStart, onDragEnd, onOpen, onChat, onMove } = props
  // Null means shut: the menu is placed from the trigger's rectangle at the
  // moment it opens, so its position and its openness are one piece of state.
  const [placement, setPlacement] = useState<MenuPlacement | null>(null)
  const menuOpen = placement !== null
  const trigger = useRef<HTMLButtonElement>(null)

  // Mount only. A move to another column unmounts this card and mounts a new
  // one over there, so the menu item that was clicked — and the focus on it —
  // is gone; a move inside the column keeps the node and needs nothing.
  useEffect(() => {
    if (refocus) trigger.current?.focus()
  }, [])

  /** Menu items unmount when the menu shuts, so focus has to be put somewhere. */
  const close = (): void => {
    setPlacement(null)
    trigger.current?.focus()
  }

  const toggle = (): void => {
    const box = trigger.current?.getBoundingClientRect()
    if (menuOpen || !box) setPlacement(null)
    else setPlacement(menuPlacement(box, { width: window.innerWidth, height: window.innerHeight }))
  }

  useEffect(() => {
    if (!menuOpen) return
    /*
     * The menu is fixed to the viewport so the scrolling column cannot clip it,
     * which means it no longer travels with the card: scroll the column and it
     * would hang over an unrelated one. Capture, because the scroll happens on
     * the column body rather than on the window.
     */
    const dismiss = (): void => close()
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    return () => {
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', dismiss)
    }
  }, [menuOpen])

  const move = (toColumnId: string, visualIndex: number): void => {
    close()
    onMove(toColumnId, visualIndex)
  }

  return (
    <div
      className={`ob-kb-card${active ? ' is-active' : ''}${dragging ? ' is-dragging' : ''}`}
      data-card={card.id}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', card.id)
        e.dataTransfer.effectAllowed = 'move'
        onDragStart()
      }}
      onDragEnd={onDragEnd}
    >
      <button type="button" className="ob-kb-card-main" onClick={onOpen} aria-label={`Edit card ${card.title}`}>
        <span className="ob-kb-card-grip" aria-hidden="true">
          <IconGrip size={12} />
        </span>
        <span className="ob-kb-card-title">{card.title}</span>
      </button>

      <div className="ob-kb-card-foot">
        <span className="ob-kb-card-meta">
          {bot ? <BotAvatar bot={bot} size="sm" /> : null}
          {card.notes.trim() ? (
            <span className="ob-kb-card-flag" title="Has notes">
              <IconNote size={11} />
            </span>
          ) : null}
          {card.sessionId ? (
            <span className="ob-kb-card-flag" title="Linked to a chat">
              <IconChat size={11} />
            </span>
          ) : null}
        </span>

        <span className="ob-kb-card-actions">
          <button
            type="button"
            className="ob-icon-btn"
            aria-label={card.sessionId ? `Open the chat for ${card.title}` : `Start a chat for ${card.title}`}
            onClick={onChat}
          >
            <IconChat size={11} />
          </button>
          <span
            className="ob-kb-menu-wrap"
            onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setPlacement(null)}
            onKeyDown={(e) => {
              if (e.key !== 'Escape' || !menuOpen) return
              // Escape belongs to the menu while it is open; left to bubble it
              // would reach the app handler and close the whole board.
              e.stopPropagation()
              close()
            }}
          >
            <button
              type="button"
              ref={trigger}
              className="ob-icon-btn"
              aria-label={`Move ${card.title}`}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              onClick={toggle}
            >
              <IconMove size={11} />
            </button>
            {placement ? (
              <ul className="ob-kb-menu" role="menu" aria-label={`Move ${card.title}`} style={placement}>
                <li role="none">
                  <button
                    type="button"
                    role="menuitem"
                    className="ob-kb-menu-item"
                    disabled={index === 0}
                    onClick={() => move(column.id, index - 1)}
                  >
                    Move up
                  </button>
                </li>
                <li role="none">
                  {/* One slot past the neighbour below: a visual slot counts the
                      card itself, so +2 lands it after the card it swaps with. */}
                  <button
                    type="button"
                    role="menuitem"
                    className="ob-kb-menu-item"
                    disabled={index >= column.cards.length - 1}
                    onClick={() => move(column.id, index + 2)}
                  >
                    Move down
                  </button>
                </li>
                {columns
                  .filter((c) => c.id !== column.id)
                  .map((c) => (
                    <li role="none" key={c.id}>
                      <button
                        type="button"
                        role="menuitem"
                        className="ob-kb-menu-item"
                        onClick={() => move(c.id, c.cards.length)}
                      >
                        Move to {c.name}
                      </button>
                    </li>
                  ))}
              </ul>
            ) : null}
          </span>
        </span>
      </div>
    </div>
  )
}
