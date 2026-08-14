/** Provider-neutral messages -> the Anthropic Messages API format. */

import { imagePartsOf, partsOf, safeImageMime, splitSystem, textOf } from './messageContent'
import type { ProviderMessage, ToolSchema } from './types'

export type AnthropicBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | {
      type: 'tool_result'
      tool_use_id: string
      content: Array<
        | { type: 'text'; text: string }
        | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
      >
      is_error?: boolean
    }

export interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: AnthropicBlock[]
}

function imageBlock(mime: string, data: string): AnthropicBlock {
  return { type: 'image', source: { type: 'base64', media_type: safeImageMime(mime), data } }
}

function userBlocks(m: ProviderMessage): AnthropicBlock[] {
  return partsOf(m.content).map((p) =>
    p.type === 'text' ? { type: 'text' as const, text: p.text } : imageBlock(p.mime, p.data)
  )
}

function assistantBlocks(m: ProviderMessage): AnthropicBlock[] {
  const blocks: AnthropicBlock[] = []
  const text = textOf(m.content)
  if (text) blocks.push({ type: 'text', text })
  for (const call of m.toolCalls ?? []) {
    blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.args ?? {} })
  }
  return blocks
}

/** Tool results are user-turn blocks in this API, and may carry images. */
function toolResultBlock(m: ProviderMessage): AnthropicBlock {
  const text = textOf(m.content)
  const content: Array<
    { type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  > = [{ type: 'text', text: text || (m.isError ? 'error' : 'ok') }]
  for (const img of imagePartsOf(m.content)) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: safeImageMime(img.mime), data: img.data }
    })
  }
  return {
    type: 'tool_result',
    tool_use_id: m.toolCallId ?? '',
    content,
    ...(m.isError ? { is_error: true } : {})
  }
}

export function toAnthropicMessages(messages: ProviderMessage[]): {
  system: string
  messages: AnthropicMessage[]
} {
  const { system, rest } = splitSystem(messages)
  const out: AnthropicMessage[] = []

  for (const m of rest) {
    const role: 'user' | 'assistant' = m.role === 'assistant' ? 'assistant' : 'user'
    const blocks =
      m.role === 'assistant'
        ? assistantBlocks(m)
        : m.role === 'tool'
          ? [toolResultBlock(m)]
          : userBlocks(m)
    if (!blocks.length) continue

    // Consecutive same-role turns must be merged; tool results especially.
    const last = out[out.length - 1]
    if (last && last.role === role) last.content.push(...blocks)
    else out.push({ role, content: blocks })
  }

  return { system, messages: out }
}

export function toAnthropicTools(tools: ToolSchema[]): Array<Record<string, unknown>> {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: {
      type: 'object',
      properties: t.parameters.properties ?? {},
      ...(t.parameters.required?.length ? { required: t.parameters.required } : {})
    }
  }))
}

/** `max_tokens` is required by the API; stay inside every model's ceiling. */
export function maxTokensFor(model: string): number {
  return /claude-3-(opus|sonnet|haiku)/i.test(model) ? 4096 : 8192
}
