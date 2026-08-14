import type { ReactNode } from 'react'
import type { VisualizationEvent } from '../../../shared/visualization'
import './VisualizationTimeline.css'

/**
 * An ordered list of events on a single rail.
 *
 * The connecting line is drawn per row rather than as one absolute element, so
 * rows of different heights stay joined and the last row stops cleanly at its
 * own marker. `time` is free text and right-aligned in tabular figures, which
 * keeps a column of dates or durations lined up without parsing them.
 */
export function VisualizationTimeline({ events }: { events: VisualizationEvent[] }): ReactNode {
  if (events.length === 0) return <p className="ob-viz-empty">No events supplied.</p>

  return (
    <ol className="ob-viz-timeline">
      {events.map((event, i) => (
        <li className="ob-viz-event" data-tone={event.tone ?? 'muted'} data-last={i === events.length - 1} key={`${event.title}-${i}`}>
          <span className="ob-viz-event-rail" aria-hidden="true">
            <span className="ob-viz-event-dot" />
          </span>
          <div className="ob-viz-event-body">
            <div className="ob-viz-event-head">
              <span className="ob-viz-event-title">{event.title}</span>
              {event.time ? <span className="ob-viz-event-time">{event.time}</span> : null}
            </div>
            {event.detail ? <p className="ob-viz-event-detail">{event.detail}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  )
}
