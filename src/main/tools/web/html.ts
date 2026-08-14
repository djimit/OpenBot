/**
 * HTML → text conversion.
 *
 * Deliberately regex-based and dependency-free: scripts, styles and other
 * non-content elements are removed outright (so nothing executable or invisible
 * survives into the model's context), block elements become line breaks and
 * entities are decoded.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
  euro: '€',
  pound: '£',
  yen: '¥',
  middot: '·',
  bull: '•',
  times: '×',
  divide: '÷'
}

export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (whole, body: string) => {
    if (body.startsWith('#')) {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code)
        } catch {
          return whole
        }
      }
      return whole
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole
  })
}

/** Remove everything that is not readable content. */
export function stripNonContent(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript\s*>/gi, '')
    .replace(/<template\b[^>]*>[\s\S]*?<\/template\s*>/gi, '')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg\s*>/gi, '')
    .replace(/<canvas\b[^>]*>[\s\S]*?<\/canvas\s*>/gi, '')
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe\s*>/gi, '')
    .replace(/<(nav|footer|aside)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
}

export function extractTitle(html: string): string | undefined {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  if (!match) return undefined
  const title = decodeEntities(match[1]).replace(/\s+/g, ' ').trim()
  return title || undefined
}

const BLOCK_BREAK =
  /<\/?(p|div|section|article|header|main|ul|ol|dl|dd|dt|table|thead|tbody|tfoot|form|figure|blockquote|pre)\b[^>]*>/gi

/** Convert an HTML document to readable plain text. */
export function htmlToText(html: string): string {
  let text = stripNonContent(html)

  text = text
    .replace(/<h([1-6])\b[^>]*>/gi, (_m, level: string) => `\n\n${'#'.repeat(Number(level))} `)
    .replace(/<\/h[1-6]\s*>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<hr\s*\/?>/gi, '\n---\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/li\s*>/gi, '')
    .replace(/<\/tr\s*>/gi, '\n')
    .replace(/<\/t[dh]\s*>/gi, '\t')
    .replace(BLOCK_BREAK, '\n\n')
    .replace(/<[^>]+>/g, '')

  text = decodeEntities(text)

  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Collect absolute links, for the `links` section of a fetch result. */
export function extractLinks(html: string, base: string, limit = 50): Array<{ text: string; href: string }> {
  const out: Array<{ text: string; href: string }> = []
  const rx = /<a\b[^>]*href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi
  let match = rx.exec(html)
  while (match && out.length < limit) {
    const href = match[2] ?? match[3] ?? match[4] ?? ''
    const label = decodeEntities(match[5].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
    if (href && !href.startsWith('javascript:') && !href.startsWith('#')) {
      try {
        out.push({ text: label, href: new URL(decodeEntities(href), base).toString() })
      } catch {
        /* unresolvable href */
      }
    }
    match = rx.exec(html)
  }
  return out
}
