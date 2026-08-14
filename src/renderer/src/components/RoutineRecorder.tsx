import { useState, type ReactNode } from 'react'
import type { Bot } from '../../../shared/types'
import { startRecording, stopRecording, useAppState } from '../state'
import { IconRecord, IconStop } from './Icons'
import './RoutineRecorder.css'

interface RoutineRecorderProps {
  bots: Bot[]
  botId: string
  onBotChange: (id: string) => void
}

/** Start/stop capture, with the live step counter while recording. */
export function RoutineRecorder({ bots, botId, onBotChange }: RoutineRecorderProps): ReactNode {
  const { recording } = useAppState()
  const [name, setName] = useState('')
  const active = recording.state !== 'idle'

  if (active) {
    return (
      <div className="ob-recorder is-active">
        <span className="ob-recorder-live">
          <span className="ob-recorder-dot" aria-hidden="true" />
          {recording.state === 'paused' ? 'Paused' : 'Recording'}
        </span>
        <span className="ob-recorder-name">{recording.name}</span>
        <span className="ob-recorder-count" aria-live="polite">
          {recording.stepCount} step{recording.stepCount === 1 ? '' : 's'}
        </span>
        <button type="button" className="ob-btn ob-btn-sm ob-btn-danger" onClick={() => void stopRecording()}>
          <IconStop size={11} />
          Stop and save
        </button>
      </div>
    )
  }

  return (
    <div className="ob-recorder">
      <label className="ob-sr-only" htmlFor="ob-routine-name">
        Routine name
      </label>
      <input
        id="ob-routine-name"
        className="ob-input ob-recorder-input"
        value={name}
        placeholder="Name the routine you are about to record"
        onChange={(e) => setName(e.target.value)}
      />
      <label className="ob-sr-only" htmlFor="ob-routine-bot">
        Bot
      </label>
      <select id="ob-routine-bot" className="ob-select ob-recorder-select" value={botId} onChange={(e) => onBotChange(e.target.value)}>
        {bots.map((b) => (
          <option key={b.id} value={b.id}>
            {b.emoji} {b.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="ob-btn ob-btn-sm"
        disabled={!botId}
        onClick={() => void startRecording(botId, name)}
        aria-label="Start recording a routine"
      >
        <IconRecord size={10} />
        Record
      </button>
    </div>
  )
}
