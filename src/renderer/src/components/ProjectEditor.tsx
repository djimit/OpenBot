import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { BUILT_IN_TAGS } from '../../../shared/projects'
import type { Project } from '../../../shared/types'
import { collectTags } from '../lib/board'
import {
  createProject,
  fetchProject,
  openBoard,
  openProjectEditor,
  pickDirectory,
  removeProject,
  updateProject,
  useAppState
} from '../state'
import { BotAvatar } from './BotAvatar'
import { IconBoard, IconFolder, IconTrash } from './Icons'
import { Modal } from './Modal'
import { TagInput } from './TagInput'
import './ProjectEditor.css'

type Draft = Pick<Project, 'name' | 'emoji' | 'color' | 'tags' | 'cwd' | 'botIds'>

const SWATCHES = [
  'var(--ob-accent)',
  'var(--ob-green)',
  'var(--ob-yellow)',
  'var(--ob-orange)',
  'var(--ob-red)',
  'var(--ob-purple)',
  'var(--ob-magenta)',
  'var(--ob-cyan)'
]

const EMOJI = ['📁', '🧭', '🚀', '🏠', '🧪', '📚', '💼', '🎯', '🛠️', '🌱']

const emptyDraft = (): Draft => ({ name: '', emoji: EMOJI[0] as string, color: SWATCHES[0] as string, tags: [], cwd: '', botIds: [] })

