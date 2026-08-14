/**
 * Argument coercion for model-supplied tool arguments.
 *
 * Models routinely send `"3"` for a number, `"true"` for a boolean and a
 * comma-joined string for an array. Every reader below accepts the sloppy form
 * and fails with a message naming the argument when it truly cannot.
 */

import { ToolError } from './errors'

export type Args = Record<string, unknown>

function typeName(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  return typeof v
}

function missing(key: string, tool: string): ToolError {
  return new ToolError(`Missing required argument "${key}" for ${tool}.`)
}

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === ''
}

export function reqStr(args: Args, key: string, tool: string): string {
  const v = args[key]
  if (typeof v === 'string' && v.length > 0) return v
  if (isEmpty(v)) throw missing(key, tool)
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  throw new ToolError(`Argument "${key}" for ${tool} must be a string, got ${typeName(v)}.`)
}

export function optStr(args: Args, key: string): string | undefined {
  const v = args[key]
  if (isEmpty(v)) return undefined
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  throw new ToolError(`Argument "${key}" must be a string, got ${typeName(v)}.`)
}

export function optNum(args: Args, key: string): number | undefined {
  const v = args[key]
  if (isEmpty(v)) return undefined
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number(v.trim())
    if (Number.isFinite(n)) return n
  }
  throw new ToolError(`Argument "${key}" must be a number, got ${typeName(v)}.`)
}

export function reqNum(args: Args, key: string, tool: string): number {
  const v = optNum(args, key)
  if (v === undefined) throw missing(key, tool)
  return v
}

export function optBool(args: Args, key: string, def = false): boolean {
  const v = args[key]
  if (isEmpty(v)) return def
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    if (s === 'true' || s === 'yes' || s === '1') return true
    if (s === 'false' || s === 'no' || s === '0') return false
  }
  throw new ToolError(`Argument "${key}" must be a boolean, got ${typeName(v)}.`)
}

export function optStrArray(args: Args, key: string): string[] | undefined {
  const v = args[key]
  if (isEmpty(v)) return undefined
  if (Array.isArray(v)) return v.map((x) => String(x))
  if (typeof v === 'string') {
    const trimmed = v.trim()
    if (trimmed.startsWith('[')) {
      try {
        const parsed: unknown = JSON.parse(trimmed)
        if (Array.isArray(parsed)) return parsed.map((x) => String(x))
      } catch {
        /* not JSON — fall through to comma splitting */
      }
    }
    return trimmed
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }
  throw new ToolError(`Argument "${key}" must be an array of strings, got ${typeName(v)}.`)
}

/** Read an array of plain objects (used by `todo_write`). */
export function optObjArray(args: Args, key: string): Args[] | undefined {
  const v = args[key]
  if (isEmpty(v)) return undefined
  const raw: unknown =
    typeof v === 'string'
      ? (() => {
          try {
            return JSON.parse(v) as unknown
          } catch {
            throw new ToolError(`Argument "${key}" must be an array of objects (received unparseable text).`)
          }
        })()
      : v
  if (!Array.isArray(raw)) {
    throw new ToolError(`Argument "${key}" must be an array of objects, got ${typeName(raw)}.`)
  }
  return raw.map((item, i) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new ToolError(`Argument "${key}"[${i}] must be an object, got ${typeName(item)}.`)
    }
    return item as Args
  })
}

export function optEnum<T extends string>(args: Args, key: string, allowed: readonly T[], def: T): T {
  const v = optStr(args, key)
  if (v === undefined) return def
  const lower = v.trim().toLowerCase()
  const hit = allowed.find((a) => a === lower)
  if (hit) return hit
  throw new ToolError(`Argument "${key}" must be one of: ${allowed.join(', ')}. Got "${v}".`)
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}
