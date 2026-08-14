/**
 * The tools layer.
 *
 * Wiring it up from the agent loop:
 *
 *   const schemas = schemasFor(bot.tools)          // advertise to the model
 *   const result  = await runTool(call, {          // execute one call
 *     sessionId, botId: bot.id, cwd: session.cwd, signal,
 *     computerTarget: bot.computerTarget,
 *     messageId, settings, dataDir, host,
 *     requestApproval, emit
 *   })
 *
 * Handlers never throw and never block on anything the user has not approved.
 */

export type { EffectiveSettings, Tool, ToolContext, ToolHandler, ToolHost, ApprovalDraft, ApprovalKind } from './types'

export {
  allTools,
  getTool,
  hasTool,
  isComputerTool,
  isMutatingTool,
  runTool,
  schemasFor,
  toolGroups,
  unknownToolIds
} from './registry'

export { ApprovalDenied, ToolError, describeError } from './errors'
export { forgetSession } from './paths'
export { unifiedDiff } from './diff'
export { getComputerProvider, describeTarget, resetComputerProviders } from './computer'
export { NAMED_KEYS } from './computer/tools'
