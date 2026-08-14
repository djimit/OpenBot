/**
 * The approval-preserving box RPC behind `POST /box/tool`.
 *
 * The guest never draws trusted UI, so a call that needs an approval is run
 * only far enough to describe one and then handed back to the desktop, which
 * gates it and retries with the signature. Everything arriving over the wire is
 * re-derived here rather than trusted: the desktop's `EffectiveSettings` and
 * approval list are attacker-shaped input as far as this process is concerned.
 */

import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { ApprovalRequest, Settings, ToolCall } from '../../shared/types'
import { isVmBoxTool, runTool } from '../tools/registry'
import type { EffectiveSettings, ToolContext } from '../tools/types'
import type { VmBoxApproval, VmBoxToolRequest, VmBoxToolResponse } from '../tools/computer/vmProtocol'
import { BOX_ROOT, MAX_APPROVALS, VM_ID } from './config'

export async function execute(request: VmBoxToolRequest, signal: AbortSignal): Promise<VmBoxToolResponse> {
  if (!isVmBoxTool(request.call.name)) {
    return {
      result: {
        callId: request.call.id,
        name: request.call.name,
        ok: false,
        output: `The guest daemon refuses non-box tool "${request.call.name}".`
      }
    }
  }

  const approved = new Set(request.approvals)
  let pending: VmBoxApproval | undefined
  const context: ToolContext = {
    sessionId: `vm:${VM_ID}`,
    botId: VM_ID,
    cwd: BOX_ROOT,
    dataDir: join(BOX_ROOT, '.openbot'),
    signal,
    computerTarget: { kind: 'local' },
    settings: request.settings as Settings,
    emit: () => undefined,
    requestApproval: async (approval: ApprovalRequest): Promise<boolean> => {
      const signature = approvalSignature(approval)
      if (approved.has(signature)) return true
      if (!pending) pending = { signature, request: approvalDraft(approval) }
      return false
    }
  }

  const result = await runTool(request.call, context)
  return pending ? { approval: pending } : { result }
}

export function approvalSignature(request: ApprovalRequest): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        toolName: request.toolName,
        kind: request.kind,
        summary: request.summary,
        detail: request.detail,
        preview: request.preview ?? null,
        force: request.force === true
      })
    )
    .digest('hex')
}

function approvalDraft(request: ApprovalRequest): VmBoxApproval['request'] {
  return {
    toolName: request.toolName,
    kind: request.kind,
    summary: request.summary,
    detail: request.detail,
    ...(request.preview ? { preview: request.preview } : {}),
    ...(request.force ? { force: true } : {})
  }
}

export function normaliseToolRequest(value: unknown): VmBoxToolRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected an object.')
  const source = value as Record<string, unknown>
  const call = normaliseCall(source['call'])
  const approvals = Array.isArray(source['approvals'])
    ? source['approvals']
        .filter((entry): entry is string => typeof entry === 'string' && /^[a-f0-9]{64}$/.test(entry))
        .slice(0, MAX_APPROVALS)
    : []
  return { call, approvals, settings: normaliseSettings(source['settings']) }
}

function normaliseCall(value: unknown): ToolCall {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected a tool call.')
  const source = value as Record<string, unknown>
  const id = typeof source['id'] === 'string' ? source['id'].slice(0, 128) : ''
  const name = typeof source['name'] === 'string' ? source['name'].slice(0, 128) : ''
  const args = source['args']
  if (!id || !name || !args || typeof args !== 'object' || Array.isArray(args)) {
    throw new TypeError('Malformed tool call.')
  }
  return { id, name, args: args as Record<string, unknown> }
}

function normaliseSettings(value: unknown): EffectiveSettings {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
  const policies = ['ask-every-time', 'ask-first-time', 'allowlist', 'auto-run'] as const
  const policy = policies.includes(source['approvalPolicy'] as (typeof policies)[number])
    ? (source['approvalPolicy'] as (typeof policies)[number])
    : 'ask-every-time'
  return {
    approvalPolicy: policy,
    allowlist: strings(source['allowlist']),
    denylist: strings(source['denylist']),
    computerUseAllowedApps: []
  }
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string').slice(0, 1000)
    : []
}
