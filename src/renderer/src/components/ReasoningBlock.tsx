import { useState, type ReactNode } from 'react'
import { IconChevronDown, IconChevronRight } from './Icons'
import './ReasoningBlock.css'

interface ReasoningBlockProps {
  text: string
  /** True while the model is still thinking and has produced no answer yet. */
  streaming: boolean
}

/** Collapsible reasoning trace — hidden by default, never auto-expanded. */
export function ReasoningBlock({ text, streaming }: ReasoningBlockProps): ReactNode {
  const [open, setOpen] = useState(false)
  if (!text && !streaming) return null

  return (
    <div className={`ob-reasoning${streaming ? ' ob-reasoning-live' : ''}`}>
      <button type="button" className="ob-reasoning-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? <IconChevronDown size={11} /> : <IconChevronRight size={11} />}
        <span>{streaming ? 'Thinking' : 'Reasoning'}</span>
        {streaming ? <span className="ob-reasoning-dots" aria-hidden="true" /> : null}
      </button>
      {open ? <pre className="ob-reasoning-text">{text || 'No reasoning captured yet.'}</pre> : null}
    </div>
  )
}
