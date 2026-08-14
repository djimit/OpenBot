/**
 * What the bots are told about turn-taking.
 *
 * Two audiences, deliberately unbalanced:
 *
 *  · `exchangeContract` is a system-prompt section. It says only what cannot be
 *    said later — who the teammates are, and how to read the transcript. It is
 *    short because it competes with the user's rules, the persona, memory, the
 *    tool list, the mode rules and, on an agent CLI, that CLI's own multi-page
 *    system prompt. A long protocol here is simply not read.
 *
 *  · `floorBrief` is a user-role message appended at the very end of the
 *    context, so it is the last thing the model reads before it writes. That is
 *    where the protocol actually belongs, and it is restated every single turn.
 *
 * `actionNudge` is the one-shot recovery: a reply with no ACTION line leaves the
 * floor stuck, so the moderator asks for the line once before the turn is given
 * up, in the manner of a room moderator keeping one conversation moving.
 */

import type { Session } from '../../shared/types'

const ACTION_MENU = [
  'ACTION: ASK <teammate> <what you need>   (only if you genuinely need them)',
  'ACTION: SPEAK <summary>                  (you answered; nobody else needed)',
  'ACTION: FINAL <answer>                   (the goal is met; ends the exchange)',
  'ACTION: YIELD                            (you have nothing to add)'
]

const LAST_LINE = 'The LAST line of your reply must be exactly one of these, on its own, with nothing after it:'

/** The floor moves on the line, never on the intention to move it. */
const INTENT_IS_NOT_A_HANDOFF =
  'Saying you will bring a teammate in does nothing on its own — the floor only moves on the ACTION line.'

/** The user's most recent instruction, verbatim. */
export function lastUserMessage(session: Session): string {
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const message = session.messages[i]
    if (message.role === 'user' && message.content.trim()) return message.content.trim()
  }
  return ''
}

/** The same instruction, trimmed to what the brief can carry: the exchange's goal. */
export function goalOf(session: Session): string {
  return lastUserMessage(session).slice(0, 400)
}

export function exchangeContract(others: Array<{ name: string; description: string }>): string {
  const roster = others
    .map((bot) => `- ${bot.name}: ${bot.description || 'no description'}`)
    .join('\n')

  return [
    '# Shared conversation',
    'You share this conversation with:',
    roster,
    '',
    'The user reads every message. Speak in first person, keep it short, and never write a ' +
      "reply on a teammate's behalf.",
    'A teammate\'s turn appears prefixed with their name in brackets, like "[' +
      (others[0]?.name ?? 'Teammate') +
      ']: ...". Anything without that prefix is your own turn or the user.',
    'Only one of you holds the floor at a time. A [moderator] note at the end of the ' +
      'conversation says whose turn it is and how the reply must end. Follow it exactly, every turn.'
  ].join('\n')
}

/**
 * The moderator's brief, handed to whoever holds the floor.
 *
 * Turn-taking is the orchestrator's job, not something the bots negotiate
 * between themselves — left to negotiate it they drift into pleasantries. Each
 * turn therefore restates the goal, who is speaking, and what ending the turn
 * requires.
 */
export function floorBrief(input: {
  goal: string
  speaker: string
  from?: string
  request?: string
  turn: number
  remaining: number
  /** The user named this bot with an @mention, so it must answer them. */
  userAddressed?: boolean
}): string {
  const goal = input.goal || '(see the conversation above)'

  if (input.userAddressed) {
    return [
      `[moderator] ${input.speaker}, the user asked you directly.`,
      `Their message: ${goal}`,
      'Answer them, not your teammates. Be brief and concrete.',
      '',
      INTENT_IS_NOT_A_HANDOFF,
      LAST_LINE,
      ...ACTION_MENU
    ].join('\n')
  }

  const handed = input.from
    ? `${input.from} handed the floor to you${input.request ? ` — they asked: ${input.request}` : ''}. Answer that first.`
    : 'Take the next concrete step toward the goal.'

  return [
    `[moderator] ${input.speaker}, your turn (${input.turn}). ${input.remaining} handovers left ` +
      'before the user is asked to step in.',
    `The user's goal: ${goal}`,
    handed,
    "Add something new — do not repeat yourself, do not greet anyone, and never write a reply on a teammate's behalf.",
    'Do real work this turn: use your tools, produce something, or answer specifically.',
    '',
    INTENT_IS_NOT_A_HANDOFF,
    LAST_LINE,
    ...ACTION_MENU
  ].join('\n')
}

/**
 * Asked for once, when a reply arrived without an ACTION line.
 *
 * Kept to the missing line: repeating the whole brief invites the bot to repeat
 * the whole reply, and the user would read the same paragraph twice.
 */
export function actionNudge(speaker: string, teammates: string[]): string {
  const who = teammates.length ? teammates.join(', ') : 'your teammates'
  return [
    `[moderator] ${speaker}, your last reply had no ACTION line, so the floor could not move ` +
      'and the user is waiting.',
    'Do not repeat what you just said. Add one short sentence at most, then end with the line.',
    `${LAST_LINE} (teammates: ${who})`,
    ...ACTION_MENU
  ].join('\n')
}
