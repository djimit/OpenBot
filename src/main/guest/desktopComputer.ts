/**
 * The graphical computer backend, plus the X11 helpers only it needs.
 *
 * `scrot` and `xdotool` are invoked with argument arrays and never a shell, and
 * every coordinate is clamped before it reaches one, so a malformed request
 * cannot become a command line.
 */

import { mkdir, readFile, rm } from 'node:fs/promises'
import { spawn, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import { DISPLAY, VIEWPORT_HEIGHT, VIEWPORT_WIDTH, VM_ID } from './config'
import type { GuestComputer } from './computerRoutes'

/**
 * A complete lightweight Linux desktop backed by Xvfb + Openbox.
 *
 * Input is injected at the X display rather than through Chromium's debugging
 * protocol, so apps installed later with apt appear in the same screen and are
 * controllable without teaching the host about them. Xvfb is local to the VM;
 * no VNC or X11 socket is published to macOS.
 */
export class DesktopComputer implements GuestComputer {
  ready = false
  private processes: ChildProcess[] = []
  private capture = Promise.resolve()

  constructor(
    private readonly browser: string,
    private readonly root: string
  ) {}

  async start(): Promise<void> {
    const home = join(this.root, '.home')
    const profile = join(home, '.config', 'chromium')
    await mkdir(profile, { recursive: true })
    this.processes.push(this.launch('Xvfb', [DISPLAY, '-screen', '0', `${VIEWPORT_WIDTH}x${VIEWPORT_HEIGHT}x24`, '-nolisten', 'tcp', '-ac']))
    await wait(350)
    this.processes.push(this.launch('openbox', []))
    await wait(250)
    this.processes.push(this.launch(this.browser, [
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
      `--user-data-dir=${profile}`,
      '--start-maximized',
      'about:blank'
    ]))
    await waitForDesktop()
    this.ready = true
  }

  stop(): void {
    this.ready = false
    for (const process of this.processes.reverse()) process.kill('SIGTERM')
    this.processes = []
  }

  async screenshot(): Promise<{ image: string; width: number; height: number; scale: number }> {
    const path = `/tmp/openbot-screen-${VM_ID}.png`
    let release!: () => void
    const previous = this.capture
    this.capture = new Promise<void>((resolve) => { release = resolve })
    await previous
    try {
      await runDisplay('scrot', ['--overwrite', '--silent', path])
      const image = await readFile(path)
      return { image: image.toString('base64'), width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT, scale: 1 }
    } finally {
      await rm(path, { force: true }).catch(() => undefined)
      release()
    }
  }

  async click(x: number, y: number, mouseButton: 'left' | 'right' | 'middle', clickCount: number): Promise<void> {
    const button = mouseButton === 'right' ? '3' : mouseButton === 'middle' ? '2' : '1'
    await runDisplay('xdotool', ['mousemove', coordinate(x), coordinate(y), 'click', '--repeat', String(clickCount), '--delay', '90', button])
  }

  async move(x: number, y: number): Promise<void> {
    await runDisplay('xdotool', ['mousemove', coordinate(x), coordinate(y)])
  }

  async type(value: string): Promise<void> {
    await runDisplay('xdotool', ['type', '--clearmodifiers', '--delay', '1', '--file', '-'], value)
  }

  async key(combo: string): Promise<void> {
    const keys = combo.toLowerCase().split('+').map((part) => {
      const key = part.trim()
      if (key === 'cmd' || key === 'command' || key === 'meta') return 'ctrl'
      if (key === 'return') return 'enter'
      if (!/^[a-z0-9_-]{1,24}$/.test(key)) throw new TypeError('The key combination is malformed.')
      return key
    })
    if (keys.length === 0 || keys.length > 5) throw new TypeError('The key combination is malformed.')
    await runDisplay('xdotool', ['key', '--clearmodifiers', keys.join('+')])
  }

  async scroll(x: number, y: number, deltaX: number, deltaY: number): Promise<void> {
    const args = ['mousemove', coordinate(x), coordinate(y)]
    const append = (button: string, amount: number): void => {
      const repeats = Math.min(20, Math.max(1, Math.ceil(Math.abs(amount) / 80)))
      args.push('click', '--repeat', String(repeats), '--delay', '15', button)
    }
    if (Math.abs(deltaY) >= 1) append(deltaY > 0 ? '5' : '4', deltaY)
    if (Math.abs(deltaX) >= 1) append(deltaX > 0 ? '7' : '6', deltaX)
    if (args.length > 3) await runDisplay('xdotool', args)
  }

  async drag(from: [number, number], to: [number, number]): Promise<void> {
    await runDisplay('xdotool', [
      'mousemove', coordinate(from[0]), coordinate(from[1]),
      'mousedown', '1',
      'mousemove', '--sync', coordinate(to[0]), coordinate(to[1]),
      'mouseup', '1'
    ])
  }

  async openApp(name: string): Promise<void> {
    const requested = name.trim().toLowerCase()
    const apps: Record<string, string[]> = {
      browser: [this.browser], chromium: [this.browser], chrome: [this.browser],
      terminal: ['/usr/bin/xterm'], xterm: ['/usr/bin/xterm']
    }
    const command = apps[requested]
    if (!command) throw new TypeError(`No installed desktop application is registered as "${name}".`)
    this.processes.push(this.launch(command[0]!, command.slice(1)))
  }

  async navigate(value: string): Promise<void> {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new TypeError('Only http(s) navigation is allowed.')
    await this.key('ctrl+l')
    await this.type(url.toString())
    await this.key('enter')
  }

  async activeApp(): Promise<string> {
    try {
      const result = await runDisplay('xdotool', ['getactivewindow', 'getwindowname'])
      return result.trim() || 'Linux desktop'
    } catch {
      return 'Linux desktop'
    }
  }

  private launch(command: string, args: string[]): ChildProcess {
    const child = spawn(command, args, {
      env: { ...process.env, DISPLAY, HOME: join(this.root, '.home') },
      stdio: ['ignore', 'ignore', 'pipe']
    })
    child.stderr?.on('data', (chunk) => {
      const line = String(chunk).trim()
      if (line && !/dbus|policy.*cloudmanagement|libva/i.test(line)) console.warn('[openbot/desktop]', line)
    })
    child.once('exit', () => {
      if (this.ready && command === 'Xvfb') this.ready = false
    })
    return child
  }
}

function coordinate(value: number): string {
  return String(Math.max(0, Math.min(100_000, Math.round(value))))
}

async function runDisplay(command: string, args: string[], input?: string): Promise<string> {
  return await new Promise<string>((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      env: { ...process.env, DISPLAY },
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe']
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout?.on('data', (chunk) => stdout.push(Buffer.from(chunk)))
    child.stderr?.on('data', (chunk) => stderr.push(Buffer.from(chunk)))
    child.once('error', rejectPromise)
    child.once('exit', (code) => {
      const error = Buffer.concat(stderr).toString('utf8').trim()
      if (code === 0) resolvePromise(Buffer.concat(stdout).toString('utf8'))
      else rejectPromise(new Error(`${command} exited ${code ?? 'without status'}${error ? `: ${error}` : ''}`))
    })
    if (input !== undefined) child.stdin?.end(input)
  })
}

async function waitForDesktop(): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      await runDisplay('xdotool', ['search', '--onlyvisible', '--name', '.'])
      return
    } catch {
      await wait(200)
    }
  }
  throw new Error('The Linux desktop did not become ready within 30 seconds.')
}

function wait(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}
