/**
 * `osascript` plumbing for the local computer provider.
 *
 * Two dialects are used:
 *  - AppleScript (`-e` per line) drives System Events for clicks and keys.
 *  - JavaScript for Automation (`-l JavaScript`, from a temp file so the script
 *    can take arguments) reaches CoreGraphics for real scroll-wheel and drag
 *    events, which System Events has no vocabulary for.
 *
 * Every failure is classified: a missing TCC grant becomes an actionable
 * permission message, anything else becomes a plain automation error.
 */

import { randomUUID } from 'node:crypto'
import { unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execCapture } from '../exec'
import { commandError, detectPermissionFailure, permissionError } from './localPermissions'

const OSASCRIPT = '/usr/bin/osascript'
const DEFAULT_TIMEOUT_MS = 20_000

export interface ScriptOptions {
  /** Used in error messages, e.g. "Clicking at (12, 34)". */
  what: string
  timeoutMs?: number
  signal?: AbortSignal
}

/** Escape a JS/AppleScript string body: backslashes and double quotes. */
export function escapeForScript(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/** Run AppleScript statements, one `-e` argument per line. */
export async function runAppleScript(lines: string[], opts: ScriptOptions): Promise<string> {
  const args: string[] = []
  for (const line of lines) args.push('-e', line)
  const res = await execCapture(OSASCRIPT, args, {
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    signal: opts.signal,
    maxOutputChars: 20_000
  })

  if (res.spawnError) throw commandError(opts.what, res.spawnError, null)
  if (res.timedOut) throw commandError(opts.what, 'osascript did not return in time', null)
  if (res.code !== 0) {
    const permission = detectPermissionFailure(res.stderr, res.code)
    if (permission) throw permissionError(permission, `${opts.what}:`)
    throw commandError(opts.what, res.stderr, res.code)
  }
  return res.stdout.trim()
}

/**
 * Run a JXA script that defines `function run(argv)`. The script is written to
 * a temp file because `-e` gives `run()` no arguments.
 */
export async function runJxa(source: string, args: string[], opts: ScriptOptions): Promise<string> {
  const file = join(tmpdir(), `openbot-jxa-${randomUUID()}.js`)
  await writeFile(file, source, 'utf8')
  try {
    const res = await execCapture(OSASCRIPT, ['-l', 'JavaScript', file, ...args], {
      timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      signal: opts.signal,
      maxOutputChars: 20_000
    })
    if (res.spawnError) throw commandError(opts.what, res.spawnError, null)
    if (res.timedOut) throw commandError(opts.what, 'osascript did not return in time', null)
    if (res.code !== 0) {
      const permission = detectPermissionFailure(res.stderr, res.code)
      if (permission) throw permissionError(permission, `${opts.what}:`)
      throw commandError(opts.what, res.stderr, res.code)
    }
    return res.stdout.trim()
  } finally {
    await unlink(file).catch(() => undefined)
  }
}

/**
 * Best-effort JXA: returns `undefined` instead of throwing, for the
 * CoreGraphics paths that have a System Events fallback. A missing permission
 * is still surfaced, because retrying the fallback would fail the same way.
 */
export async function tryJxa(source: string, args: string[], opts: ScriptOptions): Promise<string | undefined> {
  try {
    return await runJxa(source, args, opts)
  } catch (err) {
    if (err instanceof Error && err.message.includes('Privacy & Security')) throw err
    return undefined
  }
}
