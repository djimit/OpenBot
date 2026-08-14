/**
 * Settings lifecycle: load once at startup, keep in memory, persist changes.
 * Shape, defaults and merging live in `settingsSchema.ts`.
 */

import type { Settings } from '../shared/types'
import {
  defaultSettings,
  deepMerge,
  isPlainObject,
  KNOWN_BACKEND_IDS,
  normaliseSettings
} from './settingsSchema'
import { readJsonState, writeJsonDebounced, writeJsonNow } from './store/jsonStore'
import { settingsFile } from './store/paths'
import {
  backendApiKey,
  clearBackendApiKey,
  hasBackendApiKey,
  setBackendApiKey
} from './store/backendSecrets'
import { clearMcpBearerToken, hasMcpBearerToken, mcpBearerToken, setMcpBearerToken } from './store/mcpSecrets'

let current: Settings = defaultSettings()
let loading: Promise<Settings> | null = null

/** Load `settings.json` from disk. Safe to call more than once. */
export function initSettings(): Promise<Settings> {
  if (!loading) loading = read()
  return loading
}

async function read(): Promise<Settings> {
  const file = settingsFile()
  const { status, value } = await readJsonState<unknown>(file, null)
  current = normaliseSettings(value)
  /**
   * A credential that could not be encrypted is still stripped from the file.
   *
   * This used to latch a flag that SKIPPED the rewrite below — the one write
   * that removes the plaintext `apiKey`/`bearerToken` from `settings.json` — so
   * a machine with no working OS credential store kept the secret sitting in a
   * world-readable JSON file indefinitely, and every later `updateSettings`
   * declined to persist too. Removing it from disk is the safer half of the
   * trade: the key stays usable in memory for this session, and the warning
   * says plainly that it has to be re-entered.
   */
  let secretMigrationFailed = false
  for (const [id, config] of Object.entries(current.backends)) {
    const legacy = config.apiKey?.trim()
    if (legacy) {
      try {
        setBackendApiKey(id, legacy)
      } catch (error) {
        secretMigrationFailed = true
        console.warn(
          '[openbot/settings] could not encrypt the plaintext API key for',
          id,
          '— it has been removed from settings.json and must be re-entered in Settings',
          error
        )
      }
    }
    const stored = backendApiKey(id)
    if (stored) config.apiKey = stored
    config.hasApiKey = Boolean(stored || legacy)
  }
  for (const server of current.mcpServers) {
    const legacy = server.bearerToken?.trim()
    if (legacy) {
      try {
        setMcpBearerToken(server.id, legacy)
      } catch (error) {
        secretMigrationFailed = true
        console.warn(
          '[openbot/settings] could not encrypt the plaintext MCP token for',
          server.id,
          '— it has been removed from settings.json and must be re-entered in Settings',
          error
        )
      }
    }
    // `?? legacy` so a failed migration does not also cut the session off from
    // a credential it already holds; only the on-disk copy goes.
    server.bearerToken = mcpBearerToken(server.id) ?? legacy
    server.hasBearerToken = hasMcpBearerToken(server.id) || Boolean(legacy)
  }
  // A file we could not open still holds the user's real config. Writing the
  // defaults over it — which is what "persist the normalised shape" would do
  // here — would destroy it, so this launch runs on defaults and leaves the
  // file alone. A missing, empty or quarantined file is safe to replace.
  if (status === 'unreadable') {
    console.warn('[openbot/settings] settings.json is unreadable; running on defaults')
    // Latched, because refusing to overwrite *here* only deferred the damage by
    // one write: the next `updateSettings` — a theme toggle is enough — wrote
    // the defaults straight over the intact file. The directory is still
    // writable, so nothing else stops it. API keys, allowlist and denylist all
    // went with it, which is a safety regression as well as data loss.
    unreadable = true
    return current
  }
  unreadable = false
  // Persist the normalised shape so the file always reflects the live schema,
  // but only when that actually changes something. A write that fails now says
  // so instead of resolving quietly, and it must not take startup down with it:
  // the settings in memory are valid either way.
  // `secretMigrationFailed` forces the write rather than suppressing it: that
  // is the pass that takes the plaintext credential off disk.
  const persisted = persistedSettings(current)
  if (
    secretMigrationFailed ||
    status !== 'ok' ||
    JSON.stringify(value) !== JSON.stringify(persisted)
  ) {
    try {
      await writeJsonNow(file, persisted)
    } catch (err) {
      console.error('[openbot/settings] could not persist the normalised settings', err)
    }
  }
  return current
}

/** The in-memory settings. Always a complete, valid object. */
export function getSettings(): Settings {
  return current
}

/** Set when the file could not be read: nothing may be persisted over it. */
let unreadable = false

/** Whether this launch is running on defaults because the file is unreadable. */
export function settingsAreUnreadable(): boolean {
  return unreadable
}

/** Deep-merge a partial update, persist it, and return the new settings. */
export function updateSettings(patch: Partial<Settings>): Settings {
  const merged = deepMerge<Record<string, unknown>>(
    current as unknown as Record<string, unknown>,
    isPlainObject(patch) ? (patch as Record<string, unknown>) : {}
  )
  current = normaliseSettings(merged)
  if (unreadable) {
    console.warn('[openbot/settings] not persisting over an unreadable settings.json')
    return current
  }
  writeJsonDebounced(settingsFile(), persistedSettings(current))
  announce(current)
  return current
}

