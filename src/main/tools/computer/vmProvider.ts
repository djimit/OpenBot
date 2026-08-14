/**
 * `ComputerProvider` for a bot's own virtual machine.
 *
 * Speaks plain HTTP JSON to the VM's control daemon. The route contract, owned
 * jointly with the VM team:
 *
 *   GET  /screenshot  -> { image: base64 png, width, height, scale }
 *   POST /click       <- { x, y, button, clickCount }
 *   POST /move        <- { x, y }
 *   POST /type        <- { text }
 *   POST /key         <- { combo }
 *   POST /scroll      <- { x, y, dx, dy }
 *   POST /drag        <- { from: [x, y], to: [x, y] }
 *   POST /open_app    <- { name }
 *   POST /navigate    <- { url }
 *   GET  /health      -> { ok: true, detail? }
 *
 * Coordinates are in the space of the most recent `/screenshot`, exactly as for
 * the local provider — the daemon owns the mapping on its side.
 */

import type {
  ComputerProbeResult,
  ComputerProvider,
  ComputerTarget,
  MouseButton,
  ScreenFrame
} from '../../../shared/types'
import { linkSignals } from '../cancel'
import { ToolError } from '../errors'
import type { VmBoxToolRequest, VmBoxToolResponse } from './vmProtocol'

type VmTarget = Extract<ComputerTarget, { kind: 'vm' }>

const TIMEOUT_ACTION_MS = 15_000
const TIMEOUT_SCREENSHOT_MS = 30_000
const TIMEOUT_HEALTH_MS = 5_000
const TIMEOUT_BOX_MAX_MS = 620_000
const MAX_RESPONSE_BYTES = 24 * 1024 * 1024
const MAX_FRAME_DIMENSION = 32_768

export interface VmProviderOptions {
  /** Read at request time so rotating a credential never leaves a cached copy. */
  token?: () => string | undefined
}

/** The daemon is reached through a local tunnel; credentials never go to a remote origin. */
export function normaliseVmEndpoint(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new ToolError(
      `The VM endpoint "${value}" is not a valid URL.`,
      'Use the loopback URL exposed by the VM supervisor, for example http://127.0.0.1:8790.'
    )
  }
  const host = url.hostname.toLowerCase()
  const loopback = host === 'localhost' || host === '::1' || host === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(host)
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !loopback) {
    throw new ToolError(
      `The VM endpoint must be an http(s) loopback URL; received "${value}".`,
      'Expose the VM daemon through a local supervisor or SSH tunnel instead of sending control traffic over the network.'
    )
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== '/')) {
    throw new ToolError(
      `The VM endpoint must be a bare loopback origin; received "${value}".`,
      'Remove credentials, paths, query strings and fragments from the control endpoint.'
    )
  }
  return url.origin
}

export class VmComputerProvider implements ComputerProvider {
  readonly kind = 'vm' as const
  private readonly base: string

  constructor(
    private readonly target: VmTarget,
    private readonly options: VmProviderOptions = {}
  ) {
    this.base = normaliseVmEndpoint(target.endpoint)
  }

  async probe(signal?: AbortSignal): Promise<ComputerProbeResult> {
    try {
      const body = await this.request<{
        ok?: boolean
        detail?: string
        capabilities?: unknown
      }>('GET', '/health', undefined, TIMEOUT_HEALTH_MS, signal)
      // A listener on the configured port is not enough to prove it is the VM
      // daemon. The contract requires an explicit readiness assertion.
      const ok = body.ok === true
      const capabilities = Array.isArray(body.capabilities)
        ? body.capabilities.filter((item): item is string => typeof item === 'string')
        : []
      const isolatedExecution =
        capabilities.includes('box-exec-v1') && capabilities.includes('box-files-v1')
      const executionNote = isolatedExecution
        ? 'Isolated process and filesystem execution is available.'
        : 'Isolated process/filesystem execution is unavailable; box-bound tools will be refused.'
      const computerNote = capabilities.includes('computer-v1')
        ? 'VM screen and input control is available.'
        : 'VM screen and input control is unavailable.'
      return {
        ok,
        detail: `${body.detail ?? (ok ? `VM ${this.target.vmId} is healthy at ${this.base}.` : `VM ${this.target.vmId} reported not ready.`)}\n${executionNote}\n${computerNote}`,
        capabilities,
        isolatedExecution
      }
    } catch (err) {
      return { ok: false, detail: err instanceof ToolError ? err.text : String(err) }
    }
  }

