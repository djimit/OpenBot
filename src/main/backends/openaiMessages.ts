/** Provider-neutral messages and tool schemas -> OpenAI wire format. */

import { dataUri, imagePartsOf, newCallId, partsOf, textOf } from './messageContent'
import type { ProviderMessage, ToolSchema } from './types'

export type OaContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export interface OaMessage {
  role: string
  content: string | OaContentPart[] | null
  name?: string
  tool_call_id?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
}

/**
 * Images become `image_url` parts carrying a data URI. Images attached to a
 * tool result are re-emitted as a following user message, because the OpenAI
 * schema does not allow image parts on a `tool` message.
 */
export function toOpenAiMessages(messages: ProviderMessage[]): OaMessage[] {
  const out: OaMessage[] = []
  for (const m of messages) {
    if (m.role === 'tool') {
      out.push(...toolTurn(m))
      continue
    }
    if (m.role === 'assistant') {
      out.push(assistantTurn(m))
      continue
    }
    out.push(plainTurn(m))
  }
  return out
}

function toolTurn(m: ProviderMessage): OaMessage[] {
  const text = textOf(m.content)
  const messages: OaMessage[] = [
    {
      role: 'tool',
      tool_call_id: m.toolCallId ?? '',
      content: text || (m.isError ? 'error' : 'ok')
    }
  ]
  const images = imagePartsOf(m.content)
  if (images.length) {
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: `Image returned by ${m.name ?? 'the tool'}:` },
        ...images.map((img) => ({ type: 'image_url' as const, image_url: { url: dataUri(img) } }))
      ]
    })
  }
  return messages
}

function assistantTurn(m: ProviderMessage): OaMessage {
  const msg: OaMessage = { role: 'assistant', content: textOf(m.content) || null }
  if (m.toolCalls?.length) {
    msg.tool_calls = m.toolCalls.map((c) => ({
      id: c.id || newCallId(),
      type: 'function' as const,
      function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) }
    }))
  }
  return msg
}

function plainTurn(m: ProviderMessage): OaMessage {
  const images = imagePartsOf(m.content)
  if (!images.length) return { role: m.role, content: textOf(m.content) }

  const parts: OaContentPart[] = partsOf(m.content).map((p) =>
    p.type === 'text'
      ? { type: 'text' as const, text: p.text }
      : { type: 'image_url' as const, image_url: { url: dataUri(p) } }
  )
  // Image parts are only valid on user turns.
  return { role: m.role === 'system' ? 'user' : m.role, content: parts }
}

export function toOpenAiTools(tools: ToolSchema[]): Array<Record<string, unknown>> {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: 'object',
        properties: t.parameters.properties ?? {},
        ...(t.parameters.required?.length ? { required: t.parameters.required } : {})
      }
    }
  }))
}
