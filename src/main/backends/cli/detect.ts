/**
 * Detection for agent CLIs: is the binary there, and does it answer?
 *
 * The probe is `<binary> --version` with stdin closed, classified as
 * missing / timeout / nonzero / success. Everything it needs comes from the
 * spec's install row, so detection stays data-driven.
 */

import { installHint } from '../detectionTable'
import { checkInstall } from '../installStatus'
import type { DetectResult } from '../types'
import { anyPathExists } from '../which'
import { type AgentCliSpec, commandFor } from './spec'
import type { BackendConfig } from '../types'

export async function detectAgentCli(
  spec: AgentCliSpec,
  cfg: BackendConfig
): Promise<DetectResult> {
  const command = commandFor(spec, cfg)
  if (!command) {
    return {
      status: 'not-installed',
      detail: `Set a command for ${spec.displayName} in Settings — any binary speaking its protocol works.`
    }
  }

  const install = await checkInstall(spec.install, { command, runVersionProbe: true })

  if (!install.installed) {
    return {
      status: 'not-installed',
      detail: `\`${command}\` was not found on your PATH. ${installHint(spec.install)}`
    }
  }

  if (install.outcome === 'timeout') {
    return {
      status: 'error',
      detail: `${spec.displayName} did not answer a version check within the probe window — it may be waiting on first-run setup. Run \`${command}\` once in a terminal.`
    }
  }

  const configured = spec.install.paths ? await anyPathExists(spec.install.paths()) : true
  const version = install.version ? ` ${install.version}` : ''
  const where = install.binaryPath ? ` (${install.binaryPath})` : ''
  if (!configured) {
    return {
      status: 'needs-key',
      detail: `${spec.displayName}${version} is installed${where} but has no configuration yet — run \`${command}\` once and sign in.`
    }
  }

  return { status: 'available', detail: `${spec.displayName}${version} found${where}.` }
}
