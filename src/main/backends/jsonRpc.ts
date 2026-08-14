/**
 * JSON-RPC 2.0 over newline-delimited JSON.
 *
 * This is the whole wire layer of the Agent Client Protocol — no dependency
 * needed, it is one object per line on the child's stdin/stdout.
 */

import { safeJsonParse } from './lenientJson'

export interface JsonRpcErrorShape {
  code: number
  message: string
  data?: unknown
}

/** Ids travel as sent: numbers by default, strings when a vendor envelope demands it. */
export type JsonRpcId = string | number

export type RequestHandler = (params: unknown) => Promise<unknown> | unknown
export type NotificationHandler = (method: string, params: unknown) => void

export interface JsonRpcPeerOptions {
  /**
   * Last chance to reshape an outgoing message. Factory's droid rejects a bare
   * JSON-RPC frame, so its adapter adds the vendor envelope here rather than
   * forking this class.
   */
  decorate?: (message: Record<string, unknown>) => Record<string, unknown>
}

interface Pending {
  resolve: (value: unknown) => void
  reject: (err: unknown) => void
}

export class JsonRpcError extends Error {
  readonly code: number
  readonly data?: unknown

  constructor(shape: JsonRpcErrorShape) {
    super(shape.message)
    this.name = 'JsonRpcError'
    this.code = shape.code
    this.data = shape.data
  }
}

export class JsonRpcPeer {
  private nextId = 1
  private readonly pending = new Map<string, Pending>()
  private readonly handlers = new Map<string, RequestHandler>()
  private closed = false

  constructor(
    private readonly send: (line: string) => void,
    private readonly onNotification: NotificationHandler,
    private readonly options: JsonRpcPeerOptions = {}
  ) {}

  private emit(message: Record<string, unknown>): void {
    this.send(JSON.stringify(this.options.decorate ? this.options.decorate(message) : message))
  }

  request<T>(method: string, params?: unknown): Promise<T> {
    if (this.closed) return Promise.reject(new Error(`${method}: connection closed`))
    const id = this.nextId++
    const promise = new Promise<unknown>((resolve, reject) => {
      // Keyed by string so a peer that echoes ids as text still matches.
      this.pending.set(String(id), { resolve, reject })
    })
    this.emit({ jsonrpc: '2.0', id, method, params: params ?? {} })
    return promise as Promise<T>
  }

  notify(method: string, params?: unknown): void {
    if (this.closed) return
    this.emit({ jsonrpc: '2.0', method, params: params ?? {} })
  }

  onRequest(method: string, handler: RequestHandler): void {
    this.handlers.set(method, handler)
  }

  /** Feed one inbound line. Never throws. */
  handleLine(line: string): void {
    const text = line.trim()
    if (!text) return
    const msg = safeJsonParse<Record<string, unknown>>(text)
    if (!msg) return

    const id =
      typeof msg.id === 'number' || (typeof msg.id === 'string' && msg.id) ? msg.id : undefined
    const method = typeof msg.method === 'string' ? msg.method : undefined

    if (method && id !== undefined) {
      void this.answer(id, method, msg.params)
      return
    }
    if (method) {
      this.onNotification(method, msg.params)
      return
    }
    if (id === undefined) return

    const pending = this.pending.get(String(id))
    if (!pending) return
    this.pending.delete(String(id))
    if (msg.error) pending.reject(new JsonRpcError(msg.error as JsonRpcErrorShape))
    else pending.resolve(msg.result)
  }

  private async answer(id: JsonRpcId, method: string, params: unknown): Promise<void> {
    const handler = this.handlers.get(method)
    if (!handler) {
      this.emit({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` }
      })
      return
    }
    try {
      const result = await handler(params)
      this.emit({ jsonrpc: '2.0', id, result: result ?? {} })
    } catch (err) {
      this.emit({
        jsonrpc: '2.0',
        id,
        error: { code: -32603, message: err instanceof Error ? err.message : String(err) }
      })
    }
  }

  /** Fail every in-flight request — the child died or the turn was cancelled. */
  close(err?: unknown): void {
    this.closed = true
    const reason = err ?? new Error('connection closed')
    for (const [, pending] of this.pending) pending.reject(reason)
    this.pending.clear()
  }
}