/** Apply write-only API-key fields from the renderer without ever echoing a key back. */
export function updateSettingsFromRenderer(patch: Partial<Settings>): Settings {
  if (isPlainObject(patch.backends)) {
    for (const [id, raw] of Object.entries(patch.backends)) {
      if (!KNOWN_BACKEND_IDS.includes(id) || !isPlainObject(raw)) continue
      if (raw['clearApiKey'] === true) {
        clearBackendApiKey(id)
        const existing = current.backends[id]
        if (existing) {
          existing.apiKey = ''
          existing.hasApiKey = false
        }
      } else if (typeof raw['apiKey'] === 'string' && raw['apiKey'].trim()) {
        setBackendApiKey(id, raw['apiKey'])
      }
    }
  }
  if (Array.isArray(patch.mcpServers)) {
    const incomingIds = new Set<string>()
    for (const server of patch.mcpServers) {
      if (!server?.id) continue
      incomingIds.add(server.id)
      if (server.clearBearerToken === true) clearMcpBearerToken(server.id)
      else if (server.bearerToken?.trim()) setMcpBearerToken(server.id, server.bearerToken)
    }
    for (const existing of current.mcpServers) {
      if (!incomingIds.has(existing.id) && hasMcpBearerToken(existing.id)) clearMcpBearerToken(existing.id)
    }
  }
  const updated = updateSettings(patch)
  for (const [id, config] of Object.entries(updated.backends)) {
    const stored = backendApiKey(id)
    if (stored) config.apiKey = stored
    config.hasApiKey = hasBackendApiKey(id)
    delete config.clearApiKey
  }
  for (const server of updated.mcpServers) {
    server.bearerToken = mcpBearerToken(server.id)
    server.hasBearerToken = hasMcpBearerToken(server.id)
    delete server.clearBearerToken
  }
  if (!unreadable) writeJsonDebounced(settingsFile(), persistedSettings(updated))
  return updated
}

/** Renderer copy with only secret-presence bits. */
export function rendererSettings(settings: Settings = current): Settings {
  return {
    ...settings,
    backends: Object.fromEntries(Object.entries(settings.backends).map(([id, config]) => [
      id,
      {
        ...config,
        apiKey: '',
        hasApiKey: hasBackendApiKey(id),
        clearApiKey: undefined
      }
    ])),
    mcpServers: settings.mcpServers.map((server) => ({
      ...server,
      bearerToken: '',
      hasBearerToken: hasMcpBearerToken(server.id),
      clearBearerToken: undefined
    }))
  }
}

function persistedSettings(settings: Settings): Settings {
  return {
    ...settings,
    backends: Object.fromEntries(Object.entries(settings.backends).map(([id, config]) => {
      const clean = { ...config }
      delete clean.apiKey
      delete clean.clearApiKey
      clean.hasApiKey = hasBackendApiKey(id)
      return [id, clean]
    })),
    mcpServers: settings.mcpServers.map((server) => {
      const clean = { ...server }
      delete clean.bearerToken
      delete clean.clearBearerToken
      clean.hasBearerToken = hasMcpBearerToken(server.id)
      return clean
    })
  }
}

/**
 * The settings that are lists of strings, and so can be appended to.
 *
 * `-?` because an optional setting would otherwise carry its `undefined` into
 * the key union, and `undefined` is not something this can be indexed by.
 */
export type ListSetting = {
  [K in keyof Settings]-?: Settings[K] extends string[] ? K : never
}[keyof Settings]

/**
 * Add one value to a list setting, if it is not already there.
 *
 * Synchronous on purpose, and the reason this exists at all. `updateSettings`
 * replaces arrays wholesale, so the read-await-write shape
 *
 *     const settings = await store.get()
 *     await store.update({ allowlist: [...settings.allowlist, pattern] })
 *
 * has a microtask boundary in the middle where a second caller reads the same
 * array. Both then write their own one-element addition and the first is gone —
 * clicking "Always allow" on two parked approvals in quick succession lost one
 * rule permanently. Here the read, the membership check and the write happen in
 * one uninterrupted run, so concurrent callers cannot lose each other's values.
 */
/**
 * Notified whenever settings actually change on disk.
 *
 * A callback rather than a direct broadcast so this module keeps no dependency
 * on the IPC layer — settings are read by the tool layer and the agent loop,
 * neither of which should drag Electron in behind them. The IPC layer
 * subscribes at boot.
 */
type SettingsListener = (settings: Settings) => void
const listeners = new Set<SettingsListener>()

export function onSettingsChanged(fn: SettingsListener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function announce(settings: Settings): void {
  for (const fn of listeners) {
    try {
      fn(settings)
    } catch (err) {
      // A broken listener must not fail the write that already succeeded.
      console.warn('[openbot/settings] listener failed', err)
    }
  }
}

export function appendSetting(key: ListSetting, value: string): Settings {
  const entry = typeof value === 'string' ? value.trim() : ''
  if (!entry) return current
  const existing = current[key]
  if (existing.includes(entry)) return current
  return updateSettings({ [key]: [...existing, entry] } as Partial<Settings>)
}

export { defaultSettings } from './settingsSchema'
