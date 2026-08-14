import { randomUUID } from 'node:crypto'
import type { AgentGroup } from '../../shared/types'
import { asId } from '../ipc/validate'
import { JsonCollection } from './collection'
import { groupsDir } from './paths'

const collection = new JsonCollection<AgentGroup>(groupsDir, normalise)

export const DEFAULT_GROUP_COLOR = '#7c9cff'

/**
 * A group colour exists to be interpolated into CSS — the first
 * `style={{ background: group.color }}` makes whatever is stored here an
 * injection sink, and `groupsUpdate` wrote any string of any length straight to
 * disk. Only a literal hex triplet is kept; anything else becomes the default
 * rather than being persisted for that component to find.
 */
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

/** Comfortably every bot a person would herd into one group. */
export const MAX_GROUP_MEMBERS = 100

export function asGroupColor(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_GROUP_COLOR
  const color = value.trim()
  return HEX_COLOR.test(color) ? color.toLowerCase() : DEFAULT_GROUP_COLOR
}

/** `asId`'s shape check without its throw: one bad member drops that member, not the group. */
function isMemberId(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    return asId(value) === value
  } catch {
    return false
  }
}

/**
 * Membership, or null when the value is not a list at all.
 *
 * Coercing a non-array to `[]` — what this used to do — turned one malformed
 * `groupsUpdate` patch into a silent wipe of the group's members, so the whole
 * document is rejected instead. Absent is still `[]`: groups written before
 * this field existed are legitimate.
 */
function memberIds(value: unknown): string[] | null {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) return null
  return [...new Set(value.filter(isMemberId))].slice(0, MAX_GROUP_MEMBERS)
}

function normalise(raw: unknown): AgentGroup | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  if (typeof value['id'] !== 'string' || typeof value['name'] !== 'string') return null
  const botIds = memberIds(value['botIds'])
  if (!botIds) return null
  const now = Date.now()
  return {
    id: value['id'], name: value['name'].slice(0, 120) || 'Untitled group',
    color: asGroupColor(value['color']),
    botIds,
    ...(value['pinned'] === true ? { pinned: true } : {}),
    createdAt: Number(value['createdAt']) || now, updatedAt: Number(value['updatedAt']) || now
  }
}

export const loadGroups = (): Promise<void> => collection.load()
export const listGroups = (): AgentGroup[] => collection.all().sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false) || a.createdAt - b.createdAt)

export function createGroup(name: string): AgentGroup {
  const now = Date.now()
  return collection.put({ id: randomUUID(), name: name.trim().slice(0, 120) || 'New group', color: DEFAULT_GROUP_COLOR, botIds: [], createdAt: now, updatedAt: now })
}

export function updateGroup(id: string, patch: Partial<AgentGroup>): AgentGroup | null {
  const group = collection.get(id)
  if (!group) return null
  return collection.put(normalise({ ...group, ...patch, id, createdAt: group.createdAt, updatedAt: Date.now() }) ?? group)
}

export const removeGroup = (id: string): boolean => collection.delete(id)

export function removeBotFromGroups(botId: string): void {
  for (const group of collection.all()) {
    if (group.botIds.includes(botId)) updateGroup(group.id, { botIds: group.botIds.filter((id) => id !== botId) })
  }
}
