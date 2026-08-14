/**
 * A deliberately small YAML-frontmatter reader for `SKILL.md`.
 *
 * Skills only ever need simple scalars out of the header (`name`,
 * `description`, the odd `metadata` block), so this reads exactly that and
 * ignores the rest rather than pulling in a YAML dependency:
 *
 *   key: value          plain, quoted ("…" with escapes, '…' with '' escape)
 *   key: |   /  key: >  block scalars, literal and folded
 *   key:                nested maps and sequences — consumed, not stored
 *
 * Nothing here throws: a malformed header yields whatever fields parsed cleanly.
 */

import { open } from 'node:fs/promises'

export interface SkillHead {
  fields: Record<string, string>
  /** Markdown after the frontmatter, used only for a description fallback. */
  body: string
}

/** Frontmatter is tiny; never read more than this from a skill file. */
const HEAD_BYTES = 64 * 1024

const FENCE = /^(-{3}|\.{3})\s*$/
const ENTRY = /^([A-Za-z0-9_][A-Za-z0-9_.-]*)\s*:\s?(.*)$/
/** `|`, `>`, and their chomping/indentation indicators in either order (`|-`, `>2`, `|2-`). */
const BLOCK = /^[|>][-+]?\d*[-+]?$/

/** Read the head of a skill file. Returns null when it cannot be read at all. */
export async function readSkillHead(file: string): Promise<SkillHead | null> {
  let handle
  try {
    handle = await open(file, 'r')
    const buffer = Buffer.allocUnsafe(HEAD_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, HEAD_BYTES, 0)
    return parseFrontmatter(buffer.subarray(0, bytesRead).toString('utf8'))
  } catch {
    return null
  } finally {
    await handle?.close().catch(() => {})
  }
}

export function parseFrontmatter(text: string): SkillHead {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')

  if (!FENCE.test(lines[0] ?? '')) return { fields: {}, body: normalized }

  let end = -1
  for (let i = 1; i < lines.length; i++) {
    if (FENCE.test(lines[i])) {
      end = i
      break
    }
  }
  // Unterminated header: parse what is there rather than discarding the file.
  const header = lines.slice(1, end === -1 ? lines.length : end)
  const body = end === -1 ? '' : lines.slice(end + 1).join('\n')

  return { fields: parseEntries(header), body }
}

function parseEntries(lines: string[]): Record<string, string> {
  const fields: Record<string, string> = {}
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    // Blank, comment, or a stray nested line with no owner.
    if (!line.trim() || line.trimStart().startsWith('#') || /^\s/.test(line)) {
      i++
      continue
    }

    const entry = ENTRY.exec(line)
    if (!entry) {
      i++
      continue
    }

    const [, key, rawValue] = entry
    const value = rawValue.trim()
    i++

    if (BLOCK.test(value)) {
      const { text, next } = readBlock(lines, i, value.startsWith('>'))
      fields[key] = text
      i = next
      continue
    }

    if (value === '') {
      // Nested map or sequence: consume its lines, keep the key as empty.
      while (i < lines.length && (/^\s/.test(lines[i]) || lines[i].trim() === '')) i++
      fields[key] = ''
      continue
    }

    fields[key] = unquote(value)
  }

  return fields
}

/** Collect the indented lines under a `|` or `>` scalar. */
function readBlock(lines: string[], start: number, folded: boolean): { text: string; next: number } {
  const collected: string[] = []
  let indent = -1
  let i = start

  for (; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '') {
      collected.push('')
      continue
    }
    const leading = line.length - line.trimStart().length
    if (leading === 0) break
    if (indent === -1) indent = leading
    collected.push(line.slice(Math.min(indent, leading)))
  }

  while (collected.length > 0 && collected[collected.length - 1] === '') collected.pop()
  const text = folded ? collected.join('\n').replace(/\n(?!\n)/g, ' ') : collected.join('\n')
  return { text: text.trim(), next: i }
}

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value
      .slice(1, -1)
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\(["\\])/g, '$1')
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'")
  }
  // Plain scalar: a ` #` starts a comment, per YAML.
  const comment = value.indexOf(' #')
  return (comment === -1 ? value : value.slice(0, comment)).trim()
}
