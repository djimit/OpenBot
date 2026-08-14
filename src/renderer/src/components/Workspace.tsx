import { useEffect, useMemo, type ReactNode } from 'react'
import { cx } from '../lib/format'
import { LAYOUT_PRESETS, gridStyleFor, paneAreaFor, type LayoutPreset } from '../lib/paneLayout'
import { overlayOwnsKeys } from '../lib/shortcutRules'
import { assignPane, closeFocusedPane, closeWorkspace, isEditableTarget, moveFocus, setPreset, store, useAppState } from '../state'
import { PaneChat } from './PaneChat'
import { WorkspacePicker } from './WorkspacePicker'
import './Workspace.css'

/** Alt+1…6 pick a preset, in the order `LAYOUT_PRESETS` lists them. */
const DIGITS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6']

/**
 * Several conversations at once.
 *
 * The tiling comes from `lib/paneLayout` — a pure function of the preset — and
 * the pane assignments from `state/workspace`. Exactly one pane is focused, and
 * focusing a pane makes its chat the app's current session, so the composer
 * below the grid and the live event stream always follow the focused pane.
 */
export function Workspace(): ReactNode {
  const { workspace, currentSessionId } = useAppState()
  const { preset, panes, focused } = workspace

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!e.altKey || e.metaKey || e.ctrlKey || isEditableTarget(e.target)) return
      /*
       * Read at press time, not from the render that installed this listener:
       * the effect runs once. An approval or a dialog owns the keyboard while it
       * is up — Alt+arrow calls `selectSession`, which changed the live chat out
       * from under a gate that was asking about the previous one.
       */
      const { approvals, modal } = store.getState()
      if (overlayOwnsKeys({ approvals: approvals.length, modalOpen: modal !== null })) return

      const digit = DIGITS.indexOf(e.code)
      if (digit >= 0 && digit < LAYOUT_PRESETS.length) {
        e.preventDefault()
        setPreset(LAYOUT_PRESETS[digit].value)
        return
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault()
        moveFocus(1)
        return
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault()
        moveFocus(-1)
        return
      }
      // Alt+W types "∑" on macOS, so match the physical key.
      if (e.code === 'KeyW') {
        e.preventDefault()
        closeFocusedPane()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Navigating elsewhere (the sidebar, a deleted chat) moves the app's current
  // session; the focused pane follows it, so "focused" and "live" never drift
  // apart. An empty focused pane is left alone — it was emptied on purpose.
  useEffect(() => {
    const inPane = panes[focused]
    if (inPane && currentSessionId && inPane !== currentSessionId) assignPane(focused, currentSessionId)
  }, [panes, focused, currentSessionId])

  const taken = useMemo(() => new Set(panes.filter((id): id is string => id !== null)), [panes])

  return (
    <div className="ob-workspace">
      <div className="ob-ws-bar">
        <span className="ob-ws-name">Workspace</span>

        <div className="ob-ws-presets" role="group" aria-label="Pane layout">
          {LAYOUT_PRESETS.map((info, i) => (
            <button
              key={info.value}
              type="button"
              className={cx('ob-ws-preset', info.value === preset && 'is-active')}
              aria-pressed={info.value === preset}
              aria-label={`${info.label} layout — ${info.hint}`}
              title={`${info.hint}  (Alt+${i + 1})`}
              onClick={() => setPreset(info.value)}
            >
              <PresetGlyph preset={info.value} />
              <span className="ob-ws-preset-label">{info.label}</span>
            </button>
          ))}
        </div>

        <span className="ob-ws-keys" aria-hidden="true">
          Alt+←/→ focus · Alt+W close pane · Alt+G exit
        </span>

        <button
          type="button"
          className="ob-btn ob-btn-sm"
          onClick={closeWorkspace}
          aria-label="Close the workspace and return to a single conversation"
        >
          Close workspace
        </button>
      </div>

      <div className="ob-ws-grid" style={gridStyleFor(preset)}>
        {panes.map((sessionId, index) => (
          <div
            key={sessionId ? `${index}:${sessionId}` : `${index}:empty`}
            className="ob-ws-cell"
            style={{ gridArea: paneAreaFor(preset, index) }}
          >
            {sessionId ? (
              <PaneChat sessionId={sessionId} index={index} focused={index === focused} />
            ) : (
              <WorkspacePicker index={index} taken={taken} />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Rectangles per preset, in a 16×16 box: [x, y, width, height]. */
const GLYPHS: Record<LayoutPreset, Array<[number, number, number, number]>> = {
  single: [[2, 2, 12, 12]],
  'two-columns': [
    [2, 2, 5.5, 12],
    [8.5, 2, 5.5, 12]
  ],
  'two-rows': [
    [2, 2, 12, 5.5],
    [2, 8.5, 12, 5.5]
  ],
  'top-main': [
    [2, 2, 12, 7],
    [2, 10.5, 5.5, 3.5],
    [8.5, 10.5, 5.5, 3.5]
  ],
  'left-main': [
    [2, 2, 7, 12],
    [10, 2, 4, 5.5],
    [10, 8.5, 4, 5.5]
  ],
  four: [
    [2, 2, 5.5, 5.5],
    [8.5, 2, 5.5, 5.5],
    [2, 8.5, 5.5, 5.5],
    [8.5, 8.5, 5.5, 5.5]
  ]
}

/** A miniature of the tiling: the label alone does not carry the shape. */
function PresetGlyph({ preset }: { preset: LayoutPreset }): ReactNode {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {GLYPHS[preset].map(([x, y, w, h], i) => (
        <rect key={i} x={x} y={y} width={w} height={h} rx="1.5" fill="currentColor" opacity={i === 0 ? 0.95 : 0.4} />
      ))}
    </svg>
  )
}
