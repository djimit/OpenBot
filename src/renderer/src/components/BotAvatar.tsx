import type { CSSProperties, ReactNode } from 'react'
import type { Bot } from '../../../shared/types'
import './BotAvatar.css'

interface BotAvatarProps {
  bot?: Pick<Bot, 'emoji' | 'color' | 'name'>
  size?: 'sm' | 'md' | 'lg'
  /** Adds a faint halo — used where avatars sit on a busy surface. */
  ring?: boolean
  active?: boolean
}

/** Solid identity circle in the bot's own colour, carrying its glyph. */
export function BotAvatar({ bot, size = 'md', ring = false, active = false }: BotAvatarProps): ReactNode {
  const style = { '--ob-bot-color': bot?.color ?? 'var(--ob-accent)' } as CSSProperties
  return (
    <span
      className={`ob-avatar ob-avatar-${size}${ring ? ' ob-avatar-ring' : ''}${active ? ' ob-avatar-active' : ''}`}
      style={style}
      aria-hidden="true"
    >
      {bot?.emoji || '◆'}
    </span>
  )
}
