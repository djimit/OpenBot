/**
 * The daemon's HTTP transport: bounded request bodies and JSON replies.
 *
 * Nothing here knows what a route means. Keeping the caps and the response
 * shape in one place is what lets every handler assume it was handed a body
 * that already fits in memory.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * An error the client is entitled to see the status of.
 *
 * The body is read before the route's own try block, so an oversized request
 * used to arrive at the generic handler and come back as HTTP 500 — the client
 * was told the daemon had broken when in fact it had refused a payload, which
 * is a very different thing to act on.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

export async function readBody(req: IncomingMessage, limit: number): Promise<string> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.length
    if (bytes > limit) {
      throw new HttpError(413, `Request body is larger than ${Math.floor(limit / (1024 * 1024))} MiB.`)
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export function json(res: ServerResponse, status: number, value: unknown): void {
  if (res.headersSent || res.writableEnded) return
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  })
  res.end(body)
}
