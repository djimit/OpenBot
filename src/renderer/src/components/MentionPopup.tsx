import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Bot } from '../../../shared/types'
import { BotAvatar } from './BotAvatar'
import './MentionPopup.css'

/**
 * The `@` query the caret currently sits in, or null.
 *
 * Only a mention at a word boundary counts, so an email address or a decorator
 * in pasted code does not open the picker.
 */
export function mentionQuery(value: string, caret: number): { query: string; start: number } | null {
  const before = value.slice(0, caret)
  const match = /(^|\s)@([\p{L}\p{N} _-]{0,40})$/u.exec(before)
  if (!match) return null
  return { query: match[2] ?? '', start: caret - (match[2]?.length ?? 0) - 1 }
}

/**
 * Insert the chosen bot, leaving the caret after a trailing space.
 *
 * The half-typed name may continue past the caret — editing in the middle of an
 * existing word is ordinary — so the rest of that word is swallowed too, and no
 * second space is added when one is already there.
 */
export function applyMention(value: string, start: number, caret: number, name: string): string {
  const rest = value.slice(caret)
  const tail = /^[\p{L}\p{N}_-]*/u.exec(rest)?.[0].length ?? 0
  const after = rest.slice(tail)
  return `${value.slice(0, start)}@${name}${after.startsWith(' ') ? '' : ' '}${after}`
}

/**
 * The bots a query addresses. Empty means the picker has nothing to show.
 *
 * An empty query addresses NOBODY, rather than everybody. `includes('')` is true
 * of every name, so a bare `@` — or `@` followed by a space, which trims back to
 * nothing — armed the picker over the whole roster, and the picker owns Enter
 * while it is armed: pressing Enter to send "email me @ the address below"
 * inserted a bot's name instead of sending the message. One typed character is
 * enough to bring the list back.
 */
export function matchBots(bots: Bot[], query: string): Bot[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  return bots.filter((bot) => bot.name.toLowerCase().includes(needle))
}

interface MentionPopupProps {
  bots: Bot[]
  query: string
  onPick: (bot: Bot) => void
  onDismiss: () => void
}

export function MentionPopup({ bots, query, onPick, onDismiss }: MentionPopupProps): ReactNode {
  const matches = matchBots(bots, query)
  const [active, setActive] = useState(0)

  // Keep the highlight in range as the query narrows the list.
  useEffect(() => setActive(0), [query])

  /*
   * Read through a ref, so the listener is installed once per open picker.
   * `matches` is a fresh array and the callbacks fresh closures on every render,
   * so listing them as dependencies tore the window listener down and put a new
   * one up on every single keystroke.
   */
  const latest = useRef({ matches, active, onPick, onDismiss })
  latest.current = { matches, active, onPick, onDismiss }
  const armed = matches.length > 0

  useEffect(() => {
    if (!armed) return
    const onKey = (e: globalThis.KeyboardEvent): void => {
      // An IME candidate list owns these keys first; stealing Enter mid-
      // composition would commit a bot instead of the word being typed.
      if (e.isComposing) return
      if (['Enter', 'Tab', 'ArrowUp', 'ArrowDown', 'Escape'].includes(e.key)) {
        // Nothing downstream may also act on this key: Escape in particular
        // reaches the global handler, which would stop the running turn.
        e.stopPropagation()
      }
      const current = latest.current
      const count = current.matches.length
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActive((i) => (i + 1) % count)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActive((i) => (i - 1 + count) % count)
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        const bot = current.matches[current.active]
        if (bot) current.onPick(bot)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        current.onDismiss()
      }
    }
    // Capture phase: the composer's own Enter handler must not send the message
    // while the picker is choosing a bot.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [armed])

  if (matches.length === 0) return null

  return (
    <div className="ob-mention" role="listbox" aria-label="Address a bot">
      {matches.map((bot, i) => (
        <button
          key={bot.id}
          type="button"
          role="option"
          aria-selected={i === active}
          className={`ob-mention-item${i === active ? ' is-active' : ''}`}
          onMouseEnter={() => setActive(i)}
          onMouseDown={(e) => {
            // mousedown, not click: the textarea must not lose focus first.
            e.preventDefault()
            onPick(bot)
          }}
        >
          <BotAvatar bot={bot} size="sm" />
          <span className="ob-mention-name">{bot.name}</span>
          {bot.description ? <span className="ob-mention-desc">{bot.description}</span> : null}
        </button>
      ))}
    </div>
  )
}
