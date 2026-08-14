import { useSyncExternalStore } from 'react'
import type { Message } from '../../../shared/types'
import { store } from './core'
import type { AppState } from './types'

/**
 * Whole-app snapshot. Streaming tokens never touch this object, so the hot
 * path stays off the global subscription.
 */
export function useAppState(): AppState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState)
}

/** Subscribes a single bubble to a single message. */
export function useMessage(id: string): Message | undefined {
  const subscribe = (onChange: () => void): (() => void) => store.subscribeMessage(id, onChange)
  const read = (): Message | undefined => store.getMessage(id)
  return useSyncExternalStore(subscribe, read, read)
}
