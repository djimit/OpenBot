/**
 * Opening a chat from a board card.
 *
 * This is the one flow that straddles both halves of the bridge — it creates a
 * session, files it under the project, names it, and links it back onto the
 * card — so it lives on its own rather than inside the board actions.
 *
 * The ordering matters. Once the session exists nothing may bail out, because
 * the only record that it belongs to this card is the link written at the end;
 * abandoning it would strand a chat and let the next click make a second one.
 */

import type { BoardCard, Session } from '../../../shared/types'
import { errText } from './bridge'
import { store } from './core'
import { loadProjects } from './projects'
import { reach, session, setSessionProject, settle, unavailable } from './projectsBridge'
import { adoptSession, loadSessions, selectSession } from './sessions'

const UNLINKED = 'The chat opened, but the card could not be linked to it.'

export async function openCardChat(card: BoardCard): Promise<void> {
  const projectId = store.getState().currentProjectId
  if (!projectId) return

  // A card that already has one jumps to it — never a second chat for one card.
  if (card.sessionId) {
    store.patch({ modal: null })
    await selectSession(card.sessionId)
    return
  }

  const create = session('create')
  if (!create) return unavailable()

  let chat: Session
  try {
    chat = await create(card.botId ? [card.botId] : undefined)
  } catch (e) {
    store.toast(errText(e), 'error')
    return
  }

  // Past this point every step is best effort, and the user lands in the chat
  // either way; only the missing link is worth interrupting them about.
  const title = card.title.trim() || chat.title
  const rename = session('rename')
  await settle(setSessionProject(chat.id, projectId))
  if (title !== chat.title && rename) await settle(rename(chat.id, title))
  const link = reach('updateCard')
  const board = await settle(link ? link(projectId, card.id, { sessionId: chat.id }) : null)

  adoptSession({ ...chat, title, projectId })
  store.patch({ modal: null, ...(board ? { board } : {}) })
  if (!board) store.toast(UNLINKED, 'error')
  await Promise.all([loadSessions(), loadProjects()])
}
