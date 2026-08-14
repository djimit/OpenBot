/**
 * `list_dir` — list a directory, optionally a few levels deep.
 */

import { lstat, stat } from 'node:fs/promises'
import type { ToolSchema } from '../../../shared/types'
import { clamp, optBool, optNum, optStr } from '../args'
import { ToolError } from '../errors'
import { displayPath, resolvePath } from '../paths'
import { defineTool } from '../results'
import { formatBytes } from '../text'
import { walk, type WalkEntry } from './walk'

const NAME = 'list_dir'
const DEFAULT_LIMIT = 400
const MAX_LIMIT = 2000

export const schema: ToolSchema = {
  name: NAME,
  description:
    'List the contents of a directory. Directories are marked with a trailing slash. Noise directories ' +
    '(node_modules, .git, caches) are skipped when recursing unless include_ignored is set.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Directory to list. Defaults to the working directory.' },
      depth: { type: 'number', description: 'Levels to descend. 1 = this directory only. Default 1, max 6.' },
      all: { type: 'boolean', description: 'Include dotfiles. Default false.' },
      include_ignored: { type: 'boolean', description: 'Descend into node_modules/.git/etc. Default false.' },
      limit: { type: 'number', description: `Maximum entries to return. Default ${DEFAULT_LIMIT}.` }
    }
  },
  mutating: false
}

export const listDirTool = defineTool(schema, async (args, ctx) => {
  const input = optStr(args, 'path') ?? '.'
  const depth = clamp(Math.floor(optNum(args, 'depth') ?? 1), 1, 6)
  const showAll = optBool(args, 'all', false)
  const includeIgnored = optBool(args, 'include_ignored', false)
  const limit = clamp(Math.floor(optNum(args, 'limit') ?? DEFAULT_LIMIT), 1, MAX_LIMIT)

  const absolute = await resolvePath(ctx, input, { tool: NAME, mode: 'read' })
  const shown = displayPath(ctx, absolute)
  const info = await stat(absolute)
  if (!info.isDirectory()) {
    throw new ToolError(`${shown} is not a directory.`, 'Use read_file for files.')
  }

  const rows: Array<{ rel: string; isDir: boolean; size: number; mtime: number }> = []
  const summary = await walk({
    root: absolute,
    maxDepth: depth,
    includeIgnored,
    signal: ctx.signal,
    maxEntries: MAX_LIMIT * 4,
    onEntry: async (entry: WalkEntry) => {
      if (!showAll && entry.name.startsWith('.')) return
      const size = entry.isDir ? 0 : await sizeOf(entry.path)
      const mtime = await mtimeOf(entry.path)
      rows.push({ rel: entry.rel, isDir: entry.isDir, size, mtime })
      return rows.length >= limit ? 'stop' : undefined
    }
  })

  if (rows.length === 0) {
    return {
      callId: ctx.callId ?? '',
      name: NAME,
      ok: true,
      output: `${shown}/ is empty${showAll ? '' : ' (dotfiles hidden — pass all: true to include them)'}.`,
      detail: { path: shown, absolute, entries: [] }
    }
  }

  rows.sort((a, b) => (a.isDir === b.isDir ? a.rel.localeCompare(b.rel) : a.isDir ? -1 : 1))
  const lines = rows.map((r) =>
    r.isDir ? `${r.rel}/` : `${r.rel}${'  '}${formatBytes(r.size).padStart(9)}`
  )
  const note = summary.truncated || rows.length >= limit ? `\n… list truncated at ${rows.length} entries.` : ''

  return {
    callId: ctx.callId ?? '',
    name: NAME,
    ok: true,
    output: `${shown}/ — ${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}\n${lines.join('\n')}${note}`,
    detail: { path: shown, absolute, entries: rows, truncated: summary.truncated }
  }
})

async function sizeOf(path: string): Promise<number> {
  try {
    return (await lstat(path)).size
  } catch {
    return 0
  }
}

async function mtimeOf(path: string): Promise<number> {
  try {
    return (await lstat(path)).mtimeMs
  } catch {
    return 0
  }
}
