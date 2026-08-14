/** `/models` listing and the mapping onto `ModelInfo`. */

import { fetchJson } from './httpClient'
import { inferTools, inferVision, isChatModel, prettyLabel } from './modelMeta'
import { type OaEndpoint, oaHeaders } from './openaiEndpoint'
import type { ModelInfo } from './types'
import { joinUrl } from './urls'

export interface OaModelEntry {
  id?: string
  name?: string
  object?: string
  owned_by?: string
  context_length?: number
  max_context_length?: number
  context_window?: number
  /** LM Studio: `llm` | `vlm` | `embeddings`. */
  type?: string
  architecture?: { input_modalities?: string[]; modality?: string }
  supported_parameters?: string[]
  capabilities?: string[]
  input_modalities?: string[]
  [key: string]: unknown
}

export async function listOpenAiModels(
  ep: OaEndpoint,
  signal: AbortSignal,
  path = '/models'
): Promise<OaModelEntry[]> {
  const res = await fetchJson<{ data?: OaModelEntry[]; models?: OaModelEntry[] }>(
    joinUrl(ep.baseUrl, path),
    { headers: oaHeaders(ep), signal }
  )
  return res.data ?? res.models ?? []
}

export interface ModelInfoOptions {
  /** Assume tool support unless the entry says otherwise (cloud providers). */
  assumeTools?: boolean
  /** Keep non-chat models (embeddings, audio, image) in the list. */
  includeNonChat?: boolean
}

/**
 * Prefer whatever the server reports; fall back to id-based inference so
 * local servers still expose accurate vision/tool flags.
 */
export function toModelInfo(entry: OaModelEntry, opts: ModelInfoOptions = {}): ModelInfo | null {
  const id = typeof entry.id === 'string' && entry.id ? entry.id : entry.name
  if (typeof id !== 'string' || !id) return null
  if (!opts.includeNonChat && !isChatModel(id)) return null
  if (typeof entry.type === 'string' && /embedding|rerank/i.test(entry.type)) return null

  const modalities = entry.architecture?.input_modalities ?? entry.input_modalities
  const reportedVision = Array.isArray(modalities)
    ? modalities.includes('image')
    : entry.type === 'vlm'
      ? true
      : undefined

  const reportedTools = Array.isArray(entry.supported_parameters)
    ? entry.supported_parameters.includes('tools')
    : Array.isArray(entry.capabilities)
      ? entry.capabilities.includes('tools') || entry.capabilities.includes('function_calling')
      : undefined

  const contextWindow =
    positive(entry.context_length) ?? positive(entry.max_context_length) ?? positive(entry.context_window)

  return {
    id,
    label: typeof entry.name === 'string' && entry.name && entry.name !== id ? entry.name : prettyLabel(id),
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    supportsTools: reportedTools ?? (opts.assumeTools ? true : inferTools(id)),
    supportsVision: reportedVision ?? inferVision(id)
  }
}

function positive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}
