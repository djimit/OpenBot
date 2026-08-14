/**
 * Guarded access to the projects half of the bridge.
 *
 * The shape comes from the shared contract, but every call is looked up at the
 * moment it is made: a preload that predates projects leaves the namespace
 * undefined, and the UI should disable a control and say so rather than throw
 * through the render tree.
 */

import type { OpenBotApi } from '../../../shared/types'
import { tryBridge } from './bridge'
import { store } from './core'

export type ProjectsBridge = OpenBotApi['projects']
type SessionsBridge = OpenBotApi['sessions']

const UNAVAILABLE = 'That project action is not available in this build yet.'

const namespace = (): Partial<ProjectsBridge> | null =>
  (tryBridge()?.projects as Partial<ProjectsBridge> | undefined) ?? null

/** One bridge method, bound to its namespace, or null when it is absent. */
export function reach<K extends keyof ProjectsBridge>(name: K): ProjectsBridge[K] | null {
  const api = namespace()
  const fn = api?.[name] as ((...args: unknown[]) => unknown) | undefined
  if (typeof fn !== 'function' || !api) return null
  return fn.bind(api) as ProjectsBridge[K]
}

/**
 * The same guard for the sessions half. Opening a chat from a card straddles
 * both namespaces, and an older preload can be missing either of them.
 */
export function session<K extends keyof SessionsBridge>(name: K): SessionsBridge[K] | null {
  const api = tryBridge()?.sessions as Partial<SessionsBridge> | undefined
  const fn = api?.[name] as ((...args: unknown[]) => unknown) | undefined
  if (typeof fn !== 'function' || !api) return null
  return fn.bind(api) as SessionsBridge[K]
}

/** Best effort: the caller has already done something it cannot undo. */
export async function settle<T>(work: Promise<T> | null): Promise<T | null> {
  try {
    return work ? await work : null
  } catch {
    return null
  }
}

/** True once the main process exposes projects — controls disable themselves otherwise. */
export function projectsReady(): boolean {
  return reach('list') !== null
}

export function unavailable(): void {
  store.toast(UNAVAILABLE, 'error')
}

/** Files a chat into a project. Older preloads simply lack it, so it is optional. */
export async function setSessionProject(sessionId: string, projectId: string | null): Promise<void> {
  const setProject = session('setProject')
  if (!setProject) return
  await setProject(sessionId, projectId)
}
