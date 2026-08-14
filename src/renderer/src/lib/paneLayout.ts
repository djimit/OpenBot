/**
 * Pane-grid presets for the multi-pane workspace.
 *
 * The preset vocabulary and the grid maths are ported from a terminal
 * multiplexer, where they were proven against real panes; only the pane
 * contents differ here (terminals became chats). Everything in this module is
 * pure — no React, no store, no DOM — so the tiling is a function of
 * (preset, pane index) alone and can be reasoned about on its own.
 */

export type LayoutPreset = 'single' | 'two-columns' | 'two-rows' | 'top-main' | 'left-main' | 'four'

export interface LayoutPresetInfo {
  value: LayoutPreset
  /** Short control label. */
  label: string
  /** How many panes the preset tiles. */
  slots: number
  /** Sentence used as the control's tooltip and accessible description. */
  hint: string
}

/** Presentation order of the presets — also the order of the Alt+1…6 keys. */
export const LAYOUT_PRESETS: readonly LayoutPresetInfo[] = [
  { value: 'single', label: 'Single', slots: 1, hint: 'One conversation, full width' },
  { value: 'two-columns', label: 'Columns', slots: 2, hint: 'Two conversations side by side' },
  { value: 'two-rows', label: 'Rows', slots: 2, hint: 'Two conversations stacked' },
  { value: 'top-main', label: 'Top + side', slots: 3, hint: 'One wide conversation above two' },
  { value: 'left-main', label: 'Left + side', slots: 3, hint: 'One tall conversation beside two' },
  { value: 'four', label: 'Grid of 4', slots: 4, hint: 'Four conversations in a 2×2 grid' }
]

const SLOTS: Record<LayoutPreset, number> = {
  single: 1,
  'two-columns': 2,
  'two-rows': 2,
  'top-main': 3,
  'left-main': 3,
  four: 4
}

/** What a first-time workspace opens with: a split is the whole point of it. */
export const DEFAULT_PRESET: LayoutPreset = 'two-columns'

export function presetSlots(preset: LayoutPreset): number {
  return SLOTS[preset] ?? 1
}

export function isLayoutPreset(value: unknown): value is LayoutPreset {
  return typeof value === 'string' && Object.hasOwn(SLOTS, value)
}

export function presetInfo(preset: LayoutPreset): LayoutPresetInfo {
  return LAYOUT_PRESETS.find((p) => p.value === preset) ?? LAYOUT_PRESETS[0]
}

/**
 * A CSS grid template. Deliberately a plain object rather than React's
 * `CSSProperties`, so this module stays framework-free; it is structurally
 * assignable to a `style` prop.
 */
export interface PaneGridStyle {
  gridTemplateColumns: string
  gridTemplateRows: string
  gridTemplateAreas?: string
}

/**
 * The grid template for a preset. `top-main` and `left-main` use named areas so
 * the first pane is the large one and the rest stack alongside it; the other
 * presets are even columns/rows and let the panes flow in order.
 */
export function gridStyleFor(preset: LayoutPreset): PaneGridStyle {
  switch (preset) {
    case 'single':
      return { gridTemplateColumns: '1fr', gridTemplateRows: '1fr' }
    case 'two-columns':
      return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr' }
    case 'two-rows':
      return { gridTemplateColumns: '1fr', gridTemplateRows: '1fr 1fr' }
    case 'top-main':
      return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '2fr 1fr', gridTemplateAreas: '"main main" "a b"' }
    case 'left-main':
      return { gridTemplateColumns: '2fr 1fr', gridTemplateRows: '1fr 1fr', gridTemplateAreas: '"main a" "main b"' }
    case 'four':
      return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr' }
    default:
      return { gridTemplateColumns: '1fr', gridTemplateRows: '1fr' }
  }
}

/**
 * The named grid area pane `index` occupies, or undefined for presets whose
 * panes flow naturally into the next cell.
 */
export function paneAreaFor(preset: LayoutPreset, index: number): string | undefined {
  if (preset !== 'top-main' && preset !== 'left-main') return undefined
  if (index === 0) return 'main'
  if (index === 1) return 'a'
  if (index === 2) return 'b'
  return undefined
}

/**
 * Resize a slot list to a preset. Growing adds empty slots; shrinking DROPS the
 * panes past the last slot rather than keeping them alive but invisible, so what
 * the state holds is always what the grid shows.
 */
export function fitPanes<T>(panes: readonly (T | null)[], preset: LayoutPreset): (T | null)[] {
  return Array.from({ length: presetSlots(preset) }, (_, i) => panes[i] ?? null)
}
