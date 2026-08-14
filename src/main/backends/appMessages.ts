/**
 * Projection from app-level `Message`s (the shared contract) onto the
 * provider-neutral `ProviderMessage` shape every adapter consumes.
 */

import type { Message } from '../../shared/types'
import { mimeForName, toImagePart } from './messageContent'
import type { ProviderImagePart, ProviderMessage, ProviderPart } from './types'

export function fromAppMessages(messages: Message[]): ProviderMessage[] {
  const out: ProviderMessage[] = []
  for (const m of messages) {
    if (m.role === 'tool') {
      out.push(toolMessage(m))
      continue
    }
    if (m.role === 'assistant') {
      const msg: ProviderMessage = { role: 'assistant', content: m.content ?? '' }
      if (m.toolCalls?.length) msg.toolCalls = m.toolCalls
      if (m.reasoning) msg.reasoning = m.reasoning
      out.push(msg)
      continue
    }
    out.push(userMessage(m))
  }
  return out
}

function toolMessage(m: Message): ProviderMessage {
  const result = m.toolResult
  const parts: ProviderPart[] = [{ type: 'text', text: result?.output ?? m.content ?? '' }]
  const shot = toImagePart(result?.screenshot, 'image/png')
  if (shot) parts.push(shot)
  return {
    role: 'tool',
    content: parts,
    toolCallId: result?.callId,
    name: result?.name,
    isError: result ? !result.ok : false
  }
}

function userMessage(m: Message): ProviderMessage {
  const images = (m.attachments ?? [])
    .filter((a) => a.kind === 'image')
    .map((a) => toImagePart(a.data, a.mime ?? mimeForName(a.name)))
    .filter((p): p is ProviderImagePart => p !== null)

  if (!images.length) return { role: m.role, content: m.content ?? '' }

  const parts: ProviderPart[] = []
  if (m.content) parts.push({ type: 'text', text: m.content })
  parts.push(...images)
  return { role: m.role, content: parts }
}
