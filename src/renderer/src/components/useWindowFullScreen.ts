import { useEffect, useRef, useState } from 'react'
import { store } from '../state'

export interface WindowFullScreen {
  fullscreen: boolean
  toggleFullscreen: () => Promise<void>
}

/**
 * Native full screen, owned by the expanded view.
 *
 * `expanded` is the dialog that asked for it: while that is open the window may
 * be full screen, and every way out of it puts the window back.
 */
export function useWindowFullScreen(expanded: boolean): WindowFullScreen {
  const [fullscreen, setFullscreen] = useState(false)
  const ownsFullscreen = useRef(false)

  useEffect(() => {
    let disposed = false
    const changed = (): void => {
      void window.openbot.window.isFullScreen().then((active) => {
        if (!disposed) setFullscreen(active)
      })
    }
    window.addEventListener('resize', changed)
    changed()
    return () => {
      disposed = true
      window.removeEventListener('resize', changed)
    }
  }, [])

  const toggleFullscreen = async (): Promise<void> => {
    try {
      const requested = !fullscreen
      const active = await window.openbot.window.setFullScreen(requested)
      ownsFullscreen.current = requested && active
      setFullscreen(active)
      if (active !== requested) store.toast('The window could not change full-screen state.', 'error')
    } catch {
      store.toast('The window could not enter full screen.', 'error')
    }
  }

  /*
   * Leaving full screen belongs to `expanded` going false, not to the close
   * button.
   *
   * `expanded` is derived from `modal === 'computer'`, and Escape closes a modal
   * through the global shortcut handler — which never called `closeExpanded`.
   * The dialog went away, `ownsFullscreen` stayed true, and the window was left
   * full-screen with no in-app control left to bring it back. Restoring on the
   * state change catches every route out, including unmounting while expanded.
   */
  useEffect(() => {
    if (expanded || !ownsFullscreen.current) return
    ownsFullscreen.current = false
    setFullscreen(false)
    void window.openbot.window.setFullScreen(false)
  }, [expanded])

  /* The frame can also disappear while still expanded — closing the right rail
     unmounts it — and an unmounted component has no state change left to react
     to, so the restore has to happen on the way out as well. */
  useEffect(() => {
    return () => {
      if (!ownsFullscreen.current) return
      ownsFullscreen.current = false
      void window.openbot.window.setFullScreen(false)
    }
  }, [])

  return { fullscreen, toggleFullscreen }
}
