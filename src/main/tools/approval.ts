/**
 * The approval gate.
 *
 * Tools describe what they are about to do; the host renders it and returns a
 * verdict. `approve-always` bookkeeping belongs to the host — tools simply ask
 * again and trust the gate to answer without prompting.
 */

import { randomUUID } from 'node:crypto'
import { ApprovalDenied } from './errors'
import { settingsOf } from './settings'
import type { ApprovalDraft, ToolContext } from './types'

/**
 * Ask the user.
 *
 * `auto-run` answers yes without a card, unless `force` is set — reserved for
 * destructive or irreversible actions, which are always confirmed. A gate that
 * throws counts as a refusal.
 *
 * There is deliberately no `auto-run` fast path here. Answering yes without
 * reaching the gate also skipped the gate's denylist check, so a rule the user
 * wrote to forbid something was silently inert on that one policy for every
 * self-approving tool — only `shell` escaped, and only because it runs its own
 * refusal check first. `evaluate` already resolves `auto-run` without showing a
 * card, and checks the denylist before it does.
 */
export async function approve(
  ctx: ToolContext,
  draft: ApprovalDraft,
  opts: { force?: boolean } = {}
): Promise<boolean> {
  try {
    /*
     * `force` must reach the gate: it is what makes a destructive or
     * irreversible action confirm even under `auto-run`. Dropping it here left
     * every computer-use action running unprompted on that policy.
     */
    return await ctx.requestApproval({
      id: randomUUID(),
      sessionId: ctx.sessionId,
      ...draft,
      ...(opts.force ? { force: true } : {})
    })
  } catch {
    return false
  }
}

/** Throwing form of {@link approve}; the caller's handler turns it into `ok: false`. */
export async function requireApproval(
  ctx: ToolContext,
  draft: ApprovalDraft,
  opts: { force?: boolean } = {}
): Promise<void> {
  const granted = await approve(ctx, draft, opts)
  if (!granted) throw new ApprovalDenied(draft.summary)
}
