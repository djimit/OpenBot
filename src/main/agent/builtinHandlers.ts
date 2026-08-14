/**
 * Implementations of the built-in tools that act on loop-owned state, used when the tool
 * registry does not provide them. They are also the place the session's todo list is kept
 * in sync with whatever a registry-provided `todo_write` returned.
 */

import type { Session, TodoItem, ToolCall, ToolResult } from '../../shared/types'
import { broadcast } from './events'
import { asRecord, asString, asStringArray } from './json'
import { newId } from './ids'
import { rememberFact } from './memory'
import { sessions } from './sessionGateway'

const STATUSES = new Set<TodoItem['status']>(['pending', 'in_progress', 'completed'])

export function parseTodos(call: ToolCall): TodoItem[] {
  const raw = call.args?.['todos'] ?? call.args?.['items'] ?? call.args?.['list']
  return normaliseTodos(raw)
}

export function normaliseTodos(raw: unknown): TodoItem[] {
  if (!Array.isArray(raw)) return []
  const out: TodoItem[] = []
  for (const item of raw) {
    if (typeof item === 'string') {
      if (item.trim()) out.push({ id: newId('todo'), text: item.trim(), status: 'pending' })
      continue
    }
    const rec = asRecord(item)
    const text = asString(rec['text'] ?? rec['title'] ?? rec['content']).trim()
    if (!text) continue
    const status = asString(rec['status'], 'pending') as TodoItem['status']
    out.push({
      id: asString(rec['id']) || newId('todo'),
      text,
      status: STATUSES.has(status) ? status : 'pending'
    })
  }
  return out
}

/** Replace the session todo list and tell the renderer. */
export async function applyTodos(session: Session, todos: TodoItem[]): Promise<void> {
  await sessions.update(session, (fresh) => {
    fresh.todos = todos
  })
  broadcast({ type: 'todos', sessionId: session.id, todos })
}

export async function runTodoWrite(session: Session, call: ToolCall): Promise<ToolResult> {
  const todos = parseTodos(call)
  if (todos.length === 0) {
    return result(call, false, 'No usable todo items were given. Send the full list under "todos".')
  }
  await applyTodos(session, todos)
  const done = todos.filter((t) => t.status === 'completed').length
  return result(call, true, `Task list updated: ${todos.length} items, ${done} completed.`, todos)
}

export async function runRemember(botId: string, call: ToolCall): Promise<ToolResult> {
  const text = asString(call.args?.['text'] ?? call.args?.['fact'] ?? call.args?.['note']).trim()
  if (!text) return result(call, false, 'Nothing to remember: "text" was empty.')

  const tags = asStringArray(call.args?.['tags'])
  const outcome = await rememberFact(botId, text, 'run', tags)
  return outcome.entry
    ? result(call, true, `Remembered: ${outcome.entry.text}`, outcome.entry)
    : result(call, false, `Not stored — ${outcome.reason}.`)
}

function result(call: ToolCall, ok: boolean, output: string, detail?: unknown): ToolResult {
  return { callId: call.id, name: call.name, ok, output, detail }
}
