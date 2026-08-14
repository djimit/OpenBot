/**
 * Last-resort process guards for the main process.
 *
 * Node's default for an unhandled rejection is to kill the process, and the
 * main process is the one holding the store: a stray rejection anywhere in the
 * agent, backend or tool layers would take the whole app down mid-turn and
 * lose the user's chat with it. `backends/cli/codexAppServer.ts` documents one
 * such rejection it cannot fully rule out.
 *
 * Installed before anything asynchronous starts, so a failure during boot is
 * caught by the same net as one during a run.
 */

let installed = false

export function installCrashGuards(): void {
  if (installed) return
  installed = true

  process.on('unhandledRejection', (reason) => {
    console.error('[openbot] unhandled promise rejection', reason)
  })

  /*
   * Surviving an uncaught exception means continuing with state whose
   * invariants may no longer hold, which is not free — but the alternative is
   * an editor-class desktop app that vanishes without warning, discarding
   * every debounced write that had not landed yet. The orderly quit path
   * (flush, then stop children) is still what runs when the user quits, so
   * logging and staying up loses strictly less than exiting here.
   */
  process.on('uncaughtException', (err) => {
    console.error('[openbot] uncaught exception in the main process', err)
  })
}
