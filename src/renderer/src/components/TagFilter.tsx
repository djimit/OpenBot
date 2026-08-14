import type { ReactNode } from 'react'
import type { ProjectTag } from '../../../shared/types'
import './TagFilter.css'

interface TagFilterProps {
  /** Every tag worth offering: the built-ins plus whatever is in use. */
  tags: ProjectTag[]
  active: ProjectTag | null
  /** How many projects each tag would show, for the title text. */
  countOf: (tag: ProjectTag) => number
  onSelect: (tag: ProjectTag | null) => void
}

/**
 * The tag row above the project list. Tags are free text, so this renders
 * whatever the user has actually invented rather than a fixed set — `All`
 * first, then the built-ins, then their own.
 */
export function TagFilter({ tags, active, countOf, onSelect }: TagFilterProps): ReactNode {
  return (
    <div className="ob-tagfilter" role="group" aria-label="Filter projects by tag">
      <button
        type="button"
        className={`ob-tagfilter-chip${active === null ? ' is-active' : ''}`}
        aria-pressed={active === null}
        onClick={() => onSelect(null)}
      >
        All
      </button>
      {tags.map((tag) => {
        const count = countOf(tag)
        return (
          <button
            key={tag}
            type="button"
            className={`ob-tagfilter-chip${active === tag ? ' is-active' : ''}`}
            aria-pressed={active === tag}
            title={`${count} project${count === 1 ? '' : 's'} tagged ${tag}`}
            onClick={() => onSelect(active === tag ? null : tag)}
          >
            {tag}
          </button>
        )
      })}
    </div>
  )
}
