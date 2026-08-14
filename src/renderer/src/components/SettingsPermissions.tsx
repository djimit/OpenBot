import { useState, type ReactNode } from 'react'
import type { ApprovalPolicy, Settings } from '../../../shared/types'
import { editSettingsList, updateSettings } from '../state'
import { StringListEditor } from './StringListEditor'
import './SettingsPermissions.css'

interface SettingsPermissionsProps {
  settings: Settings
}

const POLICIES: Array<{ id: ApprovalPolicy; label: string; hint: string }> = [
  { id: 'ask-every-time', label: 'Ask every time', hint: 'Every mutating action waits for you.' },
  { id: 'ask-first-time', label: 'Ask once per action', hint: 'Approve an action once, then it repeats freely.' },
  { id: 'allowlist', label: 'Allowlist', hint: 'Run listed commands without asking; ask for everything else.' },
  { id: 'auto-run', label: 'Auto-run', hint: 'Never ask, except for destructive actions and anything outside the working folder.' }
]

/**
 * Where a bot may run the short side call that extracts memories from a turn.
 *
 * On a direct model API that is one cheap completion. On an agent CLI the same
 * call spawns a whole second agent process after EVERY turn — billable, running
 * its own tool loop — which is not something to do behind someone's back, so it
 * is off for CLIs unless asked for.
 */
const MEMORY_EXTRACTION: Array<{ id: NonNullable<Settings['memoryExtraction']>; label: string; hint: string }> = [
  { id: 'api', label: 'Direct APIs only', hint: 'One cheap completion after a turn. Agent CLIs are skipped.' },
  { id: 'all', label: 'Every backend', hint: 'Also spawns a second agent CLI process after each turn it runs on.' },
  { id: 'off', label: 'Off', hint: 'Bots only remember what you or they save explicitly.' }
]

/** Approval policy, command lists, sandbox and the global rules prompt. */
export function SettingsPermissions({ settings }: SettingsPermissionsProps): ReactNode {
  const policy = POLICIES.find((p) => p.id === settings.approvalPolicy)
  /*
   * The rules box is typed into a draft and written on blur.
   *
   * Bound straight to `updateSettings`, every keystroke sent the whole prompt
   * over IPC and `updateSettings` serialises those writes, so a paragraph of
   * house rules was a disk write per character and a textarea that lagged the
   * keyboard. null means "no draft", so a value saved elsewhere shows through.
   */
  const [rulesDraft, setRulesDraft] = useState<string | null>(null)

  const commitRules = (): void => {
    if (rulesDraft !== null && rulesDraft !== settings.rules) void updateSettings({ rules: rulesDraft })
    setRulesDraft(null)
  }

  return (
    <section className="ob-settings-section">
      <div className="ob-field">
        <label htmlFor="ob-policy" className="ob-label">
          Approval policy
        </label>
        <select
          id="ob-policy"
          className="ob-select"
          value={settings.approvalPolicy}
          onChange={(e) => void updateSettings({ approvalPolicy: e.target.value as ApprovalPolicy })}
        >
          {POLICIES.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <p className="ob-hint">{policy?.hint}</p>
      </div>

      <div className="ob-field">
        <label htmlFor="ob-memory-extraction" className="ob-label">
          Learn from conversations
        </label>
        <select
          id="ob-memory-extraction"
          className="ob-select"
          value={settings.memoryExtraction ?? 'api'}
          onChange={(e) =>
            void updateSettings({
              memoryExtraction: e.target.value as NonNullable<Settings['memoryExtraction']>
            })
          }
        >
          {MEMORY_EXTRACTION.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <p className="ob-hint">
          {MEMORY_EXTRACTION.find((m) => m.id === (settings.memoryExtraction ?? 'api'))?.hint}
        </p>
      </div>

      {/*
        There was a "Sandbox" checkbox here promising to "confine file writes
        and commands to the working folder". Nothing read it, and there is no
        seatbelt anywhere — the confinement it described is done unconditionally
        by the path layer. A security control that does nothing is worse than
        none, because it invites trust it cannot repay, so it is gone rather
        than left switched on.
      */}
      {settings.approvalPolicy === 'auto-run' ? (
        <p className="ob-notice ob-notice-error" role="status">
          Auto-run answers approvals for you. Work outside the working folder and anything
          destructive still asks, but everything else runs unattended.
        </p>
      ) : null}

      {/*
        One entry at a time — `editSettingsList` re-reads the file first. These
        two lists are shared with the agent: answering an approval with "always
        approve" appends a rule here, and this panel would not hear about it, so
        posting the whole array back would have wiped it.
      */}
      <StringListEditor
        label="Allowlist"
        hint="Commands that never need approval."
        items={settings.allowlist}
        placeholder="Command or prefix"
        onEdit={(edit) => void editSettingsList('allowlist', edit)}
      />

      <StringListEditor
        label="Denylist"
        hint="Never run these, whatever the policy says."
        items={settings.denylist}
        placeholder="Command or prefix"
        tone="danger"
        onEdit={(edit) => void editSettingsList('denylist', edit)}
      />

      <div className="ob-field">
        <label htmlFor="ob-rules" className="ob-label">
          Global rules
        </label>
        <p className="ob-hint">Prepended to every bot's system prompt.</p>
        <textarea
          id="ob-rules"
          className="ob-textarea"
          rows={6}
          value={rulesDraft ?? settings.rules}
          placeholder="House rules that apply to every bot"
          onChange={(e) => setRulesDraft(e.target.value)}
          onBlur={commitRules}
        />
      </div>

      <StringListEditor
        label="Computer use"
        hint='Apps a bot may see and control. Use "*" to allow all of them.'
        items={settings.computerUseAllowedApps}
        placeholder="App name, e.g. Safari"
        onEdit={(edit) => void editSettingsList('computerUseAllowedApps', edit)}
      />

      {settings.computerUseAllowedApps.length === 0 ? (
        <p className="ob-notice" role="status">
          No apps are granted yet, so computer use is off. Add an app above before asking a bot to
          drive one.
        </p>
      ) : null}
    </section>
  )
}
