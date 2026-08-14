import type { CSSProperties, MouseEvent, ReactNode } from 'react'
import { pngSrc } from '../lib/format'

/** The frame's own pixel size, read off the image once it has loaded. */
export interface Natural {
  width: number
  height: number
}

interface LastClick {
  x: number
  y: number
  at: number
  botId: string | null
}

// The click marker is only meaningful once we know the frame's own pixel size.
export function clickMarker(
  lastClick: LastClick | null,
  botId: string | undefined,
  natural: Natural | null,
  frameAt: number
): CSSProperties | null {
  return lastClick &&
    lastClick.botId === botId &&
    natural &&
    natural.width > 0 &&
    natural.height > 0 &&
    lastClick.at >= frameAt - 4000
    ? { left: `${(lastClick.x / natural.width) * 100}%`, top: `${(lastClick.y / natural.height) * 100}%` }
    : null
}

/** Ring over the spot the bot last clicked. */
export function ClickMarker({ marker }: { marker: CSSProperties | null }): ReactNode {
  if (!marker) return null
  return (
    <span className="ob-cframe-marker" style={marker} aria-hidden="true">
      <span className="ob-cframe-marker-ring" />
      <span className="ob-cframe-marker-dot" />
    </span>
  )
}

interface StageProps {
  screenshot: string
  marker: CSSProperties | null
  takeover: boolean
  onClick: (event: MouseEvent<HTMLImageElement>) => void
  onNatural: (natural: Natural) => void
}

/** The rail-sized frame: one click sends one click. */
export function ComputerFrameStage({ screenshot, marker, takeover, onClick, onNatural }: StageProps): ReactNode {
  return (
    <div className="ob-cframe-stage">
      <img
        className="ob-cframe-img"
        src={pngSrc(screenshot)}
        alt="Latest capture of the controlled screen"
        onClick={onClick}
        data-takeover={takeover || undefined}
        onLoad={(e) => onNatural({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
      />
      <ClickMarker marker={marker} />
    </div>
  )
}
