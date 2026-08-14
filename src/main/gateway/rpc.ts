/**
 * JSON-RPC 2.0 — the wire format MCP rides on.
 *
 * Parsing is deliberately strict. The clients on the other end are real MCP
 * implementations shipped by other vendors, so a malformed envelope is answered
 * with the code the spec prescribes rather than a best-effort guess.
 */

export const JSON_RPC_VERSION = '2.0'

export type JsonRpcId = string | number

export interface JsonRpcMessage {
  jsonrpc: string
  id?: JsonRpcId | null
  method?: string
  params?: unknown
}

export interface JsonRpcSuccess {
  jsonrpc: typeof JSON_RPC_VERSION
  id: JsonRpcId
  result: unknown
}

export interface JsonRpcFailure {
  jsonrpc: typeof JSON_RPC_VERSION
  id: JsonRpcId | null
  error: { code: number; message: string; data?: unknown }
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure

/** The standard codes. MCP adds no transport-level codes of its own. */
export const RPC_ERROR = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603
} as const

export function success(id: JsonRpcId, result: unknown): JsonRpcSuccess {
  return { jsonrpc: JSON_RPC_VERSION, id, result }
}

export function failure(
  id: JsonRpcId | null,
  code: number,
  message: string,
  data?: unknown
): JsonRpcFailure {
  const error = data === undefined ? { code, message } : { code, message, data }
  return { jsonrpc: JSON_RPC_VERSION, id, error }
}

/** A message carrying an `id` expects a response; one without it is a notification. */
export function isNotification(msg: JsonRpcMessage): boolean {
  return msg.id === undefined || msg.id === null
}

export function idOf(msg: JsonRpcMessage): JsonRpcId | null {
  return typeof msg.id === 'string' || typeof msg.id === 'number' ? msg.id : null
}

export function paramsOf(msg: JsonRpcMessage): Record<string, unknown> {
  const raw = msg.params
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {}
}

export interface ParsedBody {
  /** True when the client sent a batch; the reply must then be an array too. */
  batch: boolean
  messages: JsonRpcMessage[]
}

export function parseBody(raw: string): ParsedBody | JsonRpcFailure {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return failure(null, RPC_ERROR.parse, 'Request body is not valid JSON.')
  }

  const batch = Array.isArray(value)
  const items = batch ? (value as unknown[]) : [value]
  if (items.length === 0) {
    return failure(null, RPC_ERROR.invalidRequest, 'Empty JSON-RPC batch.')
  }

  const messages: JsonRpcMessage[] = []
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return failure(null, RPC_ERROR.invalidRequest, 'A JSON-RPC message must be an object.')
    }
    const msg = item as JsonRpcMessage
    if (msg.jsonrpc !== JSON_RPC_VERSION) {
      return failure(
        idOf(msg),
        RPC_ERROR.invalidRequest,
        `Unsupported jsonrpc version — expected "${JSON_RPC_VERSION}".`
      )
    }
    messages.push(msg)
  }
  return { batch, messages }
}

export function isFailure(value: ParsedBody | JsonRpcFailure): value is JsonRpcFailure {
  return 'error' in value
}
