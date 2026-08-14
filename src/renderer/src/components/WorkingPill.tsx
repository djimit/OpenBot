import type { ReactNode } from 'react'
import './WorkingPill.css'

interface WorkingPillProps {
  label?: string
  /** Slightly larger treatment for use inside the transcript. */
  size?: 'sm' | 'md'
}

/** Amber dot + label marking an agent that is actively doing something. */
export function WorkingPill({ label = 'Working', size = 'sm' }: WorkingPillProps): ReactNode {
  return (
    <span className={`ob-working ob-working-${size}`} role="status">
      <span className="ob-working-dot" aria-hidden="true" />
      {label}
    </span>
  )
}
