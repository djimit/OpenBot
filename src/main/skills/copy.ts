/**
 * The containment-checked recursive copy used when installing a skill.
 *
 * Two things a plain `fs.cp` would not do:
 *   - a symlink is followed only while its target stays inside the source
 *     folder, so a link to `/etc` or `~/.ssh` is skipped rather than copied in;
 *   - every destination path is re-checked against the destination root, so no
 *     entry name can climb out of it.
 *
 * Sockets, FIFOs and devices are skipped. A skill is a playbook, so the budget
 * caps below turn a mistaken pick (a whole home directory, say) into a clear
 * error instead of a very long copy.
 */

import { copyFile, lstat, mkdir, readdir, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'

const MAX_FILES = 2000
const MAX_BYTES = 100 * 1024 * 1024
const MAX_DEPTH = 24

interface Budget {
  files: number
  bytes: number
}

/** True when `child` is `parent` or lives underneath it. */
export function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * Copy the folder `source` to `dest`. Throws an `Error` whose message completes
 * "could not install X because …" when a budget is exceeded.
 */
export async function copyTree(source: string, dest: string): Promise<void> {
  await walk(source, dest, source, { files: 0, bytes: 0 }, 0)
}

async function walk(from: string, to: string, root: string, budget: Budget, depth: number): Promise<void> {
  if (depth > MAX_DEPTH) throw new Error(`the folder nests deeper than ${MAX_DEPTH} levels`)
  await mkdir(to, { recursive: true })

  for (const entry of await readdir(from, { withFileTypes: true })) {
    const name = entry.name
    if (name === '.' || name === '..' || name.includes(sep) || name.includes('\0')) continue

    const child = join(from, name)
    const target = join(to, name)
    if (!isInside(to, target)) continue

    const link = await lstat(child).catch(() => null)
    if (!link) continue

    let resolved = child
    if (link.isSymbolicLink()) {
      const real = await realpath(child).catch(() => null)
      if (!real || !isInside(root, real)) continue
      resolved = real
    }

    const info = await stat(resolved).catch(() => null)
    if (!info) continue

    if (info.isDirectory()) {
      await walk(resolved, target, root, budget, depth + 1)
      continue
    }
    if (!info.isFile()) continue

    budget.files += 1
    budget.bytes += info.size
    if (budget.files > MAX_FILES) throw new Error(`it holds more than ${MAX_FILES} files`)
    if (budget.bytes > MAX_BYTES) {
      throw new Error(`it is larger than ${Math.round(MAX_BYTES / 1024 / 1024)} MB`)
    }

    await copyFile(resolved, target)
  }
}
