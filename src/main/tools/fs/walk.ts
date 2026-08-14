/**
 * Directory traversal with the shared ignore list.
 *
 * `glob`, `grep` and recursive `list_dir` all walk through here so they agree
 * on what is noise (`node_modules`, `.git`, caches …) and so a single entry
 * budget protects every one of them from a runaway tree.
 *
 * Containment lives here too: an entry whose real path leaves the root is never
 * reported, so a caller cannot read or name a file through a link that points
 * out of the workspace.
 */

import { readdir, realpath } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { isInside } from '../containment'

/** Directories skipped unless the caller opts in or names one explicitly. */
export const IGNORED_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  '.venv',
  'venv',
  '__pycache__',
  '.mypy_cache',
  '.pytest_cache',
  '.cache',
  '.next',
  '.nuxt',
  '.turbo',
  '.parcel-cache',
  'coverage',
  '.idea',
  '.gradle',
  'Pods',
  'DerivedData'
])

export interface WalkEntry {
  /** Absolute path. */
  path: string
  /** Path relative to the walk root, always with `/` separators. */
  rel: string
  name: string
  isDir: boolean
  isSymlink: boolean
  depth: number
}

export interface WalkOptions {
  root: string
  /** 1 = direct children only. Default Infinity. */
  maxDepth?: number
  /** Stop after this many visited entries. Default 200_000. */
  maxEntries?: number
  /** Walk into normally-ignored directories too. */
  includeIgnored?: boolean
  /** Names that must never be pruned even when ignored by default. */
  forced?: ReadonlySet<string>
  /** Wall-clock budget in ms. Default 15_000. */
  timeBudgetMs?: number
  signal?: AbortSignal
  /** Return `'stop'` to end the walk early (e.g. a result cap was hit). */
  onEntry(entry: WalkEntry): void | 'stop' | Promise<void | 'stop'>
}

export interface WalkSummary {
  scanned: number
  /** True when the walk ended on a budget rather than finishing the tree. */
  truncated: boolean
}

export async function walk(opts: WalkOptions): Promise<WalkSummary> {
  const maxDepth = opts.maxDepth ?? Number.POSITIVE_INFINITY
  const maxEntries = opts.maxEntries ?? 200_000
  const deadline = Date.now() + (opts.timeBudgetMs ?? 15_000)
  const stack: Array<{ dir: string; depth: number }> = [{ dir: opts.root, depth: 0 }]
  const realRoot = await realRootOf(opts.root)
  let scanned = 0
  let truncated = false

  while (stack.length > 0) {
    const current = stack.pop() as { dir: string; depth: number }
    if (opts.signal?.aborted) return { scanned, truncated: true }
    if (Date.now() > deadline) return { scanned, truncated: true }

    let entries
    try {
      entries = await readdir(current.dir, { withFileTypes: true })
    } catch {
      continue // unreadable directory: skip rather than fail the whole walk
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))

    for (const dirent of entries) {
      if (scanned >= maxEntries) return { scanned, truncated: true }
      const abs = join(current.dir, dirent.name)
      const isSymlink = dirent.isSymbolicLink()
      const isDir = dirent.isDirectory()
      scanned++

      /*
       * A symlink is only handed out once its real target is known to be inside
       * the root. `readdir` reports a symlink-to-file as `isDir: false`, so the
       * directory guard below never saw it and `grep` opened it: a workspace
       * containing `leak -> ~/.ssh/id_rsa` returned the key with no approval,
       * while `read_file` on the same path still asked. Only symlinks pay the
       * `realpath` cost — nothing under an already-contained real directory can
       * escape without one, since directory symlinks are never descended.
       */
      if (isSymlink && !(await staysInside(realRoot, abs))) continue

      const entry: WalkEntry = {
        path: abs,
        rel: toPosix(relative(opts.root, abs)),
        name: dirent.name,
        isDir,
        isSymlink,
        depth: current.depth + 1
      }
      const verdict = await opts.onEntry(entry)
      if (verdict === 'stop') return { scanned, truncated: true }

      if (!isDir || isSymlink) continue // never follow directory symlinks: cycles
      if (current.depth + 1 >= maxDepth) continue
      if (!opts.includeIgnored && IGNORED_DIRS.has(dirent.name) && !opts.forced?.has(dirent.name)) continue
      stack.push({ dir: abs, depth: current.depth + 1 })
    }
  }
  return { scanned, truncated }
}

export function toPosix(p: string): string {
  return sep === '/' ? p : p.split(sep).join('/')
}

/**
 * Real path of the walk root, resolved once.
 *
 * Both sides of the containment test have to be real paths: a workspace usually
 * sits under a symlinked ancestor on macOS (/tmp, /var and /etc all are), and
 * comparing a resolved entry against the lexical root would then reject every
 * link inside the workspace as an escape.
 */
async function realRootOf(root: string): Promise<string> {
  try {
    return await realpath(root)
  } catch {
    return resolve(root) // unresolvable root: `readdir` is about to fail anyway
  }
}

/** True when the link resolves inside the root. A broken link fails closed. */
async function staysInside(realRoot: string, link: string): Promise<boolean> {
  try {
    return isInside(realRoot, await realpath(link))
  } catch {
    return false
  }
}
