/** Core chat primitives: messages, tool calls, attachments. */

export type Role = 'system' | 'user' | 'assistant' | 'tool'

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

export interface ToolResult {
  callId: string
  name: string
  ok: boolean
  output: string
  /** Structured payload for rich renderers (diffs, screenshots, tables). */
  detail?: unknown
  /** base64 PNG, for computer-use tools that return a frame. */
  screenshot?: string
  durationMs?: number
  /** Payloads were dropped to bound the session file — see `store/compaction.ts`. */
  compacted?: boolean
}

export interface Attachment {
  id: string
  kind: 'file' | 'image' | 'selection'
  name: string
  path?: string
  mime?: string
  data?: string
}

export interface Message {
  id: string
  role: Role
  content: string
  reasoning?: string
  toolCalls?: ToolCall[]
  toolResult?: ToolResult
  attachments?: Attachment[]
  /** Which bot authored this turn, in a multi-bot exchange. */
  botId?: string
  /** Set when one bot hands work to another. */
  handoffTo?: string
  /** The message this one answers, when a bot is replying to a teammate. */
  replyTo?: string
  model?: string
  createdAt: number
  streaming?: boolean
  error?: string
  /** Emoji reactions keyed to local/LAN participant names. */
  reactions?: Record<string, string[]>
}
