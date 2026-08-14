/** Tool identities, schemas and the approval gate's vocabulary. */

export const TOOL_IDS = [
  // filesystem / dev
  'read_file',
  'write_file',
  'edit_file',
  'list_dir',
  'glob',
  'grep',
  'shell',
  // web
  'fetch',
  'web_search',
  // computer use
  'screenshot',
  'click',
  'type_text',
  'key_press',
  'scroll',
  'drag',
  'open_app',
  'navigate',
  // presentation
  'visualize',
  // agent
  'todo_write',
  'remember',
  'handoff',
  'delegate_task',
  'request_help'
] as const

export type ToolId = (typeof TOOL_IDS)[number]

export interface ToolSchema {
  name: ToolId | string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
  /** Mutating tools route through the approval gate. */
  mutating: boolean
  /** Requires screen-capture / input-injection permission. */
  computerUse?: boolean
}

export interface ApprovalRequest {
  id: string
  sessionId: string
  toolName: string
  /** One-line summary, e.g. the command about to run. */
  summary: string
  /** Full detail: command text, diff, target path. */
  detail: string
  kind: 'shell' | 'write' | 'edit' | 'delete' | 'fetch' | 'mcp' | 'computer'
  /** base64 PNG preview for computer-use actions. */
  preview?: string
  /**
   * This action is destructive or irreversible and must always be confirmed.
   *
   * Set by the tool raising the request. It outranks `auto-run`, the allowlist and
   * `ask-first-time` memory — the same way the denylist does. Without the field the
   * flag never left the tool layer, and every computer action ran unprompted under
   * `auto-run`.
   */
  force?: boolean
}

export type ApprovalDecision = 'approve' | 'approve-always' | 'reject'
