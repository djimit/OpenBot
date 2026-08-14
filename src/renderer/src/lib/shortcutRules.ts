/**
 * Who owns the keyboard, as a pure decision.
 *
 * The global handlers used to answer this implicitly, in the order their `if`
 * branches happened to be written, and a blocking approval lost every race: the
 * Cmd+N/Cmd+K/Cmd+, branch ran before the Escape branch and never asked whether
 * a gate was pending. With one waiting, Cmd+N switched the chat out from under
 * it, Cmd+K opened the palette — whose autofocused input sits UNDER the approval
 * scrim, so the user typed into something they could not see — and Cmd+, mounted
 * Settings on top of the gate.
 *
 * An approval is a security gate: it asks "may this command run", and nothing
 * else may move while it waits. These rules say so once, in a form that can be
 * tested without a DOM, and every keyboard entry point reads them.
 */

/** What a global key press means. `null` is "not ours — leave it alone". */
export type ShortcutAction =
  | 'new-chat'
  | 'toggle-palette'
  | 'settings'
  | 'reject-approval'
  | 'close-modal'
  | 'stop-turn'
  | null

/** The parts of a key event the rules depend on. */
export interface KeyIntent {
  key: string
  /** Command, or Control when the target is not a text field. */
  mod: boolean
  alt: boolean
  /** A held key: Escape must answer one gate per press, not walk the queue. */
  repeat: boolean
  /** The press came from a text field — an input, textarea or contenteditable. */
  editable: boolean
  /**
   * That text field hands Escape on to the app anyway.
   *
   * Two do, and they are the two with nothing to lose by it: the composer, whose
   * placeholder reads "Running — Esc to stop", and the command palette's search
   * box, which is autofocused on open and is the only way out of a surface that
   * traps Tab. Both carry no draft worth protecting; every other field does.
   */
  passesEscape: boolean
}

/** The parts of the app the rules depend on. */
export interface ShellState {
  /** Approval gates waiting to be answered. */
  approvals: number
  /** Any dialog is open — Settings, Bots, the palette, the board. */
  modalOpen: boolean
  streaming: boolean
}

/**
 * True when an overlay owns the keyboard and the pane shortcuts must stand down.
 *
 * Alt+1…6, Alt+arrows, Alt+W and Alt+G reach the window from anywhere. Alt+arrow
 * calls `selectSession`, so behind an approval it changed the live conversation
 * while the user was being asked to approve a command belonging to the old one.
 */
export function overlayOwnsKeys(state: { approvals: number; modalOpen: boolean }): boolean {
  return state.approvals > 0 || state.modalOpen
}

/**
 * The app-level shortcut a press maps to.
 *
 * With a gate pending only Escape is answered, and it always means "reject this
 * request" — never "close the dialog behind it" or "stop the run". That one
 * outranks the text field too: a security gate must be answerable wherever the
 * caret happens to be.
 */
export function shortcutFor(intent: KeyIntent, state: ShellState): ShortcutAction {
  const gated = state.approvals > 0

  if (intent.mod && !intent.alt && !gated) {
    const key = intent.key.toLowerCase()
    if (key === 'n') return 'new-chat'
    if (key === 'k') return 'toggle-palette'
    if (key === ',') return 'settings'
  }

  if (intent.key !== 'Escape' || intent.repeat) return null
  if (gated) return 'reject-approval'

  /*
   * Escape inside a text field belongs to the field, not to the app.
   *
   * Only `mod` used to consult the target, so Escape was claimed wherever it was
   * pressed — and the components that do not stop it themselves (BotEditor,
   * ProjectEditor, CardEditor, the settings panels, BotMemory, TagInput,
   * RoutinePanel, Sidebar) each paid for it twice over. Pressing Escape in a
   * long system prompt, the reflex for dismissing an autocomplete, matched
   * `close-modal` and unmounted the editor with the unsaved draft inside it.
   * Pressing it to clear the sidebar search box while a turn ran matched
   * `stop-turn` one branch further down and killed the agent. ModelPicker
   * documents this same bug and works around it locally, for itself only.
   *
   * `passesEscape` is how the two fields that WANT the app's Escape say so —
   * see `KeyIntent`. Without it this guard would have taken the composer's
   * advertised "Esc to stop" away, and shut the only keyboard exit from the
   * command palette.
   */
  if (intent.editable && !intent.passesEscape) return null

  if (state.modalOpen) return 'close-modal'
  if (state.streaming) return 'stop-turn'
  return null
}
