import type { AgentGroup } from '../../shared/types'
import {
  asGroupColor,
  createGroup,
  DEFAULT_GROUP_COLOR,
  listGroups,
  MAX_GROUP_MEMBERS,
  removeGroup,
  updateGroup
} from '../store/groups'
import { CHANNELS } from './channels'
import { emptyArray, handle, handleVoid, nullResult } from './handler'
import { asId, asIdArray, asPatch, asString } from './validate'

/**
 * The fields a group's editor may set, each checked here rather than trusted
 * into the store.
 *
 * `groupsUpdate` used to persist whatever the patch carried: `color` — which
 * exists to be interpolated into CSS — as arbitrary text of any length, and
 * `botIds` as an unbounded array of strings that had never met `asId`. Anything
 * the patch does not mention is left alone.
 */
function groupPatch(raw: unknown): Partial<AgentGroup> {
  const patch = asPatch<AgentGroup>(raw)
  const next: Partial<AgentGroup> = {}
  if (patch.name !== undefined) next.name = asString(patch.name, 120)
  if (patch.color !== undefined) next.color = asGroupColor(patch.color)
  if (patch.botIds !== undefined) {
    /*
     * `asIdArray` throws on anything that is not an array, and that is the
     * point: membership arriving in the wrong shape is refused outright rather
     * than read as "remove everyone", which is how a malformed patch silently
     * emptied a group.
     */
    const botIds = asIdArray(patch.botIds)
    if (botIds.length > MAX_GROUP_MEMBERS) {
      throw new TypeError(`a group holds at most ${MAX_GROUP_MEMBERS} bots`)
    }
    next.botIds = botIds
  }
  if (patch.pinned !== undefined) next.pinned = patch.pinned === true
  return next
}

export function registerGroupIpc(): void {
  handle<AgentGroup[]>(CHANNELS.groupsList, () => listGroups(), emptyArray)
  handle<AgentGroup>(CHANNELS.groupsCreate, ([name]) => createGroup(asString(name, 120)), () => {
    const now = Date.now()
    return { id: '', name: 'New group', color: DEFAULT_GROUP_COLOR, botIds: [], createdAt: now, updatedAt: now }
  })
  handle<AgentGroup | null>(CHANNELS.groupsUpdate, ([id, patch]) => updateGroup(asId(id), groupPatch(patch)), nullResult)
  handleVoid(CHANNELS.groupsRemove, ([id]) => { removeGroup(asId(id)) })
}
