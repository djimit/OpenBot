/**
 * `ComputerProvider` for this Mac.
 *
 * All host-specific machinery lives behind this class (and the `local*`
 * modules it composes): `screencapture` + `sips` for frames, `osascript` for
 * input, `open` for apps and URLs. Tool handlers never see any of it.
 *
 * Coordinate contract: callers work in the pixel space of the most recent
 * `screenshot()`. That frame is downscaled from native pixels, and native
 * pixels are themselves denser than the points the pointer uses, so every
 * incoming coordinate is divided by `scale` and offset by the display's origin.
 */

import type { ComputerProvider, MouseButton, ScreenFrame } from '../../../shared/types'
import { ToolError } from '../errors'
import { captureDisplay, type Capture } from './localCapture'
import {
  clickAt,
  dragBetween,
  frontmostApp,
  launchApp,
  moveTo,
  openUrl,
  pressKey,
  scrollAt,
  typeText,
  type Point
} from './localInput'

export interface LocalProviderOptions {
  /** 1-based display index, matching `screencapture -D`. Default 1 (primary). */
  display?: number
}

export class LocalComputerProvider implements ComputerProvider {
  readonly kind = 'local' as const
  private readonly display: number
  private lastFrame: Capture | undefined

  constructor(options: LocalProviderOptions = {}) {
    this.display = Math.max(1, Math.floor(options.display ?? 1))
  }

  async probe(): Promise<{ ok: boolean; detail?: string }> {
    if (process.platform !== 'darwin') {
      return { ok: false, detail: `Local computer use requires macOS; this process is running on ${process.platform}.` }
    }

    const notes: string[] = []
    let ok = true

    // Accessibility (and Automation, for System Events) — probed with a
    // harmless query rather than by injecting input.
    try {
      const front = await frontmostApp()
      notes.push(`Input injection is allowed (frontmost app: ${front || 'unknown'}).`)
    } catch (err) {
      ok = false
      notes.push(err instanceof ToolError ? err.text : String(err))
    }

    // Screen Recording — the capture itself is the check; macOS exposes no
    // preflight API to osascript.
    try {
      const frame = await this.screenshot()
      notes.push(`Screen capture works (${frame.width}×${frame.height} px, scale ${frame.scale.toFixed(2)}).`)
    } catch (err) {
      ok = false
      notes.push(err instanceof ToolError ? err.text : String(err))
    }

    return { ok, detail: notes.join('\n') }
  }

  async screenshot(): Promise<ScreenFrame> {
    this.assertMacOS()
    const capture = await captureDisplay({ display: this.display })
    this.lastFrame = capture
    return { image: capture.image, width: capture.width, height: capture.height, scale: capture.scale }
  }

  async click(x: number, y: number, button: MouseButton = 'left', clickCount = 1): Promise<void> {
    this.assertMacOS()
    await clickAt(await this.toScreenPoint(x, y), button, clampClicks(clickCount))
  }

  async moveMouse(x: number, y: number): Promise<void> {
    this.assertMacOS()
    await moveTo(await this.toScreenPoint(x, y))
  }

  async typeText(text: string): Promise<void> {
    this.assertMacOS()
    await typeText(text)
  }

  async keyPress(combo: string): Promise<void> {
    this.assertMacOS()
    await pressKey(combo)
  }

  async scroll(x: number, y: number, dx: number, dy: number): Promise<void> {
    this.assertMacOS()
    const scale = (await this.frame()).scale || 1
    await scrollAt(await this.toScreenPoint(x, y), dx / scale, dy / scale)
  }

  async drag(from: [number, number], to: [number, number]): Promise<void> {
    this.assertMacOS()
    await dragBetween(await this.toScreenPoint(from[0], from[1]), await this.toScreenPoint(to[0], to[1]))
  }

  async openApp(name: string): Promise<void> {
    this.assertMacOS()
    await launchApp(name)
  }

  async navigate(url: string): Promise<void> {
    this.assertMacOS()
    await openUrl(url)
  }

  /** Frontmost application name, used for the computer-use allowlist check. */
  async activeApp(): Promise<string | undefined> {
    if (process.platform !== 'darwin') return undefined
    try {
      return await frontmostApp()
    } catch {
      return undefined
    }
  }

  /** Size of the frame coordinates are interpreted in, without recapturing. */
  lastFrameSize(): { width: number; height: number } | undefined {
    if (!this.lastFrame) return undefined
    return { width: this.lastFrame.width, height: this.lastFrame.height }
  }

  private assertMacOS(): void {
    if (process.platform !== 'darwin') {
      throw new ToolError(
        `Local computer use requires macOS; this process is running on ${process.platform}.`,
        'Point the bot at a VM computer target instead.'
      )
    }
  }

  /** The frame coordinates are relative to, captured on demand the first time. */
  private async frame(): Promise<Capture> {
    if (!this.lastFrame) await this.screenshot()
    if (!this.lastFrame) throw new ToolError('No screen frame is available.')
    return this.lastFrame
  }

  /** Image pixel → global display point, clamped to the display. */
  private async toScreenPoint(x: number, y: number): Promise<Point> {
    const frame = await this.frame()
    const scale = frame.scale || 1
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new ToolError(`Coordinates must be numbers; got (${x}, ${y}).`)
    }
    if (x < 0 || y < 0 || x > frame.width || y > frame.height) {
      throw new ToolError(
        `(${Math.round(x)}, ${Math.round(y)}) is outside the ${frame.width}×${frame.height} screenshot.`,
        'Coordinates must come from the most recent screenshot. Take a new one and read the position off it.'
      )
    }
    return {
      x: frame.bounds.x + x / scale,
      y: frame.bounds.y + y / scale
    }
  }
}

function clampClicks(count: number): number {
  if (!Number.isFinite(count)) return 1
  return Math.max(1, Math.min(3, Math.round(count)))
}
