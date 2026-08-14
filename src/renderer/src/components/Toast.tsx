import type { ReactNode } from 'react'
import { store, useAppState } from '../state'
import { IconClose, IconWarning } from './Icons'
import './Toast.css'

/** One transient message at a time, for failures that are not session-scoped. */
export function Toast(): ReactNode {
  const { toast } = useAppState()
  if (!toast) return null

  return (
    <div className={`ob-toast ob-toast-${toast.kind}`} role="status" aria-live="polite">
      {toast.kind === 'error' ? <IconWarning size={13} /> : null}
      <span className="ob-toast-text">{toast.text}</span>
      <button type="button" className="ob-icon-btn" aria-label="Dismiss message" onClick={() => store.dismissToast()}>
        <IconClose size={11} />
      </button>
    </div>
  )
}
