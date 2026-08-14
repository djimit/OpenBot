/**
 * Lazy, failure-tolerant access to the backend registry, plus a cache of the
 * last successful detection so `backends.list()` is cheap and `refresh()` is
 * the only call that actually probes the machine.
 *
 * `src/main/backends/registry.ts` is owned by another module; if it cannot be
 * loaded the UI simply shows no backends instead of failing to start.
 */

import type { BackendInfo } from '../../shared/types'
import type { BackendConfig } from '../../shared/types'
import { getSettings } from '../settings'

interface RegistryModule {
  detectAll(configs?: Record<string, BackendConfig>): Promise<BackendInfo[]> | BackendInfo[]
  cachedBackendInfos(): Promise<BackendInfo[]> | BackendInfo[]
}

let cachedModule: Promise<Partial<RegistryModule> | null> | null = null
let lastDetected: BackendInfo[] | null = null

/**
 * Resolved at build time: the map is populated when the registry exists and
 * empty when it does not, so a missing peer module can never fail the build.
 */
// @ts-ignore `import.meta.glob` is a Vite build-time transform.
const candidates = import.meta.glob('../backends/registry.ts') as Record<
  string,
  () => Promise<unknown>
>

async function importRegistry(): Promise<Partial<RegistryModule> | null> {
  const load = Object.values(candidates)[0]
  if (!load) {
    console.warn('[openbot/ipc] backend registry is not part of this build')
    return null
  }
  try {
    return (await load()) as Partial<RegistryModule>
  } catch (err) {
    console.warn('[openbot/ipc] backend registry unavailable:', err)
    return null
  }
}

function loadRegistry(): Promise<Partial<RegistryModule> | null> {
  if (!cachedModule) {
    cachedModule = importRegistry().then((module) => {
      if (!module) cachedModule = null
      return module
    })
  }
  return cachedModule
}

/** Probe every backend. Returns the previous result if detection fails. */
export async function detectBackends(): Promise<BackendInfo[]> {
  const module = await loadRegistry()
  if (!module || typeof module.detectAll !== 'function') return lastDetected ?? []
  try {
    const detected = await module.detectAll(getSettings().backends)
    lastDetected = Array.isArray(detected) ? detected : []
    return lastDetected
  } catch (err) {
    console.error('[openbot/ipc] backend detection failed', err)
    return lastDetected ?? []
  }
}

/** Last-known backends from disk; machine probing belongs to explicit refresh. */
export async function listBackends(): Promise<BackendInfo[]> {
  if (lastDetected) return lastDetected
  const module = await loadRegistry()
  if (!module || typeof module.cachedBackendInfos !== 'function') return []
  try {
    const cached = await module.cachedBackendInfos()
    lastDetected = Array.isArray(cached) ? cached : []
    return lastDetected
  } catch (err) {
    console.warn('[openbot/ipc] backend status cache unavailable', err)
    return []
  }
}
