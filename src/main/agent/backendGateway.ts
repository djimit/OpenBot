/**
 * Access to the backend registry, which is an optional peer module: when it is not part
 * of the build the loop reports "backend unavailable" instead of failing to load.
 */

import type { BackendConfig, BackendInfo, ModelInfo, Settings, ToolCall } from '../../shared/types'
import type { Backend, ChatChunk, ChatRequest } from './contracts'
import { asRecord, asString, extractJson } from './json'
import { loadBackendRegistry, tryCall } from './optionalModules'
import { newId, now } from './ids'
import { settingsStore } from './settingsGateway'

export async function getBackend(id: string): Promise<Backend | null> {
  if (!id) return null
  const registry = await loadBackendRegistry()
  const backend = await tryCall(
    registry?.getBackend ? () => registry.getBackend!(id) : undefined,
    null as Backend | null | undefined
  )
  return backend && typeof backend.chat === 'function' ? backend : null
}

let cached: { at: number; infos: BackendInfo[] } | null = null
const DETECT_TTL_MS = 60_000

export async function detectBackends(force = false): Promise<BackendInfo[]> {
  if (!force && cached && now() - cached.at < DETECT_TTL_MS) return cached.infos
  const registry = await loadBackendRegistry()
  const { backends } = await settingsStore.get()
  const infos = await tryCall(
    registry?.detectAll ? () => registry.detectAll!(backends) : undefined,
    [] as BackendInfo[]
  )
  const safe = Array.isArray(infos) ? infos.filter((info) => !!info?.id) : []
  cached = { at: now(), infos: safe }
  return safe
}

export async function getBackendInfo(id: string): Promise<BackendInfo | null> {
  return (await detectBackends()).find((info) => info.id === id) ?? null
}

export async function getModelInfo(backendId: string, modelId: string): Promise<ModelInfo | null> {
  const info = await getBackendInfo(backendId)
  if (!info || !Array.isArray(info.models)) return null
  return info.models.find((model) => model?.id === modelId) ?? null
}

export function backendConfigFor(settings: Settings, backendId: string): BackendConfig {
  return settings.backends?.[backendId] ?? { enabled: true }
}

/** Coerce whatever the model produced into a well-formed `ToolCall`. */
export function normaliseCall(raw: Record<string, unknown>): ToolCall {
  const rawArgs = raw['args'] ?? raw['arguments'] ?? raw['parameters'] ?? raw['input']
  const args = typeof rawArgs === 'string' ? asRecord(extractJson(rawArgs)) : asRecord(rawArgs)
  return {
    id: asString(raw['id']) || newId('call'),
    name: asString(raw['name'] ?? raw['tool'] ?? raw['function']),
    args
  }
}

/**
 * Open a chat stream. Tolerates a backend that hands back a promise for the iterable, and
 * turns anything non-iterable into a clean error the loop can report.
 */
export async function openChatStream(
  backend: Backend,
  req: ChatRequest,
  cfg: BackendConfig
): Promise<AsyncIterable<ChatChunk>> {
  const out: unknown = await Promise.resolve(backend.chat(req, cfg))
  if (!out || typeof out !== 'object' || !(Symbol.asyncIterator in (out as object))) {
    throw new Error('backend returned no stream')
  }
  return out as AsyncIterable<ChatChunk>
}

/** Drain a stream into text and tool calls. Used by one-shot side calls. */
export async function collectTurn(
  stream: AsyncIterable<ChatChunk>
): Promise<{ text: string; reasoning: string; calls: ToolCall[] }> {
  let text = ''
  let reasoning = ''
  const calls: ToolCall[] = []
  for await (const chunk of stream) {
    if (!chunk || typeof chunk !== 'object') continue
    if (chunk.type === 'text') text += chunk.delta ?? ''
    else if (chunk.type === 'reasoning') reasoning += chunk.delta ?? ''
    else if (chunk.type === 'tool_call' && chunk.call) {
      calls.push(normaliseCall(asRecord(chunk.call)))
    } else if (chunk.type === 'done') break
  }
  return { text, reasoning, calls }
}

/**
 * A short side call — memory extraction, adaptive replay. Returns null rather than
 * throwing, so those features simply skip when inference is unavailable.
 */
export async function runSideCall(
  backendId: string,
  req: ChatRequest,
  settings: Settings
): Promise<{ text: string; reasoning: string; calls: ToolCall[] } | null> {
  try {
    const backend = await getBackend(backendId)
    if (!backend) return null
    const stream = await openChatStream(backend, req, backendConfigFor(settings, backendId))
    return await collectTurn(stream)
  } catch {
    return null
  }
}
