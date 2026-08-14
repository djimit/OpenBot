/**
 * The per-bot browser registry.
 *
 * One Chrome process per bot, created lazily and kept for the life of the
 * process so a bot's profile — and therefore its sign-ins — survives between
 * turns. Creating a provider does not start Chrome; the session does that on
 * first use.
 */

import { ToolError } from '../../errors'
import { DEFAULT_SPEC, type BrowserSpec } from './chrome'
import { BrowserComputerProvider } from './provider'
import { deleteProfile } from './profile'

const browsers = new Map<string, BrowserComputerProvider>()

/** Get or create a bot's browser. Does not start it. */
export function browserFor(
  botId: string,
  options: { userDataDir?: string; spec?: Partial<BrowserSpec> } = {}
): BrowserComputerProvider {
  const existing = browsers.get(botId)
  if (existing) return existing
  if (!botId.trim()) throw new ToolError('A browser target needs a bot id.')
  const created = new BrowserComputerProvider(
    { botId, ...DEFAULT_SPEC, ...options.spec },
    options.userDataDir
  )
  browsers.set(botId, created)
  return created
}

export function getBrowser(botId: string): BrowserComputerProvider | undefined {
  return browsers.get(botId)
}

export function listBrowsers(): BrowserComputerProvider[] {
  return [...browsers.values()]
}

/** Stop and forget one browser, optionally removing its persistent profile. */
export async function removeBrowser(
  botId: string,
  options: { userDataDir?: string; deleteProfile?: boolean } = {}
): Promise<void> {
  const browser = browsers.get(botId)
  if (browser) {
    await browser.stop().catch(() => undefined)
    browsers.delete(botId)
  }
  if (options.deleteProfile) await deleteProfile(botId, options.userDataDir)
}

/** Shut every browser down — call on app quit so no Chrome is orphaned. */
export async function stopAllBrowsers(): Promise<void> {
  await Promise.all([...browsers.values()].map((b) => b.stop().catch(() => undefined)))
  browsers.clear()
}
