/**
 * Public surface of the model backend layer.
 *
 * Everything above this line treats local and cloud models as peers: the same
 * `Backend` interface, the same streaming chunks, the same tool calls.
 */

export type {
  Backend,
  ChatChunk,
  ChatRequest,
  ChatRunner,
  DetectResult,
  ProviderImagePart,
  ProviderMessage,
  ProviderPart,
  ProviderTextPart
} from './types'

export {
  BACKENDS,
  cachedBackendInfos,
  detectAll,
  getBackend,
  invalidateDetection,
  listBackends
} from './registry'

export { DEFAULT_BASE_URLS, configFor, defaultBackendConfigs } from './backendDefaults'
export { fromAppMessages } from './appMessages'
export { hasImages, textOf, toImagePart } from './messageContent'
export { inferTools, inferVision, prettyLabel } from './modelMeta'
export { hydratedEnv, hydratedPath } from './loginShellEnv'
export { AGENT_CLI_SPECS, DEFAULT_AGENT_CLI_ID, agentCliBackends, stopAgentCliServers } from './cli'
export type { AgentCliSpec } from './cli'
