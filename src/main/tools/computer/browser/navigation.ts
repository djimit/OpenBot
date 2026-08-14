/**
 * Going somewhere in a browser target.
 *
 * `openApp` is the browser equivalent of launching an application: it resolves
 * a name against the bot's dock (or the catalog) and navigates to that app's
 * URL, so the same tool call works whichever target a bot drives.
 */

import { ToolError } from '../../errors'
import type { AppDock } from './apps'
import type { CdpClient } from './cdpClient'

const NAVIGATE_TIMEOUT_MS = 30_000

export async function navigate(cdp: CdpClient, url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) {
    throw new ToolError(
      `A browser target can only navigate to http(s) URLs; got "${url}".`,
      'Pass a full URL, for example https://example.com.'
    )
  }
  // Subscribe before navigating, or a fast load fires before we are listening.
  const loaded = cdp.waitFor('Page.loadEventFired', NAVIGATE_TIMEOUT_MS)
  await cdp.send('Page.navigate', { url }, { timeoutMs: NAVIGATE_TIMEOUT_MS })
  await loaded
}

export async function openApp(cdp: CdpClient, dock: AppDock, name: string): Promise<void> {
  await dock.ready()
  const app = dock.find(name)
  if (!app) {
    const installed = dock.list().map((a) => a.name).join(', ') || 'none'
    throw new ToolError(
      `"${name}" is not installed on this bot's browser. Installed apps: ${installed}.`,
      'Ask the user to install it, or use navigate with the full URL instead.'
    )
  }
  await navigate(cdp, app.url)
}

/** Current page URL, used to report where the browser is. */
export async function currentUrl(cdp: CdpClient): Promise<string | undefined> {
  try {
    const res = await cdp.send<{ result?: { value?: unknown } }>(
      'Runtime.evaluate',
      { expression: 'location.href', returnByValue: true },
      { timeoutMs: 5000 }
    )
    const value = res.result?.value
    return typeof value === 'string' ? value : undefined
  } catch {
    return undefined
  }
}
