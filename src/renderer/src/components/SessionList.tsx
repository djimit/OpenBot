import { useMemo, useState, type ReactNode } from 'react'
import type { Bot, SessionSummary } from '../../../shared/types'
import { groupSessions, relativeTime } from '../lib/format'
import { removeSession, renameSession, selectSession, setSessionProject, toggleArchive, useAppState } from '../state'
import { BotAvatar } from './BotAvatar'
import { IconArchive, IconCheck, IconClose, IconFolder, IconPencil, IconTrash } from './Icons'
import './SessionList.css'

interface SessionListProps {
  sessions: SessionSummary[]
  bots: Map<string, Bot>
  currentId: string | null
  query: string
  showArchived: boolean
  loading: boolean
  error: string | null
  /** When set, only chats filed under that project are listed. */
  projectId?: string | null
  projectName?: string
}

/** Grouped conversation list with inline rename, archive and delete. */
export function SessionList({
  sessions,
  bots,
  currentId,
  query,
  showArchived,
  loading,
  error,
  projectId = null,
  projectName
}: SessionListProps): ReactNode {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [confirmId, setConfirmId] = useState<string | null>(null)
  /** The row whose project picker is open — one at a time, like rename and delete. */
  const [filingId, setFilingId] = useState<string | null>(null)
  /*
   * The picker needs the project list, and the row is where the chat already
   * is, so the choice is made in place rather than in a dialog. Read from the
   * store rather than taken as a prop: the list is shared state and this is the
   * only part of the row that wants it.
   */
  const { projects } = useAppState()
  const live = projects.filter((p) => !p.archived)

  /*
   * What one chat may be filed under: the live projects, plus the archived one
   * it is already in. Leaving that one out would make the picker read "No
   * project" for a chat that is filed, and the next stray click would unfile it.
   */
  const optionsFor = (s: SessionSummary): typeof projects =>
    s.projectId && !live.some((p) => p.id === s.projectId)
      ? [...live, ...projects.filter((p) => p.id === s.projectId)]
      : live

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const filtered = sessions.filter(
      (s) =>
        (showArchived ? s.archived === true : s.archived !== true) &&
        /*
         * With no project selected, a filed chat is shown under its project
         * rather than here — otherwise it appears twice and the project looks
         * empty. Selecting a project narrows this list to that project.
         */
        (projectId ? s.projectId === projectId : !s.projectId) &&
        (!needle || s.title.toLowerCase().includes(needle))
    )
    return groupSessions(filtered)
  }, [sessions, query, showArchived, projectId])

  const commitRename = (id: string): void => {
    void renameSession(id, draft)
    setEditingId(null)
  }

  if (error) {
    return (
      <p className="ob-notice ob-notice-error ob-sessions-notice" role="alert">
        {error}
      </p>
    )
  }

  if (loading && sessions.length === 0) {
    return <p className="ob-sessions-note">Loading conversations…</p>
  }

  if (groups.length === 0) {
    return (
      <p className="ob-sessions-note">
        {query.trim()
          ? 'No conversations match that search.'
          : showArchived
            ? 'Nothing archived yet.'
            : projectId
              ? `No conversations in ${projectName ?? 'this project'} yet. Open a card and start one.`
              : 'No conversations yet. Start one with New chat.'}
      </p>
    )
  }

  return (
    <>
      {groups.map((group) => (
        <section key={group.label} className="ob-sessions-group">
          <h3 className="ob-sessions-label">{group.label}</h3>
          <ul className="ob-sessions">
            {group.items.map((s) => {
              const isCurrent = s.id === currentId
              const editing = editingId === s.id
              const filing = filingId === s.id
              return (
                <li key={s.id} className={`ob-session${isCurrent ? ' is-current' : ''}`}>
                  {editing ? (
                    <input
                      className="ob-input ob-session-rename"
                      value={draft}
                      autoFocus
                      aria-label="Conversation title"
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => commitRename(s.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename(s.id)
                        if (e.key === 'Escape') {
                          e.stopPropagation()
                          setEditingId(null)
                        }
                      }}
                    />
                  ) : filing ? (
                    /* Takes the row over the way the rename field does — the
                       actions strip is only visible on hover, and a picker that
                       vanishes when the pointer leaves it cannot be used. */
                    <select
                      className="ob-select ob-session-rename"
                      autoFocus
                      aria-label={`File ${s.title || 'Untitled'} under a project`}
                      value={s.projectId ?? ''}
                      onChange={(e) => {
                        // Empty string, not undefined: "No project" is a choice
                        // to unfile, and the store reads null as exactly that.
                        void setSessionProject(s.id, e.target.value || null)
                        setFilingId(null)
                      }}
                      // Leaving the picker abandons it; the choice itself has
                      // already closed the row by then, so this only cancels.
                      onBlur={() => setFilingId(null)}
                      onKeyDown={(e) => {
                        if (e.key !== 'Escape') return
                        e.stopPropagation()
                        setFilingId(null)
                      }}
                    >
                      <option value="">No project</option>
                      {optionsFor(s).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.emoji} {p.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <button
                      type="button"
                      className="ob-session-main"
                      aria-current={isCurrent ? 'true' : undefined}
                      onClick={() => void selectSession(s.id)}
                    >
                      <span className="ob-session-title">{s.title || 'Untitled'}</span>
                      <span className="ob-session-meta">
                        {s.botIds.slice(0, 3).map((id) => (
                          <BotAvatar key={id} bot={bots.get(id)} size="sm" />
                        ))}
                        <span>{relativeTime(s.updatedAt)}</span>
                        <span aria-hidden="true">·</span>
                        <span>{s.messageCount}</span>
                      </span>
                    </button>
                  )}

                  {confirmId === s.id ? (
                    <span className="ob-session-actions">
                      <button
                        type="button"
                        className="ob-icon-btn"
                        aria-label={`Confirm deleting ${s.title}`}
                        onClick={() => {
                          void removeSession(s.id)
                          setConfirmId(null)
                        }}
                      >
                        <IconCheck size={12} />
                      </button>
                      <button type="button" className="ob-icon-btn" aria-label="Cancel delete" onClick={() => setConfirmId(null)}>
                        <IconClose size={12} />
                      </button>
                    </span>
                  ) : (
                    <span className="ob-session-actions">
                      <button
                        type="button"
                        className="ob-icon-btn"
                        aria-label={`Rename ${s.title}`}
                        onClick={() => {
                          setFilingId(null)
                          setDraft(s.title)
                          setEditingId(s.id)
                        }}
                      >
                        <IconPencil size={12} />
                      </button>
                      {/* Nothing to choose between until a project exists. */}
                      {projects.length > 0 ? (
                        <button
                          type="button"
                          className="ob-icon-btn"
                          aria-label={s.projectId ? `Move ${s.title} to another project` : `File ${s.title} in a project`}
                          onClick={() => {
                            setEditingId(null)
                            setFilingId(s.id)
                          }}
                        >
                          <IconFolder size={12} />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="ob-icon-btn"
                        aria-label={s.archived ? `Restore ${s.title}` : `Archive ${s.title}`}
                        onClick={() => void toggleArchive(s.id)}
                      >
                        <IconArchive size={12} />
                      </button>
                      <button type="button" className="ob-icon-btn" aria-label={`Delete ${s.title}`} onClick={() => setConfirmId(s.id)}>
                        <IconTrash size={12} />
                      </button>
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </>
  )
}
