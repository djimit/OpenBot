import { useEffect, useState, type ReactNode } from 'react'
import { relativeTime } from '../lib/format'
import { addMemory, loadMemory, removeMemory, useAppState } from '../state'
import { IconPlus, IconTrash } from './Icons'
import './BotMemory.css'

interface BotMemoryProps {
  botId: string
}

/** What the bot remembers, with a way to add and forget entries. */
export function BotMemory({ botId }: BotMemoryProps): ReactNode {
  const { memories } = useAppState()
  const [text, setText] = useState('')
  const entries = memories[botId]

  useEffect(() => {
    void loadMemory(botId)
  }, [botId])

  const submit = (): void => {
    if (!text.trim()) return
    void addMemory(botId, text)
    setText('')
  }

  return (
    <section className="ob-memory">
      <h4 className="ob-label">Memory</h4>

      <div className="ob-memory-add">
        <input
          className="ob-input"
          value={text}
          placeholder="Something this bot should remember"
          aria-label="New memory"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submit()
            }
          }}
        />
        <button type="button" className="ob-icon-btn" onClick={submit} aria-label="Add memory" disabled={!text.trim()}>
          <IconPlus size={12} />
        </button>
      </div>

      {entries === undefined ? (
        <p className="ob-hint">Loading memory…</p>
      ) : entries.length === 0 ? (
        <p className="ob-hint">Nothing remembered yet. Entries appear here as the bot works.</p>
      ) : (
        <ul className="ob-memory-list">
          {entries.map((entry) => (
            <li key={entry.id} className="ob-memory-item">
              <span className="ob-memory-text">{entry.text}</span>
              <span className="ob-memory-meta">
                <span className="ob-pill">{entry.source}</span>
                <span>{relativeTime(entry.createdAt)}</span>
                <button
                  type="button"
                  className="ob-icon-btn"
                  aria-label="Forget this entry"
                  onClick={() => void removeMemory(botId, entry.id)}
                >
                  <IconTrash size={11} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
