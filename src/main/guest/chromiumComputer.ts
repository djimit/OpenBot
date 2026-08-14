/**
 * The browser-only computer backend: headless Chromium driven over CDP.
 *
 * This is the fallback when the guest image has no X11 desktop. It advertises
 * `computer-v1` but not `desktop-v1`, because everything it can see or click is
 * inside one page target.
 */

import { mkdir } from 'node:fs/promises'
import { spawn, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import { editingCommands, parseCombo } from '../tools/computer/browser/keymap'
import { VIEWPORT_HEIGHT, VIEWPORT_WIDTH } from './config'

interface PendingCdp {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

/** A deliberately small CDP client for the private Chromium display. */
export class ChromiumComputer {
  ready = false
  private process?: ChildProcess
  private socket?: WebSocket
  private seq = 0
  private pending = new Map<number, PendingCdp>()

  constructor(
    private readonly binary: string,
    private readonly port: number,
    private readonly root: string
  ) {}

  async start(): Promise<void> {
    const profile = join(this.root, '.browser')
    await mkdir(profile, { recursive: true })
    this.process = spawn(this.binary, [
      '--headless=new',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-sync',
      '--metrics-recording-only',
      '--no-first-run',
      '--no-default-browser-check',
      '--password-store=basic',
      `--remote-debugging-port=${this.port}`,
      '--remote-debugging-address=127.0.0.1',
      `--user-data-dir=${profile}`,
      `--window-size=${VIEWPORT_WIDTH},${VIEWPORT_HEIGHT}`,
      'about:blank'
    ], { stdio: ['ignore', 'ignore', 'pipe'] })
    this.process.stderr?.on('data', (chunk) => {
      const line = String(chunk).trim()
      if (line && !/dbus|policy.*cloudmanagement/i.test(line)) console.warn('[openbot/chromium]', line)
    })
    this.process.once('exit', () => {
      this.ready = false
      this.socket = undefined
    })
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      try {
        await this.connect()
        await this.command('Page.enable')
        // Chromium's --window-size describes the outer window and currently
        // leaves a shorter visual viewport in headless mode. Pin the CDP device
        // metrics so screenshots and input coordinates share an exact frame.
        await this.command('Emulation.setDeviceMetricsOverride', {
          width: VIEWPORT_WIDTH,
          height: VIEWPORT_HEIGHT,
          deviceScaleFactor: 1,
          mobile: false,
          screenWidth: VIEWPORT_WIDTH,
          screenHeight: VIEWPORT_HEIGHT
        })
        this.ready = true
        return
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
    }
    throw new Error('Chromium DevTools did not become ready within 30 seconds.')
  }

  stop(): void {
    this.socket?.close()
    this.process?.kill('SIGTERM')
  }

  async screenshot(): Promise<{ image: string; width: number; height: number; scale: number }> {
    const metrics = await this.command('Page.getLayoutMetrics') as {
      cssVisualViewport?: { clientWidth?: number; clientHeight?: number }
    }
    const captured = await this.command('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false
    }) as { data?: string }
    const width = Math.max(1, Math.round(metrics.cssVisualViewport?.clientWidth ?? VIEWPORT_WIDTH))
    const height = Math.max(1, Math.round(metrics.cssVisualViewport?.clientHeight ?? VIEWPORT_HEIGHT))
    if (!captured.data) throw new Error('Chromium returned no screenshot data.')
    return { image: captured.data, width, height, scale: 1 }
  }

  async click(x: number, y: number, mouseButton: 'left' | 'right' | 'middle', clickCount: number): Promise<void> {
    await this.command('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: mouseButton, clickCount })
    await this.command('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: mouseButton, clickCount })
  }

  async move(x: number, y: number): Promise<void> {
    await this.command('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' })
  }

  async type(value: string): Promise<void> {
    await this.command('Input.insertText', { text: value })
  }

  async key(combo: string): Promise<void> {
    const { modifiers, key, code, vk, text } = parseCombo(combo)
    const commands = editingCommands(modifiers, key)
    await this.command('Input.dispatchKeyEvent', {
      type: text ? 'keyDown' : 'rawKeyDown',
      modifiers,
      key,
      code,
      windowsVirtualKeyCode: vk,
      nativeVirtualKeyCode: vk,
      text,
      ...(commands.length > 0 ? { commands } : {})
    })
    await this.command('Input.dispatchKeyEvent', {
      type: 'keyUp', modifiers, key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk
    })
  }

  async scroll(x: number, y: number, deltaX: number, deltaY: number): Promise<void> {
    await this.command('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX, deltaY })
  }

  async drag(from: [number, number], to: [number, number]): Promise<void> {
    await this.command('Input.dispatchMouseEvent', { type: 'mousePressed', x: from[0], y: from[1], button: 'left', buttons: 1, clickCount: 1 })
    for (let step = 1; step <= 8; step += 1) {
      const ratio = step / 8
      await this.command('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: from[0] + (to[0] - from[0]) * ratio,
        y: from[1] + (to[1] - from[1]) * ratio,
        button: 'left',
        buttons: 1
      })
    }
    await this.command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to[0], y: to[1], button: 'left', clickCount: 1 })
  }

  async openApp(name: string): Promise<void> {
    if (!/^(chromium|chrome|browser)$/i.test(name.trim())) {
      throw new TypeError(`The managed box currently exposes Chromium, not "${name}".`)
    }
  }

  async activeApp(): Promise<string> {
    return 'Chromium'
  }

  async navigate(value: string): Promise<void> {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new TypeError('Only http(s) navigation is allowed.')
    await this.command('Page.navigate', { url: url.toString() })
  }

  private async connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return
    const targets = await fetch(`http://127.0.0.1:${this.port}/json/list`).then((response) => response.json()) as Array<{
      type?: string
      webSocketDebuggerUrl?: string
    }>
    const endpoint = targets.find((target) => target.type === 'page')?.webSocketDebuggerUrl
    if (!endpoint) throw new Error('Chromium has no page target.')
    await new Promise<void>((resolvePromise, rejectPromise) => {
      const socket = new WebSocket(endpoint)
      const timer = setTimeout(() => rejectPromise(new Error('Chromium WebSocket timed out.')), 5_000)
      socket.addEventListener('open', () => {
        clearTimeout(timer)
        this.socket = socket
        socket.addEventListener('message', (event) => this.onMessage(String(event.data)))
        socket.addEventListener('close', () => this.disconnect(new Error('Chromium connection closed.')))
        socket.addEventListener('error', () => this.disconnect(new Error('Chromium connection failed.')))
        resolvePromise()
      }, { once: true })
      socket.addEventListener('error', () => {
        clearTimeout(timer)
        rejectPromise(new Error('Chromium WebSocket failed.'))
      }, { once: true })
    })
  }

  private async command(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    await this.connect()
    const id = ++this.seq
    return await new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        rejectPromise(new Error(`${method} timed out.`))
      }, 15_000)
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolvePromise(value) },
        reject: (error) => { clearTimeout(timer); rejectPromise(error) }
      })
      this.socket!.send(JSON.stringify({ id, method, params }))
    })
  }

  private onMessage(raw: string): void {
    let message: { id?: number; result?: unknown; error?: { message?: string } }
    try { message = JSON.parse(raw) as typeof message } catch { return }
    if (typeof message.id !== 'number') return
    const pending = this.pending.get(message.id)
    if (!pending) return
    this.pending.delete(message.id)
    if (message.error) pending.reject(new Error(message.error.message || 'Chromium command failed.'))
    else pending.resolve(message.result)
  }

  private disconnect(error: Error): void {
    this.socket = undefined
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }
}
