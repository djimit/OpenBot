/** Results from OpenBOT's local, cross-workspace content search. */

export type SearchResultKind = 'message' | 'file' | 'link' | 'conversation' | 'bot' | 'project' | 'routine'

export interface SearchResult {
  id: string
  kind: SearchResultKind
  title: string
  snippet: string
  updatedAt: number
  sessionId?: string
  botId?: string
  projectId?: string
  routineId?: string
}
