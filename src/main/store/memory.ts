/**
 * Per-bot long-term memory.
 *
 * One document per bot — `memory/<botId>.json` — holding that bot's entries in
 * insertion order. Documents are self-describing (`{ botId, entries }`) so a
 * renamed file can never orphan its contents.
 */

import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { MemoryEntry } from '../../shared/types'
import { deleteJson, readJsonDirState, reviveJson, writeJsonDebounced } from './jsonStore'
import { memoryDir, safeFileName } from './paths'

interface MemoryDoc {
  botId: string
  entries: MemoryEntry[]
}

const SOURCES: ReadonlyArray<MemoryEntry['source']> = ['run', 'user', 'exchange']

/**
 * Hard bounds on one bot's memory document.
 *
 * What reaches the model is already bounded by `memoryBudgetFor`, so this is
 * about the file: memory was append-only with no eviction, and the whole
 * document is rewritten on every single add. A long-running bot therefore paid
 * a growing cost on every `remember` and a growing load time on every launch,
 * for facts the prompt could never fit anyway. Oldest goes first — a fact worth
 * keeping gets restated, and there is no signal here that says otherwise.
 */
const MAX_ENTRIES = 500
const MAX_TEXT = 2000

/** Keep the newest `MAX_ENTRIES`, in order. */
function capped(entries: MemoryEntry[]): MemoryEntry[] {
  return entries.length > MAX_ENTRIES ? entries.slice(entries.length - MAX_ENTRIES) : entries
}

const cache = new Map<string, MemoryEntry[]>()
let loaded = false

function fileFor(botId: string): string {
  return join(memoryDir(), `${safeFileName(botId)}.json`)
}

function persist(botId: string): void {
  const doc: MemoryDoc = { botId, entries: cache.get(botId) ?? [] }
  writeJsonDebounced(fileFor(botId), doc)
}

function normaliseEntry(raw: unknown, botId: string): MemoryEntry | null {
  if (typeof raw !== 'object' || raw === null) return null
  const value = raw as Record<string, unknown>
  const text = typeof value['text'] === 'string' ? value['text'].slice(0, MAX_TEXT) : ''
  if (text.trim() === '') return null
  const source = value['source']
  const tags = Array.isArray(value['tags'])
    ? value['tags'].filter((t): t is string => typeof t === 'string')
    : undefined
  const entry: MemoryEntry = {
    id: typeof value['id'] === 'string' && value['id'] ? value['id'] : randomUUID(),
    botId: typeof value['botId'] === 'string' && value['botId'] ? value['botId'] : botId,
    text,
    source: (SOURCES as ReadonlyArray<string>).includes(source as string)
      ? (source as MemoryEntry['source'])
      : 'user',
    createdAt: typeof value['createdAt'] === 'number' ? value['createdAt'] : Date.now()
  }
  if (tags && tags.length) entry.tags = tags
  return entry
}

/**
 * The bots whose memory document existed but could not be read.
 *
 * The cache is not the whole truth for those bots, and rewriting the document —
 * which every add does, wholesale — would delete the facts that did not load.
 * One `remember` call after a failed read destroyed the rest.
 *
 * Held per bot, by file, because the alternative was worse than the bug: a
 * single locked document turned persistence off for *every* bot for the rest of
 * the session, so memories the user watched being saved were gone at the next
 * launch, with only a console line to say why. A bot whose own document read
 * cleanly has nothing to lose by being written.
 */
const unreadable = new Set<string>()

/** False for a bot whose document did not load: its cache is not complete. */
function persistable(botId: string): boolean {
  return !unreadable.has(fileFor(botId))
}

/** Read every memory document into the cache. */
export async function loadMemory(): Promise<void> {
  if (loaded) return
  loaded = true
  const read = await readJsonDirState<unknown>(memoryDir())
  for (const file of read.unreadable) unreadable.add(file)
  for (const raw of read.values) {
    if (typeof raw !== 'object' || raw === null) continue
    const doc = raw as Record<string, unknown>
    const botId = typeof doc['botId'] === 'string' ? doc['botId'] : ''
    // Tolerate the legacy/bare shape of a naked array as well.
    const rawEntries = Array.isArray(doc['entries'])
      ? doc['entries']
      : Array.isArray(raw)
        ? (raw as unknown[])
        : []
    const entries: MemoryEntry[] = []
    for (const rawEntry of rawEntries) {
      const entry = normaliseEntry(rawEntry, botId)
      if (entry) entries.push(entry)
    }
    const key = botId || entries[0]?.botId
    if (!key) continue
    // A document written before the cap existed is trimmed on the way in; the
    // next add is what writes the smaller file back.
    cache.set(key, capped(entries))
  }
}

/** Every entry for a bot, oldest first. */
export function listBotMemory(botId: string): MemoryEntry[] {
  return [...(cache.get(botId) ?? [])]
}

export function addBotMemory(
  botId: string,
  text: string,
  source: MemoryEntry['source'] = 'user',
  tags?: string[]
): MemoryEntry {
  const entry: MemoryEntry = {
    id: randomUUID(),
    botId,
    text: text.slice(0, MAX_TEXT),
    source,
    createdAt: Date.now()
  }
  if (tags && tags.length) entry.tags = tags.filter((t) => typeof t === 'string')
  const existing = cache.get(botId)
  // No cached document means this one is being created, which after
  // `clearBotMemory` means recreated — the only caller allowed to write over a
  // path the store has tombstoned as deleted.
  if (!existing) reviveJson(fileFor(botId))
  const entries = capped([...(existing ?? []), entry])
  cache.set(botId, entries)
  // Held in memory for this session, but never written back over a document we
  // could not read in full.
  if (persistable(botId)) persist(botId)
  else console.warn('[openbot/store] memory for', botId, 'was unreadable at load; not persisting')
  return entry
}

export function removeBotMemory(botId: string, entryId: string): boolean {
  const entries = cache.get(botId)
  if (!entries) return false
  const next = entries.filter((entry) => entry.id !== entryId)
  if (next.length === entries.length) return false
  cache.set(botId, next)
  // Same rule as adding, which this used to ignore: rewriting a document that
  // did not load drops every entry the read never saw, and a removal rewrites
  // it just as wholesale as an add does.
  if (persistable(botId)) persist(botId)
  return true
}

/** Drop a bot's whole memory document — used when the bot is deleted. */
export function clearBotMemory(botId: string): void {
  cache.delete(botId)
  void deleteJson(fileFor(botId))
}

/* ── conventional aliases ────────────────────────────────────────── */

/**
 * The agent loop resolves store functions by conventional name (`list`,
 * `add`) rather than by import, so it stays decoupled from this module's
 * internals. These are the names it looks for.
 */
export const list = listBotMemory

export function add(botId: string, text: string, entry?: Partial<MemoryEntry>): MemoryEntry {
  return addBotMemory(botId, text, entry?.source ?? 'run', entry?.tags)
}
