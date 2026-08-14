/**
 * Parser for `pi --list-models`.
 *
 * pi prints a fixed-width table of every model it can reach — cloud providers
 * and locally-hosted ones alike. This is how local models surface in OpenBOT:
 * the user configures them inside pi, and we enumerate whatever pi reports. We
 * write no inference code for them.
 *
 *   provider  model                        context  max-out  thinking  images
 *   cluster   deepseek-v4-flash-0731       1.0M     32.8K    yes       no
 *   MBP       mlx-community/Qwen3.6-27B..  262.1K   32.8K    yes       yes
 */

import type { ModelInfo } from '../types'

/** `1.0M` / `262.1K` / `32768` -> a token count. */
function parseCount(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const match = /^([\d.]+)\s*([KMkm])?$/.exec(raw.trim())
  if (!match) return undefined
  const value = Number(match[1])
  if (!Number.isFinite(value)) return undefined
  const unit = match[2]?.toUpperCase()
  const scale = unit === 'M' ? 1_000_000 : unit === 'K' ? 1_000 : 1
  return Math.round(value * scale)
}

function isYes(raw: string | undefined): boolean {
  return raw?.trim().toLowerCase() === 'yes'
}

/** The `thinking` and `images` columns are strictly yes/no; anything else is not a row. */
function isFlag(raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase()
  return value === 'yes' || value === 'no'
}

/**
 * Columns are separated by runs of two or more spaces. Splitting on single
 * spaces or on `/` would break real model names, which contain both — e.g.
 * `mlx-community/Qwen3.6-27B-AEON-Ultimate-Uncensored-BF16-mlx-8Bit` and
 * `lmstudio-community--Qwen2.5-Coder-3B-Instruct-MLX-4bit`.
 */
export function parsePiModels(output: string): ModelInfo[] {
  const lines = output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
  if (lines.length < 2) return []

  // Drop the header row, identified by its first column rather than position.
  const rows = /^\s*provider\b/i.test(lines[0]) ? lines.slice(1) : lines

  const models: ModelInfo[] = []
  const seen = new Set<string>()

  for (const line of rows) {
    const cols = line.trim().split(/\s{2,}/)

    const [provider, name, context, , thinking, images] = cols
    if (!provider || !name) continue

    /*
     * Only accept a row that has the full six columns and yes/no in both flag
     * positions. Accepting anything with two columns turned stray output — a
     * warning, a banner, an interleaved stderr line — into a fabricated model,
     * and picked up whatever happened to sit in the `images` position as its
     * vision flag, which is how computer use gets offered on a model that
     * cannot see.
     */
    if (cols.length < 6 || !isFlag(thinking) || !isFlag(images)) continue
    if (/\s/.test(provider) || /\s/.test(name)) continue

    // pi's `--model` flag accepts the `provider/id` form, so the slug we build
    // here round-trips back as a valid argument.
    const id = `${provider}/${name}`
    if (seen.has(id)) continue
    seen.add(id)

    models.push({
      id,
      label: name,
      contextWindow: parseCount(context),
      supportsTools: true,
      supportsVision: isYes(images),
      // `thinking` is reported but has no home on ModelInfo; kept out rather
      // than smuggled into an unrelated field.
      ...(isYes(thinking) ? {} : {})
    })
  }

  return models
}
