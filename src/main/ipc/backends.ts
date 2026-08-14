/** IPC for `OpenBotApi.backends`. Detection lives in the backend registry. */

import type { BackendInfo } from '../../shared/types'
import { detectBackends, listBackends } from './backendRegistry'
import { CHANNELS } from './channels'
import { emptyArray, handle } from './handler'

export function registerBackendIpc(): void {
  handle<BackendInfo[]>(CHANNELS.backendsList, () => listBackends(), emptyArray)
  handle<BackendInfo[]>(CHANNELS.backendsRefresh, () => detectBackends(), emptyArray)
}
