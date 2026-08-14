/**
 * Keeping a message list at its newest message while tokens stream in.
 *
 * Streaming never re-renders the list — each bubble subscribes to its own
 * message — so an effect on the message array cannot hold the view down. A
 * ResizeObserver on the content is the only thing that does.
 *
 * That observer has to follow the node, not the first node it ever saw. The
 * transcript swaps its whole tree while a chat opens (`sessionLoading` renders a
 * spinner instead), so the observed div is destroyed and a NEW one mounted in
 * its place. Watching the detached one meant the reply streamed off the bottom
 * of the viewport after every chat switch, jumping back only when a new message
 * arrived and re-rendered the list. Hence a callback ref: React hands us each
 * node as it mounts and runs the cleanup when it goes.
 */

import { useCallback, useRef, type RefObject } from 'react'

/** How far from the bottom still counts as "reading the latest". */
export const STICK_THRESHOLD = 72

/** What a scroller looks like to these rules — the three numbers that matter. */
export interface ScrollGeometry {
  scrollHeight: number
  scrollTop: number
  clientHeight: number
}

/** True when the reader is at the bottom, so new content should carry them. */
export function isStuck(geometry: ScrollGeometry, threshold = STICK_THRESHOLD): boolean {
  return geometry.scrollHeight - geometry.scrollTop - geometry.clientHeight <= threshold
}

/**
 * True when a "jump to latest" affordance is worth offering: the reader has
 * scrolled away AND there is meaningfully more below. Without the second half
 * the button flickers on over a list barely taller than its own viewport.
 */
export function showsJump(geometry: ScrollGeometry, threshold = STICK_THRESHOLD): boolean {
  return !isStuck(geometry, threshold) && geometry.scrollHeight > geometry.clientHeight + threshold
}

function geometryOf(el: HTMLElement): ScrollGeometry {
  return { scrollHeight: el.scrollHeight, scrollTop: el.scrollTop, clientHeight: el.clientHeight }
}

export interface StickyScroll {
  scrollerRef: RefObject<HTMLDivElement | null>
  /** Callback ref for the growing content — see the note at the top. */
  contentRef: (node: HTMLDivElement | null) => (() => void) | void
  onScroll: () => void
  /** Back to the bottom, unless the reader has scrolled away. */
  pin: () => void
  /** Back to the bottom regardless: the jump button, and opening a chat. */
  jump: (behavior?: ScrollBehavior) => void
}

/**
 * @param onScrolled Told about every scroll, for a jump button or similar.
 */
export function useStickyScroll(onScrolled?: (geometry: ScrollGeometry, stuck: boolean) => void): StickyScroll {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const stuck = useRef(true)

  // Held in a ref so `contentRef` keeps one identity: a callback ref that
  // changed every render would detach and re-attach the observer just as often.
  const notify = useRef(onScrolled)
  notify.current = onScrolled

  const pin = useCallback(() => {
    const el = scrollerRef.current
    if (el && stuck.current) el.scrollTo({ top: el.scrollHeight })
  }, [])

  const jump = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = scrollerRef.current
    if (!el) return
    stuck.current = true
    el.scrollTo({ top: el.scrollHeight, behavior })
  }, [])

  const onScroll = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    const geometry = geometryOf(el)
    stuck.current = isStuck(geometry)
    notify.current?.(geometry, stuck.current)
  }, [])

  const contentRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) return
      const observer = new ResizeObserver(() => pin())
      observer.observe(node)
      return () => observer.disconnect()
    },
    [pin]
  )

  return { scrollerRef, contentRef, onScroll, pin, jump }
}
