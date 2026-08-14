import type { ReactNode } from 'react'
import type { DiffLine } from '../lib/diff'
import './DiffView.css'

interface DiffViewProps {
  lines: DiffLine[]
  path?: string
  added?: number
  removed?: number
  /** Shown when the diff was reconstructed from the call arguments. */
  synthesized?: boolean
  maxRows?: number
}

const GUTTER: Record<DiffLine['kind'], string> = {
  add: '+',
  del: '-',
  ctx: ' ',
  meta: '',
  hunk: ''
}

/** Renders unified-diff lines with per-line gutters and add/remove tinting. */
export function DiffView({ lines, path, added, removed, synthesized, maxRows = 400 }: DiffViewProps): ReactNode {
  const shown = lines.slice(0, maxRows)
  const hidden = lines.length - shown.length

  return (
    <div className="ob-diff">
      <div className="ob-diff-head">
        <span className="ob-diff-path">{path ?? 'Proposed change'}</span>
        <span className="ob-diff-stat">
          {added !== undefined ? <span className="ob-diff-plus">+{added}</span> : null}
          {removed !== undefined ? <span className="ob-diff-minus">−{removed}</span> : null}
          {synthesized ? <span className="ob-diff-note">reconstructed</span> : null}
        </span>
      </div>
      {/*
        The body scrolls at 340px, so it needs a way in from the keyboard:
        nothing inside it is focusable, and on an approval card this is the
        change the user is being asked to allow — they could read the first
        screenful of a long diff and then had to decide blind.
      */}
      <div className="ob-diff-body" role="table" tabIndex={0} aria-label={path ? `Diff for ${path}` : 'Diff'}>
        {shown.map((line, i) => (
          <div className={`ob-diff-row ob-diff-${line.kind}`} role="row" key={`${i}-${line.kind}`}>
            <span className="ob-diff-no" role="cell">
              {line.oldNo ?? ''}
            </span>
            <span className="ob-diff-no" role="cell">
              {line.newNo ?? ''}
            </span>
            <span className="ob-diff-sign" aria-hidden="true">
              {GUTTER[line.kind]}
            </span>
            <span className="ob-diff-text" role="cell">
              {line.text || ' '}
            </span>
          </div>
        ))}
      </div>
      {hidden > 0 ? <div className="ob-diff-more">{hidden} more lines not shown</div> : null}
    </div>
  )
}
