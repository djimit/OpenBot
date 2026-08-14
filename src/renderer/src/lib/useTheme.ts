import { useEffect } from 'react'
import type { Settings } from '../../../shared/types'

const DARK_QUERY = '(prefers-color-scheme: dark)'

/**
 * Reflects the theme and font-size preferences onto the document root, where
 * tokens.css picks them up. 'system' follows the OS and keeps following it.
 */
export function useTheme(theme: Settings['theme'] | undefined, fontSize: number | undefined): void {
  useEffect(() => {
    const root = document.documentElement
    const media = window.matchMedia(DARK_QUERY)

    const apply = (): void => {
      const resolved = theme === 'system' || theme === undefined ? (media.matches ? 'dark' : 'light') : theme
      root.setAttribute('data-theme', resolved)
    }

    apply()
    if (theme !== undefined && theme !== 'system') return
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])

  useEffect(() => {
    const root = document.documentElement
    if (fontSize === undefined) return
    const clamped = Math.min(24, Math.max(9, Math.round(fontSize)))
    root.style.setProperty('--ob-font-size-base', `${clamped}px`)
  }, [fontSize])
}
