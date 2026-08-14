/**
 * Per-session cancellation.
 *
 * One `AbortController` per session, handed to backend streams (aborting in-flight HTTP)
 * and to every tool context (aborting spawned child processes). Anything that owns a
 * resource the signal cannot reach registers a disposer here instead.
 *
 * All state is keyed by session id, so concurrent sessions never cancel each other.
 */

type Disposer = () => void

interface Entry {
  controller: AbortController
  disposers: Set<Disposer>
  startedAt: number
}

const entries = new Map<string, Entry>()

/**
 * Begin a cancellable unit of work. Any previous controller for the session is aborted
 * first, so a stale run can never keep streaming into a new one.
 */
export function start(sessionId: string): AbortController {
  abort(sessionId, 'superseded')
  const entry: Entry = {
    controller: new AbortController(),
    disposers: new Set(),
    startedAt: Date.now()
  }
  entries.set(sessionId, entry)
  return entry.controller
}

export function controllerFor(sessionId: string): AbortController | undefined {
  return entries.get(sessionId)?.controller
}

export function signalFor(sessionId: string): AbortSignal | undefined {
  return entries.get(sessionId)?.controller.signal
}

export function isRunning(sessionId: string): boolean {
  const entry = entries.get(sessionId)
  return !!entry && !entry.controller.signal.aborted
}

export function isAborted(sessionId: string): boolean {
  const entry = entries.get(sessionId)
  return !entry || entry.controller.signal.aborted
}

/**
 * Register a resource to tear down on abort — a child process handle, a watcher, a
 * timer. Returns an unregister function to call when the resource ends normally.
 */
export function register(sessionId: string, dispose: Disposer): Disposer {
  const entry = entries.get(sessionId)
  if (!entry) {
    // No run in flight: the resource is already orphaned, so dispose immediately.
    safeDispose(dispose)
    return () => undefined
  }
  if (entry.controller.signal.aborted) {
    safeDispose(dispose)
    return () => undefined
  }
  entry.disposers.add(dispose)
  return () => entry.disposers.delete(dispose)
}

/** Abort the session's work. Returns true when something was actually running. */
export function abort(sessionId: string, reason = 'stopped'): boolean {
  const entry = entries.get(sessionId)
  if (!entry) return false

  const wasRunning = !entry.controller.signal.aborted
  if (wasRunning) {
    try {
      entry.controller.abort(new DOMException(reason, 'AbortError'))
    } catch {
      try {
        entry.controller.abort()
      } catch {
        /* already aborted */
      }
    }
  }

  for (const dispose of entry.disposers) safeDispose(dispose)
  entry.disposers.clear()
  entries.delete(sessionId)
  return wasRunning
}

/**
 * Mark a unit of work finished. Only clears state if `controller` is still the current
 * one, so a run that finishes late cannot wipe a newer run's controller.
 */
export function finish(sessionId: string, controller: AbortController): void {
  const entry = entries.get(sessionId)
  if (!entry || entry.controller !== controller) return
  for (const dispose of entry.disposers) safeDispose(dispose)
  entry.disposers.clear()
  entries.delete(sessionId)
}

/** Abort everything — used on app quit. */
export function abortAll(reason = 'shutdown'): void {
  for (const sessionId of [...entries.keys()]) abort(sessionId, reason)
}

export function runningSessionIds(): string[] {
  return [...entries.entries()]
    .filter(([, e]) => !e.controller.signal.aborted)
    .map(([id]) => id)
}

function safeDispose(dispose: Disposer): void {
  try {
    dispose()
  } catch {
    /* teardown failures are never fatal */
  }
}
