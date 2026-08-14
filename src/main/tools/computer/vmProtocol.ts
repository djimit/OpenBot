/** Wire contract shared by the desktop VM client and the guest execution daemon. */

import type { ToolCall, ToolResult } from '../../../shared/types'
import type { ApprovalDraft, EffectiveSettings } from '../types'

export interface VmBoxToolRequest {
  call: ToolCall
  /** Stable approval signatures accepted by the user for this one call. */
  approvals: string[]
  settings: EffectiveSettings
}

export interface VmBoxApproval {
  signature: string
  request: ApprovalDraft
}

export type VmBoxToolResponse =
  | { result: ToolResult; approval?: never }
  | { approval: VmBoxApproval; result?: never }

export const VM_BOX_CAPABILITIES = ['box-exec-v1', 'box-files-v1'] as const

export function hasVmBoxCapabilities(capabilities: readonly string[] | undefined): boolean {
  return VM_BOX_CAPABILITIES.every((capability) => capabilities?.includes(capability))
}

export function hasVmComputerCapability(capabilities: readonly string[] | undefined): boolean {
  return capabilities?.includes('computer-v1') === true
}
