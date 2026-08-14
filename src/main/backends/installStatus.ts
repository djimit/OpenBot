/**
 * "Is this thing installed?" — the shared answer behind every
 * not-installed / not-running distinction.
 */

import type { InstallSpec } from './detectionTable'
import { type ProbeOutcome, probeVersion } from './versionProbe'
import { anyPathExists, which } from './which'

export interface InstallStatus {
  installed: boolean
  binaryPath?: string
  version?: string
  /** Result of the version probe, when one was run. */
  outcome?: ProbeOutcome
  /** Redacted probe output, when the probe failed. */
  detail?: string
}

export interface CheckInstallOptions {
  /** User-configured binary or absolute path, overriding the table default. */
  command?: string
  /** Spawn `<binary> --version` as well as resolving it on PATH. */
  runVersionProbe?: boolean
  timeoutMs?: number
}

export async function checkInstall(
  spec: InstallSpec,
  opts: CheckInstallOptions = {}
): Promise<InstallStatus> {
  const binary = opts.command?.trim() || spec.binary
  const binaryPath = binary ? await which(binary) : null

  if (!binaryPath) {
    // Some backends ship a GUI app with no CLI on PATH.
    const hinted = spec.paths?.().filter(Boolean) ?? []
    if (hinted.length && (await anyPathExists(hinted))) {
      return { installed: true }
    }
    return { installed: false, outcome: 'missing' }
  }

  if (!opts.runVersionProbe) return { installed: true, binaryPath }

  const probe = await probeVersion(binaryPath, spec.versionArgs ?? ['--version'], opts.timeoutMs)
  return {
    // A binary that exists but exits non-zero on `--version` is still installed.
    installed: probe.outcome !== 'missing',
    binaryPath,
    ...(probe.version ? { version: probe.version } : {}),
    outcome: probe.outcome,
    ...(probe.outcome === 'success' ? {} : { detail: probe.output })
  }
}

/** `Ollama 0.6.2` / `Ollama` — for status details. */
export function describeInstall(label: string, status: InstallStatus): string {
  return status.version ? `${label} ${status.version}` : label
}
