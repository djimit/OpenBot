/**
 * Tool-layer contracts.
 *
 * Every tool is a `{ schema, handler }` pair. Handlers are pure with respect to
 * the app: they receive a `ToolContext` carrying everything they are allowed to
 * touch (working directory, approval gate, event sink, settings) and they never
 * throw — failures come back as `{ ok: false, output }` so the agent loop can
 * feed the message straight back to the model.
 *
 * The locked cross-process contract lives in `src/shared/types.ts`; this file
 * only adds main-process-side plumbing.
 */

import type {
  AgentEvent,
  AgentTask,
  ApprovalRequest,
  Bot,
  ComputerTarget,
  MemoryEntry,
  Settings,
  TodoItem,
  ToolResult,
  ToolSchema
} from '../../shared/types'

/** The approval taxonomy, re-exported for convenience. */
export type ApprovalKind = ApprovalRequest['kind']

/**
 * What a tool passes to {@link ToolContext.requestApproval} through the
 * `approve()` helper — `id` and `sessionId` are filled in for it.
 */
export type ApprovalDraft = Omit<ApprovalRequest, 'id' | 'sessionId'>

/**
 * Optional persistence hooks supplied by the main process.
 *
 * Everything here is optional: when a hook is missing the tool still works and
 * still emits the matching `AgentEvent`, falling back to a local JSON store for
 * durable state (see `agent.ts`). This keeps the tool layer runnable in tests
 * without booting Electron.
 */
export interface ToolHost {
  /** Persist a memory entry for a bot. */
  saveMemory?(entry: MemoryEntry): Promise<void> | void
  /** Replace the todo list of a session. */
  setTodos?(sessionId: string, todos: TodoItem[]): Promise<void> | void
  /** Hand control of the session to another bot. */
  handoff?(sessionId: string, fromBotId: string, toBotId: string, reason: string): Promise<void> | void
  /** Used by `handoff` to validate the target bot id and name it in the summary. */
  listBots?(): Promise<Bot[]> | Bot[]
  /** Start an independently tracked task on a teammate in this conversation. */
  delegateTask?(
    sessionId: string,
    fromBotId: string,
    toBotId: string,
    prompt: string,
    title?: string
  ): Promise<AgentTask> | AgentTask
}

/**
 * Ambient state handed to every tool handler.
 *
 * `sessionId`, `botId`, `cwd`, `signal`, `requestApproval` and `emit` are the
 * required core. The remaining fields are optional so a caller can construct a
 * minimal context; each has a documented default.
 */
export interface ToolContext {
  /** Session the call belongs to; stamped onto approvals and events. */
  sessionId: string
  /** Bot that issued the call; used by `remember` and `handoff`. */
  botId: string
  /** Working directory. All relative paths resolve against it and may not escape it. */
  cwd: string
  /** Aborted when the user stops the run; long-running tools must honour it. */
  signal: AbortSignal
  /** Blocking approval gate. Resolves `true` to proceed, `false` to refuse. */
  requestApproval(req: ApprovalRequest): Promise<boolean>
  /** Streaming sink back to the renderer. Never throws into the tool. */
  emit(event: AgentEvent): void

  /** Which machine this bot drives. Defaults to `{ kind: 'local' }` (this Mac). */
  computerTarget?: ComputerTarget
  /** Id of the `ToolCall` being served; stamped onto the `ToolResult`. */
  callId?: string
  /** Assistant message the call hangs off; required for incremental streaming. */
  messageId?: string
  /** User settings. Missing fields fall back to conservative defaults. */
  settings?: Settings
  /** Root for tool-owned state (bot memory fallback). Defaults to `~/.openbot`. */
  dataDir?: string
  /** Optional persistence hooks. */
  host?: ToolHost
}

/** A tool: its model-facing schema plus the implementation. */
export interface Tool {
  schema: ToolSchema
  /** Never throws. Errors are returned as `{ ok: false, output }`. */
  handler(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>
}

export type ToolHandler = Tool['handler']

/** Subset of {@link Settings} the tool layer actually reads. */
export interface EffectiveSettings {
  approvalPolicy: Settings['approvalPolicy']
  allowlist: string[]
  denylist: string[]
  computerUseAllowedApps: string[]
}
