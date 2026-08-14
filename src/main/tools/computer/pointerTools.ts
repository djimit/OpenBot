/**
 * Pointer tools: `click` (single/double/right), `scroll`, `drag`.
 *
 * Coordinates arrive in the pixel space of the most recent screenshot; the
 * provider maps them onto its own display.
 */

import type { MouseButton, ToolSchema } from '../../../shared/types'
import { clamp, optEnum, optNum, optStrArray, reqNum } from '../args'
import { ToolError } from '../errors'
import { defineTool } from '../results'
import { frameResult, withComputerApproval } from './gate'

const BUTTONS = ['left', 'right', 'middle'] as const
const SETTLE_MS = 450

/* ── click ───────────────────────────────────────────────────────── */

export const clickSchema: ToolSchema = {
  name: 'click',
  description:
    'Click at a point from the most recent screenshot. Set clicks: 2 for a double-click (opening an ' +
    'item, selecting a word) or button: "right" for a context menu. Take a screenshot first so the ' +
    'coordinates are current.',
  parameters: {
    type: 'object',
    properties: {
      x: { type: 'number', description: 'Horizontal pixel position in the last screenshot.' },
      y: { type: 'number', description: 'Vertical pixel position in the last screenshot.' },
      button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Mouse button. Default left.' },
      clicks: { type: 'number', description: '1 = single, 2 = double, 3 = triple. Default 1.' },
      purpose: { type: 'string', description: 'What you expect the click to do, shown to the user.' }
    },
    required: ['x', 'y']
  },
  mutating: true,
  computerUse: true
}

export const clickTool = defineTool(clickSchema, async (args, ctx) => {
  const x = reqNum(args, 'x', 'click')
  const y = reqNum(args, 'y', 'click')
  const button = optEnum(args, 'button', BUTTONS, 'left') as MouseButton
  const clicks = clamp(Math.round(optNum(args, 'clicks') ?? 1), 1, 3)
  const purpose = typeof args.purpose === 'string' ? args.purpose : ''
  const label = `${clicks === 2 ? 'Double-click' : clicks === 3 ? 'Triple-click' : 'Click'}${button === 'left' ? '' : ` (${button})`}`

  const outcome = await withComputerApproval(
    ctx,
    {
      toolName: 'click',
      summary: `${label} at (${Math.round(x)}, ${Math.round(y)})`,
      detail: purpose ? `${label} at (${Math.round(x)}, ${Math.round(y)}) — ${purpose}` : `${label} at (${Math.round(x)}, ${Math.round(y)})`,
      settleMs: SETTLE_MS
    },
    (provider) => provider.click(x, y, button, clicks, ctx.signal)
  )

  return frameResult(ctx, 'click', `${label} at (${Math.round(x)}, ${Math.round(y)}).`, outcome, {
    x,
    y,
    button,
    clicks
  })
})

/** Alias so a model that calls `double_click` still succeeds. */
export const doubleClickTool = defineTool(
  {
    ...clickSchema,
    name: 'double_click',
    description: 'Double-click at a point from the most recent screenshot. Equivalent to click with clicks: 2.',
    parameters: {
      type: 'object',
      properties: {
        x: clickSchema.parameters.properties.x,
        y: clickSchema.parameters.properties.y,
        purpose: clickSchema.parameters.properties.purpose
      },
      required: ['x', 'y']
    }
  },
  (args, ctx) => clickTool.handler({ ...args, clicks: 2 }, ctx)
)

/* ── scroll ──────────────────────────────────────────────────────── */

const DIRECTIONS = ['down', 'up', 'left', 'right'] as const

export const scrollSchema: ToolSchema = {
  name: 'scroll',
  description:
    'Scroll the area under a point. Give either direction + amount, or explicit dx/dy pixel deltas ' +
    '(positive dy scrolls down the page, positive dx scrolls right).',
  parameters: {
    type: 'object',
    properties: {
      x: { type: 'number', description: 'Point to scroll over, from the last screenshot.' },
      y: { type: 'number', description: 'Point to scroll over, from the last screenshot.' },
      direction: { type: 'string', enum: ['down', 'up', 'left', 'right'], description: 'Scroll direction.' },
      amount: { type: 'number', description: 'Pixels to scroll in that direction. Default 400.' },
      dx: { type: 'number', description: 'Horizontal delta, instead of direction/amount.' },
      dy: { type: 'number', description: 'Vertical delta, instead of direction/amount.' }
    },
    required: ['x', 'y']
  },
  mutating: true,
  computerUse: true
}