/** Create / edit form for one project: identity, tags, folder and bots. */
export function ProjectEditor(): ReactNode {
  const { projectDraftId, projects, bots } = useAppState()
  const isNew = projectDraftId === 'new'
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    let live = true
    setConfirmDelete(false)
    if (!projectDraftId || projectDraftId === 'new') {
      setDraft(emptyDraft())
      setLoading(false)
      return
    }
    setLoading(true)
    void fetchProject(projectDraftId).then((project) => {
      if (!live) return
      // No project means it was deleted while the row was still on screen.
      // Closing is honest; an empty form would invite saving over nothing.
      if (!project) return openProjectEditor(null)
      const { name, emoji, color, tags, cwd, botIds } = project
      setDraft({ name, emoji, color, tags, cwd, botIds })
      setLoading(false)
    })
    return () => {
      live = false
    }
  }, [projectDraftId])

  const suggestions = useMemo(() => collectTags(projects, BUILT_IN_TAGS), [projects])
  const set = <K extends keyof Draft>(key: K, value: Draft[K]): void => setDraft((d) => ({ ...d, [key]: value }))

  const close = (): void => openProjectEditor(null)

  const save = async (): Promise<void> => {
    if (!draft.name.trim()) return
    setSaving(true)
    const saved = isNew || !projectDraftId ? await createProject(draft) : await updateProject(projectDraftId, draft)
    setSaving(false)
    if (saved) close()
  }

  const toggleBot = (id: string): void =>
    setDraft((d) => ({ ...d, botIds: d.botIds.includes(id) ? d.botIds.filter((b) => b !== id) : [...d.botIds, id] }))

  return (
    <Modal
      title={isNew ? 'New project' : 'Edit project'}
      subtitle="A project gathers its bots, chats and board in one place."
      size="md"
      onClose={close}
      actions={
        !isNew && projectDraftId ? (
          <button type="button" className="ob-btn ob-btn-sm" onClick={() => void openBoard(projectDraftId)}>
            <IconBoard size={12} />
            Board
          </button>
        ) : null
      }
    >
      {loading ? (
        <p className="ob-hint">Loading project…</p>
      ) : (
        <div className="ob-project-editor">
          <div className="ob-project-identity">
            <div className="ob-field">
              <label htmlFor="ob-project-emoji">Emoji</label>
              <input
                id="ob-project-emoji"
                className="ob-input ob-project-emoji-input"
                value={draft.emoji}
                maxLength={8}
                onChange={(e) => set('emoji', e.target.value)}
              />
            </div>
            <div className="ob-field">
              <label htmlFor="ob-project-name">Name</label>
              <input
                id="ob-project-name"
                className="ob-input"
                value={draft.name}
                maxLength={120}
                placeholder="What this work is called"
                onChange={(e) => set('name', e.target.value)}
              />
            </div>
          </div>

          <div className="ob-project-emoji-row" role="group" aria-label="Suggested emoji">
            {EMOJI.map((e) => (
              <button key={e} type="button" className="ob-project-emoji-chip" aria-label={`Use ${e}`} onClick={() => set('emoji', e)}>
                {e}
              </button>
            ))}
          </div>

          <div className="ob-field">
            <span className="ob-label">Colour</span>
            <div className="ob-project-swatches" role="group" aria-label="Project colour">
              {SWATCHES.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`ob-project-swatch${draft.color === color ? ' is-active' : ''}`}
                  style={{ background: color }}
                  aria-label={`Colour ${color.replace(/var\(--ob-|\)/g, '')}`}
                  aria-pressed={draft.color === color}
                  onClick={() => set('color', color)}
                />
              ))}
            </div>
          </div>

          <div className="ob-field">
            <span className="ob-label">Tags</span>
            <TagInput value={draft.tags} suggestions={suggestions} onChange={(tags) => set('tags', tags)} />
            <p className="ob-hint">Tags are free text. The sidebar groups by whatever you actually use.</p>
          </div>

          <div className="ob-field">
            <span className="ob-label">Working folder</span>
            <div className="ob-project-folder">
              <span className="ob-project-folder-path" title={draft.cwd || undefined}>
                {draft.cwd || 'Not set — bots fall back to your home folder.'}
              </span>
              <button
                type="button"
                className="ob-btn ob-btn-sm"
                onClick={() => void pickDirectory().then((dir) => dir && set('cwd', dir))}
              >
                <IconFolder size={12} />
                Choose
              </button>
              {draft.cwd ? (
                <button type="button" className="ob-btn ob-btn-sm ob-btn-ghost" onClick={() => set('cwd', '')}>
                  Clear
                </button>
              ) : null}
            </div>
          </div>

          <div className="ob-field">
            <span className="ob-label">Bots on this project</span>
            {bots.length === 0 ? (
              <p className="ob-hint">No bots yet. Create one and it can be assigned here.</p>
            ) : (
              <ul className="ob-project-bots">
                {bots.map((bot) => (
                  <li key={bot.id}>
                    <label className="ob-check ob-project-bot">
                      <input type="checkbox" checked={draft.botIds.includes(bot.id)} onChange={() => toggleBot(bot.id)} />
                      <BotAvatar bot={bot} size="sm" />
                      <span>{bot.name}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <footer className="ob-project-editor-foot">
            {!isNew && projectDraftId ? (
              confirmDelete ? (
                <span className="ob-project-confirm">
                  <button
                    type="button"
                    className="ob-btn ob-btn-sm ob-btn-danger"
                    onClick={() => void removeProject(projectDraftId)}
                  >
                    Delete for good
                  </button>
                  <button type="button" className="ob-btn ob-btn-sm" onClick={() => setConfirmDelete(false)}>
                    Cancel
                  </button>
                </span>
              ) : (
                <button type="button" className="ob-btn ob-btn-sm ob-btn-ghost" onClick={() => setConfirmDelete(true)}>
                  <IconTrash size={12} />
                  Delete
                </button>
              )
            ) : (
              <span />
            )}
            <span className="ob-project-confirm">
              <button type="button" className="ob-btn ob-btn-sm" onClick={close}>
                Cancel
              </button>
              <button
                type="button"
                className="ob-btn ob-btn-sm ob-btn-primary"
                disabled={!draft.name.trim() || saving}
                onClick={() => void save()}
              >
                {saving ? 'Saving…' : isNew ? 'Create project' : 'Save changes'}
              </button>
            </span>
          </footer>
        </div>
      )}
    </Modal>
  )
}
