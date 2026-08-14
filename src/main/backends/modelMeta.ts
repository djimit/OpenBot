/**
 * Capability inference from model ids.
 *
 * Local servers rarely report whether a model can see images or call tools,
 * so we infer it from the id. Adapters always prefer what the server reports
 * and fall back to these tables.
 */

/** Model families that accept images. */
const VISION_PATTERNS: RegExp[] = [
  /vision/i,
  /(^|[-_/:.])vl(-|_|:|\.|$|\d)/i,
  /llava/i,
  /bakllava/i,
  /moondream/i,
  /minicpm-?v/i,
  /cogvlm/i,
  /internvl/i,
  /pixtral/i,
  /paligemma/i,
  /idefics/i,
  /smolvlm/i,
  /molmo/i,
  /aya-?vision/i,
  /janus/i,
  /kimi-?vl/i,
  /glm-?4(\.\d+)?v/i,
  /llama-?4/i,
  /llama-?3\.2-vision/i,
  /gemma-?3(?!.*\b1b\b)/i,
  /mistral-?small-?3/i,
  /granite-?3(\.\d+)?-?vision/i,
  /phi-?(3\.5|4).*(vision|multimodal)/i,
  /qwen-?2(\.5)?-?vl/i,
  /qwen-?3-?vl/i,
  /gpt-?4o/i,
  /gpt-?4\.1/i,
  /gpt-?4-turbo/i,
  /gpt-?5/i,
  /^o[34]([-.]|$)/i,
  /claude-/i,
  /gemini-/i,
  /grok-(2-vision|3|4|vision)/i
]

/** Explicitly text-only, even when a broader pattern would match. */
const NO_VISION_PATTERNS: RegExp[] = [
  /embed/i,
  /rerank/i,
  /whisper/i,
  /tts/i,
  /text-only/i,
  /gpt-?4o-.*audio/i,
  /gemma-?3.*\b1b\b/i,
  /qwen-?3-?vl-?guard/i
]

/** Families with real native tool/function calling. */
const TOOL_PATTERNS: RegExp[] = [
  /llama-?3\.[123]/i,
  /llama-?4/i,
  /qwen-?[23](\.\d+)?/i,
  /qwq/i,
  /mistral/i,
  /mixtral/i,
  /ministral/i,
  /magistral/i,
  /devstral/i,
  /codestral/i,
  /firefunction/i,
  /command-?[ar]/i,
  /hermes-?[34]/i,
  /nemotron/i,
  /granite-?3/i,
  /gpt-?oss/i,
  /glm-?[45]/i,
  /deepseek-?(v3|v4|r1|chat)/i,
  /athene/i,
  /smollm-?3/i,
  /cogito/i,
  /exaone/i,
  /internlm/i,
  /seed-?oss/i,
  /minimax/i,
  /kimi-?k2/i,
  /xlam/i,
  /watt-?tool/i,
  /gpt-?4/i,
  /gpt-?5/i,
  /^o[134]([-.]|$)/i,
  /claude-/i,
  /gemini-/i,
  /grok-/i
]

/** Families known to lack native tool calling — checked first. */
const NO_TOOL_PATTERNS: RegExp[] = [
  /embed/i,
  /rerank/i,
  /gemma/i,
  /^llava/i,
  /bakllava/i,
  /moondream/i,
  /minicpm/i,
  /tinyllama/i,
  /^orca/i,
  /vicuna/i,
  /wizard/i,
  /stablelm/i,
  /^phi-?[23]/i,
  /codellama/i,
  /starcoder/i,
  /sqlcoder/i,
  /deepseek-?coder(?!-v2)/i,
  /llama-?2/i,
  /^falcon/i,
  /^mpt/i,
  /^gpt-?2/i,
  /instruct-?tiny/i
]

/** Not chat models — filtered out of listings entirely. */
const NON_CHAT_PATTERNS: RegExp[] = [
  /embed/i,
  /^text-embedding/i,
  /moderation/i,
  /whisper/i,
  /^tts-/i,
  /-tts(-|$)/i,
  /dall-?e/i,
  /^gpt-image/i,
  /^omni-moderation/i,
  /rerank/i,
  /^sora/i,
  /clip$/i,
  /stable-?diffusion/i,
  /-realtime/i,
  /^computer-use-preview$/i,
  /^codex-mini/i,
  /nomic-embed/i,
  /mxbai-embed/i,
  /bge-/i,
  /snowflake-arctic-embed/i,
  /all-minilm/i
]

function matches(id: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(id))
}

export function inferVision(modelId: string): boolean {
  const id = modelId.trim()
  if (!id) return false
  if (matches(id, NO_VISION_PATTERNS)) return false
  return matches(id, VISION_PATTERNS)
}

export function inferTools(modelId: string): boolean {
  const id = modelId.trim()
  if (!id) return false
  if (matches(id, NO_TOOL_PATTERNS)) return false
  return matches(id, TOOL_PATTERNS)
}

export function isChatModel(modelId: string): boolean {
  return !matches(modelId, NON_CHAT_PATTERNS)
}

/** OpenAI reasoning models reject `temperature` and other sampling knobs. */
export function isReasoningOnlyModel(modelId: string): boolean {
  return /^(o[134])([-.]|$)/i.test(modelId) || /^gpt-5/i.test(modelId)
}

/** `mlx-community/Qwen3-8B-4bit` -> `Qwen3 8B 4bit` */
export function prettyLabel(modelId: string): string {
  const tail = modelId.includes('/') ? modelId.slice(modelId.lastIndexOf('/') + 1) : modelId
  return tail.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim() || modelId
}

const UNITS: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9 }

/** Rough parameter count from an id such as `qwen3:8b` — used for sorting/labels. */
export function inferParamCount(modelId: string): number | undefined {
  const m = /(\d+(?:\.\d+)?)\s*([kmb])(?![a-z])/i.exec(modelId)
  if (!m) return undefined
  const unit = UNITS[m[2].toLowerCase()]
  return unit ? Number(m[1]) * unit : undefined
}
