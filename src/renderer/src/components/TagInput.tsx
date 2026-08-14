import { useId, useState, type ReactNode } from 'react'
import type { ProjectTag } from '../../../shared/types'
import { IconClose, IconPlus } from './Icons'
import './TagInput.css'

interface TagInputProps {
  value: ProjectTag[]
  /** Tags already in use elsewhere, offered as one-click suggestions. */
  suggestions: ProjectTag[]
  onChange: (tags: ProjectTag[]) => void
}

/** Same shape the store keeps: trimmed, lower case, short. */
const clean = (raw: string): ProjectTag => raw.trim().toLowerCase().slice(0, 24)

const MAX_TAGS = 8

/** Free-text tag chips with add, remove and suggestions. */
export function TagInput({ value, suggestions, onChange }: TagInputProps): ReactNode {
  const [draft, setDraft] = useState('')
  const inputId = useId()

  const full = value.length >= MAX_TAGS

  const add = (raw: string): void => {
    const tag = clean(raw)
    setDraft('')
    if (!tag || value.includes(tag) || full) return
    onChange([...value, tag])
  }

  const remove = (tag: ProjectTag): void => onChange(value.filter((t) => t !== tag))

  const needle = clean(draft)
  const offered = suggestions.filter((t) => !value.includes(t) && (!needle || t.includes(needle))).slice(0, 6)

  return (
    <div className="ob-taginput">
      {value.length > 0 ? (
        <ul className="ob-taginput-chips" aria-label="Tags on this project">
          {value.map((tag) => (
            <li key={tag} className="ob-taginput-chip">
              <span>{tag}</span>
              <button type="button" className="ob-taginput-x" aria-label={`Remove tag ${tag}`} onClick={() => remove(tag)}>
                <IconClose size={9} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="ob-taginput-row">
        <input
          id={inputId}
          className="ob-input"
          value={draft}
          maxLength={24}
          disabled={full}
          placeholder={full ? 'Eight tags is the limit' : 'Add a tag — work, personal, anything'}
          aria-label="Add a tag"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault()
              add(draft)
            } else if (e.key === 'Backspace' && !draft && value.length > 0) {
              remove(value[value.length - 1] as ProjectTag)
            }
          }}
        />
        <button
          type="button"
          className="ob-btn ob-btn-sm"
          disabled={!clean(draft) || full}
          aria-label="Add this tag"
          onClick={() => add(draft)}
        >
          <IconPlus size={11} />
          Add
        </button>
      </div>

      {offered.length > 0 && !full ? (
        <div className="ob-taginput-suggest" role="group" aria-label="Existing tags">
          {offered.map((tag) => (
            <button key={tag} type="button" className="ob-taginput-suggestion" onClick={() => add(tag)}>
              {tag}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
