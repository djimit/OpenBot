/**
 * Input injection for the local (this-Mac) provider.
 *
 * Clicks and keystrokes go through System Events (`click at {x, y}`,
 * `keystroke`, `key code`) exactly as AppleScript intends. Scrolling and
 * dragging have no System Events equivalent, so they post CoreGraphics events
 * through JXA; if that bridge is unavailable, scrolling falls back to page/arrow
 * keys and dragging reports why it could not run.
 *
 * All coordinates here are global display points, already mapped out of image
 * space by the provider.
 */

import type { MouseButton } from '../../../shared/types'
import { execCapture } from '../exec'
import { ToolError } from '../errors'
import { CLICK_JXA, DRAG_JXA, MOVE_JXA, SCROLL_JXA } from './localCgScripts'
import { modifierClause, parseCombo, type ParsedCombo } from './localKeymap'
import { escapeForScript, runAppleScript, tryJxa } from './localOsascript'
import { commandError } from './localPermissions'

const OPEN = '/usr/bin/open'
/** `keystroke` gets unreliable with very long strings, so text is chunked. */
const TYPE_CHUNK_CHARS = 180

export interface Point {
  x: number
  y: number
}

export interface InputOptions {
  signal?: AbortSignal
}

const BUTTON_INDEX: Record<MouseButton, number> = { left: 0, right: 1, middle: 2 }

export async function moveTo(point: Point, opts: InputOptions = {}): Promise<void> {
  const done = await tryJxa(MOVE_JXA, [fmt(point.x), fmt(point.y)], {
    what: `Moving the pointer to (${fmt(point.x)}, ${fmt(point.y)})`,
    signal: opts.signal
  })
  if (done) return
  // System Events cannot move the pointer without clicking; say so plainly.
  throw new ToolError(
    'Could not move the pointer: the CoreGraphics event bridge is unavailable on this system.',
    'Click directly at the target coordinates instead of moving first.'
  )
}

export async function clickAt(
  point: Point,
  button: MouseButton = 'left',
  clickCount = 1,
  opts: InputOptions = {}
): Promise<void> {
  const what = `${clickCount > 1 ? `${clickCount}× ` : ''}${button} click at (${fmt(point.x)}, ${fmt(point.y)})`
  const x = fmt(point.x)
  const y = fmt(point.y)

  if (button === 'left') {
    // System Events is the documented path and works in most apps.
    const lines: string[] = []
    for (let i = 0; i < clickCount; i++) {
      if (i > 0) lines.push('delay 0.06')
      lines.push(`tell application "System Events" to click at {${x}, ${y}}`)
    }
    try {
      await runAppleScript(lines, { what, signal: opts.signal })
      return
    } catch (err) {
      // A permission problem will fail the same way through CoreGraphics.
      if (err instanceof ToolError && err.text.includes('Privacy & Security')) throw err
    }
  }

  const done = await tryJxa(CLICK_JXA, [x, y, String(BUTTON_INDEX[button]), String(clickCount)], {
    what,
    signal: opts.signal
  })
  if (done) return

  if (button === 'right') {
    // Control-click is macOS's own right-click equivalent.
    await runAppleScript(
      [
        'tell application "System Events"',
        '  key down control',
        `  click at {${x}, ${y}}`,
        '  key up control',
        'end tell'
      ],
      { what, signal: opts.signal }
    )
    return
  }
  throw commandError(what, 'neither System Events nor CoreGraphics accepted the click', null)
}

export async function typeText(text: string, opts: InputOptions = {}): Promise<void> {
  if (text === '') return
  const lines: string[] = []
  // Split on newlines and tabs: `keystroke` cannot carry either.
  for (const [index, segment] of text.split('\n').entries()) {
    if (index > 0) lines.push('tell application "System Events" to key code 36')
    for (const [tabIndex, piece] of segment.split('\t').entries()) {
      if (tabIndex > 0) lines.push('tell application "System Events" to key code 48')
      for (const chunk of chunkText(piece, TYPE_CHUNK_CHARS)) {
        lines.push(`tell application "System Events" to keystroke "${escapeForScript(chunk)}"`)
      }
    }
  }
  await runAppleScript(lines, {
    what: `Typing ${text.length} character${text.length === 1 ? '' : 's'}`,
    timeoutMs: Math.min(120_000, 20_000 + text.length * 40),
    signal: opts.signal
  })
}

