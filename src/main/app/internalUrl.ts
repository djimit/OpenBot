/**
 * Deciding whether a URL belongs to our own renderer.
 *
 * Deliberately free of `electron` imports: this predicate is the only thing
 * between a `file:` link in model or tool output and an arbitrary local file
 * loaded into the window that carries the preload bridge, so it is kept
 * self-contained and exercised directly by tests.
 */

import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Canonical, symlink-resolved path, or the input when it cannot be resolved. */
export function canonical(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

export interface RendererLocation {
  /** Vite dev server origin, when one is running. */
  devUrl?: string | undefined
  /** Canonical directory the built renderer lives in, with a trailing separator. */
  rendererRoot: string
}

function matchesDevServer(parsed: URL, devUrl: string): boolean {
  try {
    // Compare origins, not prefixes: `http://localhost:5173.example.com`
    // starts with the dev URL but is a remote site.
    return parsed.origin === new URL(devUrl).origin
  } catch {
    // A malformed dev URL simply means nothing matches it.
    return false
  }
}

/**
 * The local path a `file:` URL names, or null when it names none.
 *
 * `fileURLToPath` is not total. `file://evil.com/x` throws
 * ERR_INVALID_FILE_URL_HOST and `file:///a%2Fb` throws
 * ERR_INVALID_FILE_URL_PATH — and a throw raised inside a `will-navigate`
 * listener happens *before* the listener reaches `event.preventDefault()`, so
 * calling it unguarded made exactly the URLs shaped to defeat the check the
 * ones that were allowed through. Anything Node refuses to parse is not ours.
 */
function filePath(parsed: URL): string | null {
  // A `file:` URL carrying a host is not a local path at all — not even
  // `file://localhost/…`, which OpenBOT never produces. Rejected explicitly
  // rather than by relying on the throw below.
  if (parsed.host !== '') return null
  try {
    return fileURLToPath(parsed)
  } catch {
    return null
  }
}

/** Our own renderer: the dev server origin in dev, the bundled files in prod. */
export function isInternalUrl(url: string, location: RendererLocation): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (location.devUrl && matchesDevServer(parsed, location.devUrl)) return true
  if (parsed.protocol !== 'file:') return false
  const path = filePath(parsed)
  if (path === null) return false
  return canonical(path).startsWith(location.rendererRoot)
}
