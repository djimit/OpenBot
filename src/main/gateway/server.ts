/**
 * The MCP endpoint itself: `node:http`, loopback only, OS-assigned port.
 *
 * Two transports over one dispatcher, because the CLIs in the wild speak both:
 *
 *   POST /mcp        streamable HTTP — the reply is the response body
 *   GET  /mcp        an SSE channel for server-initiated notifications
 *   DELETE /mcp      the client is done; close its streams
 *   GET  /sse        legacy HTTP+SSE — announces the POST endpoint, then carries
 *   POST /messages   every reply back over that stream
 *
 * The port is never chosen by us: we listen on 0 and read the real port back, so
 * nothing collides and nothing is guessable.
 */

import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http'
import { type JsonRpcResponse, isFailure, parseBody } from './rpc'
import { dispatch } from './protocol'
import { authorise, sessionHeaderMatches } from './security'
import { closeAllStreams, closeStreamsFor, openSse, streamById } from './sse'
import type { Grant } from './tokens'
import { readBody, writeAccepted, writeJson, writeStatus, writeUnauthorized } from './wire'

const HOST = '127.0.0.1'

let server: Server | null = null
let starting: Promise<string> | null = null
let baseUrl = ''

export async function ensureServer(): Promise<string> {
  if (baseUrl) return baseUrl
  starting ??= start().finally(() => {
    starting = null
  })
  return starting
}

function start(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const created = createServer((req, res) => {
      void handle(req, res).catch(() => {
        if (!res.headersSent) writeStatus(res, 500, 'Gateway failed to handle the request.')
        else res.end()
      })
    })
    created.on('error', (err) => {
      server = null
      baseUrl = ''
      reject(err)
    })
    created.listen({ host: HOST, port: 0 }, () => {
      const address = created.address()
      if (!address || typeof address === 'string') {
        created.close()
        reject(new Error('The MCP gateway could not determine its own port.'))
        return
      }
      server = created
      baseUrl = `http://${HOST}:${address.port}`
      resolve(baseUrl)
    })
  })
}

/** `''` until the server is listening. */
export function gatewayBaseUrl(): string {
  return baseUrl
}

export function mcpEndpoint(): string {
  return `${baseUrl}/mcp`
}

export function sseEndpoint(): string {
  return `${baseUrl}/sse`
}

export async function closeServer(): Promise<void> {
  const current = server
  server = null
  baseUrl = ''
  closeAllStreams()
  if (!current) return
  await new Promise<void>((resolve) => current.close(() => resolve()))
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const grant = authorise(req)
  if (!grant) {
    writeUnauthorized(res)
    return
  }
  if (!sessionHeaderMatches(req, grant)) {
    writeStatus(res, 404, 'Unknown MCP session — re-initialize.')
    return
  }

  const url = new URL(req.url ?? '/', baseUrl || `http://${HOST}`)
  const path = url.pathname.replace(/\/+$/, '') || '/'
  const method = req.method ?? 'GET'

  if (method === 'GET' && path === '/mcp') {
    openSse(res, grant.token)
    return
  }
  if (method === 'GET' && path === '/sse') {
    const stream = openSse(res, grant.token)
    stream.sendEvent('endpoint', `${baseUrl}/messages?stream=${stream.id}`)
    return
  }
  if (method === 'DELETE' && path === '/mcp') {
    closeStreamsFor(grant.token)
    res.writeHead(204, { 'content-length': '0' })
    res.end()
    return
  }
  if (method === 'POST' && (path === '/mcp' || path === '/messages')) {
    await handlePost(req, res, grant, path === '/messages' ? url.searchParams.get('stream') : null)
    return
  }
  writeStatus(res, 404, 'No such endpoint.')
}

async function handlePost(
  req: IncomingMessage,
  res: ServerResponse,
  grant: Grant,
  streamId: string | null
): Promise<void> {
  const legacyStream = streamId ? streamById(streamId) : null
  if (streamId && (!legacyStream || legacyStream.token !== grant.token)) {
    writeStatus(res, 404, 'That SSE stream is not open.')
    return
  }

  const body = await readBody(req)
  if (!body.ok) {
    writeStatus(res, body.status, body.reason)
    return
  }

  const parsed = parseBody(body.text)
  if (isFailure(parsed)) {
    writeJson(res, 400, parsed)
    return
  }

  // The socket closing mid-call means the client walked away: stop the work.
  const aborter = new AbortController()
  res.on('close', () => aborter.abort())

  const responses: JsonRpcResponse[] = []
  for (const message of parsed.messages) {
    const reply = await dispatch(grant, message, aborter.signal)
    if (reply) responses.push(reply)
  }

  if (legacyStream) {
    for (const reply of responses) legacyStream.send(reply)
    writeAccepted(res)
    return
  }
  if (responses.length === 0) {
    writeAccepted(res)
    return
  }

  const headers: Record<string, string> = grant.mcpSessionId
    ? { 'mcp-session-id': grant.mcpSessionId }
    : {}
  writeJson(res, 200, parsed.batch ? responses : responses[0], headers)
}
