/**
 * The shared OpenAI-compatible surface — the single import point for adapters.
 *
 * Cloud providers (OpenAI, xAI, OpenRouter) and local servers (LM Studio,
 * llama.cpp, MLX) speak the same `/chat/completions` protocol, so they share
 * one endpoint description, one streaming implementation, one tool-call
 * accumulator and one model mapper.
 */

export type { OaEndpoint } from './openaiEndpoint'
export { oaHeaders } from './openaiEndpoint'
export type { OaModelEntry, ModelInfoOptions } from './openaiModels'
export { listOpenAiModels, toModelInfo } from './openaiModels'
export type { OaMessage, OaContentPart } from './openaiMessages'
export { toOpenAiMessages, toOpenAiTools } from './openaiMessages'
export type { OaChatOptions } from './openaiStream'
export { streamOpenAiChat } from './openaiStream'
export type { OaToolCallDelta } from './toolCallAccumulator'
export { ToolCallAccumulator, parseToolArgs } from './toolCallAccumulator'
