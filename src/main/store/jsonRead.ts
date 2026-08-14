/**
 * Reading JSON documents, and being honest about why a value is what it is.
 *
 * An unparseable file is quarantined into `backups/` and the caller gets its
 * default instead of a crash. Every other outcome is reported through `status`,
 * because "could not open" and "not there" produce the same fallback value and
 * a caller that confuses the two deletes data.
 */

import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import { backupsDir, dataRoot, ensureDir } from './paths'

/** Move an unreadable file aside so the next launch starts clean. */
async function quarantine(file: string, raw: string): Promise<void> {
  // The timestamp alone is not a unique name: two documents with the same
  // basename — `bots/x.json` and `memory/x.json` — quarantined in the same
  // millisecond landed on the same path, and the second one silently replaced
  // the first. The random tail is what makes the pair survivable.
  const stamp = `${Date.now()}.${randomBytes(3).toString('hex')}`
  const target = join(ensureDir(backupsDir()), `${basename(file)}.${stamp}.corrupt`)
  try {
    await fs.rename(file, target)
  } catch {
    try {
      await fs.writeFile(target, raw, 'utf8')
      await fs.rm(file, { force: true })
    } catch (err) {
      console.error('[openbot/store] could not quarantine', file, err)
      return
    }
  }
  console.warn('[openbot/store] corrupt file quarantined ->', target)
}

/**
 * Why a read produced its value.
 *
 * `unreadable` is the one a caller must not treat as "no data yet": the file is
 * there and its contents are intact, we simply could not open it (permissions,
 * a locked volume, too many open files). Overwriting on that signal destroys
 * user data, so `readJson`'s callers get to tell the two cases apart.
 */
export type JsonReadStatus = 'ok' | 'missing' | 'empty' | 'corrupt' | 'unreadable'

export interface JsonRead<T> {
  status: JsonReadStatus
  value: T
}

/** Read and parse `file`, reporting why the value is what it is. */
export async function readJsonState<T>(file: string, fallback: T): Promise<JsonRead<T>> {
  let raw: string
  try {
    raw = await fs.readFile(file, 'utf8')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return { status: 'missing', value: fallback }
    console.error('[openbot/store] read failed', file, err)
    return { status: 'unreadable', value: fallback }
  }
  if (raw.trim() === '') return { status: 'empty', value: fallback }
  try {
    const parsed = JSON.parse(raw) as T
    return parsed === null || parsed === undefined
      ? { status: 'empty', value: fallback }
      : { status: 'ok', value: parsed }
  } catch {
    await quarantine(file, raw)
    return { status: 'corrupt', value: fallback }
  }
}

/** Read and parse `file`; returns `fallback` when missing, empty or corrupt. */
export async function readJson<T>(file: string, fallback: T): Promise<T> {
  return (await readJsonState(file, fallback)).value
}

/**
 * Move aside a document that PARSED but could not be used.
 *
 * `readJsonState` quarantines what it cannot parse; a document that parses
 * cleanly and then fails its own schema was left exactly where it was, so the
 * same rejection repeated on every single launch. Only the caller that applied
 * the schema knows this happened, so only it can ask for the file to be moved.
 */
export async function quarantineDocument(file: string): Promise<void> {
  const raw = await fs.readFile(file, 'utf8').catch(() => '')
  await quarantine(file, raw)
}

/** A document that was read, and where it came from. */
export interface ReadDocument<T> {
  file: string
  value: T
}

export interface DirRead<T> {
  values: T[]
  /**
   * The same values, each with its path.
   *
   * A caller that applies a schema of its own has to be able to name the
   * document it rejects — to quarantine it, and to say so in a log line. With
   * only `values` it could do neither, so a project file with no `id` was
   * dropped without leaving a trace anywhere.
   */
  documents: ReadDocument<T>[]
  /**
   * A document existed but could not be read — a permission change, a lock, a
   * restore with the wrong owner, EMFILE at startup.
   *
   * The caller must not treat the result as the complete set. "Cannot open" and
   * "not there" look identical once the value is a fallback, and acting on that
   * confusion is how a single unreadable project file came to unfile every chat
   * that belonged to it, permanently.
   *
   * An UNPARSEABLE document counts too. It is quarantined rather than hidden,
   * so it will not come back — but it is just as absent from `values` as one
   * that could not be opened, and the caller reasoning about absence cannot
   * tell the difference. Reporting that read as complete is what let a single
   * truncated `projects/<id>.json` unfile every chat inside it.
   */
  incomplete: boolean
  /**
   * Documents that could not be parsed, by path. Already quarantined, so —
   * unlike `unreadable` — rewriting what is left is safe.
   */
  corrupt: string[]
  /**
   * The documents behind `incomplete`, by path.
   *
   * `incomplete` is a property of the whole directory, and a caller that can
   * name the affected document does not have to punish the rest: one locked
   * `memory/<botId>.json` used to stop every *other* bot from persisting for
   * the entire session. Empty when the directory itself could not be opened —
   * then nothing is known and the whole set is suspect.
   */
  unreadable: string[]
}

