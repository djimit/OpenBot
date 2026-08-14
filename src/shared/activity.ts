/** Persistent local inbox and independently running agent tasks. */

export type ActivityKind = 'info' | 'approval' | 'help' | 'completed' | 'failed'

export interface ActivityItem {
  id: string
  kind: ActivityKind
  title: string
  detail: string
  read: boolean
  createdAt: number
  sessionId?: string
  botId?: string
}

export type AgentTaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface AgentTask {
  id: string
  botId: string
  prompt: string
  title: string
  status: AgentTaskStatus
  sessionId: string
  createdAt: number
  updatedAt: number
  error?: string
}
