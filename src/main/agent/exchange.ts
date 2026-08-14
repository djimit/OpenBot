/**
 * The turn-taking protocol: who speaks next in a multi-bot session.
 *
 * Every reply ends with a single `ACTION: <VERB> <content>` line, which this
 * module parses. The protocol is plain TEXT rather than tool calls, and that is
 * the point: agent CLIs run their own tool loop and some (pi) have no MCP client
 * at all, so a tool-based handoff can never reach them. A trailing line in the
 * reply reaches every backend equally.
 *
 * The wording taught to the bots lives in `exchangeBrief.ts`; this file only
 * reads what came back.
 *
 * The turn-taking model — one speaker holds the floor, a moderator hands it on —
 * is a room/seat orchestration, reworked here for OpenBOT's bots, sessions and
 * event model.
 */

import { escapeRegex } from './text'
import { detectAddress } from './exchangeNames'

export { mentionsBot } from './exchangeNames'

export type ExchangeVerb = 'SPEAK' | 'ASK' | 'YIELD' | 'FINAL'

export interface ExchangeAction {
  verb: ExchangeVerb
  /** Everything after the verb. */
  text: string
  /** The reply with its ACTION line removed — what the user should read. */
  prose: string
  /** Name the bot addressed, for ASK. */
  target?: string
  /**
   * An `ACTION:` line was actually present. False means the verb was inferred,
   * which is what the moderator nudge in `loop.ts` reacts to.
   */
  hasActionLine: boolean
}

const VERBS = new Set<ExchangeVerb>(['SPEAK', 'ASK', 'YIELD', 'FINAL'])

/**
 * Models dress the line up: `**ACTION: ASK …**`, `- ACTION: YIELD`, `> ACTION:`
 * or wrapped in backticks. Treating those as prose loses the handoff *and*
 * leaves the raw protocol line in what the user reads, so the decoration is
 * matched rather than fought.
 */
const ACTION_LINE = /^[\s>*_`#•-]*ACTION\s*:/i
const TRAILING_MARKUP = /[*_`\s]+$/
const LEADING_MARKUP = /^[*_`\s]+/
/**
 * `FINAL: introductions are done` — the verb without the ACTION keyword.
 *
 * Observed on the turn that matters most, the one receiving a handoff. Accepted
 * only as the very last line of a reply, where a bare verb and a colon is the
 * protocol rather than prose.
 */
const BARE_VERB_LINE = /^[\s*_`]*(SPEAK|ASK|YIELD|FINAL)\s*:/i
/**
 * Quoted, bulleted or headed — someone else's words, or a list item.
 *
 * Bots quote each other's ACTION lines while replying to them, and a quoted
 * line mid-reply would otherwise route the turn on a teammate's verb. Accepted
 * only as the very last line, where the decoration is the bot dressing up its
 * own sign-off.
 */
const QUOTED_LINE = /^\s*([>#]|[-*+•]\s|\d+[.)]\s)/
const FENCE = /^\s*(```|~~~)/

function isVerb(value: string): value is ExchangeVerb {
  return (VERBS as ReadonlySet<string>).has(value)
}

/**
 * Which lines sit inside a fenced code block.
 *
 * A protocol line inside a fence is a quoted example — of the contract itself,
 * of a file, of a tool result — never this bot taking an action. Honouring it
 * would both route the turn on someone else's text and cut the line out of the
 * code block on its way to the transcript.
 */
function fencedLines(lines: string[]): boolean[] {
  let fenced = false
  return lines.map((line) => {
    if (FENCE.test(line)) {
      fenced = !fenced
      return true
    }
    return fenced
  })
}

/**
 * The protocol line: the LAST non-empty line of the reply, and only that line.
 *
 * `explicit` says the line named ACTION, which is the only form removed from
 * what the user reads. A bare verb is used for routing but left in place — if
 * the guess is wrong, the reply is merely written oddly rather than truncated.
 *
 * An `ACTION:` line found anywhere in the reply used to be honoured. That made
 * every fetched page a way to move the floor: a bot quoting a web page that
 * contains `ACTION: ASK <teammate> <attacker text>` handed the turn over on the
 * page's instruction — and because the line is cut out of the reply before it
 * is stored, the user never saw the sentence that did it. The contract already
 * demands the line be last, so nothing legitimate is lost by insisting on it.
 */
function findActionLine(lines: string[]): { index: number; line: string; explicit: boolean } | null {
  const fenced = fencedLines(lines)
  let last = -1
  for (let i = lines.length - 1; i >= 0 && last < 0; i--) if (lines[i].trim()) last = i
  if (last < 0 || fenced[last]) return null

  const line = lines[last]
  if (ACTION_LINE.test(line)) return { index: last, line, explicit: true }
  if (QUOTED_LINE.test(line) || !BARE_VERB_LINE.test(line)) return null
  return { index: last, line, explicit: false }
}

/** The line reduced to `VERB rest`, with the keyword and any markdown removed. */
function verbAndRest(actionLine: string): [string, string] {
  const body = ACTION_LINE.test(actionLine)
    ? actionLine.slice(actionLine.indexOf(':') + 1)
    : actionLine.replace(/\s*:/, ' ')
  const [head, ...rest] = body
    .replace(LEADING_MARKUP, '')
    .replace(TRAILING_MARKUP, '')
    .trim()
    .split(/\s+/)
  return [(head ?? '').replace(/[*_`]/g, '').toUpperCase(), rest.join(' ').trim()]
}


