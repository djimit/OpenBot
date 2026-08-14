/** Sessions. One bot is a normal chat; several is an exchange. */

import type { Message } from './chat'

export type AgentMode = 'agent' | 'ask' | 'plan'

export interface TodoItem {
  id: string
  text: string
  status: 'pending' | 'in_progress' | 'completed'
}

export interface Session {
  id: string
  title: string
  cwd: string
  mode: AgentMode
  /** Project this chat belongs to; unset means a loose chat. */
  projectId?: string
  /** Bots participating. One = normal chat; many = an exchange. */
  botIds: string[]
  /** Whose turn it is in a multi-bot exchange. */
  activeBotId: string
  messages: Message[]
  todos: TodoItem[]
  archived?: boolean
  createdAt: number
  updatedAt: number
}

export interface SessionSummary {
  id: string
  title: string
  botIds: string[]
  projectId?: string
  archived?: boolean
  updatedAt: number
  messageCount: number
}
