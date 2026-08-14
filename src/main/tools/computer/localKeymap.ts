/**
 * Named keys → macOS virtual key codes, and combo parsing.
 *
 * Pure data and string parsing for the local (this-Mac) provider — no process
 * execution lives here. `localInput.ts` turns the parsed result into System
 * Events statements.
 *
 * Accepted combo syntax: parts joined by `+` or `-`, modifiers first, e.g.
 *   "enter" · "cmd+s" · "shift+tab" · "ctrl+alt+delete" · "cmd+shift+4"
 */

export type Modifier = 'command' | 'shift' | 'option' | 'control' | 'function'

const MODIFIER_ALIASES: Record<string, Modifier> = {
  cmd: 'command',
  command: 'command',
  meta: 'command',
  super: 'command',
  win: 'command',
  '⌘': 'command',
  shift: 'shift',
  '⇧': 'shift',
  opt: 'option',
  option: 'option',
  alt: 'option',
  '⌥': 'option',
  ctrl: 'control',
  control: 'control',
  '⌃': 'control',
  fn: 'function',
  function: 'function'
}

/**
 * Keys that must be sent as `key code N` because they produce no character.
 * Values are macOS virtual key codes (Carbon `kVK_*`).
 */
export const KEY_CODES: Record<string, number> = {
  return: 36,
  enter: 36,
  tab: 48,
  space: 49,
  spacebar: 49,
  delete: 51,
  backspace: 51,
  escape: 53,
  esc: 53,
  capslock: 57,
  clear: 71,
  keypadenter: 76,
  help: 114,
  home: 115,
  pageup: 116,
  pgup: 116,
  forwarddelete: 117,
  del: 117,
  end: 119,
  pagedown: 121,
  pgdn: 121,
  left: 123,
  leftarrow: 123,
  right: 124,
  rightarrow: 124,
  down: 125,
  downarrow: 125,
  up: 126,
  uparrow: 126,
  f1: 122,
  f2: 120,
  f3: 99,
  f4: 118,
  f5: 96,
  f6: 97,
  f7: 98,
  f8: 100,
  f9: 101,
  f10: 109,
  f11: 103,
  f12: 111,
  f13: 105,
  f14: 107,
  f15: 113,
  f16: 106,
  f17: 64,
  f18: 79,
  f19: 80,
  volumeup: 72,
  volumedown: 73,
  mute: 74
}

export interface ParsedCombo {
  modifiers: Modifier[]
  /** Set when the key has a virtual key code (non-character keys). */
  keyCode?: number
  /** Set when the key is a single printable character sent via `keystroke`. */
  character?: string
  /** Human-readable form, for error messages and approval prompts. */
  label: string
}

export class UnknownKeyError extends Error {
  constructor(key: string) {
    super(
      `Unknown key "${key}". Use a single character, or one of: ${Object.keys(KEY_CODES).sort().join(', ')} — ` +
        'optionally prefixed with cmd/shift/option/control, e.g. "cmd+shift+p".'
    )
    this.name = 'UnknownKeyError'
  }
}

export function parseCombo(combo: string): ParsedCombo {
  const raw = combo.trim()
  if (!raw) throw new UnknownKeyError('(empty)')

  // Split on + or -, but keep a trailing literal "+" / "-" as the key itself.
  const parts = raw
    .split(/[+-]/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
  if (parts.length === 0) parts.push(raw)
  if (/[+-]$/.test(raw)) parts.push(raw.slice(-1))

  const modifiers: Modifier[] = []
  let keyToken = parts[parts.length - 1]

  for (const part of parts.slice(0, -1)) {
    const mod = MODIFIER_ALIASES[part.toLowerCase()]
    if (!mod) throw new UnknownKeyError(part)
    if (!modifiers.includes(mod)) modifiers.push(mod)
  }

  // A lone modifier name ("shift") is a key press of that modifier — reject it
  // rather than silently sending nothing.
  const lower = keyToken.toLowerCase()
  if (parts.length === 1 && MODIFIER_ALIASES[lower]) {
    throw new UnknownKeyError(`${keyToken} (a modifier on its own does nothing — combine it, e.g. "cmd+${keyToken}")`)
  }

  const label = [...modifiers, keyToken].join('+')
  const code = KEY_CODES[lower]
  if (code !== undefined) return { modifiers, keyCode: code, label }
  if ([...keyToken].length === 1) return { modifiers, character: keyToken, label }
  keyToken = lower
  throw new UnknownKeyError(keyToken)
}

/** AppleScript `using {…}` clause for the parsed modifiers. */
export function modifierClause(modifiers: Modifier[]): string {
  const usable = modifiers.filter((m) => m !== 'function')
  if (usable.length === 0) return ''
  return ` using {${usable.map((m) => `${m} down`).join(', ')}}`
}
