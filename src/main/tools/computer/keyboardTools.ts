/**
 * Keyboard tools: `type_text`, `key_press`.
 */

import type { ToolSchema } from '../../../shared/types'
import { reqStr } from '../args'
import { defineTool } from '../results'
import { truncateEnd } from '../text'
import { frameResult, withComputerApproval } from './gate'
import { KEY_CODES } from './localKeymap'

const SETTLE_MS = 350
const MAX_TEXT_CHARS = 5000

export const typeTextSchema: ToolSchema = {
  name: 'type_text',
  description:
    'Type text into whatever currently has keyboard focus. Click the field first. Newlines and tabs in ' +
    'the text are sent as Return and Tab, so this can fill a whole form in one call.',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'The text to type.' }
    },
    required: ['text']
  },
  mutating: true,
  computerUse: true
}

export const typeTextTool = defineTool(typeTextSchema, async (args, ctx) => {
  const text = reqStr(args, 'text', 'type_text').slice(0, MAX_TEXT_CHARS)
  const preview = truncateEnd(text, 300, 'preview truncated')

  const outcome = await withComputerApproval(
    ctx,
    {
      toolName: 'type_text',
      summary: `Type ${text.length} character${text.length === 1 ? '' : 's'}`,
      detail: `The following text will be typed into whatever has focus:\n\n${preview}`,
      settleMs: SETTLE_MS
    },
    (provider) => provider.typeText(text, ctx.signal)
  )

  return frameResult(ctx, 'type_text', `Typed ${text.length} characters.`, outcome, { length: text.length })
})

export const keyPressSchema: ToolSchema = {
  name: 'key_press',
  description:
    'Press a key or a keyboard shortcut. Combine modifiers with "+", modifiers first: "enter", "tab", ' +
    '"escape", "up", "down", "left", "right", "delete", "pageup", "pagedown", "home", "end", "f1"–"f19", ' +
    'or any single character. Examples: "cmd+s", "cmd+shift+p", "shift+tab", "ctrl+c".',
  parameters: {
    type: 'object',
    properties: {
      key: { type: 'string', description: 'The key or combination, e.g. "enter" or "cmd+s".' }
    },
    required: ['key']
  },
  mutating: true,
  computerUse: true
}

export const keyPressTool = defineTool(keyPressSchema, async (args, ctx) => {
  const combo = reqStr(args, 'key', 'key_press').trim()

  const outcome = await withComputerApproval(
    ctx,
    {
      toolName: 'key_press',
      summary: `Press ${combo}`,
      detail: `Send the key combination "${combo}" to the app in front.`,
      settleMs: SETTLE_MS
    },
    (provider) => provider.keyPress(combo, ctx.signal)
  )

  return frameResult(ctx, 'key_press', `Pressed ${combo}.`, outcome, { key: combo })
})

/** Named keys the model can rely on, for prompt construction and docs. */
export const NAMED_KEYS: string[] = Object.keys(KEY_CODES).sort()
