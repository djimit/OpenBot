/**
 * Frames out of a browser target: screenshots for the model, and a screencast
 * for the live view the user watches.
 *
 * The downscale convention matches the local Mac provider exactly — cap the
 * width at 1400px and report `scale` as image pixels per logical point — so a
 * vision model sees frames of the same shape whichever target a bot drives.
 */

import type { ScreenFrame } from '../../../../shared/types'
import { MAX_FRAME_WIDTH } from '../localCapture'
import type { CdpClient } from './cdpClient'
import type { BrowserSpec } from './chrome'

const SCREENSHOT_TIMEOUT_MS = 30_000

export interface ScreencastFrame {
  /** base64 JPEG. */
  image: string
  width: number
  height: number
}

/**
 * Capture the viewport.
 *
 * The clip's `scale` does the downscaling inside Chrome, so no second image
 * pass is needed — unlike the local provider, which has to shell out to `sips`.
 */
export async function captureViewport(
  cdp: CdpClient,
  spec: BrowserSpec,
  maxWidth: number = MAX_FRAME_WIDTH
): Promise<ScreenFrame> {
  const { width, height } = spec
  const scale = width > maxWidth ? maxWidth / width : 1
  const res = await cdp.send<{ data: string }>(
    'Page.captureScreenshot',
    {
      format: 'png',
      clip: { x: 0, y: 0, width, height, scale },
      captureBeyondViewport: false
    },
    { timeoutMs: SCREENSHOT_TIMEOUT_MS }
  )
  return {
    image: res.data,
    width: Math.round(width * scale),
    height: Math.round(height * scale),
    scale
  }
}

/**
 * Live view stream. Much cheaper than polling screenshots: Chrome only emits a
 * frame when the page actually changes.
 *
 * Returns a stop function; call it before starting another cast, or a restarted
 * browser accumulates one live listener per start and emits duplicate frames.
 */
export async function startScreencast(
  cdp: CdpClient,
  spec: BrowserSpec,
  onFrame: (frame: ScreencastFrame) => void
): Promise<() => Promise<void>> {
  const off = cdp.on('Page.screencastFrame', (params) => {
    const frame = params as {
      data: string
      sessionId: number
      metadata?: { deviceWidth?: number; deviceHeight?: number }
    }
    onFrame({
      image: frame.data,
      width: frame.metadata?.deviceWidth ?? spec.width,
      height: frame.metadata?.deviceHeight ?? spec.height
    })
    // Chrome pauses the cast until each frame is acknowledged.
    void cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => undefined)
  })

  await cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 70,
    maxWidth: spec.width,
    maxHeight: spec.height,
    everyNthFrame: 1
  })

  return async (): Promise<void> => {
    off()
    try {
      await cdp.send('Page.stopScreencast')
    } catch {
      /* the browser is already gone */
    }
  }
}
