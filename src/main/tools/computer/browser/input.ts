/**
 * Input dispatch into a browser target.
 *
 * Two callers, deliberately separated:
 *   - the agent, through the functions taking screenshot-space coordinates,
 *   - the user, through `forwardUserInput`, which is how they sign a bot in.
 */

import type { MouseButton } from '../../../../shared/types'
import type { CdpClient } from './cdpClient'
import { editingCommands, parseCombo } from './keymap'

/** CDP wheel deltas are pixels; callers think in notches. */
const WHEEL_PIXELS_PER_NOTCH = 40
const DRAG_STEPS = 12

/**
 * Screenshot-space → viewport-space.
 *
 * A caller only ever sees the downscaled frame, so its coordinates must be
 * scaled back up before CDP sees them. Skipping this makes every click land
 * short and up-left of its target whenever the viewport is wider than the
 * screenshot cap.
 */
export function toViewport(x: number, y: number, scale: number): [number, number] {
  const s = scale > 0 ? scale : 1
  return [Math.round(x / s), Math.round(y / s)]
}

export async function moveMouse(cdp: CdpClient, x: number, y: number, scale: number): Promise<void> {
  const [vx, vy] = toViewport(x, y, scale)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: vx, y: vy, button: 'none' })
}

export async function click(
  cdp: CdpClient,
  x: number,
  y: number,
  scale: number,
  button: MouseButton = 'left',
  clickCount = 1
): Promise<void> {
  const [vx, vy] = toViewport(x, y, scale)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: vx, y: vy, button: 'none' })
  for (let i = 1; i <= clickCount; i++) {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: vx,
      y: vy,
      button,
      clickCount: i,
      buttons: 1
    })
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: vx,
      y: vy,
      button,
      clickCount: i,
      buttons: 0
    })
  }
}

/**
 * `Input.insertText` is far faster than per-character key events and handles
 * non-ASCII correctly. It fires input events, which is what pages listen for.
 */
export async function typeText(cdp: CdpClient, text: string): Promise<void> {
  await cdp.send('Input.insertText', { text }, { timeoutMs: Math.max(15_000, text.length * 20) })
}

export async function keyPress(cdp: CdpClient, combo: string): Promise<void> {
  const { modifiers, key, code, vk, text } = parseCombo(combo)
  const commands = editingCommands(modifiers, key)
  await cdp.send('Input.dispatchKeyEvent', {
    type: text ? 'keyDown' : 'rawKeyDown',
    modifiers,
    key,
    code,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk,
    text,
    ...(commands.length > 0 ? { commands } : {})
  })
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    modifiers,
    key,
    code,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk
  })
}

/** Positive `dy` scrolls down the page, positive `dx` scrolls right. */
export async function scroll(
  cdp: CdpClient,
  x: number,
  y: number,
  dx: number,
  dy: number,
  scale: number
): Promise<void> {
  const [vx, vy] = toViewport(x, y, scale)
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x: vx,
    y: vy,
    deltaX: dx * WHEEL_PIXELS_PER_NOTCH,
    deltaY: dy * WHEEL_PIXELS_PER_NOTCH,
    buttons: 0
  })
}

export async function drag(
  cdp: CdpClient,
  from: [number, number],
  to: [number, number],
  scale: number
): Promise<void> {
  const [fx, fy] = toViewport(from[0], from[1], scale)
  const [tx, ty] = toViewport(to[0], to[1], scale)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: fx, y: fy, button: 'none' })
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: fx,
    y: fy,
    button: 'left',
    clickCount: 1,
    buttons: 1
  })
  for (let i = 1; i <= DRAG_STEPS; i++) {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: Math.round(fx + ((tx - fx) * i) / DRAG_STEPS),
      y: Math.round(fy + ((ty - fy) * i) / DRAG_STEPS),
      button: 'left',
      buttons: 1
    })
  }
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: tx,
    y: ty,
    button: 'left',
    clickCount: 1,
    buttons: 0
  })
}

export type UserInputEvent =
  | {
      kind: 'mouse'
      type: 'mousePressed' | 'mouseReleased' | 'mouseMoved'
      x: number
      y: number
      button?: MouseButton
      clickCount?: number
    }
  | { kind: 'wheel'; x: number; y: number; deltaX: number; deltaY: number }
  | {
      kind: 'key'
      type: 'keyDown' | 'keyUp' | 'char'
      key?: string
      code?: string
      text?: string
      modifiers?: number
      windowsVirtualKeyCode?: number
    }

/**
 * Forward a raw input event from the user's live view.
 *
 * This is how a user signs a bot in: they click into the view and type the
 * credentials themselves. Those keystrokes go straight to the browser and are
 * never seen by the model, never logged and never stored by OpenBOT — only the
 * resulting session cookie lands in the bot's profile. Coordinates are already
 * in viewport space, because the live view renders the cast at native size.
 */
export async function forwardUserInput(cdp: CdpClient, event: UserInputEvent): Promise<void> {
  if (event.kind === 'mouse') {
    await cdp.send('Input.dispatchMouseEvent', {
      type: event.type,
      x: event.x,
      y: event.y,
      button: event.button ?? 'left',
      clickCount: event.clickCount ?? (event.type === 'mouseMoved' ? 0 : 1),
      buttons: event.type === 'mousePressed' ? 1 : 0
    })
    return
  }
  if (event.kind === 'wheel') {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: event.x,
      y: event.y,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      buttons: 0
    })
    return
  }
  await cdp.send('Input.dispatchKeyEvent', {
    type: event.type,
    key: event.key,
    code: event.code,
    text: event.text,
    modifiers: event.modifiers ?? 0,
    windowsVirtualKeyCode: event.windowsVirtualKeyCode,
    nativeVirtualKeyCode: event.windowsVirtualKeyCode
  })
}
