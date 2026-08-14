/**
 * IPC for `OpenBotApi.agent` — the three channels that drive a turn.
 * Message bookkeeping belongs to the agent loop; this layer only validates,
 * delegates, and makes sure a failure surfaces as an `error` event instead of
 * a rejected promise in the renderer.
 */

import { getSession } from '../store/sessions'
import { AGENT_UNAVAILABLE, loopFn } from './agentRuntime'
import { broadcast } from './broadcast'
import { CHANNELS } from './channels'
import { handleVoid } from './handler'
import { asAttachments, asDecision, asId, asString } from './validate'
import { returnHumanControl } from '../tools/agent/help'
import { handle } from './handler'

function fail(sessionId: string, message: string): void {
  broadcast({ type: 'error', sessionId, message })
  broadcast({ type: 'done', sessionId })
}

export function registerAgentIpc(): void {
  handle<boolean>(CHANNELS.agentReturnControl, ([requestId]) => returnHumanControl(asId(requestId)), () => false)
  handleVoid(CHANNELS.agentSend, async ([sessionId, text, attachments]) => {
    const id = asId(sessionId)
    const body = asString(text)
    const files = asAttachments(attachments)

    if (!getSession(id)) {
      fail(id, 'That conversation no longer exists.')
      return
    }

    const send = await loopFn('sendMessage')
    if (!send) {
      fail(id, AGENT_UNAVAILABLE)
      return
    }

    try {
      await send(id, body, files)
    } catch (err) {
      console.error('[openbot/ipc] agent.send failed', err)
      fail(id, err instanceof Error ? err.message : 'The agent run failed.')
    }
  })

  handleVoid(CHANNELS.agentStop, async ([sessionId]) => {
    const id = asId(sessionId)
    const stop = await loopFn('stopSession')
    if (!stop) {
      broadcast({ type: 'done', sessionId: id })
      return
    }
    try {
      await stop(id)
    } catch (err) {
      console.error('[openbot/ipc] agent.stop failed', err)
      broadcast({ type: 'done', sessionId: id })
    }
  })

  handleVoid(CHANNELS.agentRespondToApproval, async ([requestId, decision]) => {
    const id = asId(requestId)
    const choice = asDecision(decision)
    const respond = await loopFn('respondToApproval')
    if (!respond) {
      console.warn('[openbot/ipc] approval dropped, agent runtime unavailable:', id)
      return
    }
    await respond(id, choice)
  })
}
