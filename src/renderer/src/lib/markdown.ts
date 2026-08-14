import { Marked, type Token, type Tokens } from 'marked'
import hljs from 'highlight.js/lib/common'
import type { VisualizationSpec } from '../../../shared/visualization'
import type { RichCardSpec } from '../../../shared/types'
import { parseVisualization } from '../../../main/tools/visualize/normalise'
import './markdown.css'

/**
 * Markdown -> HTML for assistant output.
 * Everything is sanitized before it reaches dangerouslySetInnerHTML: the CSP
 * already blocks inline script execution, this closes the remaining gaps
 * (javascript: URLs, embedded frames, event-handler attributes, injected CSS).
 * The input is model output and therefore untrusted — treat any change here as
 * a security change, and prefer allowlists to blocklists.
 *
 * `renderMarkdownSegments` additionally lifts fenced visualisation blocks out of
 * the prose so they can be drawn as React components — see the fence section at
 * the bottom of this file.
 */

const marked = new Marked({ gfm: true, breaks: true })

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

marked.use({
  renderer: {
    code({ text, lang }: Tokens.Code): string {
      const language = (lang ?? '').trim().split(/\s+/)[0] ?? ''
      let body: string
      let label = language || 'text'
      try {
        if (language && hljs.getLanguage(language)) {
          body = hljs.highlight(text, { language, ignoreIllegals: true }).value
        } else {
          body = escapeHtml(text)
          label = language || 'text'
        }
      } catch {
        body = escapeHtml(text)
      }
      return (
        `<figure class="ob-code" data-lang="${escapeHtml(label)}">` +
        `<figcaption class="ob-code-head"><span class="ob-code-lang">${escapeHtml(label)}</span>` +
        `<button type="button" class="ob-code-copy" data-copy-code aria-label="Copy code">Copy</button>` +
        `</figcaption>` +
        `<pre class="ob-code-body"><code class="hljs">${body}</code></pre>` +
        `</figure>`
      )
    },
    link({ href, title, tokens }): string {
      const text = this.parser.parseInline(tokens)
      const safe = /^(https?:|mailto:|file:)/i.test(href) ? href : ''
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : ''
      if (!safe) return `<span>${text}</span>`
      return `<a href="${escapeHtml(safe)}"${titleAttr} target="_blank" rel="noreferrer noopener">${text}</a>`
    }
  }
})

const HTML_NS = 'http://www.w3.org/1999/xhtml'

/**
 * Elements that never survive. The last group holds content the parser treats as
 * raw text — a tree walker cannot see inside it, and two parsers disagree about
 * where it ends, which is the whole recipe for a mutation XSS.
 */
const BLOCKED = new Set([
  'SCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'BASE', 'FORM', 'STYLE', 'FRAME', 'FRAMESET',
  'TEMPLATE', 'NOSCRIPT', 'NOEMBED', 'NOFRAMES', 'XMP', 'PLAINTEXT'
])
/** Attributes with no legitimate use in generated markdown and a hostile one available. */
const DROPPED = new Set(['style', 'ping', 'srcdoc', 'formaction', 'action', 'background'])
const URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'poster', 'data'])
const SCHEMES = new Set(['http', 'https', 'mailto', 'file'])

/**
 * Whether a URL attribute may stay.
 *
 * The scheme is read after stripping whitespace and control characters, because
 * `java&#9;script:` is a working URL in every browser and a miss for a regex
 * anchored on the literal word. Anything unrecognised is dropped rather than
 * matched against a blocklist; the one exception is an inline image, which
 * cannot execute script from an `<img>`.
 *
 * A relative link is refused too, and not for script: `will-navigate` lets
 * same-origin URLs through, so one click on a model-authored `<a href="/">`
 * replaces the app shell with a blank page and nothing brings it back. The
 * markdown link renderer above already refuses them; raw HTML gets the same
 * rule. Fragments stay, since they only scroll.
 */
function safeUrl(name: string, value: string): boolean {
  const flat = value.replace(/[\s\u0000-\u001f\u007f]/g, '').toLowerCase()
  const colon = flat.indexOf(':')
  const slash = flat.indexOf('/')
  const linky = name === 'href' || name === 'xlink:href'
  if (colon === -1 || (slash !== -1 && slash < colon)) return linky ? flat.startsWith('#') : true
  if (SCHEMES.has(flat.slice(0, colon))) return true
  return name === 'src' && /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/.test(flat)
}

function sanitize(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT)
  const doomed: Element[] = []
  const seen: Element[] = []
  let node = walker.nextNode()
  while (node) {
    const el = node as Element
    // `tagName` is only uppercased for HTML elements, so a blocklist of capitals
    // never saw `<svg><style>` or `<svg><script>`. Foreign content goes wholesale:
    // markdown has no need for SVG or MathML, and both carry vectors of their own
    // (SMIL rewriting an href, `<use>` pulling in another document).
    if (el.namespaceURI !== HTML_NS || BLOCKED.has(el.tagName.toUpperCase())) doomed.push(el)
    else seen.push(el)
    node = walker.nextNode()
  }
  for (const el of doomed) el.remove()
  for (const el of seen) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase()
      if (name.startsWith('on') || DROPPED.has(name)) el.removeAttribute(attr.name)
      else if (URL_ATTRS.has(name) && !safeUrl(name, attr.value)) el.removeAttribute(attr.name)
    }
  }
  return doc.body.innerHTML
}

