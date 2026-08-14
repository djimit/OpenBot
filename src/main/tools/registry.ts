/**
 * The tool registry.
 *
 * `TOOLS` is typed as `Record<ToolId, Tool>`, so the compiler refuses to build
 * if an id in the shared contract has no implementation. Aliases are names a
 * model may reasonably invent (`double_click`) that resolve to a real tool
 * without being advertised in the schema list.
 */

import {
  TOOL_IDS,
  type ComputerTarget,
  type ToolCall,
  type ToolId,
  type ToolResult,
  type ToolSchema
} from '../../shared/types'
import {
  agentTools,
  delegateTaskTool,
  handoffTool,
  rememberTool,
  requestHelpTool,
  todoWriteTool
} from './agent'
import { computerAliases, computerTools } from './computer/tools'
import {
  editFileTool,
  fsTools,
  globTool,
  grepTool,
  listDirTool,
  readFileTool,
  writeFileTool
} from './fs'
import { clickTool, dragTool, scrollTool } from './computer/pointerTools'
import { keyPressTool, typeTextTool } from './computer/keyboardTools'
import { navigateTool, openAppTool } from './computer/appTools'
import { screenshotTool } from './computer/screenTools'
import { shellTool } from './shell'
import { visualizeTool } from './visualize'
import { fetchTool, webSearchTool, webTools } from './web'
import type { Tool, ToolContext } from './types'
import { runVmTool, vmTargetSupportsTools } from './computer/vmTools'
import { hasVmComputerCapability } from './computer/vmProtocol'

/** Every id in the shared contract, implemented. */
const TOOLS: Record<ToolId, Tool> = {
  read_file: readFileTool,
  write_file: writeFileTool,
  edit_file: editFileTool,
  list_dir: listDirTool,
  glob: globTool,
  grep: grepTool,
  shell: shellTool,
  fetch: fetchTool,
  web_search: webSearchTool,
  screenshot: screenshotTool,
  click: clickTool,
  type_text: typeTextTool,
  key_press: keyPressTool,
  scroll: scrollTool,
  drag: dragTool,
  open_app: openAppTool,
  navigate: navigateTool,
  todo_write: todoWriteTool,
  remember: rememberTool,
  handoff: handoffTool,
  delegate_task: delegateTaskTool,
  request_help: requestHelpTool,
  visualize: visualizeTool
}

const ALIASES = new Map<string, Tool>(computerAliases.map((tool) => [tool.schema.name, tool]))

/**
 * These implementations touch the host filesystem, spawn a host process, or
 * originate network traffic from the host.
 * Until the VM daemon supplies box-native equivalents they must never be
 * advertised or executed for a VM target: degraded functionality is safer
 * than claiming isolation while acting on the user's Mac.
 */
const VM_BOX_TOOLS = new Set<string>([
  'read_file',
  'write_file',
  'edit_file',
  'list_dir',
  'glob',
  'grep',
  'shell',
  'fetch',
  'web_search'
])

export function isVmBoxTool(name: string): boolean {
  const tool = getTool(name)
  return VM_BOX_TOOLS.has(tool?.schema.name ?? name.trim())
}

/** Groups, for callers that want a themed subset. */
export const toolGroups = {
  filesystem: fsTools,
  shell: [shellTool],
  web: webTools,
  computer: computerTools,
  agent: agentTools
} as const

/** Canonical tools, in `TOOL_IDS` order. */
export function allTools(): Tool[] {
  return TOOL_IDS.map((id) => TOOLS[id])
}

/** Look up by name, accepting aliases. Returns `undefined` for unknown names. */
export function getTool(name: string): Tool | undefined {
  const key = name.trim()
  return TOOLS[key as ToolId] ?? ALIASES.get(key)
}

export function hasTool(name: string): boolean {
  return getTool(name) !== undefined
}

/**
 * Schemas for the ids a bot has enabled, in `TOOL_IDS` order, ignoring unknown
 * ids so a stale bot configuration cannot break a run.
 */
export function schemasFor(enabledIds: string[], target?: ComputerTarget): ToolSchema[] {
  const wanted = new Set(enabledIds.map((id) => id.trim()))
  return TOOL_IDS.filter(
    (id) =>
      wanted.has(id) &&
      !(
        target?.kind === 'vm' &&
        ((VM_BOX_TOOLS.has(id) && !vmTargetSupportsTools(target)) ||
          (TOOLS[id].schema.computerUse === true && !hasVmComputerCapability(target.capabilities)))
      )
  ).map((id) => TOOLS[id].schema)
}

/** Ids that were requested but do not exist — useful for a settings warning. */
export function unknownToolIds(enabledIds: string[]): string[] {
  return enabledIds.filter((id) => !hasTool(id.trim()))
}

export function isComputerTool(name: string): boolean {
  return getTool(name)?.schema.computerUse === true
}

export function isMutatingTool(name: string): boolean {
  return getTool(name)?.schema.mutating === true
}

/**
 * Run one tool call. Never throws: an unknown name, a bad argument or a crash
 * inside a handler all come back as `{ ok: false, output }`.
 */
export async function runTool(call: ToolCall, ctx: ToolContext): Promise<ToolResult> {
  const started = Date.now()
  const tool = getTool(call.name)
  if (!tool) {
    return {
      callId: call.id,
      name: call.name,
      ok: false,
      output:
        `There is no tool called "${call.name}".\n` +
        `Available tools: ${TOOL_IDS.join(', ')}.`,
      durationMs: Date.now() - started
    }
  }
  if (
    ctx.computerTarget?.kind === 'vm' &&
    tool.schema.computerUse === true &&
    !hasVmComputerCapability(ctx.computerTarget.capabilities)
  ) {
    return {
      callId: call.id,
      name: call.name,
      ok: false,
      output:
        `${call.name} was refused because VM ${ctx.computerTarget.vmId} has not advertised computer-v1. ` +
        'The action was not redirected to the host screen.',
      durationMs: Date.now() - started
    }
  }
  if (ctx.computerTarget?.kind === 'vm' && VM_BOX_TOOLS.has(tool.schema.name)) {
    if (vmTargetSupportsTools(ctx.computerTarget)) {
      const result = await runVmTool(call, ctx)
      return { ...result, durationMs: result.durationMs ?? Date.now() - started }
    }
    return {
      callId: call.id,
      name: call.name,
      ok: false,
      output:
        `${call.name} was refused because this bot targets VM ${ctx.computerTarget.vmId}, ` +
        `but the installed VM daemon does not provide isolated file, process, and network execution.\n` +
        'Do not retry on the host. Install a box-exec-capable VM daemon or switch this bot to This Mac explicitly.',
      durationMs: Date.now() - started
    }
  }
  const scoped: ToolContext = { ...ctx, callId: call.id }
  const result = await tool.handler(call.args ?? {}, scoped)
  return { ...result, callId: call.id }
}
