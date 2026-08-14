/**
 * Store-shaped facade over `main/settings.ts`.
 *
 * Settings live outside `store/` because they are a single document rather
 * than a collection, but consumers that resolve stores by path and by
 * conventional method name (`get`, `update`) expect to find them here.
 * This module is that address — the state itself is never duplicated.
 */

import type { Settings } from '../../shared/types'
import { appendSetting, getSettings, updateSettings, type ListSetting } from '../settings'

export function get(): Settings {
  return getSettings()
}

export function update(patch: Partial<Settings>): Settings {
  return updateSettings(patch)
}

/**
 * Add one value to a list setting without a read-await-write gap.
 *
 * Anything growing `allowlist`, `denylist` or `computerUseAllowedApps` must come
 * through here rather than reading the array and patching it back: `update`
 * replaces arrays wholesale, so two callers in the same turn silently drop one
 * of the two values.
 */
export function append(key: ListSetting, value: string): Settings {
  return appendSetting(key, value)
}

export type { ListSetting }
export { appendSetting, getSettings, updateSettings, defaultSettings } from '../settings'