export const scrollTool = defineTool(scrollSchema, async (args, ctx) => {
  const x = reqNum(args, 'x', 'scroll')
  const y = reqNum(args, 'y', 'scroll')
  let dx = optNum(args, 'dx') ?? 0
  let dy = optNum(args, 'dy') ?? 0

  if (dx === 0 && dy === 0) {
    const direction = optEnum(args, 'direction', DIRECTIONS, 'down')
    const amount = Math.abs(optNum(args, 'amount') ?? 400)
    if (direction === 'down') dy = amount
    else if (direction === 'up') dy = -amount
    else if (direction === 'right') dx = amount
    else dx = -amount
  }
  if (dx === 0 && dy === 0) throw new ToolError('Nothing to scroll: give a direction, or a non-zero dx/dy.')

  const motion = describeScroll(dx, dy)
  const outcome = await withComputerApproval(
    ctx,
    {
      toolName: 'scroll',
      summary: `${motion} at (${Math.round(x)}, ${Math.round(y)})`,
      detail: `${motion} with the pointer over (${Math.round(x)}, ${Math.round(y)}).`,
      settleMs: SETTLE_MS
    },
    (provider) => provider.scroll(x, y, dx, dy, ctx.signal)
  )

  return frameResult(ctx, 'scroll', `${motion}.`, outcome, { x, y, dx, dy })
})

function describeScroll(dx: number, dy: number): string {
  const parts: string[] = []
  if (dy !== 0) parts.push(`${Math.abs(dy)}px ${dy > 0 ? 'down' : 'up'}`)
  if (dx !== 0) parts.push(`${Math.abs(dx)}px ${dx > 0 ? 'right' : 'left'}`)
  return `Scroll ${parts.join(' and ')}`
}

/* ── drag ────────────────────────────────────────────────────────── */

export const dragSchema: ToolSchema = {
  name: 'drag',
  description:
    'Press at one point, move, and release at another — for moving items, resizing panes or selecting ' +
    'a range. Both points are in the most recent screenshot.',
  parameters: {
    type: 'object',
    properties: {
      from_x: { type: 'number', description: 'Where the drag starts.' },
      from_y: { type: 'number', description: 'Where the drag starts.' },
      to_x: { type: 'number', description: 'Where the drag ends.' },
      to_y: { type: 'number', description: 'Where the drag ends.' },
      from: { type: 'array', items: { type: 'number' }, description: 'Alternative to from_x/from_y: [x, y].' },
      to: { type: 'array', items: { type: 'number' }, description: 'Alternative to to_x/to_y: [x, y].' },
      purpose: { type: 'string', description: 'What the drag should achieve.' }
    }
  },
  mutating: true,
  computerUse: true
}

export const dragTool = defineTool(dragSchema, async (args, ctx) => {
  const from = readPoint(args, 'from')
  const to = readPoint(args, 'to')
  const purpose = typeof args.purpose === 'string' ? args.purpose : ''
  const summary = `Drag (${Math.round(from[0])}, ${Math.round(from[1])}) → (${Math.round(to[0])}, ${Math.round(to[1])})`

  const outcome = await withComputerApproval(
    ctx,
    {
      toolName: 'drag',
      summary,
      detail: purpose ? `${summary} — ${purpose}` : summary,
      settleMs: SETTLE_MS
    },
    (provider) => provider.drag(from, to, ctx.signal)
  )

  return frameResult(ctx, 'drag', `${summary}.`, outcome, { from, to })
})

function readPoint(args: Record<string, unknown>, prefix: 'from' | 'to'): [number, number] {
  const pair = optStrArray(args, prefix)
  if (pair && pair.length >= 2) {
    const x = Number(pair[0])
    const y = Number(pair[1])
    if (Number.isFinite(x) && Number.isFinite(y)) return [x, y]
  }
  const x = optNum(args, `${prefix}_x`)
  const y = optNum(args, `${prefix}_y`)
  if (x === undefined || y === undefined) {
    throw new ToolError(
      `drag needs ${prefix}_x and ${prefix}_y (or ${prefix}: [x, y]).`,
      'Take a screenshot and read both endpoints off it.'
    )
  }
  return [x, y]
}
