import type { ReactNode, RefObject } from 'react'
import type { Bot } from '../../../shared/types'
import { MentionPopup, applyMention } from './MentionPopup'

/** Which `@` mention the caret is inside. */
export interface MentionState {
  query: string
  start: number
  caret: number
}

interface MentionProps {
  bots: Bot[]
  mention: MentionState
  text: string
  input: RefObject<HTMLTextAreaElement | null>
  onPicked: (text: string) => void
  onDismiss: () => void
}

/** The `@` picker, and what choosing from it does to the message being typed. */
export function ComposerMention({ bots, mention, text, input, onPicked, onDismiss }: MentionProps): ReactNode {
  return (
    <MentionPopup
      bots={bots}
      query={mention.query}
      onDismiss={onDismiss}
      onPick={(bot) => {
        const next = applyMention(text, mention.start, mention.caret, bot.name)
        onPicked(next)
        // Restore focus and drop the caret after the inserted name.
        const at = mention.start + bot.name.length + 2
        requestAnimationFrame(() => {
          const el = input.current
          if (!el) return
          el.focus()
          el.setSelectionRange(at, at)
        })
      }}
    />
  )
}
