/**
 * The public surface IPC calls into.
 *
 * One user turn:
 *
 *   sendMessage → record the user message → start a cancellable run
 *     ↓
 *   iterate (turnDriver): runs turns until one finishes the work
 *     ↓
 *   always: release the controller, reject stale approvals, emit `done`
 *
 * A backend or tool failure never breaks out of this — it becomes an `error` event and a
 * clean end of turn. All state is keyed by session id, so sessions run independently.
 */

import type { ApprovalDecision, Attachment, Routine } from '../../shared/types'
import * as approval from './approval'
import * as cancel from './cancel'
import * as limits from './limits'
import * as recorder from './recorder'
import { addUserMessage } from './messages'
import { detachGateway } from './mcpGateway'
import { bots, sessions } from './sessionGateway'
import { broadcast, broadcastError } from './events'
import { clearPendingNote } from './handoff'
import { addressedBot } from './exchange'
import { clearReplyHistory } from './replyHistory'
import { errorMessage, isAbortError } from './errors'
import { stopAllExtraction, stopExtraction } from './memory'
import { iterate } from './turnDriver'
import { runRoutine as replayRoutineInSession } from './routines'
import { cancelHumanHelpForSession } from '../tools/agent/help'

export async function sendMessage(
  sessionId: string,
  text: string,
  attachments?: Attachment[]
): Promise<void> {
  const session = await sessions.get(sessionId)
  if (!session) {
    broadcastError(sessionId, 'That session no longer exists.')
    broadcast({ type: 'done', sessionId })
    return
  }

  if (cancel.isRunning(sessionId)) {
    broadcastError(sessionId, 'This session is already working. Stop it first, then send again.')
    return
  }

  // A new user message starts a fresh turn: iteration and handoff budgets reset.
  limits.resetTurn(sessionId)
  clearPendingNote(sessionId)
  clearReplyHistory(sessionId)

  /*
   * "@Coder do X" gives the floor to that bot. Otherwise it stays with whoever
   * spoke last, which leaves the user unable to bring a specific bot back.
   */
  const roster = await bots.many(session.botIds ?? [])
  const addressed = roster.length > 1 ? addressedBot(text, roster) : null
  if (addressed && addressed.id !== session.activeBotId) {
    await sessions.update(session, (fresh) => {
      fresh.activeBotId = addressed.id
    })
    broadcast({ type: 'session-updated', session })
  }

  await addUserMessage(session, text, attachments)

  const controller = cancel.start(sessionId)
  try {
    // `iterate` detaches its own MCP gateway, including when a turn throws.
    await iterate(session, controller.signal)
  } catch (err) {
    if (!isAbortError(err)) {
      broadcastError(sessionId, `The turn ended unexpectedly: ${errorMessage(err)}`)
    }
  } finally {
    approval.cancelPending(sessionId, 'turn ended')
    cancel.finish(sessionId, controller)
    broadcast({ type: 'session-updated', session })
    broadcast({ type: 'done', sessionId })
  }
}

/** Abort in-flight streams and child processes, and reject anything awaiting approval. */
export async function stopSession(sessionId: string): Promise<void> {
  cancelHumanHelpForSession(sessionId)
  const wasRunning = cancel.abort(sessionId, 'stopped by user')
  approval.cancelPending(sessionId, 'stopped by user')
  // Post-turn memory extraction outlives the run it belongs to, so it is not
  // reachable through the run's controller. "Stop" has to mean stop.
  stopExtraction(sessionId)
  void detachGateway(sessionId)
  if (wasRunning) broadcast({ type: 'done', sessionId })
}

export async function respondToApproval(
  requestId: string,
  decision: ApprovalDecision
): Promise<void> {
  approval.respondToApproval(requestId, decision)
}

export async function runRoutine(routineId: string, sessionId: string): Promise<void> {
  await replayRoutineInSession(routineId, sessionId)
}

export async function startRecording(botId: string, name: string): Promise<void> {
  recorder.startRecording(botId, name)
}

export async function stopRecording(): Promise<Routine | null> {
  return recorder.stopRecording()
}

/** Called on app quit: stop every session and reject every pending approval. */
export function shutdown(): void {
  for (const sessionId of cancel.runningSessionIds()) {
    approval.cancelPending(sessionId, 'application closing')
    void detachGateway(sessionId)
  }
  // Extractions belong to turns that have already finished, so they are not in
  // `runningSessionIds`. Left alone, the agent CLI each one spawned survives
  // the quit: children lead their own process group, by design.
  stopAllExtraction()
  cancel.abortAll('application closing')
}
