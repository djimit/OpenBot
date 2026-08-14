/**
 * `ChatRequest.mcpServers` → the flags each CLI takes for a one-turn MCP server.
 *
 * OpenBOT's own gateway is minted per bot and session and dies with the turn, so
 * it can never be written into the user's `~/.claude.json` or `~/.codex/config.toml`
 * the way a permanent server is. Both CLIs accept a server on the command line
 * instead, in two different shapes:
 *
 *   claude  `--mcp-config '<json>'`  the same JSON `claude mcp add` writes
 *   codex   `-c mcp_servers.<name>={…}`  a TOML fragment merged over config.toml
 *
 * Bearer tokens never go in the URL or argv. Both CLIs receive a per-turn
 * environment variable: Claude expands it inside the temporary JSON header and
 * Codex is given the variable name in its TOML override.
 */

import type { ChatRequest } from '../types'

type McpServer = NonNullable<ChatRequest['mcpServers']>[number]

/** Codex names the variable it should read; this is how it is derived. */
export function tokenEnvVar(name: string): string {
  return `OPENBOT_MCP_TOKEN_${name.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`
}

/*
 * The same name, made unique across one request's environment.
 *
 * `tokenEnvVar` collapses every run of non-alphanumerics to `_`, so names that
 * `uniqueName` considers distinct collapse together: `my server` and
 * `my-server` — or `Notion Work` and `Notion work`, which the caller builds as
 * `"<name> <accountName>"` — all become `OPENBOT_MCP_TOKEN_MY_SERVER`. The
 * second server's token then overwrote the first's, and the first was handed a
 * credential belonging to someone else.
 *
 * The dangerous case is the gateway. It is appended last, under the name
 * `openbot`, so a user-configured server called `Open BOT` collided with it and
 * received OpenBOT's own grant token — which authorises shell and computer-use
 * execution on this machine — over HTTP to a third-party endpoint.
 */
function uniqueTokenEnvVar(name: string, used: Set<string>): string {
  const base = tokenEnvVar(name)
  let variable = base
  let suffix = 2
  while (used.has(variable)) variable = `${base}_${suffix++}`
  used.add(variable)
  return variable
}

/** Servers worth passing on: a stdio one needs a command, an http one a URL. */
function usable(servers: McpServer[] | undefined): McpServer[] {
  return (servers ?? []).filter((server) =>
    server.transport === 'http' ? !!server.url : !!server.command
  )
}

function uniqueName(raw: string, index: number, used: Set<string>, bare = false): string {
  const cleaned = bare
    ? raw.trim().replace(/[^A-Za-z0-9_-]+/g, '-')
    : raw.trim()
  const base = cleaned.replace(/^-+|-+$/g, '') || `server-${index + 1}`
  let name = base
  let suffix = 2
  while (used.has(name)) name = `${base}-${suffix++}`
  used.add(name)
  return name
}

/**
 * `--mcp-config <json>` for Claude Code, or `[]` when there is nothing to pass.
 *
 * The value is one argv element, so nothing here is shell-quoted or shell-parsed.
 * `--strict-mcp-config` is deliberately NOT set: it would also switch off the
 * servers the user configured in Claude Code itself.
 */
export interface ClaudeMcpConfig {
  args: string[]
  env: Record<string, string>
}

export function claudeMcpConfig(servers: McpServer[] | undefined): ClaudeMcpConfig {
  const present = usable(servers)
  if (present.length === 0) return { args: [], env: {} }

  const mcpServers: Record<string, unknown> = {}
  const env: Record<string, string> = {}
  const used = new Set<string>()
  const usedVars = new Set<string>()
  for (const [index, server] of present.entries()) {
    const name = uniqueName(server.name, index, used)
    let authorization: string | undefined
    if (server.bearerToken) {
      const variable = uniqueTokenEnvVar(name, usedVars)
      env[variable] = server.bearerToken
      authorization = `Bearer \${${variable}}`
    }
    mcpServers[name] =
      server.transport === 'http'
        ? {
            type: 'http',
            url: server.url,
            ...(authorization
              ? { headers: { Authorization: authorization } }
              : {})
          }
        : {
            type: 'stdio',
            command: server.command,
            ...(server.args?.length ? { args: server.args } : {}),
            ...(server.env ? { env: server.env } : {})
          }
  }
  return { args: ['--mcp-config', JSON.stringify({ mcpServers })], env }
}

/** Backward-compatible argument-only helper used by config-shape tests. */
export function claudeMcpArgs(servers: McpServer[] | undefined): string[] {
  return claudeMcpConfig(servers).args
}

/** A TOML string literal. Only `"` and `\` can end or escape one. */
function tomlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function tomlArray(values: string[]): string {
  return `[${values.map(tomlString).join(',')}]`
}

function tomlTable(entries: Array<[string, string]>): string {
  return `{${entries.map(([key, value]) => `${key}=${value}`).join(',')}}`
}

export interface CodexMcpConfig {
  /** `-c` overrides, in argv order. */
  args: string[]
  /** Variables the child needs, merged over the hydrated shell environment. */
  env: Record<string, string>
}

/**
 * `-c mcp_servers.<name>={…}` overrides for Codex, plus the token variables
 * they refer to. Codex accepts these on `exec` and on `app-server` alike, so
 * both transports get the same servers.
 */
export function codexMcpConfig(servers: McpServer[] | undefined): CodexMcpConfig {
  const args: string[] = []
  const env: Record<string, string> = {}
  const used = new Set<string>()
  const usedVars = new Set<string>()

  for (const [index, server] of usable(servers).entries()) {
    // A name that is not a bare TOML key would land in the wrong table.
    const name = uniqueName(server.name, index, used, true)
    const entries: Array<[string, string]> =
      server.transport === 'http'
        ? [['url', tomlString(server.url ?? '')]]
        : [['command', tomlString(server.command ?? '')]]

    if (server.transport === 'http' && server.bearerToken) {
      const variable = uniqueTokenEnvVar(name, usedVars)
      env[variable] = server.bearerToken
      entries.push(['bearer_token_env_var', tomlString(variable)])
    }
    if (server.transport === 'stdio' && server.args?.length) {
      entries.push(['args', tomlArray(server.args)])
    }
    args.push('-c', `mcp_servers.${name}=${tomlTable(entries)}`)
  }
  return { args, env }
}
