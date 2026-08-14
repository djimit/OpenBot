/**
 * OpenBOT `ToolSchema` → MCP tool descriptor.
 *
 * The registry is the single source of truth: a bot's enabled ids go in,
 * schemas come back in `TOOL_IDS` order, and nothing outside that list is ever
 * advertised. `mutating` / `computerUse` become MCP's behaviour hints, which is
 * how a client decides what to show the user — the actual gate stays ours.
 *
 * The session's mode narrows that list further: Ask and Plan are read-only, and
 * a tool the bot may not call in the mode it is in must not be advertised to the
 * CLI either. `invoke.ts` refuses one anyway, as `execute.ts` does for our own
 * loop — a withheld tool the model has already seen gets called regardless.
 */

import type { AgentMode, ComputerTarget, ToolSchema } from '../../shared/types'
import { filterToolsForMode } from '../agent/modes'
import { getSession } from '../store/sessions'
import { getTool, schemasFor } from '../tools/registry'

/**
 * The mode the session is in right now.
 *
 * Read per request rather than frozen into the grant: a grant is minted once per
 * turn, and the user may switch the chat to Ask or Plan while the CLI is still
 * running. A session that is no longer in the store is treated as read-only —
 * nothing is left to say the user allowed a change.
 */
export function sessionMode(sessionId: string): AgentMode {
  return getSession(sessionId)?.mode ?? 'ask'
}

export interface McpToolAnnotations {
  title?: string
  readOnlyHint?: boolean
  destructiveHint?: boolean
  idempotentHint?: boolean
  openWorldHint?: boolean
}

export interface McpToolDescriptor {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
  annotations?: McpToolAnnotations
}

/** Tools that reach outside the machine's own state. */
const OPEN_WORLD = new Set(['fetch', 'web_search', 'navigate', 'open_app'])

function annotate(schema: ToolSchema): McpToolAnnotations {
  return {
    readOnlyHint: !schema.mutating && !schema.computerUse,
    destructiveHint: schema.mutating,
    openWorldHint: OPEN_WORLD.has(schema.name) || schema.computerUse === true
  }
}

export function toDescriptor(schema: ToolSchema): McpToolDescriptor {
  const params = schema.parameters
  return {
    name: schema.name,
    description: schema.description,
    inputSchema: {
      type: 'object',
      properties: params.properties ?? {},
      ...(params.required && params.required.length > 0 ? { required: params.required } : {})
    },
    annotations: annotate(schema)
  }
}

/**
 * Everything the bot behind this grant may call, as MCP descriptors.
 *
 * `mode` defaults to `agent` so a caller that has no session to hand — a probe,
 * a listing built before the session is resolved — still sees the bot's own
 * tools; every caller that can name the session passes its real mode.
 */
export function describeTools(
  enabledIds: string[],
  target?: ComputerTarget,
  mode: AgentMode = 'agent'
): McpToolDescriptor[] {
  return filterToolsForMode(schemasFor(enabledIds, target), mode).map(toDescriptor)
}

/**
 * Whether a name may be called under this grant.
 *
 * Aliases the registry accepts (`double_click`) resolve to their canonical tool
 * first, so an alias cannot smuggle in a tool the bot has not enabled.
 */
export function exposedSchema(
  enabledIds: string[],
  name: string,
  target?: ComputerTarget
): ToolSchema | undefined {
  const tool = getTool(name)
  if (!tool) return undefined
  const allowed = new Set(schemasFor(enabledIds, target).map((s) => s.name))
  return allowed.has(tool.schema.name) ? tool.schema : undefined
}
