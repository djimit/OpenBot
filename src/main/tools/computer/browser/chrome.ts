/**
 * Finding a Chrome-family browser, and the flags one is launched with.
 *
 * A browser target is deliberately not a container or a VM: it is one Chrome
 * process with a persistent profile, ~250MB resident and a couple of seconds to
 * start, so a user can keep many bots running at once.
 */

import { access } from 'node:fs/promises'
import { constants } from 'node:fs'

/** Checked in order; the first that exists wins. */
const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'
]

export const CHROME_MISSING_MESSAGE =
  'No Chrome-family browser is installed. A browser target needs Google Chrome, Chromium, ' +
  'Microsoft Edge or Brave — install one and try again.'

/** Absolute path to a usable browser binary, or `undefined`. */
export async function findChrome(): Promise<string | undefined> {
  for (const candidate of CHROME_CANDIDATES) {
    try {
      await access(candidate, constants.X_OK)
      return candidate
    } catch {
      /* not this one */
    }
  }
  return undefined
}

export interface BrowserSpec {
  botId: string
  width: number
  height: number
  /** Headless is lighter; headful helps when debugging the browser itself. */
  headless: boolean
  startUrl: string
}

export const DEFAULT_SPEC: Omit<BrowserSpec, 'botId'> = {
  width: 1280,
  height: 800,
  headless: true,
  startUrl: 'about:blank'
}

/**
 * Launch flags.
 *
 * `--remote-debugging-port=0` lets the OS pick a free port, which Chrome then
 * writes into `DevToolsActivePort`; a fixed port would collide as soon as a
 * second bot started.
 */
export function chromeLaunchArgs(spec: BrowserSpec, profileDir: string): string[] {
  return [
    spec.headless ? '--headless=new' : '',
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDir}`,
    `--window-size=${spec.width},${spec.height}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-features=Translate,MediaRouter',
    '--disable-gpu',
    '--mute-audio',
    spec.startUrl
  ].filter(Boolean)
}
