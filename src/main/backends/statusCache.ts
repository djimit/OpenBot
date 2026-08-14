/**
 * Last-known backend status, persisted to the cache directory.
 *
 * Lets the UI render the backend list instantly at launch — before any probe
 * has finished — and then swap in fresh results when detection completes.
 */

import { readFile, writeFile } from 'node:fs/promises'
import type { BackendInfo, BackendStatus, ModelInfo } from '../../shared/types'
import { cacheFilePath } from './userDataPaths'

const CACHE_FILE = 'backend-status.json'

export interface StoredStatus {
  status: BackendStatus
  statusDetail?: string
  models: ModelInfo[]
  toolMode: 'native' | 'prompted'
  supportsVmOrchestration?: boolean
  at: number
}

let memory: Record<string, StoredStatus> | undefined

export async function readStatusCache(): Promise<Record<string, StoredStatus>> {
  if (memory) return memory
  try {
    const file = await cacheFilePath(CACHE_FILE)
    const parsed = JSON.parse(await readFile(file, 'utf8')) as Record<string, StoredStatus>
    memory = parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    memory = {}
  }
  return memory
}

export async function rememberStatuses(infos: BackendInfo[]): Promise<void> {
  const next: Record<string, StoredStatus> = { ...(await readStatusCache()) }
  for (const info of infos) {
    next[info.id] = {
      status: info.status,
      ...(info.statusDetail ? { statusDetail: info.statusDetail } : {}),
      models: info.models,
      toolMode: info.toolMode,
      ...(info.supportsVmOrchestration ? { supportsVmOrchestration: true } : {}),
      at: Date.now()
    }
  }
  memory = next
  try {
    await writeFile(await cacheFilePath(CACHE_FILE), JSON.stringify(next, null, 2), 'utf8')
  } catch {
    // The cache is an optimisation; losing it only costs a slower first paint.
  }
}

export function clearStatusCacheMemo(): void {
  memory = undefined
}
