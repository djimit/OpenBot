/**
 * Recognising a teammate's name in a reply.
 *
 * Two different questions with two different answers, which is why they sit
 * together: whether a reply *hands over* to someone (only `@Name` counts), and
 * whether it merely *talks about* someone (which earns the moderator's one
 * nudge for a missing ACTION line, and nothing more).
 */

import { escapeRegex } from './text'

/**
 * Is this reply explicitly handing over to a teammate?
 *
 * ONLY an `@Name` mention counts. An earlier version also treated a greeting
 * ("Hey Coder!") as a handoff, which deadlocked the room: two polite bots
 * greeted each other forever, each greeting triggering the next turn. A
 * greeting is not a request, so it must not move the floor.
 */
export function detectAddress(text: string, roster: string[]): string | undefined {
  const opening = text.trim().split('\n')[0]?.slice(0, 200) ?? ''
  if (!opening) return undefined

  for (const name of [...roster].sort((a, b) => b.length - a.length)) {
    if (new RegExp(`@${escapeRegex(name)}\\b`, 'i').test(opening)) return name
  }
  return undefined
}

/**
 * Does the reply talk about a teammate at all?
 *
 * The one signal that a reply without an ACTION line left something undone: it
 * discussed a teammate and then failed to hand over. Anything else — an answer,
 * a greeting, a question back to the user — is complete as it stands.
 *
 * Naming a teammate still moves nothing by itself; it only earns the moderator's
 * single request for the missing line. Treating a mention as a handoff is what
 * deadlocked the room once already, and must not come back.
 *
 * The name must appear either as `@Name` or capitalised exactly as the bot is.
 * A case-insensitive word match read ordinary prose as a mention — "the code is
 * mostly TypeScript" with a teammate called Code, "scout the options", "set max
 * to 10" — and each false hit cost the user a second identical reply to read.
 */
export function mentionsBot(text: string, names: string[]): boolean {
  const body = (text ?? '').trim()
  if (!body) return false
  return names.some((raw) => {
    const name = raw.trim()
    if (!name) return false
    const at = new RegExp(`@${escapeRegex(name)}\\b`, 'i')
    const exact = new RegExp(`\\b${escapeRegex(name)}\\b`)
    return at.test(body) || exact.test(body)
  })
}
