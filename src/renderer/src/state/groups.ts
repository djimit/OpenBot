import type { AgentGroup } from '../../../shared/types'
import { bridge, errText } from './bridge'
import { store } from './core'

export async function loadGroups(): Promise<void> {
  try { store.patch({ groups: await bridge().groups.list() }) }
  catch (error) { store.toast(errText(error), 'error') }
}

export async function createGroup(name: string): Promise<AgentGroup | null> {
  try {
    const group = await bridge().groups.create(name)
    store.patch({ groups: [...store.getState().groups, group] })
    return group
  } catch (error) { store.toast(errText(error), 'error'); return null }
}

export async function updateGroup(id: string, patch: Partial<AgentGroup>): Promise<AgentGroup | null> {
  try {
    const group = await bridge().groups.update(id, patch)
    if (group) store.patch({ groups: store.getState().groups.map((item) => item.id === id ? group : item) })
    return group
  } catch (error) { store.toast(errText(error), 'error'); return null }
}

export async function removeGroup(id: string): Promise<void> {
  try {
    await bridge().groups.remove(id)
    store.patch({ groups: store.getState().groups.filter((group) => group.id !== id) })
  } catch (error) { store.toast(errText(error), 'error') }
}
