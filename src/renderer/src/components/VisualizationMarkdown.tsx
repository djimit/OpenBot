import { useMemo, type MouseEvent, type ReactNode } from 'react'
import { renderMarkdownSegments } from '../lib/markdown'
import { Visualization } from './Visualization'
import { RichCard } from './RichCard'

interface VisualizationMarkdownProps {
  /** Raw assistant markdown, fences and all. */
  source: string
  /** Class for the outer container; defaults to the prose wrapper. */
  className?: string
  /** Delegated click handler, e.g. the code-frame Copy button. */
  onClick?: (event: MouseEvent<HTMLDivElement>) => void
}

/**
 * Assistant markdown with inline charts.
 *
 * A drop-in replacement for the `dangerouslySetInnerHTML` prose block: the
 * source is split into HTML runs and visualisation specs, and only the HTML runs
 * go through `innerHTML` (still sanitized) while charts become real components.
 *
 * Each prose run keeps the `ob-md` class of its own accord, because the sibling
 * spacing rule is `.ob-md > * + *` — with segments in between, the paragraphs of
 * a run are no longer direct children of the outer wrapper.
 */
export function VisualizationMarkdown({
  source,
  className = 'ob-md',
  onClick
}: VisualizationMarkdownProps): ReactNode {
  const segments = useMemo(() => renderMarkdownSegments(source), [source])

  return (
    <div className={className} onClick={onClick}>
      {segments.map((segment, i) =>
        segment.kind === 'visualization' ? (
          <Visualization key={`viz-${i}`} spec={segment.spec} />
        ) : segment.kind === 'card' ? (
          <RichCard key={`card-${i}`} spec={segment.spec} />
        ) : (
          <div key={`md-${i}`} className="ob-md" dangerouslySetInnerHTML={{ __html: segment.html }} />
        )
      )}
    </div>
  )
}
