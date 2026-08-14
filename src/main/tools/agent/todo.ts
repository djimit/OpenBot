/**
 * `todo_write` — the agent's own task list for the current session.
 */

import { randomUUID } from 'node:crypto'
import type { TodoItem, ToolSchema } from '../../../shared/types'
import { optObjArray, optStrArray } from '../args'
import { ToolError } from '../errors'
import { safeEmit } from '../events'
import { defineTool } from '../results'

const NAME = 'todo_write'
const STATUSES = ['pending', 'in_progress', 'completed'] as const
const MAX_TODOS = 50

export const schema: ToolSchema = {
  name: NAME,
  description:
    'Record or update the task list for this session. Send the complete list every time — it replaces ' +
    'the previous one. Keep exactly one task in_progress, and mark work completed as soon as it is done ' +
    'rather than in a batch at the end. Use it for multi-step work so the user can see the plan.',
  parameters: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        description: 'The full task list, in order.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Keep the existing id when updating a task.' },
            text: { type: 'string', description: 'What the task is.' },
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] }
          },
          required: ['text', 'status']
        }
      }
    },
    required: ['todos']
  },
  mutating: false
}

export const todoWriteTool = defineTool(schema, async (args, ctx) => {
  const rows = optObjArray(args, 'todos') ?? plainStrings(args)
  if (!rows) throw new ToolError('todo_write needs a "todos" array.')
  if (rows.length > MAX_TODOS) throw new ToolError(`Too many todos (${rows.length}); keep the list under ${MAX_TODOS}.`)

  const todos: TodoItem[] = rows.map((row, index) => {
    const text = String(row.text ?? row.content ?? row.title ?? '').trim()
    if (!text) throw new ToolError(`todos[${index}] has no text.`)
    const status = String(row.status ?? 'pending').trim().toLowerCase()
    const match = STATUSES.find((s) => s === status)
    if (!match) {
      throw new ToolError(`todos[${index}].status must be one of: ${STATUSES.join(', ')}. Got "${row.status}".`)
    }
    const id = typeof row.id === 'string' && row.id.trim() !== '' ? row.id : randomUUID()
    return { id, text, status: match }
  })

  const inProgress = todos.filter((t) => t.status === 'in_progress')
  if (inProgress.length > 1) {
    throw new ToolError(
      `${inProgress.length} tasks are marked in_progress; only one may be at a time.`,
      'Set the others back to pending, or mark them completed.'
    )
  }

  await ctx.host?.setTodos?.(ctx.sessionId, todos)
  safeEmit(ctx, { type: 'todos', sessionId: ctx.sessionId, todos })

  const done = todos.filter((t) => t.status === 'completed').length
  const rendered = todos
    .map((t) => `${t.status === 'completed' ? '[x]' : t.status === 'in_progress' ? '[~]' : '[ ]'} ${t.text}`)
    .join('\n')

  return {
    callId: ctx.callId ?? '',
    name: NAME,
    ok: true,
    output: `Task list updated — ${done}/${todos.length} done.\n${rendered}`,
    detail: { todos }
  }
})

/** Accept a bare array of strings as an all-pending list. */
function plainStrings(args: Record<string, unknown>): Array<Record<string, unknown>> | undefined {
  const list = optStrArray(args, 'todos')
  if (!list) return undefined
  return list.map((text) => ({ text, status: 'pending' }))
}
