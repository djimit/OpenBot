/**
 * What the user and the model are shown about a command: the approval card's
 * body, and the combined output of a finished run.
 *
 * Separate from the tool itself so the decision logic stays readable — this
 * module only formats, and never decides whether something runs.
 */

import { existsSync } from 'node:fs'
import { displayPath, outsideNotice } from '../paths'
import { truncateEnd } from '../text'
import type { ToolContext } from '../types'
import type { CommandAnalysis } from './classify'

export interface ApprovalDetailInput {
  ctx: ToolContext
  command: string
  cwd: string
  analysis: CommandAnalysis
  timeoutMs: number
  /** Working directory that leaves the workspace, when one does. */
  outside?: string
  /** Paths named in the command that leave the workspace. */
  escaping: string[]
}

export function approvalDetail(input: ApprovalDetailInput): string {
  const { ctx, analysis } = input
  const lines = [
    input.command,
    '',
    `Directory: ${displayPath(ctx, input.cwd)}`,
    `Shell:     ${loginShell().path} (login shell)`,
    `Timeout:   ${Math.round(input.timeoutMs / 1000)}s`,
    `Risk:      ${analysis.risk}`
  ]
  if (analysis.reasons.length > 0) lines.push(`Because:   ${analysis.reasons.join('; ')}`)
  if (input.outside) lines.push('', outsideNotice(ctx, input.outside))

  /*
   * Named separately from the working directory: a command can run inside the
   * workspace and still read out of it, and that is the case the risk
   * classifier alone could not see.
   */
  if (input.escaping.length > 0) {
    lines.push('', 'REACHES OUTSIDE THE WORKSPACE', ...input.escaping.map((path) => `Path:      ${path}`))
    if (!input.outside) lines.push(`Workspace: ${ctx.cwd}`)
  }
  return lines.join('\n')
}

/** The current environment's login shell, with a portable guest fallback. */
export function loginShell(): { path: string; args: string[] } {
  const configured = process.env.SHELL?.trim()
  const fallbacks = process.platform === 'darwin'
    ? ['/bin/zsh', '/bin/bash', '/bin/sh']
    : ['/bin/bash', '/bin/sh']
  const path = [configured, ...fallbacks].find(
    (candidate): candidate is string => Boolean(candidate && existsSync(candidate))
  ) ?? '/bin/sh'
  return { path, args: ['-l', '-c'] }
}

export function combineOutput(stdout: string, stderr: string, limit: number): string {
  const out = stdout.trimEnd()
  const err = stderr.trimEnd()
  if (out && err) return truncateEnd(`${out}\n\n[stderr]\n${err}`, limit)
  return truncateEnd(out || err, limit)
}
