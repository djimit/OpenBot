import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import type { ApprovalDecision, ApprovalRequest } from '../../../shared/types'
import { diffFromText } from '../lib/diff'
import { useFocusTrap } from '../lib/focusTrap'
import { pngSrc } from '../lib/format'
import { useAppState } from '../state'
import { BotAvatar } from './BotAvatar'
import { DiffView } from './DiffView'
import { IconCheck, IconChat, IconClose, IconWarning } from './Icons'
import './ApprovalDialog.css'

interface ApprovalDialogProps {
  request: ApprovalRequest
  onDecide: (decision: ApprovalDecision) => void
  /** How many further requests are waiting behind this one. */
  queued: number
}

const KIND_LABEL: Record<ApprovalRequest['kind'], string> = {
  shell: 'Run a command',
  write: 'Write a file',
  edit: 'Edit a file',
  delete: 'Delete',
  fetch: 'Network request',
  mcp: 'MCP tool',
  computer: 'Control the computer'
}

/**
 * How long a freshly shown request ignores input.
 *
 * Answering one request pops the next into the same place under the pointer, so
 * the second half of a double-click — or a held key — would decide an action the
 * user has not read. Nothing a human can read and answer lands this fast.
 */
const ARM_MS = 400

/** Blocking gate for a mutating action. Esc rejects, handled by the app shell. */
export function ApprovalDialog({ request, onDecide, queued }: ApprovalDialogProps): ReactNode {
  const { bots, currentSessionId, session, sessions } = useAppState()
  const panelRef = useRef<HTMLDivElement>(null)
  // Stamped at first render, not in the effect, so the window is armed before
  // anything can be clicked rather than one paint later.
  const shownAt = useRef(Date.now())
  const diff = useMemo(() => diffFromText(request.detail), [request.detail])

  /*
   * Which chat, and which bot, is asking.
   *
   * The queue takes requests from ANY session (see state/events.ts) — that is
   * deliberate, because a background task or a group broadcast must still be
   * able to reach the user. But the card named neither, so reading chat A and
   * being handed a `shell` gate raised by chat B looked exactly like a gate
   * raised by what was on screen, and was approved on that belief.
   *
   * The title is read the way PaneChat reads it: the live session when it is
   * the one asking, the sidebar summary otherwise. The bot is only named when
   * it is not a guess — a foreign session with several bots in it gives no way
   * to tell which one raised this, and a confident wrong name on a security
   * prompt is worse than no name.
   */
  const origin = useMemo(() => {
    const live = session?.id === request.sessionId ? session : null
    const summary = sessions.find((s) => s.id === request.sessionId)
    const botIds = live?.botIds ?? summary?.botIds ?? []
    const botId = live?.activeBotId ?? (botIds.length === 1 ? botIds[0] : undefined)
    return {
      title: live?.title || summary?.title || 'Untitled chat',
      bot: botId ? bots.find((b) => b.id === botId) : undefined,
      /* The case the user cannot otherwise see: this is not the chat on screen. */
      elsewhere: request.sessionId !== currentSessionId
    }
  }, [bots, currentSessionId, request.sessionId, session, sessions])

  /*
   * A forced request can never be satisfied by a stored rule.
   *
   * `approvalPolicy.evaluate` short-circuits `force` to "ask" ABOVE the
   * allowlist check, so the pattern "Always approve" persists is unreachable
   * for this request forever. Offering the button anyway was worse than a
   * no-op: `derivePattern` widens the allowlist for every OTHER call that
   * matches — `rm *` from one `rm -rf` — while this action goes on prompting
   * every time. The user paid a standing permission and got nothing.
   *
   * Screen control keeps its own reason for hiding the button: there is no
   * honest pattern for "this click", so the main process refuses to persist one.
   */
  const forced = request.force === true
  const canRemember = !forced && request.kind !== 'computer'

  /*
   * Without this, Tab walks out of the card and into the app behind the scrim
   * — the one dialog where that matters most, since the user goes on typing
   * into a composer they cannot see while a command waits on their answer.
   *
   * Before the focus below: the trap notes where focus was so it can give it
   * back, and taking focus first made the card itself that memory.
   */
  useFocusTrap(panelRef, 'blocking')

  useEffect(() => {
    shownAt.current = Date.now()
    // The panel, never a button: a stray Enter or Space must not approve a
    // shell command just because the control happened to hold focus.
    panelRef.current?.focus()
  }, [request.id])

  const decide = (decision: ApprovalDecision): void => {
    if (Date.now() - shownAt.current < ARM_MS) return
    onDecide(decision)
  }

  return (
    <div className="ob-approval-scrim">
      <div
        className={`ob-approval${forced ? ' is-forced' : ''}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="ob-approval-title"
        aria-describedby="ob-approval-origin"
        ref={panelRef}
        tabIndex={-1}
      >
        <header className="ob-approval-head">
          <div className="ob-approval-head-row">
            <span className={`ob-pill ${forced ? 'ob-pill-bad' : 'ob-pill-warn'}`}>
              <IconWarning size={11} />
              {KIND_LABEL[request.kind]}
            </span>
            <span className="ob-approval-tool">{request.toolName}</span>
            {/* Irreversible, and named as such before the buttons are read. */}
            {forced ? <span className="ob-pill ob-pill-bad">Irreversible</span> : null}
            {queued > 0 ? <span className="ob-pill">{queued} more waiting</span> : null}
          </div>

          {/*
            Who is asking. `aria-describedby` points here, so a screen reader
            announces the chat and the bot with the dialog rather than leaving
            the origin to be discovered by tabbing.
          */}
          <p id="ob-approval-origin" className="ob-approval-origin">
            {origin.bot ? <BotAvatar bot={origin.bot} size="sm" /> : <IconChat size={12} />}
            <span>
              {origin.bot ? `${origin.bot.name} in ` : 'Asked in '}
              <span className="ob-approval-origin-title">{origin.title}</span>
            </span>
            {origin.elsewhere ? <span className="ob-pill ob-pill-accent">Another chat</span> : null}
          </p>
        </header>

        <h2 id="ob-approval-title" className="ob-approval-summary">
          {request.summary}
        </h2>

        {/*
          Focusable, and the only scroll container in the card.
          A keyboard-only user could read the first screenful of a 200-line
          script and no further: nothing inside was focusable, the panel that
          holds focus is not the element that scrolls, and the code block added a
          second scroller of its own with no way in. They were being asked to
          approve what they could not finish reading. `tabIndex` puts this region
          in the trap's cycle, before the buttons, so Tab lands here first and
          the arrow keys scroll it.
        */}
        <div
          className="ob-approval-detail"
          tabIndex={0}
          role="group"
          aria-label={`What ${request.toolName} is asking to do`}
        >
          {diff ? (
            <DiffView lines={diff} path={request.summary} />
          ) : request.detail ? (
            <pre className="ob-approval-code">{request.detail}</pre>
          ) : (
            <p className="ob-hint">No further detail was provided for this action.</p>
          )}

          {request.preview ? (
            <img className="ob-approval-preview" src={pngSrc(request.preview)} alt="Preview of the screen this action will affect" />
          ) : null}
        </div>

        <footer className="ob-approval-foot">
          <p className="ob-approval-note">
            {forced
              ? 'This one is always confirmed — there is no "always approve" for it. Esc rejects.'
              : 'Nothing runs until you decide. Esc rejects.'}
          </p>
          <div className="ob-approval-buttons">
            <button type="button" className="ob-btn ob-btn-danger" onClick={() => decide('reject')}>
              <IconClose size={12} />
              Reject
            </button>
            {/* Hidden for a forced request, and for screen control — see `canRemember`. */}
            {canRemember ? (
              <button type="button" className="ob-btn" onClick={() => decide('approve-always')}>
                Always approve
              </button>
            ) : null}
            <button type="button" className="ob-btn ob-btn-primary" onClick={() => decide('approve')}>
              <IconCheck size={12} />
              Approve
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
