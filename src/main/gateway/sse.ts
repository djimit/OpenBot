/**
 * Server→client streaming.
 *
 * MCP's HTTP transport carries server-initiated messages over Server-Sent
 * Events. Two shapes ride on the same plumbing:
 *
 *   streamable HTTP  `GET /mcp`  — an open channel for notifications
 *   legacy HTTP+SSE  `GET /sse`  — the same channel, but it first announces the
 *                                  POST endpoint and then carries every reply
 *
 * Streams are keyed by the bearer token that opened them, so revoking a session
 * closes its streams and nothing else.
 */

import { randomUUID } from 'node:crypto'
import type { ServerResponse } from 'node:http'

/** Loopback needs no keep-alive, but a comment frame detects a dead socket. */
const HEARTBEAT_MS = 25_000

export interface SseStream {
  readonly id: string
  readonly token: string
  /** Send a JSON-RPC message as one `message` event. */
  send(payload: unknown): void
  /** Send a named event (the legacy transport's `endpoint` announcement). */
  sendEvent(event: string, data: string): void
  close(): void
}

const streams = new Map<string, SseStream>()

export function openSse(res: ServerResponse, token: string): SseStream {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no'
  })
  res.flushHeaders?.()

  const id = randomUUID()
  let open = true

  const heartbeat = setInterval(() => {
    if (open) res.write(': keep-alive\n\n')
  }, HEARTBEAT_MS)
  heartbeat.unref?.()

  const stream: SseStream = {
    id,
    token,
    sendEvent(event: string, data: string): void {
      if (!open) return
      const body = data
        .split('\n')
        .map((line) => `data: ${line}`)
        .join('\n')
      res.write(`event: ${event}\n${body}\n\n`)
    },
    send(payload: unknown): void {
      stream.sendEvent('message', JSON.stringify(payload))
    },
    close(): void {
      if (!open) return
      open = false
      clearInterval(heartbeat)
      streams.delete(id)
      res.end()
    }
  }

  streams.set(id, stream)
  res.on('close', () => {
    open = false
    clearInterval(heartbeat)
    streams.delete(id)
  })
  return stream
}

export function streamById(id: string): SseStream | undefined {
  return streams.get(id)
}

/** Push a message to every stream a token has open. */
export function sendToToken(token: string, payload: unknown): number {
  let sent = 0
  for (const stream of streams.values()) {
    if (stream.token !== token) continue
    stream.send(payload)
    sent++
  }
  return sent
}

export function closeStreamsFor(token: string): void {
  for (const stream of [...streams.values()]) {
    if (stream.token === token) stream.close()
  }
}

export function closeAllStreams(): void {
  for (const stream of [...streams.values()]) stream.close()
}

export function openStreamCount(): number {
  return streams.size
}