/** Read every `*.json` in `dir`, reporting whether the set is complete. */
export async function readJsonDirState<T>(dir: string): Promise<DirRead<T>> {
  // Hung off the first directory read of the process, which is the store coming
  // up: every launch loads its collections through here. See the sweep itself.
  sweepOnce()

  let names: string[]
  try {
    names = await fs.readdir(dir)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    // A directory that is not there has nothing to lose; one we cannot open is
    // hiding every document inside it, which is the dangerous case.
    if (code === 'ENOENT') {
      return { values: [], documents: [], incomplete: false, unreadable: [], corrupt: [] }
    }
    console.error('[openbot/store] readdir failed', dir, err)
    return { values: [], documents: [], incomplete: true, unreadable: [], corrupt: [] }
  }

  const documents: ReadDocument<T>[] = []
  const unreadable: string[] = []
  const corrupt: string[] = []
  for (const name of names.filter((entry) => entry.endsWith('.json'))) {
    const file = join(dir, name)
    const read = await readJsonState<T | null>(file, null)
    if (read.status === 'unreadable') unreadable.push(file)
    else if (read.status === 'corrupt') corrupt.push(file)
    if (read.value !== null) documents.push({ file, value: read.value })
  }
  return {
    values: documents.map((document) => document.value),
    documents,
    incomplete: unreadable.length > 0 || corrupt.length > 0,
    unreadable,
    corrupt
  }
}

/**
 * Temp files a crash left behind.
 *
 * `jsonWrite` serialises to `<file>.<pid>.<rand>.tmp` and renames it over the
 * target. A process killed between the two leaves the temp file, and nothing
 * ever collected them — the cleanup on the write path only removes the one
 * random name it was using — so they accumulate one per crashed write, for the
 * life of the install.
 *
 * Two guards keep this away from a write that is still happening: a temp file
 * this process owns is never touched, and neither is one younger than an hour,
 * which is far longer than any write here takes.
 */
const TEMP_SUFFIX = /\.(\d+)\.[a-z0-9]+\.tmp$/
const STALE_AFTER_MS = 60 * 60_000
/** Big, VM-owned, and never holds store documents — do not walk into it. */
const SKIP_DIRS = new Set(['boxes'])

export async function sweepStaleTempFiles(): Promise<void> {
  const root = dataRoot()
  await sweepTempDir(root)
  for (const entry of await fs.readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) await sweepTempDir(join(root, entry.name))
  }
}

/** One directory, no recursion: documents only ever live one level down. */
async function sweepTempDir(dir: string): Promise<void> {
  const cutoff = Date.now() - STALE_AFTER_MS
  for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const owner = entry.isFile() ? TEMP_SUFFIX.exec(entry.name) : null
    if (!owner || Number(owner[1]) === process.pid) continue
    const file = join(dir, entry.name)
    const info = await fs.stat(file).catch(() => null)
    if (!info || info.mtimeMs > cutoff) continue
    await fs.rm(file, { force: true }).catch((err) => {
      console.warn('[openbot/store] could not remove a stale temp file', file, err)
    })
  }
}

let swept: Promise<void> | null = null

/** Once per process, and never allowed to fail a read that triggered it. */
function sweepOnce(): void {
  swept ??= sweepStaleTempFiles().catch((err) => {
    console.warn('[openbot/store] temp sweep failed', err)
  })
}

/** Read every `*.json` in `dir`. Unreadable entries are skipped, not fatal. */
export async function readJsonDir<T>(dir: string): Promise<T[]> {
  return (await readJsonDirState<T>(dir)).values
}
