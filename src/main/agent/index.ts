/**
 * Public surface of the agent package.
 *
 * `loop` is what IPC calls. The rest is the integration surface for the modules that call
 * back into us: the MCP gateway (`sessionActions`) and the agent-CLI adapters
 * Everything else in this directory is internal.
 */

export {
  respondToApproval,
  runRoutine,
  sendMessage,
  shutdown,
  startRecording,
  stopRecording,
  stopSession
} from './loop'

/* Loop-owned state changes, addressable by id — used by the MCP gateway. */
export {
  approve,
  approveRequest,
  handoff,
  listBots,
  noteRoutineStep,
  remember,
  saveMemoryEntry,
  setTodos
} from './sessionActions'

/* An agent CLI's own permission prompts, answered by our approval policy. */

export { onAgentEvent } from './events'
export { MAX_CONSECUTIVE_HANDOFFS, MAX_ITERATIONS } from './limits'
export { APPROVAL_TIMEOUT_MS } from './approval'
export { SUPERVISED_IDLE_TIMEOUT_MS, modeFor } from './backendMode'
export { isRecording, recordingState } from './recorder'
export { rememberFact } from './memory'
