/**
 * A size-capped, cancellable HTTP client over the global `fetch`.
 *
 * The response body is streamed and abandoned the moment it exceeds the cap,
 * so a huge download can never blow up the main process.
 */

import { lookup } from 'node:dns/promises'
import { linkSignals } from '../cancel'
import { ToolError } from '../errors'

export interface HttpRequest {
  url: string
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: string
  /** Hard ceiling on the downloaded body. */
  maxBytes: number
  timeoutMs: number
  signal?: AbortSignal
  /**
   * The one non-public host the user approved for this request, if any.
   *
   * Named rather than a boolean so an approved hop to `localhost` cannot be
   * redirected on to `169.254.169.254`: every other internal destination is
   * still refused, on the first request and on each redirect.
   */
  allowNonPublicHost?: string
}

export interface HttpResponse {
  url: string
  status: number
  statusText: string
  contentType: string
  headers: Record<string, string>
  body: string
  bytes: number
  truncated: boolean
}

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

/** Parse and validate a URL, allowing only http(s). */
export function parseHttpUrl(raw: string, tool: string): URL {
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    throw new ToolError(`${tool}: "${raw}" is not a valid URL.`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ToolError(
      `${tool}: only http and https URLs are supported (got "${url.protocol}").`,
      'Use read_file for local files.'
    )
  }
  return url
}

export interface Destination {
  /** Hostname as written in the URL, brackets stripped from an IPv6 literal. */
  host: string
  /** Every address the host resolved to. */
  addresses: string[]
  /** Why this destination is not on the public internet, when it is not. */
  reason?: string
}

/**
 * Where a URL actually points.
 *
 * The host is resolved before it is judged, because the name says nothing: a
 * domain the model read off a web page can resolve to 127.0.0.1, to 10/8, or to
 * the 169.254.169.254 metadata service, and `fetch` would have reached all three
 * with no approval card under `auto-run`. A lookup that fails is a refusal
 * rather than a pass — an unverifiable destination is not a safe one.
 */
export async function classifyDestination(url: URL | string): Promise<Destination> {
  const parsed = typeof url === 'string' ? new URL(url) : url
  const host = parsed.hostname.replace(/^\[|\]$/g, '')

  let addresses: string[]
  try {
    addresses = (await lookup(host, { all: true, verbatim: true })).map((entry) => entry.address)
  } catch {
    throw new ToolError(
      `Could not resolve ${host}, so where the request would go could not be checked.`,
      'Check the domain, or whether this machine is online. Nothing was sent.'
    )
  }
  if (addresses.length === 0) {
    throw new ToolError(`${host} resolved to no addresses, so the request was not made.`)
  }

  // Any non-public address disqualifies the host: a name that answers with both
  // a public and a private address must not be reachable on a lucky ordering.
  const reason = addresses.map(nonPublicReason).find((r) => r !== undefined)
  return { host, addresses, ...(reason ? { reason } : {}) }
}

/**
 * The address ranges a tool-driven request has no business reaching: the loopback
 * and unspecified addresses, RFC-1918 and carrier-grade NAT space, link-local
 * (which is where every cloud metadata service lives), unique-local IPv6, and
 * multicast/reserved. Everything else is treated as public.
 */
function nonPublicReason(address: string): string | undefined {
  const ip = address.toLowerCase().replace(/%.*$/, '') // drop any IPv6 zone id

  // `::ffff:127.0.0.1` is a v4 address wearing a v6 hat; judge it as v4.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip)
  if (mapped) return nonPublicReason(mapped[1] as string)

  return ip.includes(':') ? ipv6Reason(ip) : ipv4Reason(ip)
}

function ipv4Reason(ip: string): string | undefined {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return 'unrecognised address'
  }
  const [a, b] = parts as [number, number, number, number]
  if (a === 0) return 'unspecified address'
  if (a === 127) return 'loopback address'
  if (a === 10) return 'private address (10/8)'
  if (a === 172 && b >= 16 && b <= 31) return 'private address (172.16/12)'
  if (a === 192 && b === 168) return 'private address (192.168/16)'
  if (a === 169 && b === 254) return 'link-local address (cloud metadata)'
  if (a === 100 && b >= 64 && b <= 127) return 'carrier-grade NAT address'
  if (a >= 224) return 'multicast or reserved address'
  return undefined
}

function ipv6Reason(ip: string): string | undefined {
  if (ip === '::') return 'unspecified address'
  if (ip === '::1') return 'loopback address'
  if (/^fe[89ab]/.test(ip)) return 'link-local address'
  if (/^f[cd]/.test(ip)) return 'unique-local address'
  if (/^ff/.test(ip)) return 'multicast address'
  return undefined
}

/**
 * Gate for one hop. Applied to the first request and to every redirect target,
 * so a public host cannot bounce the request onto an internal one.
 */
async function assertAllowedDestination(url: string, approvedHost?: string): Promise<void> {
  const destination = await classifyDestination(url)
  if (!destination.reason) return
  if (approvedHost && destination.host.toLowerCase() === approvedHost.toLowerCase()) return
  throw new ToolError(
    `${destination.host} resolves to ${destination.addresses[0]}, a ${destination.reason}; the request was not sent.`,
    'Only public internet destinations are fetched without an explicit approval for that exact host.'
  )
}

