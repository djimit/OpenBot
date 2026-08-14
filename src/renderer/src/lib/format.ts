import type { SessionSummary } from '../../../shared/types'

/** Tiny className joiner — falsy values are dropped. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  let out = ''
  for (const p of parts) {
    if (!p) continue
    out = out ? `${out} ${p}` : p
  }
  return out
}

const startOfDay = (ts: number): number => {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export type SessionBucket = 'Today' | 'Yesterday' | 'Older'

export function bucketFor(ts: number, now = Date.now()): SessionBucket {
  const today = startOfDay(now)
  if (ts >= today) return 'Today'
  if (ts >= today - 86_400_000) return 'Yesterday'
  return 'Older'
}

export interface SessionGroup {
  label: SessionBucket
  items: SessionSummary[]
}

/** Groups newest-first into Today / Yesterday / Older, dropping empty groups. */
export function groupSessions(sessions: SessionSummary[], now = Date.now()): SessionGroup[] {
  const order: SessionBucket[] = ['Today', 'Yesterday', 'Older']
  const buckets: Record<SessionBucket, SessionSummary[]> = { Today: [], Yesterday: [], Older: [] }
  for (const s of [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)) {
    buckets[bucketFor(s.updatedAt, now)].push(s)
  }
  return order.filter((label) => buckets[label].length > 0).map((label) => ({ label, items: buckets[label] }))
}

export function relativeTime(ts: number, now = Date.now()): string {
  const diff = Math.max(0, now - ts)
  const min = Math.floor(diff / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hrs = Math.floor(min / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function clockTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || Number.isNaN(ms)) return ''
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.round((ms % 60_000) / 1000)
  return `${m}m ${s}s`
}

export function formatSize(bytes: number | undefined): string {
  if (bytes === undefined || bytes <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)}${units[i]}`
}

export function formatContext(tokens: number | undefined): string {
  if (!tokens || tokens <= 0) return ''
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}k ctx`
  return `${tokens} ctx`
}

export function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, Math.max(0, max - 1))}…` : clean
}

export function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts.length ? parts[parts.length - 1]! : p
}

/** Human summary of a tool call's arguments for the collapsed row. */
export function summarizeArgs(name: string, args: Record<string, unknown>): string {
  const pick = (...keys: string[]): string | null => {
    for (const k of keys) {
      const v = args[k]
      if (typeof v === 'string' && v.trim()) return v
      if (typeof v === 'number') return String(v)
    }
    return null
  }
  switch (name) {
    case 'shell':
      return truncate(pick('command', 'cmd', 'script') ?? '', 120)
    case 'read_file':
    case 'write_file':
    case 'edit_file':
    case 'list_dir':
      return truncate(pick('path', 'file', 'file_path', 'dir') ?? '', 120)
    case 'glob':
    case 'grep':
      return truncate(pick('pattern', 'query', 'regex') ?? '', 120)
    case 'fetch':
    case 'navigate':
      return truncate(pick('url', 'href') ?? '', 120)
    case 'web_search':
      return truncate(pick('query', 'q') ?? '', 120)
    case 'open_app':
      return truncate(pick('app', 'name', 'bundleId') ?? '', 120)
    case 'type_text':
      return truncate(pick('text', 'value') ?? '', 120)
    case 'key_press':
      return truncate(pick('key', 'keys', 'combo') ?? '', 120)
    case 'click':
    case 'double_click':
    case 'scroll':
    case 'drag': {
      const p = coordsOf(args)
      return p ? `${Math.round(p.x)}, ${Math.round(p.y)}` : ''
    }
    case 'remember':
      return truncate(pick('text', 'memory', 'note') ?? '', 120)
    case 'handoff':
      return truncate(pick('botId', 'to', 'reason') ?? '', 120)
    default: {
      const entries = Object.entries(args)
      if (!entries.length) return ''
      return truncate(
        entries
          .slice(0, 3)
          .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
          .join('  '),
        120
      )
    }
  }
}

/** Pulls an {x, y} pair out of loosely-shaped computer-use arguments. */
export function coordsOf(args: Record<string, unknown> | undefined): { x: number; y: number } | null {
  if (!args) return null
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const x = num(args.x) ?? num(args.left) ?? num(args.startX)
  const y = num(args.y) ?? num(args.top) ?? num(args.startY)
  if (x !== null && y !== null) return { x, y }
  const c = args.coordinate ?? args.coordinates ?? args.point ?? args.position
  if (Array.isArray(c) && c.length >= 2) {
    const cx0 = num(c[0])
    const cy0 = num(c[1])
    if (cx0 !== null && cy0 !== null) return { x: cx0, y: cy0 }
  }
  if (c && typeof c === 'object') {
    const o = c as Record<string, unknown>
    const ox = num(o.x)
    const oy = num(o.y)
    if (ox !== null && oy !== null) return { x: ox, y: oy }
  }
  return null
}

export function safeJson(value: unknown, indent = 2): string {
  try {
    return JSON.stringify(value, null, indent) ?? String(value)
  } catch {
    return String(value)
  }
}

/** base64 PNG -> data URI, tolerating values that already carry a scheme. */
export function pngSrc(data: string): string {
  return data.startsWith('data:') ? data : `data:image/png;base64,${data}`
}
