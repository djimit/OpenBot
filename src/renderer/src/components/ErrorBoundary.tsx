import { Component, type ErrorInfo, type ReactNode } from 'react'
import './ErrorBoundary.css'

interface Props {
  children: ReactNode
  /** Shown instead of the generic wording, e.g. "This message could not be shown". */
  label?: string
}

interface State {
  error: Error | null
}

/**
 * Contains a render failure instead of losing the app.
 *
 * Message content is model output, so a render throw is reachable by anything a
 * bot writes — a malformed chart spec, an unexpected shape. Without a boundary
 * React unmounts the whole tree and the user sees a blank window with no way
 * back. Wrapping the volatile regions keeps the rest of the app usable and, in
 * the per-message case, costs only that one bubble.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Kept: without it the cause is invisible, since nothing else logs a render throw.
    console.error('Render failed:', error, info.componentStack)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="ob-boundary" role="alert">
        <p className="ob-boundary-title">{this.props.label ?? 'Something failed to render'}</p>
        <p className="ob-boundary-detail">{error.message}</p>
        <button
          type="button"
          className="ob-btn ob-btn-sm"
          onClick={() => this.setState({ error: null })}
        >
          Try again
        </button>
      </div>
    )
  }
}
