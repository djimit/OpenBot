/**
 * IPC for `OpenBotApi.projects` — projects and the board behind the kanban.
 *
 * Board channels all answer with the whole board, or null when the project,
 * card or column named by the renderer does not exist. Nothing here throws
 * across the bridge: `handler.ts` turns a rejected argument into the channel's
 * fallback value.
 */

import { homedir } from 'node:os'
import type { Board, BoardCard, Project, ProjectSummary } from '../../shared/types'
import {
  addCard,
  addColumn,
  createProject,
  getBoard,
  getProject,
  moveCard,
  removeCard,
  removeColumn,
  removeProject,
  renameColumn,
  setColumnDone,
  updateCard,
  updateProject,
  type StoredProject
} from '../store/projects'
import { projectSummaries } from '../store/projectSummaries'
import { broadcast } from './broadcast'
import { CHANNELS } from './channels'
import { emptyArray, handle, handleVoid, nullResult } from './handler'
import { asId, asIndex, asPatch, asString } from './validate'

/** The board travels on its own channels, so it is stripped from the record. */
function toProject(stored: StoredProject): Project {
  const { board: _board, ...project } = stored
  return project
}

/** Never seen by a healthy caller — only when `create`/`update` blow up. */
function placeholderProject(id = ''): Project {
  const now = Date.now()
  return {
    id,
    name: 'Unavailable',
    emoji: '📁',
    color: '#7c9cff',
    tags: [],
    cwd: homedir(),
    botIds: [],
    createdAt: now,
    updatedAt: now
  }
}

/** The project as it stands now, so a failed update still renders something. */
function currentOrPlaceholder(id: string): Project {
  const stored = id ? getProject(id) : null
  return stored ? toProject(stored) : placeholderProject(id)
}

function registerBoardIpc(): void {
  handle<Board | null>(CHANNELS.projectsBoard, ([id]) => getBoard(asId(id)), nullResult)

  handle<Board | null>(
    CHANNELS.projectsAddCard,
    ([id, columnId, card]) => addCard(asId(id), asId(columnId), asPatch<BoardCard>(card)),
    nullResult
  )

  handle<Board | null>(
    CHANNELS.projectsUpdateCard,
    ([id, cardId, patch]) => updateCard(asId(id), asId(cardId), asPatch<BoardCard>(patch)),
    nullResult
  )

  handle<Board | null>(
    CHANNELS.projectsMoveCard,
    ([id, cardId, toColumnId, toIndex]) =>
      moveCard(asId(id), asId(cardId), asId(toColumnId), asIndex(toIndex)),
    nullResult
  )

  handle<Board | null>(
    CHANNELS.projectsRemoveCard,
    ([id, cardId]) => removeCard(asId(id), asId(cardId)),
    nullResult
  )

  handle<Board | null>(
    CHANNELS.projectsAddColumn,
    ([id, name]) => addColumn(asId(id), asString(name, 60)),
    nullResult
  )

  handle<Board | null>(
    CHANNELS.projectsRenameColumn,
    ([id, columnId, name]) => renameColumn(asId(id), asId(columnId), asString(name, 60)),
    nullResult
  )

  handle<Board | null>(
    CHANNELS.projectsRemoveColumn,
    ([id, columnId]) => removeColumn(asId(id), asId(columnId)),
    nullResult
  )

  /*
   * Which column holds finished work is a stored property, not the last one in
   * the row: counting by position meant appending any column silently turned
   * completed cards back into outstanding ones, on every surface at once.
   */
  handle<Board | null>(
    CHANNELS.projectsSetColumnDone,
    ([id, columnId, done]) => setColumnDone(asId(id), asId(columnId), done === true),
    nullResult
  )
}

export function registerProjectIpc(): void {
  handle<ProjectSummary[]>(CHANNELS.projectsList, () => projectSummaries(), emptyArray)

  handle<Project | null>(
    CHANNELS.projectsGet,
    ([id]) => {
      const stored = getProject(asId(id))
      return stored ? toProject(stored) : null
    },
    nullResult
  )

  handle<Project>(
    CHANNELS.projectsCreate,
    ([partial]) => toProject(createProject(asPatch<Project>(partial))),
    () => placeholderProject()
  )

  handle<Project>(
    CHANNELS.projectsUpdate,
    ([id, patch]) => {
      const projectId = asId(id)
      const next = updateProject(projectId, asPatch<Project>(patch))
      return next ? toProject(next) : currentOrPlaceholder(projectId)
    },
    (args) => currentOrPlaceholder(typeof args[0] === 'string' ? args[0] : '')
  )

  /** Deleting a project unfiles its chats; tell the windows about each one. */
  handleVoid(CHANNELS.projectsRemove, ([id]) => {
    for (const session of removeProject(asId(id))) {
      broadcast({ type: 'session-updated', session })
    }
  })

  registerBoardIpc()
}
