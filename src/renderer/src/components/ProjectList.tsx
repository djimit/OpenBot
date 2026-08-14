import { useMemo, type CSSProperties, type ReactNode } from 'react'
import { BUILT_IN_TAGS } from '../../../shared/projects'
import type { ProjectSummary, ProjectTag } from '../../../shared/types'
import { collectTags } from '../lib/board'
import { openBoard, openProjectEditor, projectsReady, selectProject, selectSession, setProjectFilter, useAppState } from '../state'
import { IconBoard, IconPencil } from './Icons'
import { TagFilter } from './TagFilter'
import './ProjectList.css'

const swatch = (project: ProjectSummary): CSSProperties => ({ '--ob-project-color': project.color }) as CSSProperties

/** Sidebar project rows, with the tag filter above them. */
export function ProjectList(): ReactNode {
  const { projects, projectsError, currentProjectId, projectFilter, sessions, currentSessionId } = useAppState()
  const ready = projectsReady()

  const active = useMemo(() => projects.filter((p) => !p.archived), [projects])
  const tags = useMemo(() => collectTags(active, BUILT_IN_TAGS), [active])
  const visible = useMemo(
    () => (projectFilter ? active.filter((p) => p.tags.includes(projectFilter)) : active),
    [active, projectFilter]
  )

  const countOf = (tag: ProjectTag): number => active.filter((p) => p.tags.includes(tag)).length

  /** A project's own chats — they are listed under their project, not above. */
  const chatsIn = (id: string): typeof sessions =>
    sessions.filter((s) => s.projectId === id && !s.archived)

  if (projectsError) {
    return (
      <p className="ob-notice ob-notice-error ob-project-notice" role="alert">
        {projectsError}
      </p>
    )
  }

  if (!ready) {
    return <p className="ob-side-note">Projects need a newer agent process. Restart the app to pick them up.</p>
  }

  return (
    <>
      {active.length > 0 ? <TagFilter tags={tags} active={projectFilter} countOf={countOf} onSelect={setProjectFilter} /> : null}

      {active.length === 0 ? (
        <p className="ob-side-note">No projects yet. A project gathers its own bots, chats and board in one place.</p>
      ) : visible.length === 0 ? (
        <p className="ob-side-note">
          Nothing tagged {projectFilter}.{' '}
          <button type="button" className="ob-link-btn" onClick={() => setProjectFilter(null)}>
            Show all projects
          </button>
        </p>
      ) : (
        <ul className="ob-side-list">
          {visible.map((project) => {
            const isCurrent = project.id === currentProjectId
            return (
              <li key={project.id} className={`ob-project${isCurrent ? ' is-current' : ''}`}>
                <button
                  type="button"
                  className="ob-side-item-main"
                  aria-pressed={isCurrent}
                  title={project.tags.length > 0 ? `${project.name} — ${project.tags.join(', ')}` : project.name}
                  onClick={() => selectProject(project.id)}
                >
                  <span className="ob-project-emoji" style={swatch(project)} aria-hidden="true">
                    {project.emoji || '📁'}
                  </span>
                  <span className="ob-side-item-name">{project.name}</span>
                  {/* Chats first: it is what the row is mostly used to reach.
                      Open cards only appear when the board has any. */}
                  <span
                    className="ob-side-item-count"
                    title={`${chatsIn(project.id).length} chats · ${project.openCards} open cards`}
                  >
                    {chatsIn(project.id).length}
                    {project.openCards > 0 ? <em className="ob-project-cards"> · {project.openCards}</em> : null}
                  </span>
                </button>
                <span className="ob-project-actions">
                  <button
                    type="button"
                    className="ob-icon-btn"
                    aria-label={`Open the ${project.name} board`}
                    onClick={() => void openBoard(project.id)}
                  >
                    <IconBoard size={11} />
                  </button>
                  <button
                    type="button"
                    className="ob-icon-btn"
                    aria-label={`Edit ${project.name}`}
                    onClick={() => openProjectEditor(project.id)}
                  >
                    <IconPencil size={11} />
                  </button>
                </span>

                {/* A project's chats live under it, so the sidebar mirrors how
                    the work is actually organised. */}
                {isCurrent && chatsIn(project.id).length > 0 ? (
                  <ul className="ob-project-chats">
                    {chatsIn(project.id).map((chat) => (
                      <li key={chat.id}>
                        <button
                          type="button"
                          className={`ob-project-chat${chat.id === currentSessionId ? ' is-current' : ''}`}
                          onClick={() => void selectSession(chat.id)}
                        >
                          {chat.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
