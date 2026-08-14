/**
 * The one place the supervisor starts a child process.
 *
 * Every call is argv-only (`shell: false`), bounded in output, cancellable and
 * timed out, which is what lets the rest of the supervisor treat the Apple
 * `container` CLI as an ordinary function call. Routing all of it through a
 * single indirection is also what makes the whole runtime testable without a
 * VM: `setCommandRunner` swaps the implementation, and callers keep whichever
 * reference they imported.
 */

import { spawn } from 'node:child_process'
import { basename } from 'node:path'

const COMMAND_LIMIT = 2 * 1024 * 1024

export interface CommandResult {
  stdout: string
  stderr: string
  exitCode?: number
}

export type CommandRunner = (
  command: string,
  args: string[],
  options?: { timeoutMs?: number; signal?: AbortSignal; acceptNonZero?: boolean }
) => Promise<CommandResult>

let installed: CommandRunner = spawnCapture

/** Stable entry point: resolves the installed runner at call time, not import time. */
export const commandRunner: CommandRunner = async (command, args, options) =>
  await installed(command, args, options)

export function setCommandRunner(runner?: CommandRunner): void {
  installed = runner ?? spawnCapture
}

async function spawnCapture(
  command: string,
  args: string[],
  options: { timeoutMs?: number; signal?: AbortSignal; acceptNonZero?: boolean } = {}
): Promise<CommandResult> {
  return await new Promise<CommandResult>((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false })
    let stdout = ''
    let stderr = ''
    let exitCode = 0
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      options.signal?.removeEventListener('abort', abort)
      if (error) rejectPromise(error)
      else resolvePromise({ stdout, stderr, exitCode })
    }
    const append = (current: string, chunk: Buffer): string => {
      if (Buffer.byteLength(current) >= COMMAND_LIMIT) return current
      return (current + chunk.toString('utf8')).slice(0, COMMAND_LIMIT)
    }
    child.stdout.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk) })
    child.stderr.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk) })
    child.once('error', (error) => finish(error))
    child.once('exit', (code, processSignal) => {
      exitCode = code ?? 128
      if (code === 0 || options.acceptNonZero) finish()
      else finish(new Error(`${basename(command)} ${args[0] ?? ''} failed (${processSignal ?? code}): ${stderr.trim() || stdout.trim()}`))
    })
    const abort = (): void => {
      child.kill('SIGKILL')
      finish(new Error('VM operation cancelled.'))
    }
    if (options.signal?.aborted) abort()
    else options.signal?.addEventListener('abort', abort, { once: true })
    timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(new Error(`${basename(command)} timed out after ${options.timeoutMs ?? 120_000} ms.`))
    }, options.timeoutMs ?? 120_000)
  })
}
