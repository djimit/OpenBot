/**
 * Codex app-server notification → `ChatChunk`, and approval request → answer.
 *
 * Method names and payload shapes come from the CLI's own schema, emitted by
 * `codex app-server generate-json-schema --out <dir>`, so this tracks the real
 * protocol rather than an inferred one. Unknown notifications are ignored: the
 * server emits dozens we have no use for (rate limits, fs watches, realtime
 * audio).
 */

import { isPlainObject } from '../lenientJson'
import type { ChatChunk } from '../types'
import { str, type CodexItems } from './codexItems'

/*
 * The two approval halves live in `codexApprovals.ts` and the notification
 * index in `codexItems.ts`; both are re-exported here because this module is
 * the one `codexAppServer.ts` talks to, and a single import site keeps the
 * transport unaware of how the mapping is arranged.
 */
export { CodexItems } from './codexItems'
export { approvalResponse, describeApproval } from './codexApprovals'

/** `delta` sits at the top level on some notifications and under `item` on others. */
function deltaOf(params: unknown): string {
  if (!isPlainObject(params)) return ''
  const direct = str(params.delta) || str(params.text)
  if (direct) return direct
  const item = isPlainObject(params.item) ? params.item : null
  return item ? str(item.delta) || str(item.text) : ''
}

export function codexNotification(
  method: string,
  params: unknown,
  items?: CodexItems
): ChatChunk[] {
  // Before the switch, so the notifications this file has no chunk for are
  // still not thrown away — they are what makes an approval card readable.
  items?.observe(method, params)

  switch (method) {
    case 'item/agentMessage/delta': {
      const delta = deltaOf(params)
      return delta ? [{ type: 'text', delta }] : []
    }

    case 'item/reasoning/textDelta':
    case 'item/reasoning/summaryTextDelta':
    case 'item/plan/delta': {
      const delta = deltaOf(params)
      return delta ? [{ type: 'reasoning', delta }] : []
    }

    case 'thread/tokenUsage/updated': {
      const p = isPlainObject(params) ? params : {}
      const usage = isPlainObject(p.tokenUsage) ? p.tokenUsage : null
      // `total` is context held; `last` is just the most recent request.
      const total = usage && isPlainObject(usage.total) ? usage.total : null
      if (!total) return []
      const num = (raw: unknown): number | undefined =>
        typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined
      return [
        {
          type: 'usage',
          usage: {
            inputTokens: num(total.inputTokens),
            outputTokens: num(total.outputTokens),
            totalTokens: num(total.totalTokens),
            cachedInputTokens: num(total.cachedInputTokens)
          }
        }
      ]
    }

    case 'error': {
      const message = isPlainObject(params)
        ? str(params.message) || str(params.error)
        : ''
      throw new Error(message || 'codex reported an error')
    }

    default:
      return []
  }
}

/** True once the server says this turn is finished. */
export function isTurnEnd(method: string): boolean {
  return method === 'turn/completed'
}