export async function httpRequest(req: HttpRequest): Promise<HttpResponse> {
  const link = linkSignals(req.signal, req.timeoutMs)
  const sendsBody = (req.method ?? 'GET') === 'POST'
  try {
    const { res, finalUrl } = await followRedirects(req, sendsBody, link.signal)

    const headers: Record<string, string> = {}
    res.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value
    })
    const contentType = headers['content-type'] ?? ''

    const { text, bytes, truncated } = await readCapped(res, req.maxBytes, contentType)
    return {
      url: finalUrl || res.url || req.url,
      status: res.status,
      statusText: res.statusText,
      contentType,
      headers,
      body: text,
      bytes,
      truncated
    }
  } catch (err) {
    throw asNetworkError(err, req)
  } finally {
    link.dispose()
  }
}

const MAX_REDIRECTS = 5

/**
 * Perform the request, following redirects by hand.
 *
 * A GET may follow freely — the final URL is reported back. A request carrying a
 * body may not: the user approved sending that body to one specific origin, and
 * a 307/308 to somewhere else would have replayed it verbatim to a host that was
 * never on the approval card. Same-origin hops are followed (the body is still
 * going where it was approved to go); anything cross-origin stops with the
 * destination named, so re-issuing it is a fresh, accurate approval.
 *
 * Even a plain GET is stepped through hop by hop rather than handed to
 * `redirect: 'follow'`: that hides the intermediate hops inside `fetch`, and the
 * destination check below only means something if it runs on every one of them.
 * Otherwise a public URL is all it takes to reach 127.0.0.1 or the metadata
 * service — the redirect does the escaping, and nothing ever sees it.
 */
async function followRedirects(
  req: HttpRequest,
  sendsBody: boolean,
  signal: AbortSignal
): Promise<{ res: Response; finalUrl: string }> {
  const headers = {
    'user-agent': DEFAULT_USER_AGENT,
    'accept-language': 'en-US,en;q=0.9',
    ...(req.headers ?? {})
  }

  let url = req.url
  let carriesBody = sendsBody
  for (let hop = 0; ; hop++) {
    await assertAllowedDestination(url, req.allowNonPublicHost)

    const res = carriesBody
      ? await fetch(url, { method: 'POST', headers, body: req.body, redirect: 'manual', signal })
      : await fetch(url, { method: 'GET', headers, redirect: 'manual', signal })
    const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null
    if (!location) return { res, finalUrl: url }

    if (hop >= MAX_REDIRECTS) {
      throw new ToolError(`${safeHost(url)} redirected more than ${MAX_REDIRECTS} times.`)
    }
    const next = new URL(location, url)
    if (next.protocol !== 'http:' && next.protocol !== 'https:') {
      throw new ToolError(
        `${safeHost(url)} redirected to a ${next.protocol} URL, which this tool does not follow.`
      )
    }
    // 301/302/303 drop the body and continue as a GET, which is safe anywhere.
    // 307/308 replay it, so they may only stay on the origin that was approved.
    if (res.status === 307 || res.status === 308) {
      if (next.origin !== new URL(url).origin) {
        throw new ToolError(
          `${safeHost(url)} redirected the request body to ${next.origin}, which is not what the user approved.`,
          `Nothing was sent there. If that destination is intended, request ${next.toString()} directly so it is approved on its own.`
        )
      }
    } else {
      carriesBody = false
    }
    url = next.toString()
  }
}

async function readCapped(
  res: Response,
  maxBytes: number,
  contentType: string
): Promise<{ text: string; bytes: number; truncated: boolean }> {
  const decoder = makeDecoder(contentType)
  const body = res.body
  if (!body) {
    const text = await res.text()
    return { text: text.slice(0, maxBytes), bytes: Buffer.byteLength(text), truncated: false }
  }

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  let truncated = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      bytes += value.byteLength
      if (bytes > maxBytes) {
        const keep = value.byteLength - (bytes - maxBytes)
        if (keep > 0) chunks.push(value.subarray(0, keep))
        truncated = true
        break
      }
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }

  const joined = Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)))
  return { text: decoder.decode(joined), bytes, truncated }
}

function makeDecoder(contentType: string): TextDecoder {
  const match = /charset=["']?([\w-]+)/i.exec(contentType)
  const label = match?.[1] ?? 'utf-8'
  try {
    return new TextDecoder(label)
  } catch {
    return new TextDecoder('utf-8')
  }
}

function asNetworkError(err: unknown, req: HttpRequest): ToolError {
  if (err instanceof ToolError) return err
  const message = err instanceof Error ? err.message : String(err)
  const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : ''
  const host = safeHost(req.url)
  if (/abort/i.test(message) || /timeout/i.test(message) || /timeout/i.test(cause)) {
    return new ToolError(
      `Request to ${host} did not complete within ${req.timeoutMs} ms.`,
      'The site may be slow or unreachable. Try again, or raise timeout_ms.'
    )
  }
  if (/ENOTFOUND|getaddrinfo/i.test(cause) || /ENOTFOUND/i.test(message)) {
    return new ToolError(`Could not resolve ${host}.`, 'Check the domain, or whether this machine is online.')
  }
  if (/ECONNREFUSED/i.test(cause) || /ECONNREFUSED/i.test(message)) {
    return new ToolError(`Connection to ${host} was refused — nothing is listening there.`)
  }
  if (/certificate|SSL|TLS/i.test(cause) || /certificate/i.test(message)) {
    return new ToolError(`TLS verification failed for ${host}: ${cause || message}`)
  }
  return new ToolError(`Request to ${host} failed: ${message}${cause ? ` (${cause})` : ''}`)
}

function safeHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
