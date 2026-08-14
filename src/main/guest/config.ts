/**
 * Every knob the guest daemon reads from its environment, resolved once.
 *
 * The supervisor hands the guest its identity, workspace and desktop wiring
 * through the container environment, so this module is evaluated for its side
 * effects: a missing `OPENBOT_VM_ID` has to stop the process at import rather
 * than surface later as an unauthenticated request.
 */

import { resolve } from 'node:path'

/**
 * Body caps, per route.
 *
 * A `write_file` proxied into the box carries the whole file inline in one POST
 * to `/box/tool`, so this cap *is* the file-size ceiling for an isolated bot.
 * At 1 MiB it sat far below the 16 MiB the gateway accepts from a CLI and the
 * 24 MiB the host client will read back, and every larger write failed — as an
 * opaque HTTP 500, because the body was read outside the handler's try. It is
 * sized to the response cap now, with room for the JSON envelope's escaping.
 *
 * The control routes stay small: they carry coordinates and short strings, and
 * nothing about a click should be allowed to hold megabytes of memory.
 */
export const MAX_TOOL_BYTES = 24 * 1024 * 1024
export const MAX_CONTROL_BYTES = 1024 * 1024
export const MAX_APPROVALS = 8
export const PORT = integer(process.env['OPENBOT_VM_PORT'], 8790, 1, 65_535)
export const BIND_HOST = process.env['OPENBOT_VM_BIND_HOST']?.trim() || '127.0.0.1'
export const VM_ID = requiredEnv('OPENBOT_VM_ID')
export const BOX_ROOT = resolve(process.env['OPENBOT_BOX_ROOT']?.trim() || process.cwd())
export const CHROMIUM_BIN = process.env['OPENBOT_CHROMIUM_BIN']?.trim()
export const DESKTOP_ENABLED = process.env['OPENBOT_DESKTOP'] === '1'
export const DISPLAY = process.env['DISPLAY']?.trim() || ':99'
export const CHROMIUM_PORT = integer(process.env['OPENBOT_CHROMIUM_PORT'], 9222, 1, 65_535)
export const VIEWPORT_WIDTH = 1440
export const VIEWPORT_HEIGHT = 900

export function integer(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
}

export function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required.`)
  return value
}
