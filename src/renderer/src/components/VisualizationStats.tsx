import type { ReactNode } from 'react'
import type { VisualizationMetric } from '../../../shared/visualization'
import './VisualizationStats.css'

/**
 * A row of headline figures.
 *
 * Values are rendered verbatim — the model formats them — so "1.2M", "38%" and
 * "3 of 7" all sit together without the renderer guessing at units. The grid
 * reflows on narrow transcripts rather than scrolling, because eight tiles read
 * fine stacked but badly clipped.
 */
export function VisualizationStats({ metrics }: { metrics: VisualizationMetric[] }): ReactNode {
  if (metrics.length === 0) return <p className="ob-viz-empty">No metrics supplied.</p>

  return (
    <dl className="ob-viz-stats">
      {metrics.map((metric, i) => (
        <div className="ob-viz-stat" data-tone={metric.tone ?? 'muted'} key={`${metric.label}-${i}`}>
          <dt className="ob-viz-stat-label">
            <span className="ob-viz-stat-dot" aria-hidden="true" />
            {metric.label}
          </dt>
          <dd className="ob-viz-stat-value">{metric.value}</dd>
          {metric.detail ? <dd className="ob-viz-stat-detail">{metric.detail}</dd> : null}
        </div>
      ))}
    </dl>
  )
}
