/**
 * `grep` — regular-expression search across files, with capped results.
 */

import { open, stat } from 'node:fs/promises'
import type { ToolSchema } from '../../../shared/types'
import { clamp, optBool, optEnum, optNum, optStr, reqStr } from '../args'
import { ToolError } from '../errors'
import { displayPath, resolvePath } from '../paths'
import { defineTool } from '../results'
import { looksBinary } from '../text'
import { compileGlob } from './globMatch'
import { walk } from './walk'

const NAME = 'grep'
const DEFAULT_LIMIT = 100
const MAX_LIMIT = 1000
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_MATCHES_PER_FILE = 20
const MAX_LINE_CHARS = 400

export const schema: ToolSchema = {
  name: NAME,
  description:
    'Search file contents with a JavaScript regular expression. Skips node_modules, .git, cache ' +
    'directories, binary files and files over 2 MB. Results are capped; narrow with the glob argument.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regular expression to search for.' },
      path: { type: 'string', description: 'Directory or file to search. Defaults to the working directory.' },
      glob: { type: 'string', description: 'Only search files matching this glob, e.g. "**/*.ts".' },
      case_insensitive: { type: 'boolean', description: 'Ignore case. Default false.' },
      output_mode: {
        type: 'string',
        enum: ['content', 'files'],
        description: '"content" lists matching lines (default); "files" lists matching file paths only.'
      },
      max_results: { type: 'number', description: `Maximum matches to return. Default ${DEFAULT_LIMIT}.` },
      include_ignored: { type: 'boolean', description: 'Search inside node_modules/.git/etc. Default false.' }
    },
    required: ['pattern']
  },
  mutating: false
}

interface Match {
  file: string
  line: number
  text: string
}

export const grepTool = defineTool(schema, async (args, ctx) => {
  const pattern = reqStr(args, 'pattern', NAME)
  const input = optStr(args, 'path') ?? '.'
  const globArg = optStr(args, 'glob')
  const insensitive = optBool(args, 'case_insensitive', false)
  const mode = optEnum(args, 'output_mode', ['content', 'files'] as const, 'content')
  const includeIgnored = optBool(args, 'include_ignored', false)
  const limit = clamp(Math.floor(optNum(args, 'max_results') ?? DEFAULT_LIMIT), 1, MAX_LIMIT)

  let rx: RegExp
  try {
    rx = new RegExp(pattern, insensitive ? 'i' : '')
  } catch (err) {
    throw new ToolError(
      `"${pattern}" is not a valid regular expression: ${err instanceof Error ? err.message : String(err)}`,
      'Escape regex metacharacters such as ( ) [ ] { } + * ? . | ^ $ \\ if you meant them literally.'
    )
  }

  const root = await resolvePath(ctx, input, { tool: NAME, mode: 'read' })
  const rootInfo = await stat(root)
  const fileFilter = globArg ? compileGlob(globArg) : undefined

  const matches: Match[] = []
  const files = new Set<string>()
  let scannedFiles = 0
  let capped = false

  const scan = async (absolute: string, rel: string): Promise<'stop' | undefined> => {
    if (fileFilter && !fileFilter.test(rel)) return undefined
    const found = await searchFile(absolute, rx)
    scannedFiles++
    if (found.length === 0) return undefined
    files.add(absolute)
    for (const hit of found) {
      matches.push({ file: displayPath(ctx, absolute), line: hit.line, text: hit.text })
      if (matches.length >= limit) {
        capped = true
        return 'stop'
      }
    }
    return undefined
  }

  if (rootInfo.isFile()) {
    await scan(root, root)
  } else {
    await walk({
      root,
      includeIgnored,
      forced: fileFilter?.literalSegments,
      signal: ctx.signal,
      onEntry: async (entry) => (entry.isDir ? undefined : await scan(entry.path, entry.rel))
    })
  }

  const where = displayPath(ctx, root)
  if (matches.length === 0) {
    return {
      callId: ctx.callId ?? '',
      name: NAME,
      ok: true,
      output: `No matches for /${pattern}/${insensitive ? 'i' : ''} in ${where} (${scannedFiles} files searched).`,
      detail: { pattern, root: where, matches: [], scannedFiles }
    }
  }

  const body =
    mode === 'files'
      ? [...new Set(matches.map((m) => m.file))].join('\n')
      : matches.map((m) => `${m.file}:${m.line}: ${m.text}`).join('\n')

  const note = capped ? `\n… stopped at ${limit} matches; refine the pattern or pass a glob.` : ''
  const header = `${matches.length} match${matches.length === 1 ? '' : 'es'} in ${files.size} file${files.size === 1 ? '' : 's'} (${scannedFiles} searched)`

  return {
    callId: ctx.callId ?? '',
    name: NAME,
    ok: true,
    output: `${header}\n${body}${note}`,
    detail: { pattern, root: where, matches, scannedFiles, truncated: capped }
  }
})

async function searchFile(absolute: string, rx: RegExp): Promise<Array<{ line: number; text: string }>> {
  let handle
  try {
    handle = await open(absolute, 'r')
  } catch {
    return []
  }
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size === 0 || info.size > MAX_FILE_BYTES) return []

    const sniff = Buffer.alloc(Math.min(4096, info.size))
    await handle.read(sniff, 0, sniff.length, 0)
    if (looksBinary(sniff)) return []

    const text = (await handle.readFile()).toString('utf8')
    const out: Array<{ line: number; text: string }> = []
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (!rx.test(lines[i])) continue
      const raw = lines[i].replace(/\r$/, '')
      out.push({
        line: i + 1,
        text: raw.length > MAX_LINE_CHARS ? `${raw.slice(0, MAX_LINE_CHARS)}…` : raw
      })
      if (out.length >= MAX_MATCHES_PER_FILE) break
    }
    return out
  } catch {
    return []
  } finally {
    await handle.close().catch(() => undefined)
  }
}
