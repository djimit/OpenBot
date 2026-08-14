/** Minimal but spec-correct `text/event-stream` reader. */

import { MAX_LINE_CHARS, readLines } from './lineStream'

export interface SseEvent {
  event: string
  data: string
}

export async function* readSse(res: Response): AsyncGenerator<SseEvent> {
  let name = ''
  let data: string[] = []
  let pending = 0
  for await (const line of readLines(res)) {
    if (line === '') {
      if (data.length) yield { event: name || 'message', data: data.join('\n') }
      name = ''
      data = []
      pending = 0
      continue
    }
    if (line.startsWith(':')) continue
    const idx = line.indexOf(':')
    const field = idx === -1 ? line : line.slice(0, idx)
    let value = idx === -1 ? '' : line.slice(idx + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') name = value
    else if (field === 'data') {
      // One event is only flushed on a blank line, so `readLines`' per-line cap
      // does not bound this: an endless run of short `data:` lines with no
      // record separator sails straight past it and accumulates here instead.
      pending += value.length + 1
      if (pending > MAX_LINE_CHARS) {
        throw new Error(
          `SSE event from ${res.url || 'the server'} exceeded ${MAX_LINE_CHARS} characters with no record separator — refusing to buffer it.`
        )
      }
      data.push(value)
    }
  }
  if (data.length) yield { event: name || 'message', data: data.join('\n') }
}
