/**
 * Disk cache for the hydrated login-shell environment.
 *
 * Spawning an interactive login shell costs real time, so the result is cached
 * and invalidated by a fingerprint over the shell binary and every rc file that
 * could change PATH, plus a hard TTL.
 */

import { createHash } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { homedir, platform } from 'node:os'
import { basename, join } from 'node:path'
import { cacheFilePath } from './userDataPaths'

export const SHELL_ENV_CACHE_FILE = 'login-shell-env.json'
export const SHELL_ENV_TTL_MS = 7 * 24 * 60 * 60 * 1000

export interface CachedShellEnv {
  fingerprint: string
  capturedAt: number
  env: Record<string, string>
}

/** Files that can alter PATH for a given shell, resolved at runtime. */
export function rcFilesFor(shellPath: string): string[] {
  const home = homedir()
  const shell = basename(shellPath)
  const common = ['/etc/profile', '/etc/paths', '/etc/environment']
  if (shell.includes('zsh')) {
    return [
      ...common,
      '/etc/zshenv',
      '/etc/zprofile',
      '/etc/zshrc',
      join(home, '.zshenv'),
      join(home, '.zprofile'),
      join(home, '.zshrc'),
      join(home, '.zlogin')
    ]
  }
  if (shell.includes('fish')) {
    return [...common, join(home, '.config', 'fish', 'config.fish')]
  }
  return [
    ...common,
    '/etc/bashrc',
    '/etc/bash.bashrc',
    join(home, '.bash_profile'),
    join(home, '.bash_login'),
    join(home, '.bashrc'),
    join(home, '.profile')
  ]
}

async function stamp(path: string): Promise<string> {
  try {
    const s = await stat(path)
    return `${path}:${Math.round(s.mtimeMs)}:${s.size}`
  } catch {
    return `${path}:-`
  }
}

/** Hash of the shell binary and every rc file that could change PATH. */
export async function shellFingerprint(shellPath: string): Promise<string> {
  const targets = [shellPath, ...rcFilesFor(shellPath)]
  const stamps = await Promise.all(targets.map(stamp))
  return createHash('sha256')
    .update(`${platform()}\n${stamps.join('\n')}`)
    .digest('hex')
    .slice(0, 32)
}

export async function readShellEnvCache(fingerprint: string): Promise<Record<string, string> | null> {
  try {
    const file = await cacheFilePath(SHELL_ENV_CACHE_FILE)
    const parsed = JSON.parse(await readFile(file, 'utf8')) as CachedShellEnv
    if (parsed.fingerprint !== fingerprint) return null
    if (!Number.isFinite(parsed.capturedAt)) return null
    if (Date.now() - parsed.capturedAt > SHELL_ENV_TTL_MS) return null
    return parsed.env && typeof parsed.env === 'object' ? parsed.env : null
  } catch {
    return null
  }
}

export async function writeShellEnvCache(
  fingerprint: string,
  env: Record<string, string>
): Promise<void> {
  try {
    const file = await cacheFilePath(SHELL_ENV_CACHE_FILE)
    const payload: CachedShellEnv = { fingerprint, capturedAt: Date.now(), env }
    await writeFile(file, JSON.stringify(payload, null, 2), 'utf8')
  } catch {
    // A cache miss next launch is the only cost — never fail hydration for this.
  }
}
