/** Base-URL normalisation shared by every HTTP adapter. */

export function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

export function joinUrl(base: string, path: string): string {
  const b = trimTrailingSlash(base)
  return path.startsWith('/') ? `${b}${path}` : `${b}/${path}`
}

/** `http://127.0.0.1:8080/v1` -> `http://127.0.0.1:8080` */
export function stripVersion(base: string): string {
  return trimTrailingSlash(base).replace(/\/v\d+$/, '')
}

/** Ensure an OpenAI-compatible base ends in `/v1`. */
export function ensureV1(base: string): string {
  const b = trimTrailingSlash(base)
  return /\/v\d+$/.test(b) ? b : `${b}/v1`
}

/** Host and port only, for status messages. */
export function displayHost(base: string): string {
  try {
    return new URL(base).host
  } catch {
    return trimTrailingSlash(base)
  }
}
