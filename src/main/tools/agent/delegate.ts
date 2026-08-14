/** `delegate_task` — start an independently tracked task on a teammate bot. */

import type { AgentTask, Bot, ToolSchema } from '../../../shared/types'
import { optStr, reqStr } from '../args'
import { ToolError } from '../errors'
import { defineTool } from '../results'
import type { ToolContext } from '../types'

const NAME = 'delegate_task'

export const schema: ToolSchema = {
  name: NAME,
  description:
    'Ask another bot already present in this conversation to complete an independent background task. ' +
    'Use this for genuinely parallel work; use handoff when that bot should take over the conversation.',
  parameters: {
    type: 'object',
    properties: {
      to_bot_id: { type: 'string', description: 'Id or exact name of the teammate bot.' },
      prompt: { type: 'string', description: 'A self-contained task with the context and expected result.' },
      title: { type: 'string', description: 'Optional short task label.' }
    },
    required: ['to_bot_id', 'prompt']
  },
  mutating: true
}

export const delegateTaskTool = defineTool(schema, async (args, ctx) => {
  if (!ctx.host?.delegateTask) throw new ToolError('Background delegation is unavailable in this runtime.')
  const target = resolveTarget(reqStr(args, 'to_bot_id', NAME).trim(), await listBots(ctx))
  if (target.id === ctx.botId) throw new ToolError('You cannot delegate a background task to yourself.')
  const prompt = reqStr(args, 'prompt', NAME).trim().slice(0, 100_000)
  if (!prompt) throw new ToolError('The delegated task needs a prompt.')
  const title = optStr(args, 'title')?.trim().slice(0, 200)
  const task: AgentTask = await ctx.host.delegateTask(ctx.sessionId, ctx.botId, target.id, prompt, title)
  return {
    callId: ctx.callId ?? '',
    name: NAME,
    ok: true,
    output: `Started “${task.title}” on ${target.name}. Track it in Inbox & background tasks.`,
    detail: { taskId: task.id, sessionId: task.sessionId, botId: target.id }
  }
})

async function listBots(ctx: ToolContext): Promise<Bot[]> {
  try { return await ctx.host?.listBots?.() ?? [] } catch { return [] }
}

function resolveTarget(requested: string, bots: Bot[]): Bot {
  const target = bots.find((bot) => bot.id === requested) ??
    bots.find((bot) => bot.name.toLocaleLowerCase() === requested.toLocaleLowerCase())
  if (!target || target.archived) throw new ToolError(`There is no active bot “${requested}”.`)
  return target
}
