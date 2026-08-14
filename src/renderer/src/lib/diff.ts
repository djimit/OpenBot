import type { ToolCall, ToolResult } from '../../../shared/types'

export type DiffLineKind = 'add' | 'del' | 'ctx' | 'meta' | 'hunk'

export interface DiffLine {
  kind: DiffLineKind
  text: string
  /** 1-based line number in the original file, when known. */
  oldNo?: number
  /** 1-based line number in the new file, when known. */
  newNo?: number
}

export interface DiffModel {
  lines: DiffLine[]
  added: number
  removed: number
  /** True when the diff was reconstructed locally rather than supplied. */
  synthesized: boolean
  path?: string
}

const MAX_LINES = 4000
const LCS_BUDGET = 1_200_000 // rows * cols before we fall back to a coarse diff

function looksUnified(text: string): boolean {
  return /^(@@ |--- |\+\+\+ |diff --git )/m.test(text)
}

/** Parses a unified diff into renderable lines, tracking line numbers per hunk. */
export function parseUnifiedDiff(text: string): DiffLine[] {
  const out: DiffLine[] = []
  let oldNo = 0
  let newNo = 0
  const raw = text.split('\n')
  for (const line of raw.slice(0, MAX_LINES)) {
    if (line.startsWith('@@')) {
      const m = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
      oldNo = m ? Number(m[1]) : 0
      newNo = m ? Number(m[2]) : 0
      out.push({ kind: 'hunk', text: line })
      continue
    }
    if (
      line.startsWith('diff --git') ||
      line.startsWith('index ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ') ||
      line.startsWith('new file') ||
      line.startsWith('deleted file') ||
      line.startsWith('similarity index') ||
      line.startsWith('rename ')
    ) {
      out.push({ kind: 'meta', text: line })
      continue
    }
    if (line.startsWith('+')) {
      out.push({ kind: 'add', text: line.slice(1), newNo: newNo++ })
    } else if (line.startsWith('-')) {
      out.push({ kind: 'del', text: line.slice(1), oldNo: oldNo++ })
    } else if (line.startsWith('\\')) {
      out.push({ kind: 'meta', text: line })
    } else {
      out.push({ kind: 'ctx', text: line.replace(/^ /, ''), oldNo: oldNo++, newNo: newNo++ })
    }
  }
  if (raw.length > MAX_LINES) {
    out.push({ kind: 'meta', text: `… ${raw.length - MAX_LINES} more lines` })
  }
  return out
}

/** Line-level LCS diff, with a cheap fallback for very large inputs. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n')
  const b = after.split('\n')

  if (a.length * b.length > LCS_BUDGET) {
    return [
      ...a.slice(0, MAX_LINES / 2).map((text, i): DiffLine => ({ kind: 'del', text, oldNo: i + 1 })),
      ...b.slice(0, MAX_LINES / 2).map((text, i): DiffLine => ({ kind: 'add', text, newNo: i + 1 }))
    ]
  }

  // Trim the common prefix/suffix before running the DP table.
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1
    endB -= 1
  }

  const midA = a.slice(start, endA)
  const midB = b.slice(start, endB)
  const n = midA.length
  const m = midB.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i]![j] = midA[i] === midB[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
    }
  }

  const lines: DiffLine[] = []
  const CONTEXT = 3
  const prefix = a.slice(Math.max(0, start - CONTEXT), start)
  prefix.forEach((text, k) => {
    const idx = Math.max(0, start - CONTEXT) + k
    lines.push({ kind: 'ctx', text, oldNo: idx + 1, newNo: idx + 1 })
  })

  let i = 0
  let j = 0
  let oldNo = start + 1
  let newNo = start + 1
  while (i < n && j < m) {
    if (midA[i] === midB[j]) {
      lines.push({ kind: 'ctx', text: midA[i]!, oldNo: oldNo++, newNo: newNo++ })
      i += 1
      j += 1
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      lines.push({ kind: 'del', text: midA[i]!, oldNo: oldNo++ })
      i += 1
    } else {
      lines.push({ kind: 'add', text: midB[j]!, newNo: newNo++ })
      j += 1
    }
  }
  while (i < n) lines.push({ kind: 'del', text: midA[i++]!, oldNo: oldNo++ })
  while (j < m) lines.push({ kind: 'add', text: midB[j++]!, newNo: newNo++ })

  a.slice(endA, Math.min(a.length, endA + CONTEXT)).forEach((text, k) => {
    lines.push({ kind: 'ctx', text, oldNo: endA + k + 1, newNo: endB + k + 1 })
  })

  return lines
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

function fromDetail(detail: unknown): { diff?: string; before?: string; after?: string; path?: string } {
  if (!detail) return {}
  if (typeof detail === 'string') return looksUnified(detail) ? { diff: detail } : {}
  if (typeof detail !== 'object') return {}
  const d = detail as Record<string, unknown>
  return {
    diff: str(d.diff) ?? str(d.patch) ?? str(d.unifiedDiff) ?? undefined,
    before: str(d.before) ?? str(d.old) ?? str(d.oldText) ?? str(d.old_string) ?? str(d.original) ?? undefined,
    after: str(d.after) ?? str(d.new) ?? str(d.newText) ?? str(d.new_string) ?? str(d.updated) ?? undefined,
    path: str(d.path) ?? str(d.file) ?? str(d.file_path) ?? undefined
  }
}

/**
 * Best-effort diff for an edit-shaped tool call. Prefers a unified diff handed
 * back by the tool; otherwise reconstructs one from the before/after strings in
 * the call arguments.
 */
export function extractDiff(call: ToolCall, result?: ToolResult): DiffModel | null {
  const fromResult = fromDetail(result?.detail)
  const args = call.args ?? {}
  const argPath = str(args.path) ?? str(args.file) ?? str(args.file_path) ?? undefined
  const path = fromResult.path ?? argPath

  let lines: DiffLine[] | null = null
  let synthesized = false

  if (fromResult.diff) {
    lines = parseUnifiedDiff(fromResult.diff)
  } else if (result?.output && looksUnified(result.output)) {
    lines = parseUnifiedDiff(result.output)
  } else if (fromResult.before !== undefined || fromResult.after !== undefined) {
    lines = diffLines(fromResult.before ?? '', fromResult.after ?? '')
    synthesized = true
  } else {
    const before = str(args.old_string) ?? str(args.oldText) ?? str(args.old) ?? str(args.search) ?? str(args.find)
    const after = str(args.new_string) ?? str(args.newText) ?? str(args.new) ?? str(args.replace) ?? str(args.content)
    if (before !== null || after !== null) {
      lines = diffLines(before ?? '', after ?? '')
      synthesized = true
    } else {
      const patch = str(args.diff) ?? str(args.patch)
      if (patch) lines = parseUnifiedDiff(patch)
    }
  }

  if (!lines || lines.length === 0) return null
  return {
    lines,
    added: lines.filter((l) => l.kind === 'add').length,
    removed: lines.filter((l) => l.kind === 'del').length,
    synthesized,
    path
  }
}

/** Parses the free-form `detail` of an approval request into diff lines. */
export function diffFromText(text: string): DiffLine[] | null {
  return looksUnified(text) ? parseUnifiedDiff(text) : null
}
