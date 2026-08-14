/**
 * Stable single-file address for the IPC layer.
 *
 * The implementation is split by domain under `ipc/` (one module per section
 * of `OpenBotApi`); this barrel exists so modules that resolve the IPC layer
 * as `main/ipc` keep working regardless of that internal layout. There is only
 * ever one instance of the underlying modules, so `broadcast()` imported from
 * either path pushes through the same queue.
 */

export {
  registerIpc,
  broadcast,
  sendMenuCommand,
  CHANNELS,
  EVENT_CHANNEL,
  MENU_CHANNEL
} from './ipc/index'
export type { MenuCommand } from './ipc/index'
