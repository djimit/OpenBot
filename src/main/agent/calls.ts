/**
 * Runs the tool calls one orchestrated turn asked for.
 *
 * Only reached when we own the loop. An agent CLI executes its own tools and its
 * adapter renders that as text, so nothing here ever runs twice.
 *
 * `handoff` is special: it ends the turn rather than producing a result the same
 * bot continues from, because the floor has moved to someone else.
 */

import type { Message } from '../../shared/types'
import type { TurnInput, TurnResult } from './turn'
import type { TurnMode } from './backendMode'
import { addToolMessage } from './messages'
import { broadcast } from './events'
import { executeCall } from './execute'
import { performHandoff, takePendingNote } from './handoff'
import { sessions } from './sessionGateway'

export async function runCalls(
  input: TurnInput,
  message: Message,
  intent: string,
  mode: TurnMode
): Promise<TurnResult> {
  const { session, bot, settings, signal } = input

  for (const call of message.toolCalls ?? []) {
    if (signal.aborted) return { status: 'aborted', message, mode }

    if (call.name === 'handoff') {
      const handoff = await performHandoff(session, bot, call)
      const result = {
        callId: call.id,
        name: call.name,
        ok: handoff.ok,
        output: handoff.message
      }
      await addToolMessage(session, bot.id, result)
      broadcast({ type: 'tool-result', sessionId: session.id, messageId: message.id, result })
      if (!handoff.ok) continue

      // The message is already in the transcript, so this only persists the edit.
      await sessions.update(session, () => {
        message.handoffTo = handoff.toBotId
      })
      return {
        status: 'handoff',
        message,
        mode,
        note: takePendingNote(session.id) ?? handoff.note,
        request: handoff.reason
      }
    }

    await addToolMessage(
      session,
      bot.id,
      await executeCall({
        session,
        bot,
        settings,
        call,
        messageId: message.id,
        signal,
        intent
      })
    )
  }

  return signal.aborted ? { status: 'aborted', message, mode } : { status: 'tools', message, mode }
}
