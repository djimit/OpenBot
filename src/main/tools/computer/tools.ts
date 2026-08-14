/**
 * The computer-use tool set.
 *
 * Every handler is a thin wrapper: it validates arguments, describes the action
 * for the approval prompt, and calls the `ComputerProvider` resolved from the
 * bot's computer target. Nothing here knows whether that is this Mac or a VM.
 */

import type { Tool } from '../types'
import { navigateTool, openAppTool } from './appTools'
import { keyPressTool, typeTextTool } from './keyboardTools'
import { clickTool, doubleClickTool, dragTool, scrollTool } from './pointerTools'
import { screenshotTool } from './screenTools'

export { navigateTool, openAppTool } from './appTools'
export { keyPressTool, typeTextTool, NAMED_KEYS } from './keyboardTools'
export { clickTool, doubleClickTool, dragTool, scrollTool } from './pointerTools'
export { screenshotTool } from './screenTools'

/** In `TOOL_IDS` order. `double_click` is an alias, registered separately. */
export const computerTools: Tool[] = [
  screenshotTool,
  clickTool,
  typeTextTool,
  keyPressTool,
  scrollTool,
  dragTool,
  openAppTool,
  navigateTool
]

/** Extra names accepted from models but not part of `TOOL_IDS`. */
export const computerAliases: Tool[] = [doubleClickTool]
