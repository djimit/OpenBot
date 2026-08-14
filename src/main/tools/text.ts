/**
 * Text measurement, truncation, capped accumulation and binary sniffing.
 */

export function bytesOf(s: string): number {
  return Buffer.byteLength(s, 'utf8')
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/** Keep the head and the tail of an over-long string, noting the gap. */
export function truncateMiddle(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false }
  const half = Math.floor(maxChars / 2)
  const head = text.slice(0, half)
  const tail = text.slice(text.length - half)
  const omitted = text.length - head.length - tail.length
  return {
    text: `${head}\n\n… [${omitted.toLocaleString()} characters omitted] …\n\n${tail}`,
    truncated: true
  }
}

/** Keep the head of an over-long string. */
export function truncateEnd(text: string, maxChars: number, note = 'truncated'): string {
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}\n… [${note}: ${(text.length - maxChars).toLocaleString()} more characters]`
}

export function splitLines(text: string): string[] {
  if (text === '') return []
  const lines = text.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/**
 * Heuristic binary detection over a sample of the file: a NUL byte is decisive,
 * otherwise a high share of control bytes means "not text".
 */
export function looksBinary(sample: Buffer): boolean {
  if (sample.length === 0) return false
  let suspicious = 0
  const limit = Math.min(sample.length, 8192)
  for (let i = 0; i < limit; i++) {
    const b = sample[i]
    if (b === 0) return true
    // Allow tab, LF, CR, FF, ESC and everything printable / UTF-8 continuation.
    if (b < 0x09 || (b > 0x0d && b < 0x20 && b !== 0x1b)) suspicious++
  }
  return suspicious / limit > 0.3
}

/**
 * Accumulates streamed output under a hard ceiling: the first half of the
 * budget is kept verbatim, the last half is a sliding window over the tail.
 */
export class CappedText {
  private head: string[] = []
  private tail: string[] = []
  private headLen = 0
  private tailLen = 0
  private droppedChars = 0
  private readonly half: number

  constructor(cap: number) {
    this.half = Math.max(1, Math.floor(cap / 2))
  }

  push(chunk: string): void {
    if (!chunk) return
    let rest = chunk
    if (this.headLen < this.half) {
      const take = rest.slice(0, this.half - this.headLen)
      this.head.push(take)
      this.headLen += take.length
      rest = rest.slice(take.length)
      if (!rest) return
    }
    this.tail.push(rest)
    this.tailLen += rest.length
    while (this.tailLen > this.half && this.tail.length > 1) {
      const gone = this.tail.shift() as string
      this.tailLen -= gone.length
      this.droppedChars += gone.length
    }
    if (this.tailLen > this.half && this.tail.length === 1) {
      const only = this.tail[0]
      const keep = only.slice(only.length - this.half)
      this.droppedChars += only.length - keep.length
      this.tail[0] = keep
      this.tailLen = keep.length
    }
  }

  get dropped(): number {
    return this.droppedChars
  }

  get length(): number {
    return this.headLen + this.tailLen
  }

  toString(): string {
    const head = this.head.join('')
    const tail = this.tail.join('')
    if (this.droppedChars === 0) return head + tail
    return `${head}\n… [${this.droppedChars.toLocaleString()} characters of output omitted] …\n${tail}`
  }
}
