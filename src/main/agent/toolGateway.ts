/**
 * Access to the tool registry, an optional peer module.
 *
 * With no registry the loop still runs: it offers only the built-in tools, and any other
 * call comes back as "unknown tool" rather than crashing the turn.
 */

import type { ComputerTarget, ToolSchema } from '../../shared/types'
import type { ToolEntry } from './contracts'
import { errorMessage } from './errors'
import { loadToolRegistry } from './optionalModules'

export async function getTool(name: string): Promise<ToolEntry | null> {
  if (!name) return null
  const registry = await loadToolRegistry()
  if (typeof registry?.getTool !== 'function') return null
  try {
    const tool = registry.getTool(name)
    if (!tool || typeof tool.handler !== 'function') return null
    /*
     * Execution must enter through the registry router, not the raw handler.
     * The router is where VM-targeted file/shell/web calls are authenticated
     * and proxied to the guest. Calling `tool.handler` directly silently ran
     * the host implementation for a bot whose target was a VM.
     */
    const routed = registry.runTool
    return {
      name,
      schema: tool.schema,
      handler:
        typeof routed === 'function'
          ? async (args, context) =>
              await routed(
                {
                  id: context.callId || `call-${Date.now().toString(36)}`,
                  name,
                  args
                },
                context
              )
          : tool.handler
    }
  } catch (err) {
    console.warn(`[agent] tool lookup failed for "${name}": ${errorMessage(err)}`)
    return null
  }
}

export async function schemasFor(enabledIds: string[], target?: ComputerTarget): Promise<ToolSchema[]> {
  const registry = await loadToolRegistry()
  if (typeof registry?.schemasFor !== 'function') return []
  try {
    const schemas = registry.schemasFor(enabledIds, target)
    return Array.isArray(schemas)
      ? schemas.filter((schema): schema is ToolSchema => typeof schema?.name === 'string')
      : []
  } catch (err) {
    console.warn(`[agent] tool schema lookup failed: ${errorMessage(err)}`)
    return []
  }
}
