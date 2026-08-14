/**
 * Where a popup menu opens when it must escape a scrolling ancestor.
 *
 * A board column scrolls (`.ob-kb-col-body`), and an absolutely positioned menu
 * inside a scroll container is clipped by it: opening "Move" on a card near the
 * bottom of a full column put the menu out of sight. That menu is the whole
 * keyboard alternative to dragging a card, so it is the path that matters most.
 *
 * The fix is to take the menu out of the column — `position: fixed`, placed from
 * the trigger's own rectangle. This is that arithmetic, kept pure so the flip
 * and the clamp can be tested without a browser.
 */

/** The trigger's box, in viewport coordinates — what `getBoundingClientRect` gives. */
export interface TriggerRect {
  top: number
  bottom: number
  right: number
}

export interface Viewport {
  width: number
  height: number
}

/** Fixed-position offsets. Exactly one of `top`/`bottom` is set. */
export interface MenuPlacement {
  top?: number
  bottom?: number
  right: number
  /** The menu scrolls inside this rather than running off the screen. */
  maxHeight: number
}

/** Breathing room between the trigger and the menu. */
const GAP = 4

/** Space kept clear of the window edges. */
const MARGIN = 8

/**
 * Never collapse to a sliver: below this, a menu with a couple of items would be
 * unreadable, and scrolling to reach "Move to Done" beats a 20px box.
 */
const MIN_HEIGHT = 96

/**
 * Opens below the trigger, or above it when there is more room there.
 *
 * The choice is made on available space rather than on the menu's own height, so
 * nothing has to be measured first — the menu is given a `maxHeight` that fits
 * whichever side won and scrolls inside it if the board has many columns.
 */
export function menuPlacement(trigger: TriggerRect, viewport: Viewport): MenuPlacement {
  const below = viewport.height - trigger.bottom - GAP - MARGIN
  const above = trigger.top - GAP - MARGIN
  // Right edges align, and the menu is pulled back in if the trigger sits under
  // the window edge.
  const right = Math.max(MARGIN, viewport.width - trigger.right)

  if (below >= above) {
    return { top: trigger.bottom + GAP, right, maxHeight: Math.max(MIN_HEIGHT, below) }
  }
  return { bottom: viewport.height - trigger.top + GAP, right, maxHeight: Math.max(MIN_HEIGHT, above) }
}
