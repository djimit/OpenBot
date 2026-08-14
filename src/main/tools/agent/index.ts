/** Agent self-management and collaboration tools. */

import type { Tool } from '../types'
import { delegateTaskTool } from './delegate'
import { handoffTool } from './handoff'
import { rememberTool } from './memory'
import { todoWriteTool } from './todo'
import { requestHelpTool } from './help'

export { handoffTool } from './handoff'
export { delegateTaskTool } from './delegate'
export { rememberTool, memoryFilePath } from './memory'
export { todoWriteTool } from './todo'
export { requestHelpTool, returnHumanControl, cancelHumanHelpForSession } from './help'

export const agentTools: Tool[] = [
  todoWriteTool,
  rememberTool,
  handoffTool,
  delegateTaskTool,
  requestHelpTool
]
