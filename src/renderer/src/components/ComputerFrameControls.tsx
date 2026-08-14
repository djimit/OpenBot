import type { ReactNode } from 'react'

interface NavigateProps {
  url: string
  onUrl: (url: string) => void
  onNavigate: () => void
  busy: boolean
}

/** Address bar for the private screen, shared by the rail and expanded views. */
export function NavigateRow({ url, onUrl, onNavigate, busy }: NavigateProps): ReactNode {
  return (
    <div className="ob-cframe-navigate">
      <input
        className="ob-input"
        value={url}
        placeholder="Open a website"
        aria-label="Private screen address"
        onChange={(event) => onUrl(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter') onNavigate() }}
        disabled={busy}
      />
      <button type="button" className="ob-btn ob-btn-sm" onClick={onNavigate} disabled={!url.trim() || busy}>Go</button>
    </div>
  )
}

interface ControlsProps {
  url: string
  onUrl: (url: string) => void
  onNavigate: () => void
  text: string
  onText: (text: string) => void
  onSendText: () => void
  busy: boolean
  canOpenDesktopApps: boolean
  onKey: (combo: string) => void
  onOpenDesktopTerminal: () => void
  onScrollDown: () => void
}

/**
 * Typed input for the rail frame: one action per press, each routed through the
 * busy guard, for the times a click on the picture is not enough.
 */
export function ComputerFrameControls({
  url,
  onUrl,
  onNavigate,
  text,
  onText,
  onSendText,
  busy,
  canOpenDesktopApps,
  onKey,
  onOpenDesktopTerminal,
  onScrollDown
}: ControlsProps): ReactNode {
  return (
    <div className="ob-cframe-controls">
      <NavigateRow url={url} onUrl={onUrl} onNavigate={onNavigate} busy={busy} />
      <div className="ob-cframe-type">
        <input
          className="ob-input"
          value={text}
          placeholder="Type into the focused field"
          onChange={(event) => onText(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') onSendText() }}
          disabled={busy}
        />
        <button type="button" className="ob-btn ob-btn-sm" onClick={onSendText} disabled={!text || busy}>Type</button>
      </div>
      <div className="ob-cframe-keys">
        {['enter', 'tab', 'escape'].map((combo) => (
          <button key={combo} type="button" className="ob-btn ob-btn-sm" disabled={busy} onClick={() => onKey(combo)}>
            {combo === 'escape' ? 'Esc' : combo[0]!.toUpperCase() + combo.slice(1)}
          </button>
        ))}
        {canOpenDesktopApps ? <button type="button" className="ob-btn ob-btn-sm" disabled={busy} onClick={onOpenDesktopTerminal}>Open desktop terminal</button> : null}
        <button type="button" className="ob-btn ob-btn-sm" disabled={busy} onClick={onScrollDown}>Scroll down</button>
      </div>
      <p className="ob-hint">Your clicks and keystrokes go directly to the private screen and are not sent to the model.</p>
    </div>
  )
}
