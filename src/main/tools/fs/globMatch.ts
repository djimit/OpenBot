/**
 * Glob-to-RegExp translation (no dependencies).
 *
 * Supported: `*` (within a segment), `**` (across segments), `?`, character
 * classes `[a-z]` / `[!a-z]`, and brace alternation `{ts,tsx}` including
 * nesting. Everything else is matched literally.
 */

const REGEX_SPECIALS = /[.+^${}()|[\]\\]/g

function escapeLiteral(ch: string): string {
  return ch.replace(REGEX_SPECIALS, '\\$&')
}

/** Translate one glob pattern into an anchored regular expression source. */
export function globToRegExpSource(glob: string): string {
  let out = ''
  let i = 0
  let braceDepth = 0

  while (i < glob.length) {
    const ch = glob[i]

    if (ch === '\\' && i + 1 < glob.length) {
      out += escapeLiteral(glob[i + 1])
      i += 2
      continue
    }

    if (ch === '*') {
      const isDouble = glob[i + 1] === '*'
      if (isDouble) {
        const followedBySlash = glob[i + 2] === '/'
        if (followedBySlash) {
          out += '(?:[^/]+/)*'
          i += 3
        } else {
          out += '.*'
          i += 2
        }
      } else {
        out += '[^/]*'
        i += 1
      }
      continue
    }

    if (ch === '?') {
      out += '[^/]'
      i++
      continue
    }

    if (ch === '[') {
      const close = findClosingBracket(glob, i)
      if (close === -1) {
        out += '\\['
        i++
        continue
      }
      let body = glob.slice(i + 1, close)
      if (body.startsWith('!')) body = `^${body.slice(1)}`
      out += `[${body.replace(/\\/g, '\\\\')}]`
      i = close + 1
      continue
    }

    if (ch === '{') {
      braceDepth++
      out += '(?:'
      i++
      continue
    }

    if (ch === '}' && braceDepth > 0) {
      braceDepth--
      out += ')'
      i++
      continue
    }

    if (ch === ',' && braceDepth > 0) {
      out += '|'
      i++
      continue
    }

    out += escapeLiteral(ch)
    i++
  }

  while (braceDepth-- > 0) out += ')'
  return `^${out}$`
}

function findClosingBracket(glob: string, open: number): number {
  for (let i = open + 1; i < glob.length; i++) {
    if (glob[i] === '\\') {
      i++
      continue
    }
    if (glob[i] === ']' && i > open + 1) return i
  }
  return -1
}

export interface GlobMatcher {
  test(relPosixPath: string): boolean
  /** Literal path segments named by the pattern, so the walker can un-prune them. */
  literalSegments: ReadonlySet<string>
}

export function compileGlob(glob: string): GlobMatcher {
  const pattern = glob.trim()
  // A bare `*.ts` should match at any depth — that is what users expect.
  const normalized = pattern.includes('/') ? pattern : `**/${pattern}`
  let rx: RegExp
  try {
    rx = new RegExp(globToRegExpSource(normalized))
  } catch {
    rx = new RegExp(`^${normalized.replace(REGEX_SPECIALS, '\\$&').replace(/\*/g, '.*')}$`)
  }
  const literalSegments = new Set(
    pattern
      .split('/')
      .filter((seg) => seg.length > 0 && !/[*?[\]{}]/.test(seg))
  )
  return {
    test: (rel: string): boolean => rx.test(rel),
    literalSegments
  }
}
