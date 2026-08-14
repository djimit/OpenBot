/**
 * Key combos → Chrome DevTools Protocol key events.
 *
 * The combo syntax is the one the shared contract specifies — lowercase,
 * `+`-separated, modifiers first — and is identical to the local Mac provider's,
 * so a model writes "cmd+s" whichever target it is driving. Only the encoding
 * differs: virtual key codes and modifier bits here, AppleScript there.
 */

import { ToolError } from '../../errors'

export const MOD_ALT = 1
export const MOD_CTRL = 2
export const MOD_META = 4
export const MOD_SHIFT = 8

export interface CdpKey {
  modifiers: number
  key: string
  code: string
  vk: number
  /** Present only when the key produces text; absent for pure shortcuts. */
  text?: string
}

const NAMED_KEYS: Record<string, Omit<CdpKey, 'modifiers'>> = {
  enter: { key: 'Enter', code: 'Enter', vk: 13, text: '\r' },
  return: { key: 'Enter', code: 'Enter', vk: 13, text: '\r' },
  tab: { key: 'Tab', code: 'Tab', vk: 9, text: '\t' },
  escape: { key: 'Escape', code: 'Escape', vk: 27 },
  esc: { key: 'Escape', code: 'Escape', vk: 27 },
  backspace: { key: 'Backspace', code: 'Backspace', vk: 8 },
  delete: { key: 'Delete', code: 'Delete', vk: 46 },
  space: { key: ' ', code: 'Space', vk: 32, text: ' ' },
  up: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 },
  down: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
  left: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 },
  right: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
  home: { key: 'Home', code: 'Home', vk: 36 },
  end: { key: 'End', code: 'End', vk: 35 },
  pageup: { key: 'PageUp', code: 'PageUp', vk: 33 },
  pagedown: { key: 'PageDown', code: 'PageDown', vk: 34 }
}
for (let i = 1; i <= 12; i++) {
  NAMED_KEYS[`f${i}`] = { key: `F${i}`, code: `F${i}`, vk: 111 + i }
}

export function parseCombo(combo: string): CdpKey {
  const parts = combo
    .split(/[+\s]+/)
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean)
  if (parts.length === 0) throw new ToolError('The key combination is empty.')

  let modifiers = 0
  let target = ''
  for (const part of parts) {
    if (part === 'cmd' || part === 'command' || part === 'meta') modifiers |= MOD_META
    else if (part === 'ctrl' || part === 'control') modifiers |= MOD_CTRL
    else if (part === 'alt' || part === 'option') modifiers |= MOD_ALT
    else if (part === 'shift') modifiers |= MOD_SHIFT
    else target = part
  }
  if (!target) {
    throw new ToolError(
      `"${combo}" has modifiers but no key.`,
      'Name the key too, for example "cmd+s".'
    )
  }

  const named = NAMED_KEYS[target]
  if (named) return { modifiers, ...named }

  if (target.length === 1) {
    const upper = target.toUpperCase()
    return {
      modifiers,
      key: modifiers & MOD_SHIFT ? upper : target,
      code: /[a-z]/.test(target) ? `Key${upper}` : `Digit${target}`,
      vk: upper.charCodeAt(0),
      // A key held with cmd/ctrl/alt is a shortcut, not text input.
      text: modifiers & ~MOD_SHIFT ? undefined : modifiers & MOD_SHIFT ? upper : target
    }
  }

  throw new ToolError(
    `Unrecognised key "${target}" in "${combo}".`,
    `Use a single character or one of: ${Object.keys(NAMED_KEYS).sort().join(', ')}.`
  )
}

/**
 * Chrome's named editing commands for a modifier+key pair.
 *
 * Editing shortcuts (select-all, copy, paste…) are normally handled by the
 * browser's native menu layer, which does not exist in a headless browser.
 * Dispatching the keystroke alone silently does nothing, so the command is
 * named explicitly — otherwise an agent's "cmd+a, backspace" clears exactly one
 * character. Both cmd and ctrl are accepted so a model trained on either
 * platform's habits still edits text correctly.
 */
export function editingCommands(modifiers: number, key: string): string[] {
  const accel = (modifiers & MOD_META) !== 0 || (modifiers & MOD_CTRL) !== 0
  if (!accel) return []
  const shift = (modifiers & MOD_SHIFT) !== 0
  switch (key.toLowerCase()) {
    case 'a':
      return ['selectAll']
    case 'c':
      return ['copy']
    case 'v':
      return ['paste']
    case 'x':
      return ['cut']
    case 'z':
      return shift ? ['redo'] : ['undo']
    case 'arrowleft':
      return [shift ? 'moveToBeginningOfLineAndModifySelection' : 'moveToBeginningOfLine']
    case 'arrowright':
      return [shift ? 'moveToEndOfLineAndModifySelection' : 'moveToEndOfLine']
    case 'backspace':
      return ['deleteToBeginningOfLine']
    default:
      return []
  }
}
