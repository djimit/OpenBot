import type { ReactNode } from 'react'
import { relativeTime } from '../lib/format'
import { IconDisplay, IconExpand } from './Icons'

interface EmptyProps {
  liveViewing: boolean
  canTakeover: boolean
  busy: boolean
  streaming: boolean
  waitingForHelp: boolean
  onToggleTakeover: () => void
}

/** Nothing captured yet for this bot — the frame still offers the handover. */
export function ComputerFrameEmpty({
  liveViewing,
  canTakeover,
  busy,
  streaming,
  waitingForHelp,
  onToggleTakeover
}: EmptyProps): ReactNode {
  return (
    <section className="ob-cframe" aria-label="Screen">
      <div className="ob-cframe-head">
        <h3 className="ob-rail-title">
          Screen
          {liveViewing ? <span className="ob-cframe-badge">Live</span> : null}
        </h3>
        {canTakeover ? (
          <button type="button" className="ob-btn ob-btn-sm" onClick={onToggleTakeover} disabled={busy}>
            {busy ? (streaming && !waitingForHelp ? 'Stopping…' : 'Opening…') : waitingForHelp ? 'Take over' : streaming ? 'Stop & take over' : 'Take over'}
          </button>
        ) : null}
      </div>
      <div className="ob-cframe-empty">
        <IconDisplay size={16} />
        <p>{liveViewing ? 'Connecting to the live VM screen…' : canTakeover ? 'Open this bot’s private screen to sign in or take over.' : 'Frames appear here when a bot uses the computer.'}</p>
      </div>
    </section>
  )
}

interface HeadProps {
  liveViewing: boolean
  /** When the frame on show was captured. */
  at: number
  canTakeover: boolean
  takeover: boolean
  busy: boolean
  streaming: boolean
  waitingForHelp: boolean
  onRefresh: () => void
  onEnlarge: () => void
  onToggleTakeover: () => void
}

/** Title row of the rail frame: how fresh it is, and what you can do to it. */
export function ComputerFrameHead({
  liveViewing,
  at,
  canTakeover,
  takeover,
  busy,
  streaming,
  waitingForHelp,
  onRefresh,
  onEnlarge,
  onToggleTakeover
}: HeadProps): ReactNode {
  return (
    <div className="ob-cframe-head">
      <h3 className="ob-rail-title">
        Screen
        {liveViewing ? <span className="ob-cframe-badge">Live</span> : <span className="ob-cframe-time">{relativeTime(at)}</span>}
      </h3>
      {canTakeover ? (
        <span className="ob-cframe-actions">
          <button type="button" className="ob-btn ob-btn-sm" onClick={onRefresh} disabled={busy}>Refresh</button>
          <button type="button" className="ob-btn ob-btn-sm" onClick={onEnlarge} disabled={busy}>
            <IconExpand size={12} /> Enlarge
          </button>
          <button
            type="button"
            className={`ob-btn ob-btn-sm${takeover ? ' ob-btn-primary' : ''}`}
            aria-pressed={takeover}
            onClick={onToggleTakeover}
            disabled={busy}
          >
            {busy ? (streaming && !waitingForHelp ? 'Stopping…' : 'Opening…') : takeover ? (waitingForHelp ? 'Hand back & resume' : 'Release') : waitingForHelp ? 'Take over' : streaming ? 'Stop & take over' : 'Take over'}
          </button>
        </span>
      ) : null}
    </div>
  )
}
