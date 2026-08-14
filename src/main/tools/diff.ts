/**
 * Unified-diff generation, used for the `edit_file` / `write_file` approval
 * preview and for the structured `detail` a rich renderer can display.
 *
 * Common prefix and suffix lines are trimmed first, so the quadratic LCS only
 * ever runs over the region that actually changed. Pathologically large
 * changes fall back to a whole-block replace rather than allocating a huge
 * table.
 */

import { splitLines } from './text'

type OpKind = ' ' | '-' | '+'
interface Op {
  kind: OpKind
  text: string
}

export interface DiffOptions {
  oldPath?: string
  newPath?: string
  /** Context lines around each change. Default 3. */
  context?: number
}

/** Roughly 2000x2000 lines of change before we stop trying to be clever. */
const LCS_CELL_LIMIT = 4_000_000

export function unifiedDiff(oldText: string, newText: string, opts: DiffOptions = {}): string {
  if (oldText === newText) return ''
  const context = Math.max(0, opts.context ?? 3)
  const a = splitLines(oldText)
  const b = splitLines(newText)
  const ops = buildOps(a, b)
  const hunks = toHunks(ops, context, {
    aTotal: a.length,
    bTotal: b.length,
    aEndsNl: oldText === '' || oldText.endsWith('\n'),
    bEndsNl: newText === '' || newText.endsWith('\n')
  })
  if (hunks.length === 0) return ''
  const oldPath = opts.oldPath ?? 'a'
  const newPath = opts.newPath ?? 'b'
  return [`--- ${oldPath}`, `+++ ${newPath}`, ...hunks].join('\n')
}

export function diffStats(diff: string): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) added++
    else if (line.startsWith('-') && !line.startsWith('---')) removed++
  }
  return { added, removed }
}

/* ── Edit script ─────────────────────────────────────────────────── */

function buildOps(a: string[], b: string[]): Op[] {
  let prefix = 0
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++

  let suffix = 0
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix++
  }

  const ops: Op[] = []
  for (let i = 0; i < prefix; i++) ops.push({ kind: ' ', text: a[i] })
  ops.push(...diffMiddle(a.slice(prefix, a.length - suffix), b.slice(prefix, b.length - suffix)))
  for (let i = a.length - suffix; i < a.length; i++) ops.push({ kind: ' ', text: a[i] })
  return ops
}

function diffMiddle(a: string[], b: string[]): Op[] {
  if (a.length === 0 && b.length === 0) return []
  if (a.length === 0) return b.map((text) => ({ kind: '+' as const, text }))
  if (b.length === 0) return a.map((text) => ({ kind: '-' as const, text }))
  if (a.length * b.length > LCS_CELL_LIMIT) {
    return [
      ...a.map((text) => ({ kind: '-' as const, text })),
      ...b.map((text) => ({ kind: '+' as const, text }))
    ]
  }

  const n = a.length
  const m = b.length
  const width = m + 1
  const dp = new Uint32Array((n + 1) * width)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * width + j] =
        a[i] === b[j]
          ? dp[(i + 1) * width + j + 1] + 1
          : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1])
    }
  }

  const ops: Op[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: ' ', text: a[i] })
      i++
      j++
    } else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) {
      ops.push({ kind: '-', text: a[i] })
      i++
    } else {
      ops.push({ kind: '+', text: b[j] })
      j++
    }
  }
  while (i < n) ops.push({ kind: '-', text: a[i++] })
  while (j < m) ops.push({ kind: '+', text: b[j++] })
  return ops
}

/* ── Hunks ───────────────────────────────────────────────────────── */

interface HunkInfo {
  aTotal: number
  bTotal: number
  aEndsNl: boolean
  bEndsNl: boolean
}

const NO_EOL = '\\ No newline at end of file'

function toHunks(ops: Op[], context: number, info: HunkInfo): string[] {
  const changed: number[] = []
  for (let i = 0; i < ops.length; i++) if (ops[i].kind !== ' ') changed.push(i)
  if (changed.length === 0) return []

  // Line number of each op within its own side (1-based), plus how many lines
  // of each side precede it.
  const aLine = new Array<number>(ops.length).fill(0)
  const bLine = new Array<number>(ops.length).fill(0)
  const aBefore = new Array<number>(ops.length).fill(0)
  const bBefore = new Array<number>(ops.length).fill(0)
  let ac = 0
  let bc = 0
  for (let i = 0; i < ops.length; i++) {
    aBefore[i] = ac
    bBefore[i] = bc
    if (ops[i].kind !== '+') aLine[i] = ++ac
    if (ops[i].kind !== '-') bLine[i] = ++bc
  }

  const groups: Array<[number, number]> = []
  let start = Math.max(0, changed[0] - context)
  let end = Math.min(ops.length - 1, changed[0] + context)
  for (let k = 1; k < changed.length; k++) {
    const idx = changed[k]
    if (idx - context <= end + 1) {
      end = Math.min(ops.length - 1, idx + context)
    } else {
      groups.push([start, end])
      start = Math.max(0, idx - context)
      end = Math.min(ops.length - 1, idx + context)
    }
  }
  groups.push([start, end])

  return groups.map(([from, to]) => {
    let aCount = 0
    let bCount = 0
    const body: string[] = []
    for (let i = from; i <= to; i++) {
      const op = ops[i]
      if (op.kind !== '+') aCount++
      if (op.kind !== '-') bCount++
      body.push(`${op.kind}${op.text}`)
      const lastOfA = op.kind !== '+' && aLine[i] === info.aTotal && !info.aEndsNl
      const lastOfB = op.kind !== '-' && bLine[i] === info.bTotal && !info.bEndsNl
      if (lastOfA || lastOfB) body.push(NO_EOL)
    }
    const aStart = aCount > 0 ? aBefore[from] + 1 : aBefore[from]
    const bStart = bCount > 0 ? bBefore[from] + 1 : bBefore[from]
    return [`@@ -${aStart},${aCount} +${bStart},${bCount} @@`, ...body].join('\n')
  })
}
