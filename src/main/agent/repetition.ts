/**
 * Collapses a model repeating itself inside a single reply.
 *
 * An agent CLI runs its own tool loop and emits one text block per iteration,
 * and `stream.ts` concatenates every block into one assistant message. A model
 * that opens each iteration with the same sentence therefore lands the same line
 * five times in what the user reads as one reply. Confirmed against pi: its
 * blocks each end in a blank line, so the repeats arrive as separate lines.
 *
 * Deliberately narrow, because repeated lines are legitimate in code, in lists,
 * in tables and in logs. A line is dropped only when it repeats the line
 * immediately before it AND reads as prose: long enough, several words, not
 * indented, not marked up, no table pipe, and outside a fenced code block.
 *
 * The bias is always towards keeping content: a missed stutter is untidy, a
 * false positive silently deletes something the user can never get back.
 */

const MIN_PROSE_CHARS = 16
const MIN_PROSE_WORDS = 3
/** The same sentence glued onto one line — collapsed only from this many repeats on. */
const MIN_GLUED_RUN = 3

const FENCE = /^\s*(```|~~~)/
const SENTENCE = /[^.!?]+[.!?]+\s*/g
/** Bullets, headings, quotes and table rows: structure the author chose, not a stutter. */
const MARKUP_LINE = /^\s*([-*+•>#|]|\d+[.)])\s/
/**
 * A pipe anywhere means a table row — including the pipe-less-border style, whose
 * rows do not start with `|` and can legitimately repeat.
 */
const TABLE_CELL = /\|/

/**
 * Repeatable content is prose: long, multi-word, unindented and unmarked.
 *
 * The exclusions are what keeps real content intact — a list can legitimately
 * repeat an item, and anything indented is code or output. ANY leading
 * whitespace disqualifies: a stutter is a sentence the model started a block
 * with, so it is always flush left, while two-space indentation is the norm in
 * the unfenced code and console output a reply is full of.
 */
function isProse(line: string): boolean {
  if (/^\s/.test(line) || MARKUP_LINE.test(line) || TABLE_CELL.test(line)) return false
  const trimmed = line.trim()
  if (trimmed.length < MIN_PROSE_CHARS) return false
  return trimmed.split(/\s+/).length >= MIN_PROSE_WORDS
}

/**
 * `X. X. X.` on one line — what block concatenation produces when the blocks do
 * not end in a newline. Three repeats is the threshold: two identical sentences
 * in a row can be deliberate, three is always a stutter.
 */
function collapseGluedSentences(line: string): string {
  // Only the first sentence of a line carries its indentation, so without this the
  // per-run check below would read the tail of an indented or bulleted line as prose.
  if (!isProse(line)) return line

  const parts = line.match(SENTENCE)
  if (!parts || parts.length < MIN_GLUED_RUN) return line

  const captured = parts.join('')
  // The regex must have matched contiguously from the start, or the tail below
  // would splice the wrong slice back on.
  if (!line.startsWith(captured)) return line

  const kept: string[] = []
  let run: string[] = []
  const flushRun = (): void => {
    if (run.length === 0) return
    const stutter = run.length >= MIN_GLUED_RUN && isProse(run[0])
    // The last copy is the one carrying the whitespace that separates it from
    // what follows, so keeping it leaves the sentence break intact.
    kept.push(...(stutter ? [run[run.length - 1]] : run))
    run = []
  }

  for (const part of parts) {
    if (run.length > 0 && run[0].trim() === part.trim()) run.push(part)
    else {
      flushRun()
      run = [part]
    }
  }
  flushRun()

  return kept.join('') + line.slice(captured.length)
}

/**
 * Drop consecutive duplicate prose lines, ignoring blank lines between them.
 *
 * Blank lines are buffered rather than emitted immediately, so `X`, blank, `X`
 * collapses to a single `X` without leaving the blank behind.
 */
export function collapseRepeatedLines(text: string): string {
  if (!text) return text

  const out: string[] = []
  const blanks: string[] = []
  let fenced = false
  let previous = ''

  const flushBlanks = (): void => {
    out.push(...blanks)
    blanks.length = 0
  }

  for (const line of text.split('\n')) {
    if (FENCE.test(line)) {
      fenced = !fenced
      previous = ''
      flushBlanks()
      out.push(line)
      continue
    }
    if (fenced) {
      flushBlanks()
      out.push(line)
      continue
    }
    if (!line.trim()) {
      blanks.push(line)
      continue
    }

    const collapsed = collapseGluedSentences(line)
    const key = collapsed.trim()
    if (key === previous && isProse(collapsed)) {
      blanks.length = 0
      continue
    }

    flushBlanks()
    out.push(collapsed)
    previous = key
  }

  flushBlanks()
  return out.join('\n')
}
