/**
 * The single `child_process` wrapper used by every tool.
 *
 * Arguments are always passed as an argv array — nothing reaches a shell unless
 * the caller deliberately spawns one. Handles capture, streaming, timeouts,
 * abort and process-group kills, and resolves rather than throws.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { clearTimeout as clearNodeTimeout, setTimeout as setNodeTimeout } from 'node:timers'
import { ToolError } from './errors'
import { CappedText } from './text'

export interface ExecOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  /** Wall-clock ceiling; the child (and its group, when detached) is killed. */
  timeoutMs?: number
  signal?: AbortSignal
  input?: string
  /** Ceiling per stream, in characters. Default 200_000. */
  maxOutputChars?: number
  /** Run detached so descendants die with the child. */
  killGroup?: boolean
  onStdout?: (chunk: string) => void
  onStderr?: (chunk: string) => void
}

export interface ExecResult {
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  timedOut: boolean
  aborted: boolean
  /** Set when the binary could not be spawned at all. */
  spawnError?: string
  durationMs: number
}

export function execCapture(file: string, args: string[], opts: ExecOptions = {}): Promise<ExecResult> {
  const started = Date.now()
  const cap = opts.maxOutputChars ?? 200_000

  return new Promise<ExecResult>((resolve) => {
    const out = new CappedText(cap)
    const err = new CappedText(cap)
    let settled = false
    let timedOut = false
    let aborted = false

    let spawned: ChildProcess | undefined
    try {
      spawned = spawn(file, args, {
        cwd: opts.cwd,
        env: opts.env ?? process.env,
        detached: opts.killGroup === true,
        stdio: ['pipe', 'pipe', 'pipe']
      })
    } catch (e) {
      resolve({
        code: null,
        signal: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        aborted: false,
        spawnError: e instanceof Error ? e.message : String(e),
        durationMs: Date.now() - started
      })
      return
    }
    const child: ChildProcess = spawned

    const kill = (sig: NodeJS.Signals): void => {
      try {
        if (opts.killGroup === true && typeof child.pid === 'number') process.kill(-child.pid, sig)
        else child.kill(sig)
      } catch {
        try {
          child.kill(sig)
        } catch {
          /* already gone */
        }
      }
    }
    const hardKill = (): void => {
      kill('SIGTERM')
      setNodeTimeout(() => kill('SIGKILL'), 2000).unref()
    }

    let timer: NodeJS.Timeout | undefined
    if (opts.timeoutMs && opts.timeoutMs > 0) {
      timer = setNodeTimeout(() => {
        timedOut = true
        hardKill()
      }, opts.timeoutMs)
      timer.unref()
    }

    const onAbort = (): void => {
      aborted = true
      hardKill()
    }
    if (opts.signal) {
      if (opts.signal.aborted) onAbort()
      else opts.signal.addEventListener('abort', onAbort, { once: true })
    }

    const outDecoder = new TextDecoder('utf-8')
    const errDecoder = new TextDecoder('utf-8')
    child.stdout?.on('data', (buf: Buffer) => {
      const text = outDecoder.decode(buf, { stream: true })
      if (!text) return
      out.push(text)
      opts.onStdout?.(text)
    })
    child.stderr?.on('data', (buf: Buffer) => {
      const text = errDecoder.decode(buf, { stream: true })
      if (!text) return
      err.push(text)
      opts.onStderr?.(text)
    })

    child.stdin?.on('error', () => {
      /* the child may exit before draining stdin */
    })
    child.stdin?.end(opts.input ?? '')

    const finish = (code: number | null, sig: NodeJS.Signals | null, spawnError?: string): void => {
      if (settled) return
      settled = true
      if (timer) clearNodeTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      resolve({
        code,
        signal: sig,
        stdout: out.toString(),
        stderr: err.toString(),
        timedOut,
        aborted,
        spawnError,
        durationMs: Date.now() - started
      })
    }

    child.on('error', (e: NodeJS.ErrnoException) => {
      const detail =
        e.code === 'ENOENT'
          ? `Executable not found: ${file}`
          : e.code === 'EACCES'
            ? `Not executable: ${file}`
            : e.message
      finish(null, null, detail)
    })
    child.on('close', (code, sig) => finish(code, sig))
  })
}

/** Run a binary for its stdout, throwing a `ToolError` on any failure. */
export async function execText(file: string, args: string[], opts: ExecOptions = {}): Promise<string> {
  const res = await execCapture(file, args, opts)
  if (res.spawnError) throw new ToolError(res.spawnError)
  if (res.timedOut) throw new ToolError(`${file} timed out after ${opts.timeoutMs ?? 0} ms.`)
  if (res.code !== 0) {
    const detail = (res.stderr || res.stdout).trim().split('\n').slice(0, 5).join('\n')
    throw new ToolError(`${file} exited with code ${res.code ?? 'null'}${detail ? `: ${detail}` : ''}`)
  }
  return res.stdout
}
