/**
 * The bot's dock: which web apps are installed in its browser.
 *
 * An "app" here is a pinned web app — a name, a URL and an icon — and the
 * `signedIn` flag the user sets once they have logged the bot in through the
 * live view. Persisted next to the profile so the dock survives restarts.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { ToolError } from '../../errors'

export interface InstalledApp {
  id: string
  name: string
  url: string
  /** Emoji or a data: URI. Kept simple so nothing is fetched at render time. */
  icon: string
  /** Set by the user once they have signed the bot in. */
  signedIn?: boolean
  installedAt: number
}

/** Offered in the UI as one-click installs. */
export const APP_CATALOG: ReadonlyArray<Omit<InstalledApp, 'installedAt'>> = [
  { id: 'gmail', name: 'Gmail', url: 'https://mail.google.com', icon: '✉️' },
  { id: 'calendar', name: 'Calendar', url: 'https://calendar.google.com', icon: '📅' },
  { id: 'drive', name: 'Drive', url: 'https://drive.google.com', icon: '📁' },
  { id: 'salesforce', name: 'Salesforce', url: 'https://login.salesforce.com', icon: '☁️' },
  { id: 'linkedin', name: 'LinkedIn', url: 'https://www.linkedin.com', icon: '💼' },
  { id: 'zendesk', name: 'Zendesk', url: 'https://www.zendesk.com/login', icon: '🎫' },
  { id: 'slack', name: 'Slack', url: 'https://app.slack.com/client', icon: '💬' },
  { id: 'notion', name: 'Notion', url: 'https://www.notion.so', icon: '📝' },
  { id: 'github', name: 'GitHub', url: 'https://github.com', icon: '🐙' },
  { id: 'hex', name: 'Hex', url: 'https://app.hex.tech', icon: '📊' }
]

export interface AppInstallInput {
  id?: string
  name?: string
  url?: string
  icon?: string
}

/** The installed-app list for one bot, loaded once and written atomically. */
export class AppDock {
  private apps: InstalledApp[] = []
  private loaded = false
  private loading: Promise<void> | undefined
  /** Serialises writes so concurrent installs cannot interleave. */
  private writes: Promise<void> = Promise.resolve()

  constructor(private readonly file: string) {}

  /**
   * Load on demand and memoise. Without memoising, concurrent callers each
   * re-assign the list from disk, and a load finishing after another caller has
   * already pushed an app silently discards it.
   */
  ready(): Promise<void> {
    if (this.loaded) return Promise.resolve()
    this.loading ??= (async () => {
      try {
        const parsed: unknown = JSON.parse(await readFile(this.file, 'utf8'))
        this.apps = Array.isArray(parsed) ? (parsed as InstalledApp[]) : []
      } catch {
        this.apps = []
      }
      this.loaded = true
    })()
    return this.loading
  }

  list(): InstalledApp[] {
    return [...this.apps]
  }

  /** Resolve by id or name, falling back to the catalog. */
  find(nameOrId: string): InstalledApp | Omit<InstalledApp, 'installedAt'> | undefined {
    const needle = nameOrId.trim().toLowerCase()
    return (
      this.apps.find((a) => a.id === needle || a.name.toLowerCase() === needle) ??
      APP_CATALOG.find((a) => a.id === needle || a.name.toLowerCase() === needle)
    )
  }

  /** Install a catalog app by id, or any web app by name + URL. */
  async install(input: AppInstallInput): Promise<InstalledApp> {
    await this.ready()
    const preset = input.id ? APP_CATALOG.find((a) => a.id === input.id) : undefined
    const name = input.name ?? preset?.name
    const url = input.url ?? preset?.url
    if (!name || !url) throw new ToolError('Installing an app needs a catalog id, or a name and a url.')
    if (!/^https?:\/\//i.test(url)) throw new ToolError(`An app url must be http(s); got "${url}".`)

    const id = input.id ?? preset?.id ?? name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    const existing = this.apps.find((a) => a.id === id)
    if (existing) return existing

    const app: InstalledApp = {
      id,
      name,
      url,
      icon: input.icon ?? preset?.icon ?? '🌐',
      installedAt: Date.now()
    }
    this.apps.push(app)
    await this.save()
    return app
  }

  async uninstall(id: string): Promise<void> {
    await this.ready()
    this.apps = this.apps.filter((a) => a.id !== id)
    await this.save()
  }

  /** Marked once the user has signed in through the live view. */
  async markSignedIn(id: string, signedIn = true): Promise<void> {
    await this.ready()
    const app = this.apps.find((a) => a.id === id)
    if (!app) return
    app.signedIn = signedIn
    await this.save()
  }

  /**
   * Write atomically, and serialise writes against each other: two installs
   * landing together would otherwise race to overwrite the same file and lose
   * one of the apps, and a crash mid-write would leave truncated JSON behind.
   */
  private save(): Promise<void> {
    const snapshot = JSON.stringify(this.apps, null, 2)
    const next = this.writes.then(async () => {
      await mkdir(dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      await writeFile(tmp, snapshot, 'utf8')
      await rename(tmp, this.file)
    })
    // Keep the chain alive even if one write fails.
    this.writes = next.catch(() => undefined)
    return next
  }
}