/**
 * A reply with no usable ACTION line: nothing is removed from it.
 *
 * Smaller local models routinely ignore the protocol and simply talk to the
 * teammate ("@Coder, ..."). Honour the intent rather than stranding the
 * exchange: a reply that opens by addressing a teammate IS a handoff.
 */
function unrouted(body: string, roster: string[]): ExchangeAction {
  const addressed = detectAddress(body, roster)
  if (addressed) {
    return { verb: 'ASK', text: body, prose: body, target: addressed, hasActionLine: false }
  }
  return { verb: 'SPEAK', text: body, prose: body, hasActionLine: false }
}

/**
 * Parse the trailing ACTION line.
 *
 * Deliberately lenient: a missing or malformed line becomes SPEAK rather than an
 * error. A local model that forgets the protocol should still have its answer
 * shown, not swallowed — the exchange degrades to a normal single-bot reply, and
 * `hasActionLine` lets the caller ask for the line once before giving up.
 */
export function parseAction(output: string, roster: string[]): ExchangeAction {
  const raw = (output ?? '').trim()
  if (!raw) return { verb: 'YIELD', text: '', prose: '', hasActionLine: false }

  const lines = raw.split('\n')
  const found = findActionLine(lines)
  // An explicit ACTION line is plumbing, never content: strip it from what is stored.
  // By index, not by value — an identical line elsewhere in the reply is content.
  const prose = found?.explicit
    ? lines
        .filter((_, index) => index !== found.index)
        .join('\n')
        .trim()
    : raw

  if (!found) return unrouted(prose || raw, roster)

  const [verb, text] = verbAndRest(found.line)
  // `# ACTION: items for the sprint` is a heading, not the protocol. The verb is what
  // identifies the line as plumbing, so without one the line stays in the reply and the
  // turn counts as having no ACTION line — which the moderator asks about once.
  if (!isVerb(verb)) return unrouted(raw, roster)
  if (!text && verb !== 'YIELD') return { verb: 'YIELD', text: '', prose, hasActionLine: true }
  if (verb !== 'ASK') return { verb, text, prose, hasActionLine: true }

  /*
   * ASK <teammate> <question> — match the longest roster name that prefixes the
   * remainder, so "Code Reviewer" wins over a bot called "Code".
   *
   * The name is unwrapped first. Models write `ACTION: ASK @Coder ...` far more
   * often than the bare form — it is how the user addresses bots, and how the
   * contract's own example reads — and a plain prefix match failed on every
   * decorated form: `@Coder`, `**Coder**`, `"Coder"`, `[Coder]`. The handoff
   * then degraded to SPEAK with the ACTION line already stripped, so the floor
   * stayed put, the teammate never answered, and the user saw no sign that a
   * handover had been attempted at all.
   */
  const opener = text.replace(/^[@*_`"'<([{\s]+/, '')
  const lowered = opener.toLowerCase()
  const target = [...roster]
    .sort((a, b) => b.length - a.length)
    .find((name) => lowered.startsWith(name.toLowerCase()))

  if (!target) return { verb: 'SPEAK', text, prose, hasActionLine: true }
  // Drop whatever closed the decoration, plus the punctuation that usually
  // separates the name from the question.
  const question = opener.slice(target.length).replace(/^[*_`"'>)\]}:,\s—-]+/, '')
  return { verb: 'ASK', text: question, prose, target, hasActionLine: true }
}

/**
 * Which bot the USER addressed, from a leading `@Name` on their message.
 *
 * Without this the floor simply stays with whoever spoke last, so there is no
 * way to bring a specific bot back into the conversation — you ask "@assistant
 * where are we?" and whoever happens to hold the floor answers instead.
 *
 * Matching is forgiving about case and punctuation because it is typed by hand.
 */
export function addressedBot(
  text: string,
  roster: Array<{ id: string; name: string }>
): { id: string; name: string; rest: string } | null {
  const trimmed = text.trimStart()
  if (!trimmed.startsWith('@')) return null

  // Longest name first: "@Code Reviewer" must beat a bot called "Code".
  for (const bot of [...roster].sort((a, b) => b.name.length - a.name.length)) {
    const match = new RegExp(`^@${escapeRegex(bot.name)}\\b[,:]?\\s*`, 'i').exec(trimmed)
    if (match) return { id: bot.id, name: bot.name, rest: trimmed.slice(match[0].length) }
  }
  return null
}
