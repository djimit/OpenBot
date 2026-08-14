/**
 * Who is allowed to talk to the gateway.
 *
 * Three independent checks, all of which must pass:
 *
 *   1. the connection is loopback — the listener binds 127.0.0.1, and the Host
 *      header must agree, so a DNS-rebinding attempt cannot reach it;
 *   2. any Origin header names a loopback origin (browsers send one, CLIs do not);
 *   3. the request carries `Authorization: Bearer <token>` for a live grant.
 *
 * Nothing here is logged: a rejected request is a status code, never a trace of
 * the credential that failed.
 */

import type { IncomingMessage } from 'node:http'
import { type Grant, grantForToken } from './tokens'

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', '0000:0000:0000:0000:0000:0000:0000:0001'])

function hostname(value: string): string {
  const trimmed = value.trim().toLowerCase()
  if (trimmed.startsWith('[')) return trimmed.slice(0, trimmed.indexOf(']') + 1)
  const colon = trimmed.lastIndexOf(':')
  return colon === -1 ? trimmed : trimmed.slice(0, colon)
}

export function hostAllowed(req: IncomingMessage): boolean {
  const header = req.headers.host
  // No Host header at all is an HTTP/1.0 client; the socket is already loopback.
  if (typeof header !== 'string' || header === '') return true
  return LOOPBACK_HOSTS.has(hostname(header))
}

export function originAllowed(req: IncomingMessage): boolean {
  const header = req.headers.origin
  if (typeof header !== 'string' || header === '' || header === 'null') return true
  try {
    return LOOPBACK_HOSTS.has(new URL(header).hostname.toLowerCase())
  } catch {
    return false
  }
}

export function bearerToken(req: IncomingMessage): string {
  const header = req.headers.authorization
  if (typeof header !== 'string') return ''
  const match = /^Bearer[ \t]+(.+)$/i.exec(header.trim())
  return match ? match[1].trim() : ''
}

/**
 * Resolve the grant a request is acting under, or null when it presents no
 * usable credential. The caller answers null with 401 and no detail.
 */
export function authorise(req: IncomingMessage): Grant | null {
  if (!hostAllowed(req) || !originAllowed(req)) return null
  return grantForToken(bearerToken(req)) ?? null
}

/**
 * MCP's optional session header. Once `initialize` has assigned one, a request
 * that names a different session is stale and must re-initialize (404).
 */
export function sessionHeaderMatches(req: IncomingMessage, grant: Grant): boolean {
  const header = req.headers['mcp-session-id']
  const value = Array.isArray(header) ? header[0] : header
  if (typeof value !== 'string' || value === '') return true
  return grant.mcpSessionId === undefined || grant.mcpSessionId === value
}
