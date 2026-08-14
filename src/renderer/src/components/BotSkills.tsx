import { useEffect, useState, type ReactNode } from 'react'
import type { Skill } from '../../../shared/types'
import { installSkill, loadSkillsFor, skillsReady, useAppState } from '../state'
import { IconPlus } from './Icons'
import './BotSkills.css'

interface BotSkillsProps {
  backendId: string
  selected: string[]
  onChange: (skills: string[]) => void
}

/**
 * Skills a bot may use.
 *
 * Only the ones this bot's CLI can actually reach are offered: each agent reads
 * its own directory plus the shared one, so listing everything would let the
 * user assign a skill that silently does nothing. Anything already assigned but
 * now unreachable is still shown, flagged, so it can be removed rather than
 * lingering invisibly.
 */
export function BotSkills({ backendId, selected, onChange }: BotSkillsProps): ReactNode {
  const { skills: all } = useAppState()
  const [visible, setVisible] = useState<Skill[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let live = true
    if (!backendId) {
      setVisible([])
      /*
       * Clearing here is what stops a permanent spinner. Switching to a bot
       * with no backend yet took this early return, which never cleared the
       * flag the previous run raised — and that run's `setLoading(false)` was
       * skipped too, because this cleanup had already flipped `live`. The panel
       * then sat on "Looking for skills…" for good, hiding the message that
       * says no skills are reachable.
       */
      setLoading(false)
      return
    }
    setLoading(true)
    void loadSkillsFor(backendId).then((list) => {
      if (!live) return
      setVisible(list)
      setLoading(false)
    })
    return () => {
      live = false
      // The answer this run is waiting on will be ignored, so its flag must not
      // outlive it either.
      setLoading(false)
    }
  }, [backendId, all.length])

  if (!skillsReady()) return null

  const reachable = new Set(visible.map((s) => s.id))
  const orphans = selected.filter((id) => !reachable.has(id))

  const toggle = (id: string): void => {
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id])
  }

  return (
    <div className="ob-field">
      <div className="ob-bot-skills-head">
        <span className="ob-label">Skills</span>
        <button
          type="button"
          className="ob-btn ob-btn-sm"
          onClick={() => void installSkill()}
          title="Install a skill folder for every agent"
        >
          <IconPlus size={11} />
          Install
        </button>
      </div>
      <p className="ob-hint">
        Extra capabilities this bot can call on. Installing adds a skill to the shared folder, so
        every agent can see it.
      </p>

      {loading ? <p className="ob-hint">Looking for skills…</p> : null}

      {!loading && visible.length === 0 ? (
        <p className="ob-hint">
          No skills this agent can reach. Install one, or add a folder to its own skills directory.
        </p>
      ) : null}

      {visible.map((skill) => (
        <label key={skill.id} className="ob-check ob-bot-skill">
          <input
            type="checkbox"
            checked={selected.includes(skill.id)}
            onChange={() => toggle(skill.id)}
          />
          <span>
            <span className="ob-bot-skill-name">{skill.name}</span>
            {skill.shared ? <span className="ob-pill">shared</span> : null}
            {skill.description ? (
              <span className="ob-hint ob-bot-skill-desc">{skill.description}</span>
            ) : null}
          </span>
        </label>
      ))}

      {orphans.length > 0 ? (
        <p className="ob-notice ob-notice-error" role="status">
          {orphans.length} assigned skill{orphans.length === 1 ? '' : 's'} cannot be reached by this
          agent ({orphans.join(', ')}). Install into the shared folder, or untick to remove:{' '}
          {orphans.map((id) => (
            <button key={id} type="button" className="ob-btn ob-btn-sm" onClick={() => toggle(id)}>
              Remove {id}
            </button>
          ))}
        </p>
      ) : null}
    </div>
  )
}
