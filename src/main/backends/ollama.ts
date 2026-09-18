/**
 * Ollama — local server, no key. Chat goes through its OpenAI-compatible `/v1`;
 * models come from the native `/api/tags`, which reports tool/vision capabilities.
 */

import { DETECT_TIMEOUT_MS, LIST_TIMEOUT_MS, withTimeout } from './httpClient'
import { errorMessage, isOffline } from './httpErrors'
import { type OaEndpoint, listOpenAiModels, streamOpenAiChat, toModelInfo } from './openaiCompat'
import type { Backend, BackendConfig, ChatChunk, ChatRequest, DetectResult, ModelInfo } from './types'
import { displayHost, ensureV1, stripVersion } from './urls'

export const OLLAMA_DEFAULT_BASE_URL = 'http://127.0.0.1:11434/v1'

function endpoint(cfg: BackendConfig): OaEndpoint {
  return { baseUrl: ensureV1(cfg.baseUrl?.trim() || OLLAMA_DEFAULT_BASE_URL) }
}

/** Native tags live at the server root, not under /v1. */
function tags(ep: OaEndpoint, signal: AbortSignal) {
  return listOpenAiModels({ ...ep, baseUrl: stripVersion(ep.baseUrl) }, signal, '/api/tags')
}

export const ollamaBackend: Backend = {
  id: 'ollama',
  label: 'Ollama',
  kind: 'local-server',
  local: true,

  async detect(cfg: BackendConfig): Promise<DetectResult> {
    const ep = endpoint(cfg)
    try {
      const models = await tags(ep, withTimeout(undefined, DETECT_TIMEOUT_MS))
      return {
        status: 'available',
        detail: `${models.length} model${models.length === 1 ? '' : 's'} at ${displayHost(ep.baseUrl)}.`
      }
    } catch (err) {
      return isOffline(err)
        ? { status: 'not-installed', detail: `Ollama is not running at ${displayHost(ep.baseUrl)} — start it with \`ollama serve\`.` }
        : { status: 'error', detail: `Ollama check failed: ${errorMessage(err)}` }
    }
  },

  async listModels(cfg: BackendConfig): Promise<ModelInfo[]> {
    try {
      const entries = await tags(endpoint(cfg), withTimeout(undefined, LIST_TIMEOUT_MS))
      return entries
        .map((e) => toModelInfo(e))
        .filter((m): m is ModelInfo => m !== null)
        .sort((a, b) => a.id.localeCompare(b.id))
    } catch (err) {
      throw new Error(`Could not list Ollama models: ${errorMessage(err)}`)
    }
  },

  chat(req: ChatRequest, cfg: BackendConfig): AsyncIterable<ChatChunk> {
    return streamOpenAiChat({
      ...endpoint(cfg),
      model: req.model,
      messages: req.messages,
      tools: req.tools,
      temperature: req.temperature,
      signal: req.signal
    })
  }
}