export async function pressKey(combo: string, opts: InputOptions = {}): Promise<ParsedCombo> {
  const parsed = parseCombo(combo)
  const using = modifierClause(parsed.modifiers)
  const statement =
    parsed.keyCode !== undefined
      ? `key code ${parsed.keyCode}${using}`
      : `keystroke "${escapeForScript(parsed.character ?? '')}"${using}`
  await runAppleScript([`tell application "System Events" to ${statement}`], {
    what: `Pressing ${parsed.label}`,
    signal: opts.signal
  })
  return parsed
}

export async function scrollAt(point: Point, dx: number, dy: number, opts: InputOptions = {}): Promise<void> {
  const what = `Scrolling (${dx}, ${dy}) at (${fmt(point.x)}, ${fmt(point.y)})`
  const done = await tryJxa(SCROLL_JXA, [fmt(point.x), fmt(point.y), String(Math.round(dx)), String(Math.round(dy))], {
    what,
    signal: opts.signal
  })
  if (done) return

  // Keyboard fallback: page keys for long distances, arrows for short ones.
  const vertical = Math.abs(dy) >= Math.abs(dx)
  const distance = vertical ? dy : dx
  if (distance === 0) return
  const usePage = Math.abs(distance) >= 300
  const keyCode = vertical
    ? usePage
      ? distance > 0
        ? 121
        : 116
      : distance > 0
        ? 125
        : 126
    : distance > 0
      ? 124
      : 123
  const repeats = Math.max(1, Math.min(20, Math.round(Math.abs(distance) / (usePage ? 600 : 60))))
  const lines: string[] = []
  for (let i = 0; i < repeats; i++) lines.push(`tell application "System Events" to key code ${keyCode}`)
  await runAppleScript(lines, { what: `${what} (keyboard fallback)`, signal: opts.signal })
}

export async function dragBetween(from: Point, to: Point, opts: InputOptions = {}): Promise<void> {
  const what = `Dragging from (${fmt(from.x)}, ${fmt(from.y)}) to (${fmt(to.x)}, ${fmt(to.y)})`
  const done = await tryJxa(DRAG_JXA, [fmt(from.x), fmt(from.y), fmt(to.x), fmt(to.y)], {
    what,
    signal: opts.signal
  })
  if (done) return
  throw new ToolError(
    `${what} failed: dragging needs the CoreGraphics event bridge, which this system did not provide.`,
    'System Events can click but cannot press-move-release. Try the same result with clicks and keyboard shortcuts (for example select, then cut and paste).'
  )
}

/** The app the user is looking at, used for the computer-use allowlist check. */
export async function frontmostApp(opts: InputOptions = {}): Promise<string> {
  const name = await runAppleScript(
    ['tell application "System Events" to get name of first application process whose frontmost is true'],
    { what: 'Reading the frontmost app', signal: opts.signal }
  )
  return name.trim()
}

export async function launchApp(name: string, opts: InputOptions = {}): Promise<void> {
  const res = await execCapture(OPEN, ['-a', name], { timeoutMs: 20_000, signal: opts.signal })
  if (res.spawnError) throw new ToolError(`Could not run ${OPEN}: ${res.spawnError}`)
  if (res.code !== 0) {
    if (/unable to find application/i.test(res.stderr)) {
      throw new ToolError(
        `No application named "${name}" is installed.`,
        'Use the exact name as it appears in the Applications folder, e.g. "Safari" or "Visual Studio Code".'
      )
    }
    throw commandError(`Opening ${name}`, res.stderr, res.code)
  }
}

export async function openUrl(url: string, opts: InputOptions & { app?: string } = {}): Promise<void> {
  const args = opts.app ? ['-a', opts.app, url] : [url]
  const res = await execCapture(OPEN, args, { timeoutMs: 20_000, signal: opts.signal })
  if (res.spawnError) throw new ToolError(`Could not run ${OPEN}: ${res.spawnError}`)
  if (res.code !== 0) throw commandError(`Opening ${url}`, res.stderr, res.code)
}

function chunkText(text: string, size: number): string[] {
  if (text === '') return []
  const chunks: string[] = []
  for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size))
  return chunks
}

function fmt(n: number): string {
  return String(Math.round(n))
}
