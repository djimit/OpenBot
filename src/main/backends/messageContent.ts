/**
 * Reading and building `ProviderMessage` content: text extraction, image
 * normalisation, system-prompt handling and tool-call ids.
 */

import type { ProviderImagePart, ProviderMessage, ProviderPart, ProviderTextPart } from './types'

export function partsOf(content: string | ProviderPart[]): ProviderPart[] {
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : []
  return content
}

export function textOf(content: string | ProviderPart[]): string {
  if (typeof content === 'string') return content
  return content
    .filter((p): p is ProviderTextPart => p.type === 'text')
    .map((p) => p.text)
    .join('')
}

export function imagePartsOf(content: string | ProviderPart[]): ProviderImagePart[] {
  if (typeof content === 'string') return []
  return content.filter((p): p is ProviderImagePart => p.type === 'image')
}

export function hasImages(messages: ProviderMessage[]): boolean {
  return messages.some((m) => imagePartsOf(m.content).length > 0)
}

export function dataUri(part: ProviderImagePart): string {
  return `data:${part.mime};base64,${part.data}`
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp'
}

/** Best-effort mime type for an attachment filename. */
export function mimeForName(name: string, fallback = 'image/png'): string {
  const ext = (name.split('.').pop() ?? '').toLowerCase()
  return MIME_BY_EXT[ext] ?? fallback
}

/**
 * Accept raw base64 or a `data:` URI and normalise to an image part.
 * Returns null when there is nothing decodable.
 */
export function toImagePart(raw: string | undefined, mime?: string): ProviderImagePart | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(trimmed)
  if (match) {
    const declared = match[1] || mime || 'image/png'
    const payload = match[2]
      ? match[3]
      : Buffer.from(decodeURIComponent(match[3]), 'utf8').toString('base64')
    return { type: 'image', mime: declared, data: payload.replace(/\s+/g, '') }
  }
  return { type: 'image', mime: mime || 'image/png', data: trimmed.replace(/\s+/g, '') }
}

/** Anthropic accepts only these; anything else is coerced to PNG. */
const SAFE_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

export function safeImageMime(mime: string): string {
  const lower = mime.toLowerCase()
  return SAFE_IMAGE_MIMES.has(lower) ? lower : 'image/png'
}

/** Split system turns out of a conversation (providers that take them separately). */
export function splitSystem(messages: ProviderMessage[]): {
  system: string
  rest: ProviderMessage[]
} {
  const system: string[] = []
  const rest: ProviderMessage[] = []
  for (const m of messages) {
    if (m.role === 'system') {
      const text = textOf(m.content)
      if (text) system.push(text)
    } else {
      rest.push(m)
    }
  }
  return { system: system.join('\n\n'), rest }
}

/** Append to the conversation's system message, creating one if needed. */
export function withSystem(messages: ProviderMessage[], text: string): ProviderMessage[] {
  if (!text) return messages
  const idx = messages.findIndex((m) => m.role === 'system')
  if (idx === -1) return [{ role: 'system', content: text }, ...messages]
  const copy = messages.slice()
  const existing = copy[idx]
  copy[idx] = { ...existing, content: `${textOf(existing.content)}\n\n${text}`.trim() }
  return copy
}

let callCounter = 0

/** Stable-ish unique id for tool calls the provider did not name. */
export function newCallId(prefix = 'call'): string {
  callCounter = (callCounter + 1) % 1_000_000
  const rand =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10)
  return `${prefix}_${callCounter.toString(36)}${rand}`
}
