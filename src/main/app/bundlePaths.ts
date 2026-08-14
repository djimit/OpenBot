/**
 * Where the built preload script and renderer entry live.
 *
 * Resolved from the app root (which works both under `electron-vite dev` and
 * inside a packaged asar) with a fallback relative to this bundle, so a
 * non-standard output directory still resolves.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from 'electron'

function resolveBuilt(...segments: string[]): string {
  const fromAppRoot = join(app.getAppPath(), 'out', ...segments)
  if (existsSync(fromAppRoot)) return fromAppRoot
  return fileURLToPath(new URL(`../${segments.join('/')}`, import.meta.url))
}

/**
 * The context-isolated bridge injected into every window.
 *
 * `.cjs`, not `.mjs`: Electron refuses to load an ESM preload into a sandboxed
 * renderer, and the sandbox is worth more than the module syntax. The build
 * emits this format on purpose — see `electron.vite.config.ts`.
 */
export function preloadScript(): string {
  return resolveBuilt('preload', 'index.cjs')
}

/** The production renderer entry; unused when a dev server URL is present. */
export function rendererHtml(): string {
  return resolveBuilt('renderer', 'index.html')
}

/**
 * Vite dev server URL, set by electron-vite while developing.
 *
 * Ignored outright in a packaged build, even when the variable is set. The
 * value decides what gets loaded into the window carrying the preload bridge,
 * and the navigation guard then treats that origin as internal — so an
 * `ELECTRON_RENDERER_URL` inherited from the launching environment would both
 * pull a remote page in at full privilege and switch the guard off for it.
 */
export function devServerUrl(): string | undefined {
  if (app.isPackaged) return undefined
  const url = process.env['ELECTRON_RENDERER_URL']
  return url && url.trim() !== '' ? url : undefined
}
