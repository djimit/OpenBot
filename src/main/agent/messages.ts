/**
 * The message lifecycle: create, announce, persist, close.
 *
 * Every message the agent produces goes through here, so `message-start` / `message-end`
 * always pair up and the session on disk always matches what the renderer was told.
 */

import type { Attachment, Bot, Message, Session, ToolResult } from '../../shared/types'
import { broadcast } from './events'
import { newId, now } from './ids'
import { sessions } from './sessionGateway'

export function assistantMessage(bot: Bot): Message {
  return {
    id: newId('msg'),
    role: 'assistant',
    content: '',
    botId: bot.id,
    model: bot.modelId,
    createdAt: now(),
    streaming: true
  }
}

/** Announce a message that is about to stream. */
export function begin(sessionId: string, message: Message): void {
  broadcast({ type: 'message-start', sessionId, message })
}

/** Close a streaming message: persist it and tell the renderer it is final. */
export async function commit(session: Session, message: Message): Promise<void> {
  message.streaming = false
  await sessions.update(session, (fresh) => {
    fresh.messages.push(message)
  })
  broadcast({
    type: 'message-end',
    sessionId: session.id,
    messageId: message.id,
    content: message.content
  })
}

export async function addUserMessage(
  session: Session,
  text: string,
  attachments?: Attachment[]
): Promise<Message> {
  const message: Message = {
    id: newId('msg'),
    role: 'user',
    content: text,
    attachments: attachments?.length ? attachments : undefined,
    createdAt: now()
  }
  begin(session.id, message)
  await commit(session, message)
  broadcast({ type: 'session-updated', session })
  return message
}

/** Tool results are already streamed as `tool-result`; this only records them. */
export async function addToolMessage(
  session: Session,
  botId: string,
  result: ToolResult
): Promise<Message> {
  const message: Message = {
    id: newId('msg'),
    role: 'tool',
    content: result.output,
    toolResult: result,
    botId,
    createdAt: now()
  }
  await sessions.update(session, (fresh) => {
    fresh.messages.push(message)
  })
  return message
}

/**
 * A complete assistant message with no streaming — cap notices, aborted-run notes and
 * other things the loop says on its own behalf.
 */
export async function addNotice(
  session: Session,
  bot: Bot | null,
  text: string,
  error?: string
): Promise<Message> {
  const message: Message = {
    id: newId('msg'),
    role: 'assistant',
    content: text,
    botId: bot?.id,
    model: bot?.modelId,
    createdAt: now(),
    streaming: false,
    error
  }
  begin(session.id, message)
  await commit(session, message)
  return message
}
