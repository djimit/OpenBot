/**
 * The authenticated screen/input routes, and the backend contract behind them.
 *
 * A backend is only reachable once it reports `ready`, so a half-started
 * desktop falls through to a 404 rather than accepting clicks against a screen
 * that does not exist yet. Every field of every payload is re-validated here;
 * the backends are handed numbers and bounded strings, never raw JSON.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { MAX_CONTROL_BYTES } from './config'
import { json, readBody } from './http'

export interface GuestComputer {
  ready: boolean
  start(): Promise<void>
  stop(): void
  screenshot(): Promise<{ image: string; width: number; height: number; scale: number }>
  click(x: number, y: number, button: 'left' | 'right' | 'middle', clickCount: number): Promise<void>
  move(x: number, y: number): Promise<void>
  type(value: string): Promise<void>
  key(combo: string): Promise<void>
  scroll(x: number, y: number, deltaX: number, deltaY: number): Promise<void>
  drag(from: [number, number], to: [number, number]): Promise<void>
  openApp(name: string): Promise<void>
  navigate(value: string): Promise<void>
  activeApp(): Promise<string>
}

export async function handleComputer(
  computer: GuestComputer,
  req: IncomingMessage,
  res: ServerResponse,
  path: string
): Promise<boolean> {
  if (!computer.ready) return false
  if (req.method === 'GET' && path === '/active_app') {
    json(res, 200, { app: await computer.activeApp() })
    return true
  }
  if (req.method === 'GET' && path === '/screenshot') {
    json(res, 200, await computer.screenshot())
    return true
  }
  if (req.method !== 'POST') return false
  const routes = new Set(['/click', '/move', '/type', '/key', '/scroll', '/drag', '/open_app', '/navigate'])
  if (!routes.has(path)) return false
  const body = JSON.parse(await readBody(req, MAX_CONTROL_BYTES)) as Record<string, unknown>
  switch (path) {
    case '/click':
      await computer.click(number(body['x']), number(body['y']), button(body['button']), integerValue(body['clickCount'], 1, 1, 3))
      break
    case '/move':
      await computer.move(number(body['x']), number(body['y']))
      break
    case '/type':
      await computer.type(text(body['text'], 100_000))
      break
    case '/key':
      await computer.key(text(body['combo'], 200))
      break
    case '/scroll':
      await computer.scroll(number(body['x']), number(body['y']), number(body['dx']), number(body['dy']))
      break
    case '/drag': {
      const from = point(body['from'])
      const to = point(body['to'])
      await computer.drag(from, to)
      break
    }
    case '/open_app':
      await computer.openApp(text(body['name'], 200))
      break
    case '/navigate':
      await computer.navigate(text(body['url'], 4096))
      break
  }
  json(res, 200, { ok: true })
  return true
}

function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new TypeError('Expected a bounded string.')
  return value
}

function number(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new TypeError('Expected a finite number.')
  return parsed
}

function integerValue(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
}

function button(value: unknown): 'left' | 'right' | 'middle' {
  return value === 'right' || value === 'middle' ? value : 'left'
}

function point(value: unknown): [number, number] {
  if (!Array.isArray(value) || value.length !== 2) throw new TypeError('Expected a coordinate pair.')
  return [number(value[0]), number(value[1])]
}
