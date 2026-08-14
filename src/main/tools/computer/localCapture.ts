/**
 * Screen capture and display geometry for the local (this-Mac) provider.
 *
 * `screencapture` writes native pixels — on a Retina display that is twice the
 * point size the pointer works in — and vision models cannot afford a 3456px
 * wide frame anyway. So the frame is downscaled with `sips` and the resulting
 * `scale` (image pixels per display point) is returned so coordinates picked
 * off the image can be mapped back to the pointer's coordinate space.
 */

import { readFile, stat, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execCapture } from '../exec'
import { ToolError } from '../errors'
import { commandError, detectPermissionFailure, permissionError } from './localPermissions'
import { tryJxa } from './localOsascript'

const SCREENCAPTURE = '/usr/sbin/screencapture'
const SIPS = '/usr/bin/sips'
const CAPTURE_TIMEOUT_MS = 20_000
/** Wide enough to read UI text, small enough for a vision model's context. */
export const MAX_FRAME_WIDTH = 1400
/** A real capture is never this small; a blank/blocked one often is. */
const SUSPICIOUS_FILE_BYTES = 1024

export interface DisplayBounds {
  /** Top-left origin in global point coordinates (primary display is 0,0). */
  x: number
  y: number
  width: number
  height: number
}

export interface Capture {
  /** base64 PNG, no data: prefix. */
  image: string
  /** Pixel size of the returned image. */
  width: number
  height: number
  /** Image pixels per display point: screenPoint = origin + imageCoord / scale. */
  scale: number
  bounds: DisplayBounds
}

const SCREEN_GEOMETRY_JXA = `ObjC.import('AppKit');
function run() {
  var screens = $.NSScreen.screens;
  var count = screens.count;
  var primaryHeight = screens.objectAtIndex(0).frame.size.height;
  var out = [];
  for (var i = 0; i < count; i++) {
    var f = screens.objectAtIndex(i).frame;
    out.push({
      x: f.origin.x,
      y: primaryHeight - (f.origin.y + f.size.height),
      width: f.size.width,
      height: f.size.height
    });
  }
  return JSON.stringify(out);
}`

let geometryCache: { at: number; displays: DisplayBounds[] } | undefined

/** Display frames in points, index 0 = primary. Cached briefly. */
export async function displayGeometry(signal?: AbortSignal): Promise<DisplayBounds[]> {
  if (geometryCache && Date.now() - geometryCache.at < 30_000) return geometryCache.displays
  const raw = await tryJxa(SCREEN_GEOMETRY_JXA, [], { what: 'Reading the display layout', signal })
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as DisplayBounds[]
    if (Array.isArray(parsed) && parsed.length > 0) {
      geometryCache = { at: Date.now(), displays: parsed }
      return parsed
    }
  } catch {
    /* fall through to the empty list */
  }
  return []
}

export interface CaptureOptions {
  /** 1-based display index, matching `screencapture -D`. Default 1. */
  display?: number
  maxWidth?: number
  signal?: AbortSignal
}

export async function captureDisplay(opts: CaptureOptions = {}): Promise<Capture> {
  const display = Math.max(1, Math.floor(opts.display ?? 1))
  const maxWidth = opts.maxWidth ?? MAX_FRAME_WIDTH
  const file = join(tmpdir(), `openbot-frame-${randomUUID()}.png`)

  try {
    const res = await execCapture(SCREENCAPTURE, ['-x', '-t', 'png', '-D', String(display), file], {
      timeoutMs: CAPTURE_TIMEOUT_MS,
      signal: opts.signal,
      maxOutputChars: 8000
    })
    if (res.spawnError) {
      throw new ToolError(
        `Could not run ${SCREENCAPTURE}: ${res.spawnError}`,
        'Screen capture is a macOS system binary; this provider only runs on macOS.'
      )
    }
    if (res.code !== 0) {
      const permission = detectPermissionFailure(res.stderr, res.code) ?? 'screen-recording'
      throw permissionError(permission, 'Taking a screenshot:')
    }

    // With Screen Recording denied, `screencapture` commonly exits 0 but leaves
    // no file (or a near-empty one) behind. There is no bridged preflight API to
    // ask up front — `CGPreflightScreenCaptureAccess` is not exposed to
    // osascript — so this shape is the signal.
    const info = await stat(file).catch(() => undefined)
    if (!info || info.size < SUSPICIOUS_FILE_BYTES) {
      throw permissionError('screen-recording', 'Taking a screenshot:')
    }

    let size = await pixelSize(file, opts.signal)
    if (size.width > maxWidth) {
      await resampleWidth(file, maxWidth, opts.signal)
      size = await pixelSize(file, opts.signal)
    }

    const png = await readFile(file)
    const displays = await displayGeometry(opts.signal)
    const bounds: DisplayBounds = displays[display - 1] ?? {
      x: 0,
      y: 0,
      width: size.width,
      height: size.height
    }
    const scale = bounds.width > 0 ? size.width / bounds.width : 1

    return { image: png.toString('base64'), width: size.width, height: size.height, scale, bounds }
  } finally {
    await unlink(file).catch(() => undefined)
  }
}

async function pixelSize(file: string, signal?: AbortSignal): Promise<{ width: number; height: number }> {
  const res = await execCapture(SIPS, ['-g', 'pixelWidth', '-g', 'pixelHeight', file], {
    timeoutMs: 10_000,
    signal,
    maxOutputChars: 4000
  })
  if (res.code !== 0) throw commandError('Reading the screenshot dimensions', res.stderr, res.code)
  const width = Number(/pixelWidth:\s*(\d+)/.exec(res.stdout)?.[1] ?? 0)
  const height = Number(/pixelHeight:\s*(\d+)/.exec(res.stdout)?.[1] ?? 0)
  if (!width || !height) throw commandError('Reading the screenshot dimensions', res.stdout, res.code)
  return { width, height }
}

async function resampleWidth(file: string, width: number, signal?: AbortSignal): Promise<void> {
  const res = await execCapture(SIPS, ['--resampleWidth', String(width), file, '--out', file], {
    timeoutMs: 15_000,
    signal,
    maxOutputChars: 4000
  })
  if (res.code !== 0) throw commandError('Downscaling the screenshot', res.stderr, res.code)
}
