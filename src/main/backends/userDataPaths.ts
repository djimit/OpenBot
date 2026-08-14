/**
 * Where this layer keeps its caches.
 *
 * Resolved at runtime from Electron's userData directory (or the OS temp dir
 * when running outside Electron) — never a hardcoded home path.
 */

import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let cacheDirPromise: Promise<string> | undefined

async function resolveUserData(): Promise<string> {
  try {
    const electron = await import('electron')
    const path = electron.app?.getPath('userData')
    if (path) return path
  } catch {
    // Not running inside Electron (tests, scripts) — fall through.
  }
  return join(tmpdir(), 'openbot')
}

/** Create (once) and return the backend cache directory. */
export async function backendCacheDir(): Promise<string> {
  cacheDirPromise ??= (async () => {
    const dir = join(await resolveUserData(), 'cache')
    await mkdir(dir, { recursive: true }).catch(() => undefined)
    return dir
  })()
  return cacheDirPromise
}

export async function cacheFilePath(name: string): Promise<string> {
  return join(await backendCacheDir(), name)
}
