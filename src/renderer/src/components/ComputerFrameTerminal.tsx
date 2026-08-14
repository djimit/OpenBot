import { useEffect, useState, type ReactNode } from 'react'
import { runBotAdminCommand } from '../state'

export interface ComputerFrameTerminalProps {
  output: string
  command: string
  onCommand: (command: string) => void
  busy: boolean
  onRun: () => void
}

/**
 * The terminal's transcript and in-flight command. `enabled` is the same gate
 * the tab is behind — only a managed VM the human holds control of runs
 * anything.
 */
export function useAdminTerminal(botId: string | undefined, enabled: boolean): ComputerFrameTerminalProps {
  const [busy, setBusy] = useState(false)
  const [command, setCommand] = useState('')
  const [output, setOutput] = useState('')

  useEffect(() => {
    setCommand('')
    setOutput('')
  }, [botId])

  const run = async (): Promise<void> => {
    if (!botId || !enabled || busy || !command.trim()) return
    const submitted = command.trim()
    setCommand('')
    setBusy(true)
    setOutput((current) => `${current}${current ? '\n' : ''}$ ${submitted}\n`)
    try {
      const result = await runBotAdminCommand(botId, submitted)
      const next = result.ok
        ? `${result.stdout}${result.stderr}${result.stdout || result.stderr ? '' : '(no output)\n'}[exit ${result.exitCode}]\n`
        : `Error: ${result.error}\n`
      setOutput((current) => `${current}${next}`.slice(-200_000))
    } finally {
      setBusy(false)
    }
  }

  return { output, command, onCommand: setCommand, busy, onRun: () => void run() }
}

/** Root shell inside the managed VM — the escape hatch for installing things. */
export function ComputerFrameTerminal({ output, command, onCommand, busy, onRun }: ComputerFrameTerminalProps): ReactNode {
  return (
    <section className="ob-cframe-terminal" aria-label="VM administrator terminal">
      <div className="ob-cframe-terminal-note">
        <strong>Administrator terminal</strong>
        <span>Commands run as root inside this VM only. Install CLI, background packages, and graphical Linux apps with <code>apt-get</code>.</span>
      </div>
      <pre className="ob-cframe-terminal-output" aria-live="polite">{output || 'Ready. Try: apt-get update && apt-get install -y git\n'}</pre>
      <div className="ob-cframe-terminal-input">
        <textarea
          className="ob-input"
          value={command}
          rows={2}
          placeholder="Command to run inside the VM"
          aria-label="Administrator command"
          onChange={(event) => onCommand(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              onRun()
            }
          }}
          disabled={busy}
        />
        <button type="button" className="ob-btn ob-btn-primary" onClick={onRun} disabled={busy || !command.trim()}>
          {busy ? 'Running…' : 'Run in VM'}
        </button>
      </div>
    </section>
  )
}
