/**
 * `web_search` — DuckDuckGo's HTML endpoint, scraped. No API key, no account.
 *
 * Two endpoints are tried in order (the POST form is the most reliable, the
 * "lite" page is the fallback). Any failure degrades to a clear message telling
 * the model to use `fetch` on a known URL instead — search never hard-fails.
 */

import type { ToolSchema } from '../../../shared/types'
import { clamp, optNum, reqStr } from '../args'
import { ToolError } from '../errors'
import { defineTool } from '../results'
import { decodeEntities } from './html'
import { httpRequest } from './http'

const NAME = 'web_search'
const DEFAULT_RESULTS = 8
const MAX_RESULTS = 25
const MAX_BYTES = 1024 * 1024
const TIMEOUT_MS = 20_000

export const schema: ToolSchema = {
  name: NAME,
  description:
    'Search the web with DuckDuckGo and return titles, URLs and snippets. No API key is used. ' +
    'Follow up with the fetch tool to read any result in full.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What to search for.' },
      max_results: { type: 'number', description: `How many results to return. Default ${DEFAULT_RESULTS}.` }
    },
    required: ['query']
  },
  mutating: false
}

export interface SearchResult {
  title: string
  url: string
  snippet: string
}

export const webSearchTool = defineTool(schema, async (args, ctx) => {
  const query = reqStr(args, 'query', NAME).trim()
  const limit = clamp(Math.floor(optNum(args, 'max_results') ?? DEFAULT_RESULTS), 1, MAX_RESULTS)

  const attempts: Array<{ label: string; run: () => Promise<string> }> = [
    {
      label: 'html.duckduckgo.com',
      run: async () =>
        (
          await httpRequest({
            url: 'https://html.duckduckgo.com/html/',
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ q: query, kl: 'wt-wt' }).toString(),
            maxBytes: MAX_BYTES,
            timeoutMs: TIMEOUT_MS,
            signal: ctx.signal
          })
        ).body
    },
    {
      label: 'lite.duckduckgo.com',
      run: async () =>
        (
          await httpRequest({
            url: `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
            maxBytes: MAX_BYTES,
            timeoutMs: TIMEOUT_MS,
            signal: ctx.signal
          })
        ).body
    }
  ]

  const problems: string[] = []
  for (const attempt of attempts) {
    let html: string
    try {
      html = await attempt.run()
    } catch (err) {
      problems.push(`${attempt.label}: ${err instanceof ToolError ? err.message : String(err)}`)
      continue
    }
    if (/bots use duckduckgo|anomaly|unusual traffic/i.test(html)) {
      problems.push(`${attempt.label}: the endpoint served a bot-check page instead of results`)
      continue
    }
    const results = parseResults(html).slice(0, limit)
    if (results.length === 0) {
      problems.push(`${attempt.label}: the page contained no parseable results`)
      continue
    }
    const body = results
      .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}${r.snippet ? `\n   ${r.snippet}` : ''}`)
      .join('\n\n')
    return {
      callId: ctx.callId ?? '',
      name: NAME,
      ok: true,
      output: `${results.length} result${results.length === 1 ? '' : 's'} for "${query}":\n\n${body}`,
      detail: { query, source: attempt.label, results }
    }
  }

  return {
    callId: ctx.callId ?? '',
    name: NAME,
    ok: false,
    output:
      `Web search for "${query}" did not return usable results.\n${problems.map((p) => `- ${p}`).join('\n')}\n` +
      'DuckDuckGo rate-limits scraped requests. Wait a moment and try again, or use the fetch tool ' +
      'directly on a URL you already know.',
    detail: { query, problems }
  }
})

/** Parse both the full HTML layout and the "lite" table layout. */
export function parseResults(html: string): SearchResult[] {
  const out: SearchResult[] = []
  const seen = new Set<string>()

  const anchorRx =
    /<a\b[^>]*class="[^"]*\b(result__a|result-link)\b[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
  let match = anchorRx.exec(html)
  while (match) {
    const url = normalizeUrl(match[2])
    const title = clean(match[3])
    if (url && title && !seen.has(url)) {
      seen.add(url)
      out.push({ title, url, snippet: '' })
    }
    match = anchorRx.exec(html)
  }

  const snippetRx =
    /<(?:a|td)\b[^>]*class="[^"]*\b(result__snippet|result-snippet)\b[^"]*"[^>]*>([\s\S]*?)<\/(?:a|td)>/gi
  const snippets: string[] = []
  let sMatch = snippetRx.exec(html)
  while (sMatch) {
    snippets.push(clean(sMatch[2]))
    sMatch = snippetRx.exec(html)
  }
  for (let i = 0; i < out.length; i++) if (snippets[i]) out[i].snippet = snippets[i]

  return out
}

/** DuckDuckGo wraps outbound links as //duckduckgo.com/l/?uddg=<encoded>. */
function normalizeUrl(href: string): string {
  const raw = decodeEntities(href).trim()
  const absolute = raw.startsWith('//') ? `https:${raw}` : raw
  try {
    const url = new URL(absolute, 'https://duckduckgo.com')
    const wrapped = url.searchParams.get('uddg')
    if (wrapped) return wrapped
    if (url.hostname.endsWith('duckduckgo.com') && url.pathname.startsWith('/y.js')) return ''
    return url.toString()
  } catch {
    return ''
  }
}

function clean(fragment: string): string {
  return decodeEntities(fragment.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}
