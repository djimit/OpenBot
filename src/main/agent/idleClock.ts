/**
 * A deadline that fires only after a period of SILENCE.
 *
 * A single timer around a whole agent-CLI turn measured the wrong thing: a CLI
 * streaming steadily for twenty minutes is an ordinary long refactor, not a
 * hang, and killing it and reporting that it "produced nothing for 20 minutes"
 * was both wrong and unhelpful. What actually distinguishes a hung process is
 * that it has stopped saying anything, so the countdown restarts on every sign
 * of life and only a genuinely quiet process reaches the end of it.
 */

export interface IdleClock {
  /** Restart the countdown. Called on every chunk that arrives. */
  touch(): void
  /** True once the deadline fired; stays true. */
  expired(): boolean
  /** Stop the clock. Safe to call more than once. */
  stop(): void
}

export function startIdleClock(idleMs: number, onIdle: () => void): IdleClock {
  let timer: ReturnType<typeof setTimeout> | undefined
  let fired = false
  let stopped = false

  const arm = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      fired = true
      timer = undefined
      onIdle()
    }, idleMs)
  }
  arm()

  return {
    touch(): void {
      // Neither a stopped clock nor one that has already fired is rearmed: the
      // turn is over, and a rearmed timer would outlive it and abort the next.
      if (stopped || fired) return
      arm()
    },
    expired: () => fired,
    stop(): void {
      stopped = true
      if (timer) clearTimeout(timer)
      timer = undefined
    }
  }
}
