/**
 * Attaches the MCP gateway to a supervised (agent-CLI) session.
 *
 * The gateway — owned by `src/main/gateway` — runs an MCP server exposing OpenBOT's
 * distinctive tools (computer use, `remember`, `handoff`, routine markers) and hands the
 * endpoint back, so the turn can pass it to the CLI and the CLI's own loop calls back
 * into us through `sessionActions`.
 *
 * The glob names `../gateway/index.ts` exactly, so the barrel has to exist as a file. It
 * did not, and `import.meta.glob` compiles to an empty map when nothing matches — so the
 * whole gateway sat outside every build and every agent-CLI session ran without OpenBOT's
 * tools, announced by one `console.warn` nobody reads. The optional-peer shape is still
 * right (a build without the gateway must degrade, not fail); it just needs a target.
 */

import type { RuntimeMcpServer } from './turnTypes'
import { acceptsRuntimeMcpServer } from './runtimeMcp'
import { errorMessage } from './errors'

export interface GatewayAttachment {
  sessionId: string
  botId: string
  cwd: string
  backendId: string
}

interface GatewayModule {
  attachSession?(input: GatewayAttachment): unknown
  attach?(input: GatewayAttachment): unknown
  detachSession?(sessionId: string): unknown
  detach?(sessionId: string): unknown
  noteMessage?(sessionId: string, messageId: string | undefined): unknown
}

const candidates = import.meta.glob('../gateway/index.ts')

let cached: Promise<GatewayModule | null> | null = null
let warned = false

function load(): Promise<GatewayModule | null> {
  if (cached) return cached
  const loader = Object.values(candidates)[0]
  if (!loader) {
    if (!warned) {
      warned = true
      console.warn('[agent] MCP gateway is not part of this build; CLI sessions run without OpenBOT tools')
    }
    return Promise.resolve(null)
  }
  cached = loader()
    .then((mod) => (mod ?? null) as GatewayModule | null)
    .catch((err) => {
      cached = null
      console.warn(`[agent] MCP gateway unavailable: ${errorMessage(err)}`)
      return null
    })
  return cached
}

/** A descriptor is only usable if it actually carries an endpoint and a credential. */
function asServer(value: unknown): RuntimeMcpServer | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Partial<RuntimeMcpServer>
  if (typeof record.url !== 'string' || !record.url) return null
  if (typeof record.bearerToken !== 'string' || !record.bearerToken) return null
  return {
    name: typeof record.name === 'string' && record.name ? record.name : 'openbot',
    transport: 'http',
    url: record.url,
    bearerToken: record.bearerToken
  }
}

/**
 * Best-effort attach, returning the server to hand this turn's CLI.
 *
 * Never throws: a missing gateway must not block the turn. Returns null for a
 * backend that cannot be given a server at run time, before anything is
 * started — an endpoint nothing can connect to is a listener for nobody.
 */
export async function attachGateway(input: GatewayAttachment): Promise<RuntimeMcpServer | null> {
  if (!acceptsRuntimeMcpServer(input.backendId)) return null
  const mod = await load()
  const fn = mod?.attachSession ?? mod?.attach
  if (typeof fn !== 'function') return null
  try {
    return asServer(await fn(input))
  } catch (err) {
    console.warn(`[agent] MCP gateway attach failed: ${errorMessage(err)}`)
    return null
  }
}

/**
 * Tell the gateway which assistant message a CLI's tool calls belong to.
 *
 * The message is created after the session is attached, so this is a second
 * call. Without it the gateway has no message to hang a `tool-call` event off
 * and the CLI's use of OpenBOT's own tools never appears in the transcript.
 */
export async function noteGatewayMessage(
  sessionId: string,
  messageId: string | undefined
): Promise<void> {
  const mod = await load()
  if (typeof mod?.noteMessage !== 'function') return
  try {
    mod.noteMessage(sessionId, messageId)
  } catch (err) {
    console.warn(`[agent] MCP gateway message note failed: ${errorMessage(err)}`)
  }
}

/** Best-effort detach, called when a supervised session ends or is stopped. */
export async function detachGateway(sessionId: string): Promise<void> {
  const mod = await load()
  const fn = mod?.detachSession ?? mod?.detach
  if (typeof fn !== 'function') return
  try {
    await fn(sessionId)
  } catch (err) {
    console.warn(`[agent] MCP gateway detach failed: ${errorMessage(err)}`)
  }
}
