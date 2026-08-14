import type { ReactNode } from 'react'
import type { VisualizationSpec } from '../../../shared/visualization'
import { describeVisualization } from '../../../main/tools/visualize/normalise'
import { VisualizationBars } from './VisualizationBar'
import { VisualizationFlow } from './VisualizationFlow'
import { VisualizationStats } from './VisualizationStats'
import { VisualizationTimeline } from './VisualizationTimeline'
import './Visualization.css'

interface VisualizationProps {
  spec: VisualizationSpec
  /** Where the spec came from, shown in the frame header. */
  source?: string
}

/**
 * The frame around an inline chart: header, title, the kind-specific body, and
 * the legend/caption footer.
 *
 * Everything is drawn with inline SVG and CSS — no charting library — so a chart
 * costs nothing at install time and inherits the theme automatically. Tones are
 * expressed as `data-tone` attributes and resolved to `--ob-*` tokens in CSS,
 * which keeps every colour decision in one file.
 */
export function Visualization({ spec, source }: VisualizationProps): ReactNode {
  return (
    <figure className="ob-viz" role="group" aria-label={describeVisualization(spec)}>
      <header className="ob-viz-head">
        <span className="ob-viz-kind">{spec.kind}</span>
        <span className="ob-viz-titles">
          <span className="ob-viz-title">{spec.title}</span>
          {spec.subtitle ? <span className="ob-viz-subtitle">{spec.subtitle}</span> : null}
        </span>
        {source ? <span className="ob-viz-source">{source}</span> : null}
      </header>

      <div className="ob-viz-body">
        {spec.kind === 'flow' ? <VisualizationFlow spec={spec} /> : null}
        {spec.kind === 'bar' ? <VisualizationBars bars={spec.bars ?? []} /> : null}
        {spec.kind === 'stats' ? <VisualizationStats metrics={spec.metrics ?? []} /> : null}
        {spec.kind === 'timeline' ? <VisualizationTimeline events={spec.events ?? []} /> : null}
      </div>

      <VisualizationFoot spec={spec} />
    </figure>
  )
}

/** Tone key and caption. Renders nothing when the spec supplied neither. */
function VisualizationFoot({ spec }: { spec: VisualizationSpec }): ReactNode {
  const legend = spec.legend ?? []
  if (legend.length === 0 && !spec.caption) return null
  return (
    <figcaption className="ob-viz-foot">
      {legend.map((item, i) => (
        <span className="ob-viz-legend" key={`${item.label}-${i}`}>
          <span className="ob-viz-swatch" data-tone={item.tone ?? 'muted'} aria-hidden="true" />
          {item.label}
        </span>
      ))}
      {spec.caption ? <span className="ob-viz-caption">{spec.caption}</span> : null}
    </figcaption>
  )
}
