/**
 * HTTP framing: reading a request body under a cap, and writing replies.
 *
 * The cap matters — a `write_file` call can legitimately carry a large payload,
 * but an unbounded body on a loopback port is still a way to exhaust the app's
 * memory, so an oversized request is refused rather than buffered.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

/** Generous enough for a file write, small enough to never threaten the app. */
export const MAX_BODY_BYTES = 16 * 1024 * 1024

export type BodyResult = { ok: true; text: string } | { ok: false; status: number; reason: string }

export async function readBody(req: IncomingMessage): Promise<BodyResult> {
  const chunks: Buffer[] = []
  let size = 0
  try {
    for await (const chunk of req) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
      size += buf.byteLength
      if (size > MAX_BODY_BYTES) {
        return { ok: false, status: 413, reason: 'Request body is too large.' }
      }
      chunks.push(buf)
    }
  } catch {
    return { ok: false, status: 400, reason: 'Request body could not be read.' }
  }
  return { ok: true, text: Buffer.concat(chunks).toString('utf8') }
}

export function writeJson(
  res: ServerResponse,
  status: number,
  payload: unknown,
  headers: Record<string, string> = {}
): void {
  const body = Buffer.from(JSON.stringify(payload ?? null), 'utf8')
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': String(body.byteLength),
    'cache-control': 'no-store',
    ...headers
  })
  res.end(body)
}

/** A bare status with a one-line reason; never echoes anything the client sent. */
export function writeStatus(res: ServerResponse, status: number, reason: string): void {
  writeJson(res, status, { error: reason })
}

export function writeUnauthorized(res: ServerResponse): void {
  writeJson(
    res,
    401,
    { error: 'A valid bearer token is required.' },
    { 'www-authenticate': 'Bearer realm="openbot"' }
  )
}

/** Accepted-and-nothing-to-say: notifications and legacy POSTs. */
export function writeAccepted(res: ServerResponse): void {
  res.writeHead(202, { 'content-length': '0', 'cache-control': 'no-store' })
  res.end()
}
