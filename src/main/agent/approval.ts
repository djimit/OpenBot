/**
 * The approval gate.
 *
 * Every mutating or computer-use action passes through `requestApproval`. Policy decides
 * whether it can be answered without the user (`approvalPolicy.evaluate`); anything left
 * emits an `approval-request` and parks on a promise until `respondToApproval` lands, the
 * session is stopped, or the request times out — a timeout is treated as a rejection.
 *
 * Pending requests and per-session memory are keyed by session id, so parallel sessions
 * never answer each other's prompts.
 */

import type { ApprovalDecision, ApprovalRequest, ToolCall } from '../../shared/types'
import type { ApprovalKind } from './approvalPolicy'
import { derivePattern, evaluate, rememberKey } from './approvalPolicy'
import { broadcast } from './events'
import { newId } from './ids'
import { settingsStore } from './settingsGateway'

/** Long enough for the user to read the diff; short enough to not hang a session forever. */
export const APPROVAL_TIMEOUT_MS = 5 * 60_000

export interface ApprovalAsk {
  sessionId: string
  toolName: string
  call?: ToolCall
  target: string
  kind: ApprovalKind
  summary: string
  detail: string
  preview?: string
  /** The raising tool declared this destructive: confirm it whatever the policy says. */
  force?: boolean
  signal?: AbortSignal
  timeoutMs?: number
  /**
   * Id minted by the caller — the tool layer and the MCP gateway generate their own so
   * they can correlate the answer. Omitted, one is minted here.
   */
  requestId?: string
}

export interface ApprovalOutcome {
  approved: boolean
  reason: string
  decision?: ApprovalDecision
}

interface Pending {
  sessionId: string
  toolName: string
  target: string
  kind: ApprovalKind
  settle: (outcome: ApprovalOutcome) => void
  cleanup: () => void
}

const pending = new Map<string, Pending>()
/** sessionId → keys already approved this session, for `ask-first-time`. */
const remembered = new Map<string, Set<string>>()

function rememberedFor(sessionId: string): Set<string> {
  let set = remembered.get(sessionId)
  if (!set) {
    set = new Set()
    remembered.set(sessionId, set)
  }
  return set
}

export async function requestApproval(ask: ApprovalAsk): Promise<ApprovalOutcome> {
  const settings = await settingsStore.get()
  const memory = rememberedFor(ask.sessionId)
  const verdict = evaluate(settings, ask.toolName, ask.target, memory, ask.force === true)

  if (verdict.outcome === 'deny') return { approved: false, reason: verdict.reason }
  if (verdict.outcome === 'allow') return { approved: true, reason: verdict.reason }

  if (ask.signal?.aborted) {
    return { approved: false, reason: 'session stopped before approval' }
  }

  const request: ApprovalRequest = {
    id: ask.requestId || newId('appr'),
    sessionId: ask.sessionId,
    toolName: ask.toolName,
    summary: ask.summary,
    detail: ask.detail,
    kind: ask.kind,
    preview: ask.preview,
    ...(ask.force ? { force: true } : {})
  }

  return new Promise<ApprovalOutcome>((resolve) => {
    let settled = false
    const timeoutMs = ask.timeoutMs ?? APPROVAL_TIMEOUT_MS

    const timer = setTimeout(() => {
      settle({
        approved: false,
        reason: `no response within ${Math.round(timeoutMs / 1000)}s — treated as rejected`
      })
    }, timeoutMs)

    const onAbort = (): void => {
      settle({ approved: false, reason: 'session stopped while awaiting approval' })
    }
    ask.signal?.addEventListener('abort', onAbort, { once: true })

    const cleanup = (): void => {
      clearTimeout(timer)
      ask.signal?.removeEventListener('abort', onAbort)
      pending.delete(request.id)
    }

    const settle = (outcome: ApprovalOutcome): void => {
      if (settled) return
      settled = true
      cleanup()
      resolve(outcome)
    }

    pending.set(request.id, {
      sessionId: ask.sessionId,
      toolName: ask.toolName,
      target: ask.target,
      kind: ask.kind,
      settle,
      cleanup
    })

    broadcast({ type: 'approval-request', request })
  })
}

/**
 * Resolve a parked request. Returns false when the id is unknown (already answered,
 * timed out, or belonged to a stopped session) so IPC can report a no-op.
 */
export function respondToApproval(requestId: string, decision: ApprovalDecision): boolean {
  const entry = pending.get(requestId)
  if (!entry) return false

  if (decision === 'reject') {
    entry.settle({ approved: false, reason: 'rejected by user', decision })
    return true
  }

  rememberedFor(entry.sessionId).add(rememberKey(entry.toolName, entry.target))
  const outcome: ApprovalOutcome = {
    approved: true,
    reason: `approved by user (${decision})`,
    decision
  }

  if (decision === 'approve-always') {
    // Settle only once the rule is written, so the next call in the same turn reads it
    // back instead of prompting the user again for the command they just allowed.
    void persistAllowRule(entry.kind, entry.toolName, entry.target)
      .catch(() => undefined)
      .then(() => entry.settle(outcome))
    return true
  }

  entry.settle(outcome)
  return true
}

async function persistAllowRule(
  kind: ApprovalKind,
  toolName: string,
  target: string
): Promise<void> {
  try {
    // No pattern means the approval must not be generalised — computer-use actions.
    // The grant still stands for this call; it simply does not become a standing rule.
    const pattern = derivePattern(kind, toolName, target)
    if (!pattern) return
    /*
     * One atomic append, never read-then-write. Reading the settings, awaiting,
     * and writing the whole array back lost a rule whenever two approvals were
     * answered close together — two chats running, or two calls parked in one
     * turn — and the lost rule then re-prompted forever.
     */
    settingsStore.append('allowlist', pattern)
  } catch {
    /* the approval itself still stands; only the persisted rule is lost */
  }
}

/** Reject everything parked for a session — called when the session is stopped. */
export function cancelPending(sessionId: string, reason = 'session stopped'): number {
  let count = 0
  for (const [id, entry] of [...pending.entries()]) {
    if (entry.sessionId !== sessionId) continue
    pending.delete(id)
    entry.settle({ approved: false, reason })
    count++
  }
  return count
}

/** Forget `ask-first-time` grants and drop pending prompts for a session. */
export function resetSession(sessionId: string): void {
  cancelPending(sessionId, 'session reset')
  remembered.delete(sessionId)
}

export function pendingCount(sessionId?: string): number {
  if (!sessionId) return pending.size
  let count = 0
  for (const entry of pending.values()) if (entry.sessionId === sessionId) count++
  return count
}
