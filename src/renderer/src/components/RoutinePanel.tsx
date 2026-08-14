import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Routine } from '../../../shared/types'
import { relativeTime } from '../lib/format'
import { loadRoutines, removeRoutine, runRoutine, store, updateRoutine, useAppState } from '../state'
import { IconPlay, IconTrash } from './Icons'
import { Modal } from './Modal'
import { RoutineRecorder } from './RoutineRecorder'
import { RoutineSteps } from './RoutineSteps'
import './RoutinePanel.css'

const MODES: Array<{ id: Routine['replayMode']; label: string; hint: string }> = [
  { id: 'literal', label: 'Literal', hint: 'Replays the captured coordinates exactly.' },
  { id: 'adaptive', label: 'Adaptive', hint: 'Re-plans each step with the model against what is on screen.' }
]

/** Record and replay routines, grouped by the bot that owns them. */
export function RoutinePanel(): ReactNode {
  const { bots, routines, routinesError, recording, currentSessionId } = useAppState()
  const [botId, setBotId] = useState(() => bots[0]?.id ?? '')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [cronDraft, setCronDraft] = useState('0 9 * * 1-5')

  useEffect(() => {
    void loadRoutines()
  }, [])

  useEffect(() => {
    if (!botId && bots.length > 0) setBotId(bots[0]!.id)
  }, [bots, botId])

  const forBot = useMemo(() => routines.filter((r) => r.botId === botId), [routines, botId])
  const selected = forBot.find((r) => r.id === selectedId) ?? forBot[0] ?? null
  const activeMode = selected?.replayMode ?? 'literal'

  useEffect(() => {
    setCronDraft(selected?.trigger.cron ?? '0 9 * * 1-5')
  }, [selected?.id, selected?.trigger.cron])

  return (
    <Modal title="Routines" subtitle="Record a task once, then replay it." size="lg" onClose={() => store.setModal(null)}>
      <div className="ob-routines">
        <RoutineRecorder bots={bots} botId={botId} onBotChange={setBotId} />

        {recording.state !== 'idle' ? (
          <section className="ob-routine-live">
            <h3 className="ob-label">Captured so far</h3>
            <RoutineSteps steps={recording.steps} emptyText="No steps captured yet. Interact with the screen and they appear here." />
          </section>
        ) : null}

        {routinesError ? (
          <p className="ob-notice ob-notice-error" role="alert">
            {routinesError}
          </p>
        ) : null}

        {bots.length === 0 ? (
          <p className="ob-hint">Create a bot first — routines belong to a bot.</p>
        ) : (
          <div className="ob-routines-body">
            <div className="ob-routines-list">
              <h3 className="ob-label">Routines</h3>
              {forBot.length === 0 ? (
                <p className="ob-hint">This bot has no routines yet.</p>
              ) : (
                <ul>
                  {forBot.map((routine) => (
                    <li key={routine.id}>
                      <button
                        type="button"
                        className={`ob-routine-row${selected?.id === routine.id ? ' is-active' : ''}`}
                        onClick={() => setSelectedId(routine.id)}
                      >
                        <span className="ob-routine-name">{routine.name}</span>
                        <span className="ob-routine-meta">
                          {routine.steps.length} steps
                          {routine.lastRunAt ? ` · ran ${relativeTime(routine.lastRunAt)}` : ''}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="ob-routine-detail">
              {!selected ? (
                <p className="ob-hint">Select a routine to see its steps.</p>
              ) : (
                <>
                  <header className="ob-routine-detail-head">
                    <div>
                      <h3>{selected.name}</h3>
                      <p className="ob-hint">{selected.description || 'No description.'}</p>
                    </div>
                    <div className="ob-routine-actions">
                      <button
                        type="button"
                        className="ob-btn ob-btn-sm ob-btn-primary"
                        onClick={() => void runRoutine(selected.id)}
                        disabled={!currentSessionId}
                        title={currentSessionId ? undefined : 'Open a conversation first'}
                      >
                        <IconPlay size={11} />
                        Run
                      </button>
                      <button
                        type="button"
                        className="ob-icon-btn"
                        aria-label={`Delete ${selected.name}`}
                        onClick={() => void removeRoutine(selected.id)}
                      >
                        <IconTrash size={12} />
                      </button>
                    </div>
                  </header>

                  <div className="ob-field">
                    <span className="ob-label">Replay mode</span>
                    <div className="ob-mode" role="group" aria-label="Replay mode">
                      {MODES.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          className={`ob-mode-btn${activeMode === m.id ? ' is-active' : ''}`}
                          aria-pressed={activeMode === m.id}
                          aria-disabled="true"
                          title={m.hint}
                          onClick={() => store.toast('Replay mode is captured with the recording and cannot be changed here.')}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                    <p className="ob-hint">{MODES.find((m) => m.id === activeMode)?.hint} Set when the routine was recorded.</p>
                  </div>

                  <div className="ob-field">
                    <span className="ob-label">Schedule</span>
                    <div className="ob-mode" role="group" aria-label="Routine schedule">
                      <button
                        type="button"
                        className={`ob-mode-btn${selected.trigger.kind === 'manual' ? ' is-active' : ''}`}
                        aria-pressed={selected.trigger.kind === 'manual'}
                        onClick={() => void updateRoutine(selected.id, { trigger: { kind: 'manual' } })}
                      >
                        Manual
                      </button>
                      <button
                        type="button"
                        className={`ob-mode-btn${selected.trigger.kind === 'schedule' ? ' is-active' : ''}`}
                        aria-pressed={selected.trigger.kind === 'schedule'}
                        onClick={() => void updateRoutine(selected.id, { trigger: { kind: 'schedule', cron: cronDraft } })}
                      >
                        Scheduled
                      </button>
                    </div>
                    {selected.trigger.kind === 'schedule' ? (
                      <div className="ob-target-fields">
                        <label htmlFor={`ob-routine-cron-${selected.id}`}>Cron expression</label>
                        <input
                          id={`ob-routine-cron-${selected.id}`}
                          className="ob-input"
                          value={cronDraft}
                          placeholder="0 9 * * 1-5"
                          spellCheck={false}
                          onChange={(event) => setCronDraft(event.target.value)}
                          onBlur={() => {
                            if (cronDraft !== selected.trigger.cron) {
                              void updateRoutine(selected.id, { trigger: { kind: 'schedule', cron: cronDraft } })
                            }
                          }}
                        />
                        <p className="ob-hint">Five fields: minute, hour, day, month, weekday. Runs in this Mac’s timezone.</p>
                      </div>
                    ) : null}
                  </div>

                  <div className="ob-field">
                    <span className="ob-label">Steps</span>
                    <RoutineSteps steps={selected.steps} emptyText="This routine has no steps." />
                  </div>

                  {!currentSessionId ? <p className="ob-hint">Open a conversation to run this routine.</p> : null}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
