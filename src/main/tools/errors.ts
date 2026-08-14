/**
 * Actionable error construction.
 *
 * Tools throw {@link ToolError} internally; `defineTool` converts whatever
 * escapes into a single string the model can read and act on. Nothing here
 * ever reaches the agent loop as an exception.
 */

/** An expected failure, carrying a message plus an optional next step. */
export class ToolError extends Error {
  readonly hint: string | undefined

  constructor(message: string, hint?: string) {
    super(message)
    this.name = 'ToolError'
    this.hint = hint
  }

  /** Message and hint as one blob, ready for `ToolResult.output`. */
  get text(): string {
    return this.hint ? `${this.message}\n${this.hint}` : this.message
  }
}

/** The user (or policy) refused the action. */
export class ApprovalDenied extends ToolError {
  constructor(what: string) {
    super(
      `Denied by the user: ${what}`,
      'Do not retry the same action. Explain what you wanted to do and ask how to proceed.'
    )
    this.name = 'ApprovalDenied'
  }
}

const ERRNO_HINTS: Record<string, string> = {
  ENOENT: 'No such file or directory. Verify the path with list_dir or glob first.',
  EACCES: 'Permission denied for that path.',
  EPERM: 'Operation not permitted. macOS privacy protection may cover this location.',
  EISDIR: 'That path is a directory, not a file.',
  ENOTDIR: 'A component of that path is not a directory.',
  EEXIST: 'That path already exists.',
  ENOTEMPTY: 'That directory is not empty.',
  EMFILE: 'Too many open files are already in use.',
  ELOOP: 'Too many symbolic links while resolving the path.',
  ENOSPC: 'No space left on the device.',
  EROFS: 'That filesystem is mounted read-only.',
  ECONNREFUSED: 'The connection was refused — nothing is listening there.',
  ETIMEDOUT: 'The connection timed out.',
  ENOTFOUND: 'The host could not be resolved.'
}

export function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { name?: string; code?: string }
  return e.name === 'AbortError' || e.code === 'ABORT_ERR' || e.name === 'TimeoutError'
}

/** Collapse anything thrown into one actionable line (or two). */
export function describeError(err: unknown, toolName: string): string {
  if (err instanceof ToolError) return err.text
  if (isAbortError(err)) return `${toolName} was cancelled.`
  if (err instanceof Error) {
    const e = err as NodeJS.ErrnoException
    const hint = e.code ? ERRNO_HINTS[e.code] : undefined
    const where = e.path ? ` (${e.path})` : ''
    if (hint) return `${toolName} failed: ${e.code}${where} — ${hint}`
    const cause = e.cause instanceof Error ? ` (${e.cause.message})` : ''
    return `${toolName} failed: ${err.message}${cause}`
  }
  return `${toolName} failed: ${String(err)}`
}
