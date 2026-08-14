/**
 * Settings reads/writes, over the `store/settings` facade.
 *
 * Reads are normalised because the loop indexes into `allowlist`, `denylist` and
 * `backends` on every tool call, and a half-written settings file must degrade to the
 * cautious defaults rather than to `undefined`.
 */

import type { Settings } from '../../shared/types'
import { appendSetting, defaultSettings, getSettings, updateSettings, type ListSetting } from '../store/settings'
import { errorMessage } from './errors'

function normalise(raw: Settings): Settings {
  return {
    ...raw,
    allowlist: Array.isArray(raw.allowlist) ? raw.allowlist : [],
    denylist: Array.isArray(raw.denylist) ? raw.denylist : [],
    backends: raw.backends && typeof raw.backends === 'object' ? raw.backends : {},
    computerUseAllowedApps: Array.isArray(raw.computerUseAllowedApps)
      ? raw.computerUseAllowedApps
      : [],
    rules: typeof raw.rules === 'string' ? raw.rules : '',
    telemetry: false
  }
}

export const settingsStore = {
  async get(): Promise<Settings> {
    try {
      return normalise(getSettings())
    } catch (err) {
      console.warn(`[agent] settings read failed: ${errorMessage(err)}`)
      return defaultSettings()
    }
  },

  async update(patch: Partial<Settings>): Promise<Settings> {
    try {
      return normalise(updateSettings(patch))
    } catch (err) {
      console.warn(`[agent] settings update failed: ${errorMessage(err)}`)
      return settingsStore.get()
    }
  },

  /*
   * Deliberately synchronous, and deliberately not built from `get` + `update`.
   * Read-then-await-then-write loses one of two concurrent additions: settings
   * arrays are replaced wholesale, so approving "always allow" on two parked
   * requests in quick succession dropped one rule for good and re-prompted for
   * it forever. There must be no suspension point between the read and the
   * write, which is what an `async` wrapper would reintroduce.
   */
  append(key: ListSetting, value: string): void {
    try {
      appendSetting(key, value)
    } catch (err) {
      console.warn(`[agent] settings append failed: ${errorMessage(err)}`)
    }
  }
}
