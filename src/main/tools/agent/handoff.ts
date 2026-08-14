/**
 * `handoff` — pass control of the session to another bot.
 *
 * The tool validates the target and announces the transfer; the agent loop
 * reacts to the `handoff` event by switching the session's active bot.
 */

import type { Bot, ToolSchema } from '../../../shared/types'
import { optStr, reqStr } from '../args'
import { ToolError } from '../errors'
import { defineTool } from '../results'
import type { ToolContext } from '../types'

const NAME = 'handoff'

export const schema: ToolSchema = {
  name: NAME,
  description:
    'Hand the conversation to another bot that is better suited to the next step, with a reason and ' +
    'enough context for it to continue. Use it when the work needs a different persona, model or tool ' +
    'set — not to avoid a hard task. You stop after handing off.',
  parameters: {
    type: 'object',
    properties: {
      to_bot_id: { type: 'string', description: 'Id (or exact name) of the bot taking over.' },
      reason: { type: 'string', description: 'Why that bot should take over, in one sentence.' },
      context: { type: 'string', description: 'What you have established so far and what remains.' }
    },
    required: ['to_bot_id', 'reason']
  },
  mutating: false
}

export const handoffTool = defineTool(schema, async (args, ctx) => {
  const requested = reqStr(args, 'to_bot_id', NAME).trim()
  const reason = reqStr(args, 'reason', NAME).trim()
  const context = optStr(args, 'context')

  const bots = await listBots(ctx)
  const target = resolveTarget(requested, bots)

  if (target.id === ctx.botId) {
    throw new ToolError(
      'You cannot hand off to yourself.',
      'Either carry on with the work, or name a different bot.'
    )
  }

  /*
   * The host hook owns the event now. It routes through `performHandoff`, which
   * is where the roster check and the consecutive-handoff cap live and which
   * broadcasts `handoff` itself once the floor has actually moved. Emitting here
   * as well drew two dividers in the transcript for one hand-off — and the
   * earlier version announced the move before anything had verified it could
   * happen, so a refused hand-off still showed as one.
   */
  await ctx.host?.handoff?.(ctx.sessionId, ctx.botId, target.id, reason)

  return {
    callId: ctx.callId ?? '',
    name: NAME,
    ok: true,
    output:
      `Handed the session to ${target.name} (${target.id}).\nReason: ${reason}` +
      `${context ? `\nContext passed on: ${context}` : ''}\n` +
      'Stop here — that bot answers next.',
    detail: { toBotId: target.id, toBotName: target.name, reason, context }
  }
})

async function listBots(ctx: ToolContext): Promise<Bot[]> {
  if (!ctx.host?.listBots) return []
  try {
    return await ctx.host.listBots()
  } catch {
    return []
  }
}

function resolveTarget(requested: string, bots: Bot[]): { id: string; name: string } {
  if (bots.length === 0) return { id: requested, name: requested }

  const byId = bots.find((b) => b.id === requested)
  if (byId) return { id: byId.id, name: byId.name }

  const byName = bots.find((b) => b.name.toLowerCase() === requested.toLowerCase())
  if (byName) return { id: byName.id, name: byName.name }

  const available = bots
    .filter((b) => !b.archived)
    .map((b) => `${b.name} (${b.id})`)
    .join(', ')
  throw new ToolError(
    `There is no bot "${requested}".`,
    available ? `Available bots: ${available}.` : 'No other bots are configured yet.'
  )
}
