import type { ReactNode } from 'react'
import type { VisualizationBar } from '../../../shared/visualization'
import './VisualizationBar.css'

/**
 * Values are model-supplied and can be anything from 0.03 to 4 billion, so the
 * fraction digits follow the magnitude rather than a fixed setting.
 *
 * Past a quadrillion the grouped form stops being a number a reader can take in
 * — `1e308` spells out to 411 characters, which shoves the label out of its own
 * row — so the exponent is shown instead.
 */
function formatValue(value: number): string {
  if (Math.abs(value) >= 1e15) return value.toExponential(2)
  const digits = Math.abs(value) < 10 && !Number.isInteger(value) ? 2 : 0
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: digits }).format(value)
}

/**
 * Horizontal bars, one row each.
 *
 * A row with its own `max` is drawn against that scale — which is how a
 * percentage stays at 60% of the track instead of filling it just because it is
 * the largest value present. Rows without one share the chart's peak.
 */
export function VisualizationBars({ bars }: { bars: VisualizationBar[] }): ReactNode {
  if (bars.length === 0) return <p className="ob-viz-empty">No bars supplied.</p>

  const peak = Math.max(1, ...bars.map((b) => Math.abs(b.max ?? b.value)))

  return (
    <ul className="ob-viz-bars">
      {bars.map((bar, i) => {
        const scale = bar.max !== undefined && bar.max > 0 ? bar.max : peak
        const ratio = (bar.value / scale) * 100
        const width = Number.isFinite(ratio) ? Math.max(0, Math.min(100, ratio)) : 0
        return (
          <li className="ob-viz-bar" key={`${bar.label}-${i}`}>
            <div className="ob-viz-bar-head">
              <span className="ob-viz-bar-label">{bar.label}</span>
              {bar.detail ? <span className="ob-viz-bar-detail">{bar.detail}</span> : null}
              <span className="ob-viz-bar-value">{formatValue(bar.value)}</span>
            </div>
            <div
              className="ob-viz-bar-track"
              role="meter"
              aria-label={bar.label}
              aria-valuenow={bar.value}
              aria-valuemin={0}
              aria-valuemax={scale}
            >
              {/* Zero-width bars keep a sliver so the row still reads as a bar. */}
              <span className="ob-viz-bar-fill" data-tone={bar.tone ?? 'accent'} style={{ width: `${Math.max(width, 0.8)}%` }} />
            </div>
          </li>
        )
      })}
    </ul>
  )
}
