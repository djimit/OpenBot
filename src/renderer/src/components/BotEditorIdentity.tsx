import type { ReactNode } from 'react'

export const SWATCHES = [
  '#7c9cff',
  '#5ad1a5',
  '#f1b467',
  '#d08770',
  '#fc6b83',
  '#9386f2',
  '#e0a3ff',
  '#88c0d0'
]

export const EMOJI = ['🤖', '🧭', '🔧', '📦', '🧪', '📝', '🔍', '🛰️', '🧱', '⚡️']

interface IdentityProps {
  emoji: string
  onEmoji: (emoji: string) => void
  name: string
  onName: (name: string) => void
  color: string
  onColor: (color: string) => void
  description: string
  onDescription: (description: string) => void
  systemPrompt: string
  onSystemPrompt: (systemPrompt: string) => void
}

/** Who the bot is: face, name, colour, and the persona it runs with. */
export function BotEditorIdentity({
  emoji,
  onEmoji,
  name,
  onName,
  color,
  onColor,
  description,
  onDescription,
  systemPrompt,
  onSystemPrompt
}: IdentityProps): ReactNode {
  return (
    <>
      <div className="ob-bot-identity">
        <div className="ob-field ob-bot-emoji-field">
          <label htmlFor="ob-bot-emoji">Emoji</label>
          <input
            id="ob-bot-emoji"
            className="ob-input ob-bot-emoji-input"
            value={emoji}
            maxLength={4}
            onChange={(e) => onEmoji(e.target.value)}
          />
        </div>
        <div className="ob-field ob-bot-name-field">
          <label htmlFor="ob-bot-name">Name</label>
          <input id="ob-bot-name" className="ob-input" value={name} onChange={(e) => onName(e.target.value)} />
        </div>
      </div>

      <div className="ob-bot-emoji-row" role="group" aria-label="Suggested emoji">
        {EMOJI.map((e) => (
          <button key={e} type="button" className="ob-bot-emoji-chip" onClick={() => onEmoji(e)} aria-label={`Use ${e}`}>
            {e}
          </button>
        ))}
      </div>

      <div className="ob-field">
        <span className="ob-label">Colour</span>
        <div className="ob-bot-swatches" role="group" aria-label="Bot colour">
          {SWATCHES.map((swatch) => (
            <button
              key={swatch}
              type="button"
              className={`ob-bot-swatch${color === swatch ? ' is-active' : ''}`}
              style={{ background: swatch }}
              aria-label={`Colour ${swatch.replace(/var\(--ob-|\)/g, '')}`}
              aria-pressed={color === swatch}
              onClick={() => onColor(swatch)}
            />
          ))}
        </div>
      </div>

      <div className="ob-field">
        <label htmlFor="ob-bot-desc">Description</label>
        <input
          id="ob-bot-desc"
          className="ob-input"
          value={description}
          placeholder="What this bot is for"
          onChange={(e) => onDescription(e.target.value)}
        />
      </div>

      <div className="ob-field">
        <label htmlFor="ob-bot-prompt">System prompt</label>
        <textarea
          id="ob-bot-prompt"
          className="ob-textarea"
          rows={6}
          value={systemPrompt}
          placeholder="Operating instructions for this persona"
          onChange={(e) => onSystemPrompt(e.target.value)}
        />
      </div>
    </>
  )
}