/** Renders trusted-ish model markdown to sanitized HTML. */
export function renderMarkdown(source: string): string {
  if (!source) return ''
  try {
    const html = marked.parse(source, { async: false })
    return sanitize(typeof html === 'string' ? html : String(html))
  } catch {
    return `<p>${escapeHtml(source)}</p>`
  }
}

/** Highlights a standalone snippet (used by tool output / approval previews). */
export function highlightCode(code: string, language?: string): string {
  try {
    if (language && hljs.getLanguage(language)) {
      return hljs.highlight(code, { language, ignoreIllegals: true }).value
    }
  } catch {
    /* fall through to plain text */
  }
  return escapeHtml(code)
}

export { escapeHtml }

/* ── Fenced visualisations ────────────────────────────────────────────
 *
 * Most OpenBOT backends are agent CLIs that only ever hand us text, and several
 * cannot call tools at all. A fenced block is therefore the only route those
 * models have to a chart, which makes this path — not the `visualize` tool — the
 * one that has to be reliable.
 *
 * The tags are aliases of one another; `visualization` is accepted because it is
 * what a model guesses unprompted, and a trailing ` json` because editors and
 * models alike add it for syntax highlighting.
 */

const VISUALIZATION_LANGS = new Set(['openbot-widget', 'openbot-viz', 'visualization'])
const CARD_LANGS = new Set(['openbot-card', 'grokbot-card'])

/** The first word of a fence's info string, lowercased. `''` for anything else. */
function fenceTag(token: Token): string {
  if (token.type !== 'code') return ''
  return ((token as Tokens.Code).lang ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? ''
}

export type MarkdownSegment =
  | { kind: 'html'; html: string }
  | { kind: 'visualization'; spec: VisualizationSpec }
  | { kind: 'card'; spec: RichCardSpec }

function pushProse(into: MarkdownSegment[], source: string): void {
  if (source.trim() === '') return
  into.push({ kind: 'html', html: renderMarkdown(source) })
}

/**
 * Split assistant output into prose and charts.
 *
 * Blocks are found by markdown's own tokenizer rather than by a regex over the
 * text, because a regex cannot tell a fence from a fence *quoted inside another
 * fence* — a model documenting this feature in a ````markdown block used to have
 * its example eaten and the surrounding block torn in half. Going through the
 * lexer also picks up `~~~` and four-backtick fences for free.
 *
 * A block whose body is not a JSON object is put back verbatim and renders as an
 * ordinary code block. Half a chart is worse than no chart, and a blank message
 * is worse than both.
 */
export function renderMarkdownSegments(source: string): MarkdownSegment[] {
  if (!source) return []

  let tokens: Token[]
  try {
    tokens = marked.lexer(source)
  } catch {
    return [{ kind: 'html', html: renderMarkdown(source) }]
  }

  const segments: MarkdownSegment[] = []
  let prose = ''
  for (const token of tokens) {
    const card = CARD_LANGS.has(fenceTag(token)) ? parseCard((token as Tokens.Code).text) : null
    if (card) {
      pushProse(segments, prose)
      prose = ''
      segments.push({ kind: 'card', spec: card })
      continue
    }
    const spec = VISUALIZATION_LANGS.has(fenceTag(token))
      ? parseVisualization((token as Tokens.Code).text)
      : null
    if (!spec) {
      prose += token.raw
      continue
    }
    pushProse(segments, prose)
    prose = ''
    segments.push({ kind: 'visualization', spec })
  }
  pushProse(segments, prose)

  return segments.length > 0 ? segments : [{ kind: 'html', html: renderMarkdown(source) }]
}

function parseCard(raw: string): RichCardSpec | null {
  let value: unknown
  try { value = JSON.parse(raw) } catch { return null }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const card = value as Record<string, unknown>
  const text = (key: string, max = 20_000): string => typeof card[key] === 'string' ? card[key].slice(0, max) : ''
  /*
   * Every element is truncated as well as the array bounded. Capping the length
   * alone still let one 100k-character "recipient" through, and each entry is
   * rendered into the DOM and pasted into a mailto: URL — so the cost of an
   * unbounded element is a wedged card and an unusable draft. 320 characters is
   * longer than any real address or channel name, and matches `text()` beside it
   * in refusing to trust a field's length.
   */
  const list = (key: string, max = 320): string[] => Array.isArray(card[key]) ? card[key].filter((item): item is string => typeof item === 'string').slice(0, 50).map((item: string) => item.slice(0, max)) : []
  if (card['type'] === 'email-draft') return { type: 'email-draft', to: list('to'), cc: list('cc'), subject: text('subject', 500), body: text('body') }
  if (card['type'] === 'message-draft') return { type: 'message-draft', service: text('service', 100) || 'Message', channel: text('channel', 200) || undefined, body: text('body') }
  if (card['type'] === 'link') {
    const url = text('url', 4096)
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
      const safe = parsed.toString()
      return { type: 'link', title: text('title', 500) || safe, description: text('description', 2000) || undefined, url: safe }
    } catch {
      return null
    }
  }
  return null
}
