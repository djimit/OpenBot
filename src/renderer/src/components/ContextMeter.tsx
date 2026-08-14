import type { ReactNode } from 'react'
import { useAppState } from '../state'
import './ContextMeter.css'

/** 12.4K, 1.2M — compact enough to sit in the composer bar. */
function compact(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`
  return String(tokens)
}

/**
 * How much of the model's context the conversation is holding.
 *
 * The numbers come from the backend rather than a local count: agent CLIs
 * compact and prune their own context, so anything we counted here would drift
 * away from what the model actually sees.
 */
export function ContextMeter(): ReactNode {
  const { usage } = useAppState()
  const used = usage?.totalTokens ?? usage?.inputTokens
  if (!used) return null

  const window = usage?.contextWindow
  const ratio = window && window > 0 ? Math.min(1, used / window) : null
  // Only worth flagging as the window actually starts to fill.
  const tone = ratio === null ? '' : ratio >= 0.9 ? ' is-critical' : ratio >= 0.7 ? ' is-warn' : ''

  const label = window ? `${compact(used)} / ${compact(window)}` : compact(used)
  const title = window
    ? `${used.toLocaleString()} of ${window.toLocaleString()} tokens of context in use`
    : `${used.toLocaleString()} tokens of context in use`

  return (
    <span className={`ob-context${tone}`} title={title}>
      {ratio !== null ? (
        <span className="ob-context-track" aria-hidden="true">
          <span className="ob-context-fill" style={{ width: `${Math.round(ratio * 100)}%` }} />
        </span>
      ) : null}
      <span className="ob-context-label">{label}</span>
    </span>
  )
}
