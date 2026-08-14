/**
 * A bot's own browser, as a `ComputerProvider`.
 *
 * This is the facade the rest of the tool tree imports from; nothing here does
 * any work. `provider.ts` composes one bot's Chrome instance into the shared
 * `ComputerProvider` contract, `registry.ts` owns the per-bot instances, and
 * the capabilities themselves live in `chromeSession`, `capture`, `input`,
 * `navigation`, `profile` and `apps`.
 */

export type { InstalledApp } from './apps'
export type { ScreencastFrame } from './capture'
export { APP_CATALOG } from './apps'
export { BrowserComputerProvider, type BrowserStatus } from './provider'
export { browserFor, getBrowser, listBrowsers, removeBrowser, stopAllBrowsers } from './registry'
