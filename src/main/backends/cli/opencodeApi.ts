/**
 * HTTP client for a running `opencode serve` instance.
 *
 * Endpoint shapes come from the server's own OpenAPI document (`/doc`):
 *   POST /api/session                      create a session
 *   POST /api/session/{id}/prompt          send a turn
 *   POST /api/session/{id}/interrupt       cancel a turn
 *   GET  /api/event                        SSE stream of everything
 *   GET  /api/model                        models for the current location
 */

import { fetchJson, withTimeout } from '../httpClient'
import { safeJsonParse } from '../lenientJson'
import { inferVision, prettyLabel } from '../modelMeta'
import { readSse } from '../sse'
import type { ModelInfo } from '../types'
import { joinUrl } from '../urls'

export interface OpencodeEvent {
  type: string
  data?: Record<string, unknown>
}

interface ModelEntry {
  id?: string
  providerID?: string
  name?: string
  limit?: { context?: number; output?: number }
  capabilities?: { attachment?: boolean; reasoning?: boolean; toolCall?: boolean }
}

/** Basic auth for servers started with a password. */
export function opencodeHeaders(username: string, password?: string): Record<string, string> {
  if (!password) return {}
  const token = Buffer.from(`${username}:${password}`, 'utf8').toString('base64')
  return { authorization: `Basic ${token}` }
}

export async function createSession(
  baseUrl: string,
  headers: Record<string, string>,
  model: { providerID: string; id: string } | null,
  signal: AbortSignal
): Promise<string> {
  const res = await fetch(joinUrl(baseUrl, '/api/session'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(model ? { model } : {}),
    signal
  })
  const text = await res.text().catch(() => '')
  if (!res.ok) throw new Error(`opencode could not create a session (HTTP ${res.status}): ${text.slice(0, 300)}`)
  const parsed = safeJsonParse<{ data?: { id?: string } }>(text)
  const id = parsed?.data?.id
  if (!id) throw new Error('opencode returned a session without an id.')
  return id
}

export async function sendPrompt(
  baseUrl: string,
  headers: Record<string, string>,
  sessionId: string,
  text: string,
  signal: AbortSignal
): Promise<void> {
  const res = await fetch(joinUrl(baseUrl, `/api/session/${sessionId}/prompt`), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ prompt: { text } }),
    signal
  })
  const body = await res.text().catch(() => '')
  if (!res.ok) throw new Error(`opencode rejected the prompt (HTTP ${res.status}): ${body.slice(0, 300)}`)
}

/** Best effort: cancellation must never turn into a user-visible failure. */
export async function interruptSession(
  baseUrl: string,
  headers: Record<string, string>,
  sessionId: string
): Promise<void> {
  try {
    await fetch(joinUrl(baseUrl, `/api/session/${sessionId}/interrupt`), {
      method: 'POST',
      headers,
      signal: withTimeout(undefined, 2000)
    })
  } catch {
    // The server is going away anyway.
  }
}

/** Answer a permission request emitted by the session's own tool loop. */
export async function replyPermission(
  baseUrl: string,
  headers: Record<string, string>,
  sessionId: string,
  requestId: string,
  reply: 'once' | 'always' | 'reject',
  signal: AbortSignal
): Promise<void> {
  const res = await fetch(
    joinUrl(baseUrl, `/api/session/${encodeURIComponent(sessionId)}/permission/${encodeURIComponent(requestId)}/reply`),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ reply }),
      signal
    }
  )
  const body = await res.text().catch(() => '')
  if (!res.ok) {
    throw new Error(`opencode could not answer permission ${requestId} (HTTP ${res.status}): ${body.slice(0, 300)}`)
  }
}

/** Server-sent events for the whole server; callers filter by session id. */
export async function* streamEvents(
  baseUrl: string,
  headers: Record<string, string>,
  signal: AbortSignal
): AsyncGenerator<OpencodeEvent> {
  const res = await fetch(joinUrl(baseUrl, '/api/event'), {
    headers: { accept: 'text/event-stream', ...headers },
    signal
  })
  if (!res.ok) throw new Error(`opencode event stream failed (HTTP ${res.status}).`)
  for await (const event of readSse(res)) {
    const parsed = safeJsonParse<OpencodeEvent>(event.data)
    if (parsed?.type) yield parsed
  }
}

export function toModelInfo(entry: ModelEntry): ModelInfo | null {
  if (!entry.id || !entry.providerID) return null
  const slug = `${entry.providerID}/${entry.id}`
  return {
    id: slug,
    label: entry.name ? `${entry.name} (${entry.providerID})` : prettyLabel(slug),
    ...(entry.limit?.context ? { contextWindow: entry.limit.context } : {}),
    supportsTools: entry.capabilities?.toolCall ?? true,
    supportsVision: entry.capabilities?.attachment ?? inferVision(entry.id)
  }
}

/** Models the running server can reach, for the directory it was started in. */
export async function listServerModels(
  baseUrl: string,
  headers: Record<string, string>,
  signal: AbortSignal
): Promise<ModelInfo[]> {
  const res = await fetchJson<{ data?: ModelEntry[] }>(joinUrl(baseUrl, '/api/model'), {
    headers,
    signal
  })
  return (res.data ?? []).map(toModelInfo).filter((m): m is ModelInfo => m !== null)
}
