/** Description of one OpenAI-compatible endpoint, shared by cloud and local adapters. */

export interface OaEndpoint {
  /** Base URL including the version segment, e.g. `https://api.openai.com/v1`. */
  baseUrl: string
  apiKey?: string
  /** Provider-specific headers (attribution, API versions). */
  headers?: Record<string, string>
  /** Extra top-level body fields merged into every chat request. */
  extraBody?: Record<string, unknown>
  /** Set false for local servers that choke on an `Authorization` header. */
  sendAuth?: boolean
}

export function oaHeaders(ep: OaEndpoint): Record<string, string> {
  const headers: Record<string, string> = { ...ep.headers }
  if (ep.apiKey && ep.sendAuth !== false) headers.authorization = `Bearer ${ep.apiKey}`
  return headers
}
