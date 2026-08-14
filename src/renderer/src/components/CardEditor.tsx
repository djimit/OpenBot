import { useEffect, useState, type ReactNode } from 'react'
import type { BoardCard, Bot } from '../../../shared/types'
import { openCardChat, removeCard, updateCard } from '../state'
import { BotAvatar } from './BotAvatar'
import { IconChat, IconClose, IconTrash } from './Icons'
import './CardEditor.css'

interface CardEditorProps {
  card: BoardCard
  bots: Bot[]
  onClose: () => void
}

/** The card drawer: title, notes, who owns it, its chat, and delete. */
export function CardEditor({ card, bots, onClose }: CardEditorProps): ReactNode {
  const [title, setTitle] = useState(card.title)
  const [notes, setNotes] = useState(card.notes)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    setTitle(card.title)
    setNotes(card.notes)
    setConfirmDelete(false)
  }, [card.id, card.title, card.notes])

  const dirty = title.trim() !== card.title || notes !== card.notes
  const assigned = card.botId ? bots.find((b) => b.id === card.botId) : undefined

  const save = (): void => {
    if (!dirty || !title.trim()) return
    void updateCard(card.id, { title: title.trim(), notes })
  }

  return (
    <div className="ob-card-editor">
      <header className="ob-card-editor-head">
        <h3>Card</h3>
        <button type="button" className="ob-icon-btn" aria-label="Close card editor" onClick={onClose}>
          <IconClose />
        </button>
      </header>

      <div className="ob-field">
        <label htmlFor="ob-card-title">Title</label>
        <input
          id="ob-card-title"
          className="ob-input"
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
      </div>

      <div className="ob-field">
        <label htmlFor="ob-card-notes">Notes</label>
        <textarea
          id="ob-card-notes"
          className="ob-textarea"
          rows={7}
          value={notes}
          placeholder="Anything the bot should know before starting."
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      <div className="ob-field">
        <label htmlFor="ob-card-bot">Assigned bot</label>
        <div className="ob-card-bot">
          <BotAvatar bot={assigned} size="sm" />
          <select
            id="ob-card-bot"
            className="ob-select"
            value={card.botId ?? ''}
            // Empty string, not undefined: the store reads an absent key as
            // "leave it alone", so `undefined` could never unassign anyone.
            onChange={(e) => void updateCard(card.id, { botId: e.target.value })}
          >
            <option value="">Nobody yet</option>
            {bots.map((bot) => (
              <option key={bot.id} value={bot.id}>
                {bot.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <button type="button" className="ob-btn ob-btn-sm" onClick={() => void openCardChat(card)}>
        <IconChat size={12} />
        {card.sessionId ? 'Go to the chat' : 'Open a chat from this card'}
      </button>
      <p className="ob-hint">
        {card.sessionId
          ? 'This card already has a conversation. Opening it switches the app to that chat.'
          : 'Starts a chat filed under this project, carrying the title and the assigned bot.'}
      </p>

      <footer className="ob-card-editor-foot">
        {confirmDelete ? (
          <span className="ob-card-editor-actions">
            <button
              type="button"
              className="ob-btn ob-btn-sm ob-btn-danger"
              onClick={() => {
                void removeCard(card.id)
                onClose()
              }}
            >
              Delete card
            </button>
            <button type="button" className="ob-btn ob-btn-sm" onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
          </span>
        ) : (
          <button type="button" className="ob-btn ob-btn-sm ob-btn-ghost" onClick={() => setConfirmDelete(true)}>
            <IconTrash size={12} />
            Delete
          </button>
        )}
        <button type="button" className="ob-btn ob-btn-sm ob-btn-primary" disabled={!dirty || !title.trim()} onClick={save}>
          Save
        </button>
      </footer>
    </div>
  )
}
