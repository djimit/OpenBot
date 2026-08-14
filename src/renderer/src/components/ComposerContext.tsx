import type { ReactNode } from 'react'
import { pickDirectory, setSessionCwd } from '../state'
import { IconChevronDown, IconDisplay, IconFolder } from './Icons'

/** Last two path segments — recognisable without filling the row. */
function folderLabel(cwd: string): string {
  if (!cwd) return 'Choose folder'
  const parts = cwd.split('/').filter(Boolean)
  return parts.length <= 2 ? cwd : parts.slice(-2).join('/')
}

/** Where the next message will run: which folder, and on whose machine. */
export function ComposerContext({ cwd }: { cwd: string }): ReactNode {
  return (
    <div className="ob-composer-context">
      <button
        type="button"
        className="ob-context-chip"
        title={cwd ? `Working folder: ${cwd}` : 'Choose a working folder'}
        onClick={() => {
          void pickDirectory().then((dir) => {
            if (dir) void setSessionCwd(dir)
          })
        }}
      >
        <IconFolder size={12} />
        <span className="ob-context-chip-text">{folderLabel(cwd)}</span>
        <IconChevronDown size={10} />
      </button>

      <span className="ob-context-sep" aria-hidden="true" />

      <span className="ob-context-chip is-static" title="Everything runs on this machine">
        <IconDisplay size={12} />
        Local
      </span>
    </div>
  )
}