  async screenshot(signal?: AbortSignal): Promise<ScreenFrame> {
    const body = await this.request<Partial<ScreenFrame>>('GET', '/screenshot', undefined, TIMEOUT_SCREENSHOT_MS, signal)
    const image = typeof body.image === 'string' ? body.image.replace(/^data:image\/png;base64,/, '') : ''
    const width = Number(body.width)
    const height = Number(body.height)
    if (
      !validPngBase64(image) ||
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0 ||
      width > MAX_FRAME_DIMENSION ||
      height > MAX_FRAME_DIMENSION
    ) {
      throw new ToolError(
        `The VM at ${this.base} returned a malformed screenshot.`,
        'GET /screenshot must return { image: base64 png, width, height, scale }.'
      )
    }
    const scale = Number.isFinite(Number(body.scale)) && Number(body.scale) > 0 ? Number(body.scale) : 1
    return { image, width, height, scale }
  }

  async click(x: number, y: number, button: MouseButton = 'left', clickCount = 1, signal?: AbortSignal): Promise<void> {
    await this.request('POST', '/click', { x, y, button, clickCount }, TIMEOUT_ACTION_MS, signal)
  }

  async moveMouse(x: number, y: number, signal?: AbortSignal): Promise<void> {
    await this.request('POST', '/move', { x, y }, TIMEOUT_ACTION_MS, signal)
  }

  async typeText(text: string, signal?: AbortSignal): Promise<void> {
    await this.request('POST', '/type', { text }, TIMEOUT_ACTION_MS, signal)
  }

  async keyPress(combo: string, signal?: AbortSignal): Promise<void> {
    await this.request('POST', '/key', { combo }, TIMEOUT_ACTION_MS, signal)
  }

  async scroll(x: number, y: number, dx: number, dy: number, signal?: AbortSignal): Promise<void> {
    await this.request('POST', '/scroll', { x, y, dx, dy }, TIMEOUT_ACTION_MS, signal)
  }

  async drag(from: [number, number], to: [number, number], signal?: AbortSignal): Promise<void> {
    await this.request('POST', '/drag', { from, to }, TIMEOUT_ACTION_MS, signal)
  }

  async openApp(name: string, signal?: AbortSignal): Promise<void> {
    await this.request('POST', '/open_app', { name }, TIMEOUT_ACTION_MS, signal)
  }

  async navigate(url: string, signal?: AbortSignal): Promise<void> {
    await this.request('POST', '/navigate', { url }, TIMEOUT_ACTION_MS, signal)
  }

  async activeApp(signal?: AbortSignal): Promise<string | undefined> {
    const body = await this.request<{ app?: unknown }>('GET', '/active_app', undefined, TIMEOUT_HEALTH_MS, signal)
    return typeof body.app === 'string' && body.app.trim() ? body.app.trim() : undefined
  }

  async start(signal?: AbortSignal): Promise<void> {
    await this.request('POST', '/lifecycle/start', {}, TIMEOUT_SCREENSHOT_MS, signal)
  }

  async suspend(signal?: AbortSignal): Promise<void> {
    await this.request('POST', '/lifecycle/suspend', {}, TIMEOUT_SCREENSHOT_MS, signal)
  }

  async destroy(signal?: AbortSignal): Promise<void> {
    await this.request('POST', '/lifecycle/destroy', {}, TIMEOUT_SCREENSHOT_MS, signal)
  }

