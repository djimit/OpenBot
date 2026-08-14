/** Turning byte streams into lines: HTTP response bodies and child stdio. */

/**
 * Ceiling on a single unterminated line, and on anything else that buffers a
 * response before it can be split. Agent CLIs emit one JSON object per line and
 * some are large (a full transcript replay), so this is generous — it exists
 * only to stop a stream with no newline in it from growing the buffer until the
 * process dies.
 */
export const MAX_LINE_CHARS = 16 * 1024 * 1024

/**
 * Yield a response body line by line, including blank lines (SSE needs them
 * as record separators). Cancels the reader when the consumer stops early,
 * which is what makes a mid-stream abort actually close the socket.
 */
export async function* readLines(res: Response): AsyncGenerator<string> {
  const body = res.body
  if (!body) return
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      for (;;) {
        const nl = buf.indexOf('\n')
        if (nl < 0) break
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        yield stripCr(line)
      }
      // The child-stdio splitter below has always capped its buffer; this one
      // never did, so a server answering a stream request with a newline-free
      // body — or a binary one — could grow this string until the main process
      // ran out of memory. Loud rather than truncated: a half-read line handed
      // to a JSON parser is a worse outcome than a failed request.
      if (buf.length > MAX_LINE_CHARS) {
        throw new Error(
          `Response from ${res.url || 'the server'} exceeded ${MAX_LINE_CHARS} characters with no line break — refusing to buffer it.`
        )
      }
    }
    buf += decoder.decode()
    if (buf.length) yield stripCr(buf)
  } finally {
    try {
      await reader.cancel()
    } catch {
      // Already closed or aborted — nothing left to release.
    }
  }
}

function stripCr(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line
}

/** Incremental line splitter for chunked text (child process stdout/stderr). */
export class LineSplitter {
  private buf = ''
  private overflowed = false

  push(chunk: string): string[] {
    this.buf += chunk
    const lines: string[] = []
    for (;;) {
      const nl = this.buf.indexOf('\n')
      if (nl < 0) break
      const line = this.buf.slice(0, nl)
      this.buf = this.buf.slice(nl + 1)
      // A line that already overran the cap was truncated, not dropped; the
      // remainder up to this newline belongs to it and is discarded with it.
      if (this.overflowed) this.overflowed = false
      else lines.push(stripCr(line))
    }
    if (this.buf.length > MAX_LINE_CHARS) {
      this.buf = ''
      this.overflowed = true
    }
    return lines
  }

  flush(): string[] {
    const rest = this.buf
    this.buf = ''
    return rest ? [stripCr(rest)] : []
  }
}
