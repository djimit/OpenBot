/**
 * Tools the loop implements itself.
 *
 * `handoff`, `todo_write` and `remember` act on loop-owned state (the active bot, the
 * session's todo list, a bot's memory), so the loop always handles them — and can still
 * offer them when the tool registry has not landed or does not define them.
 */

import type { ToolSchema } from '../../shared/types'

export const HANDOFF_SCHEMA: ToolSchema = {
  name: 'handoff',
  description:
    'Hand the conversation to another bot taking part in this exchange. Use it only when ' +
    'another bot is genuinely better suited to the next step. The receiving bot sees the ' +
    'full transcript, so summarise intent rather than repeating context.',
  parameters: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'Id (or exact name) of the bot to hand off to.' },
      reason: { type: 'string', description: 'One line on why that bot should take over.' },
      note: { type: 'string', description: 'Optional brief for the receiving bot.' }
    },
    required: ['to', 'reason']
  },
  mutating: false
}

export const TODO_WRITE_SCHEMA: ToolSchema = {
  name: 'todo_write',
  description:
    'Replace the visible task list for this session. Send the whole list every time, in ' +
    'order, with exactly one item marked in_progress while work is under way.',
  parameters: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        description: 'The complete task list.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            text: { type: 'string' },
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

export const REMEMBER_SCHEMA: ToolSchema = {
  name: 'remember',
  description:
    'Store one durable fact about the user or their project for future sessions: a stable ' +
    'preference, a convention, or a decision. Never store secrets, credentials, tokens or ' +
    'personal contact details, and never store transient details about the current task.',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'The fact, as one self-contained sentence.' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Optional labels.' }
    },
    required: ['text']
  },
  mutating: false
}

export const BUILTIN_SCHEMAS: ToolSchema[] = [
  HANDOFF_SCHEMA,
  TODO_WRITE_SCHEMA,
  REMEMBER_SCHEMA
]

const BY_NAME = new Map(BUILTIN_SCHEMAS.map((s) => [s.name, s]))

export function isBuiltin(name: string): boolean {
  return BY_NAME.has(name)
}

export function builtinSchema(name: string): ToolSchema | undefined {
  return BY_NAME.get(name)
}

/**
 * Merge registry schemas with the built-ins the bot has enabled, registry first so a
 * richer registry definition wins.
 */
export function mergeBuiltins(schemas: ToolSchema[], enabledIds: string[]): ToolSchema[] {
  const present = new Set(schemas.map((s) => s.name))
  const extra = BUILTIN_SCHEMAS.filter((s) => enabledIds.includes(s.name) && !present.has(s.name))
  return [...schemas, ...extra]
}
