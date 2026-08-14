/**
 * `ToolResult` construction and the `defineTool` wrapper that makes the
 * "handlers never throw" rule structural rather than a convention.
 */

import type { ToolResult, ToolSchema } from '../../shared/types'
import { describeError } from './errors'
import type { Tool, ToolContext } from './types'

export function ok(
  ctx: ToolContext,
  name: string,
  output: string,
  extra: Partial<ToolResult> = {}
): ToolResult {
  return { callId: ctx.callId ?? '', name, ok: true, output, ...extra }
}

export function fail(
  ctx: ToolContext,
  name: string,
  output: string,
  extra: Partial<ToolResult> = {}
): ToolResult {
  return { callId: ctx.callId ?? '', name, ok: false, output, ...extra }
}

/**
 * Bind a schema to an implementation.
 *
 * The returned handler stamps `callId`/`name`/`durationMs` and catches
 * everything — including programmer errors — so a bad tool can never break the
 * agent loop.
 */
export function defineTool(
  schema: ToolSchema,
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>
): Tool {
  return {
    schema,
    async handler(args, ctx) {
      const started = Date.now()
      try {
        const result = await run(args ?? {}, ctx)
        return {
          ...result,
          callId: result.callId || ctx.callId || '',
          name: result.name || schema.name,
          durationMs: result.durationMs ?? Date.now() - started
        }
      } catch (err) {
        return {
          callId: ctx.callId ?? '',
          name: schema.name,
          ok: false,
          output: describeError(err, schema.name),
          durationMs: Date.now() - started
        }
      }
    }
  }
}
