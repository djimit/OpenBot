/**
 * Discovery: scan every known skills directory and describe what is there.
 *
 * Nothing here throws. A missing root, an unreadable directory, a folder with
 * no `SKILL.md`, or a malformed header is skipped and the rest is still
 * returned — a broken skill must never cost the user the list.
 *
 * Hidden entries (`.system`, `.git`, …) are skipped: those are vendor- or
 * tool-managed, not skills the user installed or should be assigning.
 */

import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  SKILL_FILE,
  dedupeByPreference,
  isSkillName,
  preferenceFor,
  skillId,
  type Skill
} from '../../shared/skills'
import { readSkillHead } from './frontmatter'
import { skillRoots, type SkillRoot } from './roots'

export interface DiscoverOptions {
  /** Session working folder, to include its project-local skills. */
  cwd?: string
}

/** Defence against a pathological directory; real roots hold a handful. */
const MAX_ENTRIES_PER_ROOT = 500
const MAX_DESCRIPTION = 600

/** Every skill visible on this machine, sorted by name. */
export async function discoverSkills(opts: DiscoverOptions = {}): Promise<Skill[]> {
  const roots = uniqueRoots(skillRoots(opts.cwd))
  const scanned = await Promise.all(roots.map((root) => scanRoot(root)))
  return scanned.flat().sort((a, b) => a.name.localeCompare(b.name) || a.origin.localeCompare(b.origin))
}

/** The skills one CLI can actually see, name collisions resolved its way. */
export async function discoverSkillsFor(backendId: string, opts: DiscoverOptions = {}): Promise<Skill[]> {
  return viewFor(await discoverSkills(opts), backendId)
}

/** Apply a backend's preference chain to an already-scanned list. */
export function viewFor(skills: Skill[], backendId: string): Skill[] {
  return dedupeByPreference(skills, preferenceFor(backendId)).sort((a, b) => a.name.localeCompare(b.name))
}

/** One directory's skills. Returns `[]` when it does not exist or cannot be read. */
export async function scanRoot(root: SkillRoot): Promise<Skill[]> {
  let entries: string[]
  try {
    const found = await readdir(root.dir, { withFileTypes: true })
    entries = found
      .filter((entry) => !entry.name.startsWith('.') && (entry.isDirectory() || entry.isSymbolicLink()))
      .map((entry) => entry.name)
      .slice(0, MAX_ENTRIES_PER_ROOT)
  } catch {
    return []
  }

  const read = await Promise.all(entries.map((name) => readSkill(join(root.dir, name), name, root)))
  return read.filter((skill): skill is Skill => skill !== null)
}

/**
 * Describe one candidate folder, or `null` when it is not a skill.
 * `stat` follows symlinks, so a linked skill folder reads like a real one.
 */
export async function readSkill(dir: string, folder: string, root: SkillRoot): Promise<Skill | null> {
  const file = join(dir, SKILL_FILE)

  let updatedAt = 0
  try {
    const [entry, doc] = await Promise.all([stat(dir), stat(file)])
    if (!entry.isDirectory() || !doc.isFile()) return null
    updatedAt = Math.max(doc.mtimeMs, entry.mtimeMs)
  } catch {
    return null
  }

  const head = await readSkillHead(file)
  if (!head) return null

  const name = nameFrom(head.fields.name, folder)
  return {
    id: skillId(root.origin, name),
    name,
    description: describe(head.fields.description, head.body),
    origin: root.origin,
    path: dir,
    shared: root.shared,
    updatedAt: Math.round(updatedAt)
  }
}

/** Frontmatter name wins, then the folder name, then a slug of it. */
function nameFrom(declared: string | undefined, folder: string): string {
  const candidate = (declared ?? '').trim()
  if (isSkillName(candidate)) return candidate
  if (isSkillName(folder)) return folder
  const slug = folder
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[^A-Za-z0-9]+/, '')
    .replace(/\.{2,}/g, '.')
    .slice(0, 128)
  return isSkillName(slug) ? slug : 'skill'
}

/** Frontmatter description, else the first real paragraph of the body. */
function describe(declared: string | undefined, body: string): string {
  const stated = collapse(declared ?? '')
  if (stated) return stated.slice(0, MAX_DESCRIPTION)

  for (const line of body.split('\n')) {
    const text = line.trim()
    if (!text || text.startsWith('#') || text.startsWith('<!--')) continue
    return collapse(text).slice(0, MAX_DESCRIPTION)
  }
  return ''
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** Two roots can resolve to the same folder; scan it once. */
function uniqueRoots(roots: SkillRoot[]): SkillRoot[] {
  const seen = new Set<string>()
  return roots.filter((root) => {
    if (seen.has(root.dir)) return false
    seen.add(root.dir)
    return true
  })
}
