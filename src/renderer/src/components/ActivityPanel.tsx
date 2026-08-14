import { useEffect, useState, type ReactNode } from 'react'
import { cancelBackgroundTask, clearActivity, createBackgroundTask, markActivityRead, selectSession, store, useAppState } from '../state'
import { relativeTime } from '../lib/format'
import { BotAvatar } from './BotAvatar'
import { IconClose, IconPlay, IconTrash } from './Icons'
import { Modal } from './Modal'
import './ActivityPanel.css'

export function ActivityPanel(): ReactNode {
  const { activity, tasks, bots } = useAppState()
  const [botId, setBotId] = useState('')
  const [prompt, setPrompt] = useState('')
  const active = tasks.filter((task) => task.status === 'queued' || task.status === 'running')

  /*
   * The select is seeded here rather than in `useState(bots.find(…))`, because
   * that initialiser only runs at mount and `bots` arrives over IPC afterwards:
   * a panel opened during load kept an empty selection, so the select stayed
   * blank and "Run in background" was disabled for good. Re-seeds too when the
   * chosen bot is archived away underneath the panel.
   */
  useEffect(() => {
    const first = bots.find((bot) => !bot.archived)
    if (first && !bots.some((bot) => bot.id === botId && !bot.archived)) setBotId(first.id)
  }, [bots, botId])

  const openSession = (sessionId: string): void => {
    void selectSession(sessionId)
    store.setModal(null)
  }

  return (
    <Modal title="Inbox & background tasks" subtitle="Work that needs attention or finished while you were elsewhere." size="lg" onClose={() => store.setModal(null)}>
      <div className="ob-activity-grid">
        <section className="ob-activity-section">
          <h3>Start a background task</h3>
          <div className="ob-activity-compose">
            <select className="ob-select" value={botId} onChange={(event) => setBotId(event.target.value)} aria-label="Background task bot">
              {bots.filter((bot) => !bot.archived).map((bot) => <option key={bot.id} value={bot.id}>{bot.emoji} {bot.name}</option>)}
            </select>
            <textarea className="ob-textarea" rows={3} value={prompt} placeholder="Give this bot work to complete independently…" onChange={(event) => setPrompt(event.target.value)} />
            <button type="button" className="ob-btn ob-btn-primary" disabled={!botId || !prompt.trim()} onClick={() => {
              const body = prompt.trim()
              setPrompt('')
              void createBackgroundTask(botId, body)
            }}><IconPlay size={11} /> Run in background</button>
          </div>

          <h3>Tasks</h3>
          {tasks.length === 0 ? <p className="ob-hint">No background tasks yet.</p> : (
            <ul className="ob-activity-list">
              {tasks.map((task) => {
                const bot = bots.find((candidate) => candidate.id === task.botId)
                return <li key={task.id} className="ob-activity-item">
                  <button type="button" className="ob-activity-main" onClick={() => openSession(task.sessionId)}>
                    <BotAvatar bot={bot} size="sm" />
                    <span><strong>{task.title}</strong><small>{task.status} · {relativeTime(task.updatedAt)}</small>{task.error ? <em>{task.error}</em> : null}</span>
                  </button>
                  {(task.status === 'queued' || task.status === 'running') ? <button type="button" className="ob-icon-btn" aria-label={`Cancel ${task.title}`} onClick={() => void cancelBackgroundTask(task.id)}><IconClose size={11} /></button> : null}
                </li>
              })}
            </ul>
          )}
          {active.length > 0 ? <p className="ob-hint">{active.length} task{active.length === 1 ? '' : 's'} currently active.</p> : null}
        </section>

        <section className="ob-activity-section">
          <header className="ob-activity-heading"><h3>Inbox</h3><span>
            <button type="button" className="ob-btn ob-btn-sm" onClick={() => void markActivityRead()}>Mark read</button>
            <button type="button" className="ob-icon-btn" aria-label="Clear inbox" onClick={() => void clearActivity()}><IconTrash size={11} /></button>
          </span></header>
          {activity.length === 0 ? <p className="ob-hint">Nothing needs your attention.</p> : (
            <ul className="ob-activity-list">
              {activity.map((item) => <li key={item.id} className={`ob-activity-item${item.read ? '' : ' is-unread'}`}>
                <button type="button" className="ob-activity-main" onClick={() => {
                  void markActivityRead(item.id)
                  if (item.sessionId) openSession(item.sessionId)
                }}>
                  <span className={`ob-activity-dot is-${item.kind}`} aria-hidden="true" />
                  <span><strong>{item.title}</strong><small>{relativeTime(item.createdAt)}</small><em>{item.detail}</em></span>
                </button>
              </li>)}
            </ul>
          )}
        </section>
      </div>
    </Modal>
  )
}
