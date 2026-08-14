import type { Skill } from '../../../shared/types'
import { bridge, errText } from './bridge'
import { store } from './core'

/**
 * Skills available to bots.
 *
 * The CLIs load skills themselves; OpenBOT only discovers what is installed and
 * records which ones a bot may use. Because each CLI reads only its own
 * directory plus the shared one, the list a bot can actually see depends on its
 * backend — `loadSkillsFor` is what the editor should use, not the full list.
 */
type SkillsApi = {
  list?: (cwd?: string) => Promise<Skill[]>
  refresh?: (cwd?: string) => Promise<Skill[]>
  forBackend?: (backendId: string, cwd?: string) => Promise<Skill[]>
  install?: (sourcePath: string, opts?: { overwrite?: boolean }) => Promise<unknown>
  uninstall?: (id: string) => Promise<unknown>
}

/** Resolved per call: an older preload simply has no skills namespace. */
function api(): SkillsApi | null {
  const surface = (bridge() as unknown as { skills?: SkillsApi }).skills
  return surface ?? null
}

export function skillsReady(): boolean {
  return api() !== null
}

export async function loadSkills(refresh = false): Promise<void> {
  const skills = api()
  if (!skills?.list) return
  store.patch({ skillsLoading: true })
  try {
    const list = refresh && skills.refresh ? await skills.refresh() : await skills.list()
    store.patch({ skills: list, skillsLoading: false, skillsError: null })
  } catch (e) {
    store.patch({ skillsLoading: false, skillsError: errText(e) })
  }
}

/** Only what this backend's CLI can actually see, deduped by preference. */
export async function loadSkillsFor(backendId: string): Promise<Skill[]> {
  const skills = api()
  if (!skills?.forBackend || !backendId) return []
  try {
    return await skills.forBackend(backendId)
  } catch (e) {
    store.toast(errText(e), 'error')
    return []
  }
}

/** Copy a folder into the shared directory so every CLI can see it. */
export async function installSkill(): Promise<void> {
  const skills = api()
  if (!skills?.install) return
  const dir = await bridge().dialog.pickDirectory()
  if (!dir) return
  try {
    const result = (await skills.install(dir)) as { ok?: boolean; error?: string }
    if (result?.ok) {
      store.toast('Skill installed for every agent.', 'info')
      await loadSkills(true)
    } else {
      store.toast(result?.error ?? 'That folder could not be installed as a skill.', 'error')
    }
  } catch (e) {
    store.toast(errText(e), 'error')
  }
}

export async function uninstallSkill(id: string): Promise<void> {
  const skills = api()
  if (!skills?.uninstall) return
  try {
    const result = (await skills.uninstall(id)) as { ok?: boolean; error?: string }
    if (result?.ok) await loadSkills(true)
    else store.toast(result?.error ?? 'That skill could not be removed.', 'error')
  } catch (e) {
    store.toast(errText(e), 'error')
  }
}
