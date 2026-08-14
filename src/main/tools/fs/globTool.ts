/**
 * `glob` — find files by pattern, newest first.
 */

import { lstat, stat } from 'node:fs/promises'
import type { ToolSchema } from '../../../shared/types'
import { clamp, optBool, optNum, optStr, reqStr } from '../args'
import { ToolError } from '../errors'
import { displayPath, resolvePath } from '../paths'
import { defineTool } from '../results'
import { compileGlob } from './globMatch'
import { walk } from './walk'

const NAME = 'glob'
const DEFAULT_LIMIT = 200
const MAX_LIMIT = 2000

export const schema: ToolSchema = {
  name: NAME,
  description:
    'Find files matching a glob pattern, most recently modified first. Supports *, **, ?, [abc] and ' +
    '{a,b} alternation. A pattern without a slash (e.g. "*.ts") matches at any depth. node_modules, ' +
    '.git and cache directories are skipped unless the pattern names them or include_ignored is set.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern, e.g. "src/**/*.ts" or "*.json".' },
      path: { type: 'string', description: 'Directory to search from. Defaults to the working directory.' },
      include_ignored: { type: 'boolean', description: 'Search inside node_modules/.git/etc. Default false.' },
      limit: { type: 'number', description: `Maximum matches to return. Default ${DEFAULT_LIMIT}.` }
    },
    required: ['pattern']
  },
  mutating: false
}

export const globTool = defineTool(schema, async (args, ctx) => {
  const pattern = reqStr(args, 'pattern', NAME)
  const input = optStr(args, 'path') ?? '.'
  const includeIgnored = optBool(args, 'include_ignored', false)
  const limit = clamp(Math.floor(optNum(args, 'limit') ?? DEFAULT_LIMIT), 1, MAX_LIMIT)

  const root = await resolvePath(ctx, input, { tool: NAME, mode: 'read' })
  const rootInfo = await stat(root)
  if (!rootInfo.isDirectory()) throw new ToolError(`${displayPath(ctx, root)} is not a directory.`)

  const matcher = compileGlob(pattern)
  const hits: string[] = []

  const summary = await walk({
    root,
    includeIgnored,
    forced: matcher.literalSegments,
    signal: ctx.signal,
    onEntry: (entry) => {
      if (entry.isDir) return
      if (!matcher.test(entry.rel)) return
      hits.push(entry.path)
      return hits.length >= limit ? 'stop' : undefined
    }
  })

  if (hits.length === 0) {
    return {
      callId: ctx.callId ?? '',
      name: NAME,
      ok: true,
      output:
        `No files matched "${pattern}" under ${displayPath(ctx, root)}.` +
        (summary.truncated ? ' The search stopped early on its traversal budget.' : ''),
      detail: { pattern, root, matches: [] }
    }
  }

  const withTimes = await Promise.all(
    hits.map(async (path) => ({ path, mtime: await mtimeOf(path) }))
  )
  withTimes.sort((a, b) => b.mtime - a.mtime)
  const listed = withTimes.map((h) => displayPath(ctx, h.path))

  const note =
    hits.length >= limit
      ? `\n… stopped at ${limit} matches; narrow the pattern or raise limit.`
      : summary.truncated
        ? '\n… traversal budget reached; results may be incomplete.'
        : ''

  return {
    callId: ctx.callId ?? '',
    name: NAME,
    ok: true,
    output: `${hits.length} match${hits.length === 1 ? '' : 'es'} for "${pattern}":\n${listed.join('\n')}${note}`,
    detail: { pattern, root, matches: listed, truncated: hits.length >= limit || summary.truncated }
  }
})

async function mtimeOf(path: string): Promise<number> {
  try {
    return (await lstat(path)).mtimeMs
  } catch {
    return 0
  }
}
