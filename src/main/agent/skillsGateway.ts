/**
 * The assigned-skills section of the system prompt.
 *
 * Resolving it reads the CLIs' skill directories, so it can fail for reasons
 * that have nothing to do with the turn — an unreadable folder, a broken
 * symlink, a skill whose front matter was hand-edited. None of those are worth
 * losing the user's message over, so a failure degrades to no section at all
 * and is logged once rather than thrown.
 */

import type { Bot, Session } from '../../shared/types'
import { errorMessage } from './errors'
import { skillsSectionFor } from '../skills'

export async function skillsSection(bot: Bot, session: Session): Promise<string> {
  const ids = bot.skills ?? []
  if (ids.length === 0) return ''
  try {
    return await skillsSectionFor(ids, { cwd: session.cwd })
  } catch (err) {
    console.warn(`[agent] skills lookup failed for "${bot.name}": ${errorMessage(err)}`)
    return ''
  }
}
