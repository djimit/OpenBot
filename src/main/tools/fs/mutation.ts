/** Conflict-aware, symlink-stable commits shared by file mutation tools. */

import { createHash, randomBytes } from 'node:crypto'
import { open, readFile, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { ToolError } from '../errors'
import { resolvedTargetPath } from '../paths'

export interface MutationSnapshot {
  /** Lexical path named by the tool. */
  requestedPath: string
  /** Physical path approved at snapshot time; symlinks are already resolved. */
  resolvedPath: string
  exists: boolean
  isDirectory: boolean
  bytes?: Buffer
  digest?: string
  mode?: number
  identity?: string
}

const tails = new Map<string, Promise<void>>()

async function withKeyLock<T>(key: string, run: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve()
  let release: () => void = () => undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const tail = previous.catch(() => undefined).then(() => gate)
  tails.set(key, tail)
  await previous.catch(() => undefined)
  try {
    return await run()
  } finally {
    release()
    if (tails.get(key) === tail) tails.delete(key)
  }
}

/**
 * Serialize every in-process mutation that resolves to the same physical path.
 * Recheck after joining the queue: if a symlink changed while waiting, release
 * the obsolete lock and acquire the new target before any preview is read.
 */
export async function withMutationLock<T>(
  requestedPath: string,
  run: (resolvedPath: string) => Promise<T>
): Promise<T> {
  while (true) {
    const key = await resolvedTargetPath(requestedPath)
    const result = await withKeyLock(key, async () => {
      if (await resolvedTargetPath(requestedPath) !== key) return { retry: true } as const
      return { retry: false, value: await run(key) } as const
    })
    if (!result.retry) return result.value
  }
}

function digest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Read the exact state a diff/preview is based on. */
export async function snapshotMutationTarget(
  requestedPath: string,
  lockedResolvedPath?: string
): Promise<MutationSnapshot> {
  const resolvedPath = lockedResolvedPath ?? await resolvedTargetPath(requestedPath)
  try {
    const before = await stat(resolvedPath, { bigint: true })
    if (before.isDirectory()) {
      return { requestedPath, resolvedPath, exists: true, isDirectory: true }
    }
    const bytes = await readFile(resolvedPath)
    const after = await stat(resolvedPath, { bigint: true })
    return {
      requestedPath,
      resolvedPath,
      exists: true,
      isDirectory: false,
      bytes,
      digest: digest(bytes),
      mode: Number(after.mode & 0o777n),
      identity: `${after.dev}:${after.ino}:${after.size}:${after.mtimeNs}`
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { requestedPath, resolvedPath, exists: false, isDirectory: false }
    }
    throw err
  }
}

function sameSnapshot(left: MutationSnapshot, right: MutationSnapshot): boolean {
  if (left.resolvedPath !== right.resolvedPath) return false
  if (left.exists !== right.exists || left.isDirectory !== right.isDirectory) return false
  if (!left.exists) return true
  return left.digest === right.digest && left.identity === right.identity
}

async function assertUnchanged(expected: MutationSnapshot): Promise<void> {
  const current = await snapshotMutationTarget(expected.requestedPath)
  if (sameSnapshot(expected, current)) return
  throw new ToolError(
    `Refused to overwrite ${expected.requestedPath}: it changed after the preview was prepared.`,
    'Read the file again and prepare a new edit so the user can approve the current contents.'
  )
}

/**
 * Revalidate the approved snapshot and atomically replace its physical target.
 * A second validation occurs after the temp file is durable, immediately before
 * rename, so approval wait time and temp-file I/O cannot hide another writer.
 */
export async function commitMutation(expected: MutationSnapshot, content: string): Promise<void> {
  await assertUnchanged(expected)
  const parent = dirname(expected.resolvedPath)
  const tmp = join(
    parent,
    `.${basename(expected.resolvedPath)}.${process.pid}.${randomBytes(6).toString('hex')}.openbot-tmp`
  )
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(tmp, 'wx', expected.mode ?? 0o666)
    await handle.writeFile(content, 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined
    await assertUnchanged(expected)
    await rename(tmp, expected.resolvedPath)
  } catch (err) {
    await handle?.close().catch(() => undefined)
    await rm(tmp, { force: true }).catch(() => undefined)
    throw err
  }
}
