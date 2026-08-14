/**
 * Argument validation for IPC. The renderer is untrusted input: every value
 * that crosses the bridge is checked here before it reaches the store.
 *
 * Each guard throws on bad input; `handler.ts` turns that into the channel's
 * safe fallback value.
 */

import { isAbsolute, normalize } from 'node:path'
import type { AgentMode, ApprovalDecision } from '../../shared/types'

// Attachment validation is long enough to live on its own; re-exported so
// callers still reach the whole guard set through this one module.
export { asAttachments } from './attachments'

/** Ids are generated main-side (uuid v4) but may round-trip via the renderer. */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

export function asId(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('expected an id string')
  const id = value.trim()
  if (!ID_PATTERN.test(id) || id.includes('..')) throw new TypeError(`invalid id: ${id}`)
  return id
}

export function asOptionalId(value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : asId(value)
}

export function asString(value: unknown, maxLength = 1_000_000): string {
  if (typeof value !== 'string') throw new TypeError('expected a string')
  return value.slice(0, maxLength)
}

export function asStringArray(value: unknown): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new TypeError('expected an array of strings')
  return value.filter((entry): entry is string => typeof entry === 'string' && entry !== '')
}

export function asIdArray(value: unknown): string[] {
  return asStringArray(value).map(asId)
}

/** Longest path any OS here accepts, with room to spare. */
const MAX_PATH_LENGTH = 4096

/**
 * A working directory. The renderer picks these with the native dialog, so an
 * absolute path is the only shape that can legitimately arrive — anything else
 * is a bug or an attempt to point a bot's tools somewhere it was never shown.
 */
export function asAbsolutePath(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('expected a path string')
  const path = value.trim()
  if (!path || path.length > MAX_PATH_LENGTH || !isAbsolute(path)) {
    throw new TypeError('expected an absolute path')
  }
  if (path.includes('\0')) throw new TypeError('path contains a null byte')
  return normalize(path)
}

/**
 * A drop position. Negative, fractional and absurd values are all things a
 * drag can produce, so they are trimmed here; the board clamps to its own
 * length afterwards.
 */
export function asIndex(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError('expected an index number')
  }
  return Math.max(0, Math.min(Math.trunc(value), Number.MAX_SAFE_INTEGER))
}

/**
 * Keys that address the prototype chain rather than the object. They survive a
 * structured clone as real own properties, so they are stripped at the border
 * instead of being spread into a stored document further in.
 */
const UNSAFE_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype'])

/** A patch must be a plain object — never an array, function or primitive. */
export function asPatch<T>(value: unknown): Partial<T> {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('expected an object patch')
  }
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (!UNSAFE_KEYS.has(key)) out[key] = entry
  }
  return out as Partial<T>
}

const MODES: ReadonlyArray<AgentMode> = ['agent', 'ask', 'plan']

export function asMode(value: unknown): AgentMode {
  if (typeof value !== 'string' || !(MODES as ReadonlyArray<string>).includes(value)) {
    throw new TypeError(`invalid mode: ${String(value)}`)
  }
  return value as AgentMode
}

const DECISIONS: ReadonlyArray<ApprovalDecision> = ['approve', 'approve-always', 'reject']

export function asDecision(value: unknown): ApprovalDecision {
  if (typeof value !== 'string' || !(DECISIONS as ReadonlyArray<string>).includes(value)) {
    throw new TypeError(`invalid approval decision: ${String(value)}`)
  }
  return value as ApprovalDecision
}
