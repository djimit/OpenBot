/** Per-process OpenCode configuration, kept out of the user's config files. */

import type { ChatRequest } from '../types'

type McpServer = NonNullable<ChatRequest['mcpServers']>[number]

export interface OpenCodeProcessConfig {
  content: string
}

/** OpenCode keys are identifiers in tool names as well as config object keys. */
function safeName(value: string, index: number, used: Set<string>): string {
  const base = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || `server-${index + 1}`
  let name = base
  let suffix = 2
  while (used.has(name)) name = `${base}-${suffix++}`
  used.add(name)
  return name
}

function mcpEntry(server: McpServer): Record<string, unknown> | null {
  if (server.transport === 'stdio') {
    if (!server.command?.trim()) return null
    return {
      type: 'local',
      command: [server.command, ...(server.args ?? [])],
      enabled: true,
      ...(server.env ? { environment: server.env } : {})
    }
  }
  if (!server.url?.trim()) return null
  return {
    type: 'remote',
    url: server.url,
    enabled: true,
    oauth: server.auth === 'oauth',
    ...(server.bearerToken
      ? { headers: { Authorization: `Bearer ${server.bearerToken}` } }
      : {})
  }
}

/**
 * Force every OpenCode tool through its permission event API. OpenBOT then
 * answers those requests with its own policy. Background side calls deny tools
 * outright because they have no approval callback and exist only to emit text.
 */
export function opencodeProcessConfig(req: ChatRequest): OpenCodeProcessConfig {
  const used = new Set<string>()
  const mcp: Record<string, Record<string, unknown>> = {}
  for (const [index, server] of (req.mcpServers ?? []).entries()) {
    const entry = mcpEntry(server)
    if (!entry) continue
    mcp[safeName(server.name, index, used)] = entry
  }

  return {
    content: JSON.stringify({
      permission: req.readOnly ? 'deny' : 'ask',
      ...(Object.keys(mcp).length > 0 ? { mcp } : {})
    })
  }
}
