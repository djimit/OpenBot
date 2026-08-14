/**
 * `fetch` — HTTP GET/POST returning readable text.
 */

import type { ToolSchema } from '../../../shared/types'
import { clamp, optEnum, optNum, optStr, reqStr } from '../args'
import { requireApproval } from '../approval'
import { defineTool } from '../results'
import { formatBytes, truncateEnd } from '../text'
import { extractLinks, extractTitle, htmlToText } from './html'
import { classifyDestination, httpRequest, parseHttpUrl } from './http'

const NAME = 'fetch'
const DEFAULT_MAX_BYTES = 512 * 1024
const MAX_MAX_BYTES = 5 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 30_000
const MAX_OUTPUT_CHARS = 100_000

export const schema: ToolSchema = {
  name: NAME,
  description:
    'Fetch a URL over HTTP(S) and return the response as text. HTML is stripped of scripts, styles and ' +
    'markup and converted to readable text; JSON and plain text come back as-is. The body is capped, and ' +
    'POST requests always ask the user first, as does any URL that resolves to a loopback, private or ' +
    'link-local address.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Absolute http(s) URL.' },
      method: { type: 'string', enum: ['get', 'post'], description: 'HTTP method. Default GET.' },
      body: { type: 'string', description: 'Request body for POST.' },
      content_type: { type: 'string', description: 'Content-Type for the POST body. Default application/json.' },
      format: {
        type: 'string',
        enum: ['text', 'html', 'links'],
        description: '"text" (default) converts HTML to text, "html" returns raw markup, "links" lists links.'
      },
      max_bytes: { type: 'number', description: `Download ceiling. Default ${DEFAULT_MAX_BYTES}.` },
      timeout_ms: { type: 'number', description: `Request timeout. Default ${DEFAULT_TIMEOUT_MS}.` }
    },
    required: ['url']
  },
  mutating: true
}

export const fetchTool = defineTool(schema, async (args, ctx) => {
  const url = parseHttpUrl(reqStr(args, 'url', NAME), NAME)
  const method = optEnum(args, 'method', ['get', 'post'] as const, 'get') === 'post' ? 'POST' : 'GET'
  const body = optStr(args, 'body')
  const contentType = optStr(args, 'content_type') ?? 'application/json'
  const format = optEnum(args, 'format', ['text', 'html', 'links'] as const, 'text')
  const maxBytes = clamp(Math.floor(optNum(args, 'max_bytes') ?? DEFAULT_MAX_BYTES), 1024, MAX_MAX_BYTES)
  const timeoutMs = clamp(Math.floor(optNum(args, 'timeout_ms') ?? DEFAULT_TIMEOUT_MS), 1000, 120_000)

  /*
   * Where the URL really points, before anything is shown or sent. A hostname
   * is not evidence: `metadata.internal` and a domain whose A record is
   * 127.0.0.1 both read as ordinary web addresses on the card, and only the
   * lookup tells them apart. A destination that fails to resolve throws here,
   * so an unverifiable one is refused rather than attempted.
   */
  const destination = await classifyDestination(url)

  /*
   * Always through the gate; the policy decides whether it prompts. Reads of a
   * public page are low-stakes, but deciding that here skipped the gate outright
   * under `ask-first-time` — and `fetch` is self-approving, so nothing upstream
   * asked either. Anything that sends data is confirmed whatever the policy says.
   *
   * A non-public destination forces the card for the same reason a POST does:
   * only `POST` was forced, so under `auto-run` a GET to an internal service or
   * to an exfiltration URL ran with no card at all. The address is spelled out
   * on the card, since the host alone hides what it resolved to, and only that
   * one host is then allowed to be non-public for this request.
   */
  await requireApproval(
    ctx,
    {
      toolName: NAME,
      kind: 'fetch',
      summary: `${method} ${url.host}${url.pathname}${destination.reason ? ' — non-public address' : ''}`,
      detail: [
        `URL:    ${url.toString()}`,
        `Method: ${method}`,
        ...(destination.reason
          ? [
              'NOT ON THE PUBLIC INTERNET',
              `Host ${destination.host} resolves to ${destination.addresses.join(', ')} — ${destination.reason}.`
            ]
          : []),
        ...(method === 'POST' ? [`Body:   ${truncateEnd(body ?? '', 1000)}`] : []),
        `Limit:  ${formatBytes(maxBytes)}, ${Math.round(timeoutMs / 1000)}s`
      ].join('\n')
    },
    { force: method === 'POST' || destination.reason !== undefined }
  )

  const res = await httpRequest({
    url: url.toString(),
    method,
    headers: method === 'POST' ? { 'content-type': contentType } : {},
    body: method === 'POST' ? (body ?? '') : undefined,
    maxBytes,
    timeoutMs,
    signal: ctx.signal,
    ...(destination.reason ? { allowNonPublicHost: destination.host } : {})
  })

  const isHtml = /html|xml/i.test(res.contentType) || /^\s*<(!doctype|html)/i.test(res.body)
  let rendered: string
  if (format === 'html' || !isHtml) {
    rendered = res.body
  } else if (format === 'links') {
    const links = extractLinks(res.body, res.url)
    rendered = links.length > 0 ? links.map((l) => `- ${l.text || '(no text)'} → ${l.href}`).join('\n') : '(no links found)'
  } else {
    rendered = htmlToText(res.body)
  }

  const title = isHtml ? extractTitle(res.body) : undefined
  const header = [
    `${res.status} ${res.statusText} · ${res.contentType || 'unknown type'} · ${formatBytes(res.bytes)}${res.truncated ? ' (capped)' : ''}`,
    title ? `Title: ${title}` : '',
    res.url !== url.toString() ? `Final URL: ${res.url}` : ''
  ]
    .filter(Boolean)
    .join('\n')

  const output = `${header}\n\n${truncateEnd(rendered, MAX_OUTPUT_CHARS, 'body truncated')}`
  return {
    callId: ctx.callId ?? '',
    name: NAME,
    ok: res.status >= 200 && res.status < 400,
    output:
      res.status >= 400
        ? `${header}\n\nThe server returned an error status.\n\n${truncateEnd(rendered, 4000, 'body truncated')}`
        : output,
    detail: {
      url: res.url,
      status: res.status,
      contentType: res.contentType,
      bytes: res.bytes,
      truncated: res.truncated,
      title
    }
  }
})