  async callBoxTool(payload: VmBoxToolRequest, signal?: AbortSignal): Promise<VmBoxToolResponse> {
    const requested = Number(payload.call.args['timeout_ms'])
    const timeout = Number.isFinite(requested)
      ? Math.min(TIMEOUT_BOX_MAX_MS, Math.max(TIMEOUT_ACTION_MS, requested + 15_000))
      : TIMEOUT_SCREENSHOT_MS
    return this.request('POST', '/box/tool', payload, timeout, signal)
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    payload?: unknown,
    timeoutMs: number = TIMEOUT_ACTION_MS,
    signal?: AbortSignal
  ): Promise<T> {
    const url = `${this.base}${path}`
    const link = linkSignals(signal, timeoutMs)
    try {
      const token = this.options.token?.() ?? this.target.token
      const res = await fetch(url, {
        method,
        headers: {
          accept: 'application/json',
          'x-openbot-vm-id': this.target.vmId,
          ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
          ...(token ? { authorization: `Bearer ${token}` } : {})
        },
        body: payload === undefined ? undefined : JSON.stringify(payload),
        signal: link.signal,
        redirect: 'error'
      })
      const text = await boundedResponseText(res, MAX_RESPONSE_BYTES, link.signal)

      if (res.status === 401 || res.status === 403) {
        throw new ToolError(
          `The VM at ${this.base} rejected the control token (HTTP ${res.status}).`,
          "Update the bot's computer target token in Settings."
        )
      }
      if (!res.ok) {
        throw new ToolError(
          `The VM at ${this.base} failed ${method} ${path} with HTTP ${res.status}${text ? `: ${firstLine(text)}` : '.'}`,
          'Take a fresh screenshot to see the VM state before retrying.'
        )
      }
      if (!text.trim()) return {} as T
      try {
        return JSON.parse(text) as T
      } catch {
        throw new ToolError(
          `The VM at ${this.base} returned non-JSON from ${method} ${path}: ${firstLine(text)}`,
          'The control daemon must answer with JSON.'
        )
      }
    } catch (err) {
      if (err instanceof ToolError) throw err
      throw this.unreachable(path, timeoutMs, err)
    } finally {
      link.dispose()
    }
  }

  private unreachable(path: string, timeoutMs: number, err: unknown): ToolError {
    const message = err instanceof Error ? err.message : String(err)
    const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : ''
    const timedOut = /abort|timeout/i.test(message) || /timeout/i.test(cause)
    return new ToolError(
      `Bot VM at ${this.base} is not responding${timedOut ? ` (no answer to ${path} within ${timeoutMs} ms)` : ` (${cause || message})`}.`,
      'Check that the VM is running and its control daemon is listening, or switch the bot to the local computer target.'
    )
  }
}

async function boundedResponseText(res: Response, limit: number, signal: AbortSignal): Promise<string> {
  const stated = Number(res.headers.get('content-length'))
  if (Number.isFinite(stated) && stated > limit) {
    throw new ToolError(`The VM returned an oversized response (${stated} bytes; limit ${limit}).`)
  }
  if (!res.body) return ''
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let size = 0
  let text = ''
  try {
    while (true) {
      if (signal.aborted) throw signal.reason ?? new Error('cancelled')
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) {
        await reader.cancel('response too large').catch(() => undefined)
        throw new ToolError(`The VM returned an oversized response (limit ${limit} bytes).`)
      }
      text += decoder.decode(value, { stream: true })
    }
    return text + decoder.decode()
  } finally {
    reader.releaseLock()
  }
}

function validPngBase64(value: string): boolean {
  if (!value || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false
  try {
    return Buffer.from(value, 'base64').subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
  } catch {
    return false
  }
}

function firstLine(text: string): string {
  const line = text.trim().split('\n')[0] ?? ''
  return line.length > 300 ? `${line.slice(0, 300)}…` : line
}
