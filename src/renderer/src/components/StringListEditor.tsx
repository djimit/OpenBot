import { useState, type ReactNode } from 'react'
import type { ListEdit } from '../state'
import { IconClose, IconPlus } from './Icons'
import './StringListEditor.css'

interface StringListEditorProps {
  label: string
  hint?: string
  items: string[]
  placeholder: string
  tone?: 'neutral' | 'danger'
  /**
   * One entry at a time, never the whole list. These lists are also written by
   * the agent — "always approve" appends a rule — and the copy on screen can be
   * older than the file, so sending an array back would delete whatever landed
   * in between.
   */
  onEdit: (edit: ListEdit) => void
}

/** Chip-list editor used for the command allowlist and denylist. */
export function StringListEditor({ label, hint, items, placeholder, tone = 'neutral', onEdit }: StringListEditorProps): ReactNode {
  const [draft, setDraft] = useState('')

  const add = (): void => {
    const value = draft.trim()
    if (!value || items.includes(value)) {
      setDraft('')
      return
    }
    onEdit({ kind: 'add', value })
    setDraft('')
  }

  return (
    <div className="ob-field">
      <span className="ob-label">{label}</span>
      {hint ? <p className="ob-hint">{hint}</p> : null}

      <div className="ob-list-add">
        <input
          className="ob-input"
          value={draft}
          placeholder={placeholder}
          aria-label={`Add to ${label}`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
        />
        <button type="button" className="ob-icon-btn" onClick={add} aria-label={`Add to ${label}`} disabled={!draft.trim()}>
          <IconPlus size={12} />
        </button>
      </div>

      {items.length === 0 ? (
        <p className="ob-hint">Empty.</p>
      ) : (
        <ul className="ob-list-chips">
          {items.map((item) => (
            <li key={item} className={`ob-list-chip${tone === 'danger' ? ' is-danger' : ''}`}>
              <span>{item}</span>
              <button
                type="button"
                className="ob-icon-btn"
                aria-label={`Remove ${item} from ${label}`}
                onClick={() => onEdit({ kind: 'remove', value: item })}
              >
                <IconClose size={10} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
