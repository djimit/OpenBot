import { randomUUID } from 'node:crypto'
import type { ActivityItem, ActivityKind } from '../../shared/types'
import { JsonCollection } from './collection'
import { activityDir } from './paths'

const collection = new JsonCollection<ActivityItem>(activityDir, normalise)

function normalise(raw: unknown): ActivityItem | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  if (typeof value['id'] !== 'string' || typeof value['title'] !== 'string') return null
  const kinds: ActivityKind[] = ['info', 'approval', 'help', 'completed', 'failed']
  const kind = kinds.includes(value['kind'] as ActivityKind) ? value['kind'] as ActivityKind : 'info'
  return {
    id: value['id'], kind, title: value['title'].slice(0, 200),
    detail: typeof value['detail'] === 'string' ? value['detail'].slice(0, 2000) : '',
    read: value['read'] === true,
    createdAt: Number(value['createdAt']) || Date.now(),
    ...(typeof value['sessionId'] === 'string' ? { sessionId: value['sessionId'] } : {}),
    ...(typeof value['botId'] === 'string' ? { botId: value['botId'] } : {})
  }
}

export const loadActivity = (): Promise<void> => collection.load()
export const listActivity = (): ActivityItem[] => collection.all().sort((a, b) => b.createdAt - a.createdAt)

export function addActivity(kind: ActivityKind, title: string, detail: string, scope: { sessionId?: string; botId?: string } = {}): ActivityItem {
  const item: ActivityItem = { id: randomUUID(), kind, title: title.slice(0, 200), detail: detail.slice(0, 2000), read: false, createdAt: Date.now(), ...scope }
  collection.put(item)
  for (const stale of listActivity().slice(500)) collection.delete(stale.id)
  return item
}

export function markActivityRead(id?: string): void {
  for (const item of collection.all()) {
    if ((!id || item.id === id) && !item.read) collection.put({ ...item, read: true })
  }
}

export function clearActivity(): void {
  for (const item of collection.all()) collection.delete(item.id)
}
