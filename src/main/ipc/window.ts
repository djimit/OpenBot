/** Native window operations that cannot be performed reliably in a sandboxed renderer. */

import { BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { CHANNELS } from './channels'
import { handleEvent } from './handler'

function senderWindow(event: IpcMainInvokeEvent): BrowserWindow {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window || window.isDestroyed()) throw new Error('window is unavailable')
  return window
}

async function setFullScreen(event: IpcMainInvokeEvent, args: unknown[]): Promise<boolean> {
  const requested = args[0]
  if (typeof requested !== 'boolean') throw new Error('full-screen state must be a boolean')

  const window = senderWindow(event)
  if (window.isFullScreen() === requested) return requested

  // Native macOS full-screen transitions are asynchronous. Resolve when
  // Electron confirms the transition rather than telling the renderer it
  // worked while the window is still unchanged.
  return await new Promise<boolean>((resolve) => {
    let settled = false
    const finish = (result: boolean): void => {
      if (settled) return
      settled = true
      resolve(result)
    }
    const timer = setTimeout(() => finish(window.isFullScreen()), 2500)
    const confirmed = (): void => {
      clearTimeout(timer)
      // The event itself is Electron's authoritative confirmation. On macOS,
      // isFullScreen() can still report the previous state inside this event.
      finish(requested)
    }
    if (requested) window.once('enter-full-screen', confirmed)
    else window.once('leave-full-screen', confirmed)
    window.setFullScreen(requested)
  })
}

export function registerWindowIpc(): void {
  handleEvent<boolean>(CHANNELS.windowSetFullScreen, setFullScreen, () => false)
  handleEvent<boolean>(
    CHANNELS.windowIsFullScreen,
    (event) => senderWindow(event).isFullScreen(),
    () => false
  )
}
