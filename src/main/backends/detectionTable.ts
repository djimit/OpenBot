/**
 * Detection metadata as pure data.
 *
 * Every backend's "how do I get this thing" lives here as a row, so adding an
 * install route is a table edit rather than a code change. Filesystem hints are
 * functions because paths are derived at runtime, never hardcoded.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

export interface InstallSpec {
  /** Bare binary name; resolved through the hydrated login-shell PATH. */
  binary?: string
  versionArgs?: string[]
  npmPackage?: string
  brewFormula?: string
  brewCask?: string
  pipPackage?: string
  curlInstall?: string
  homepage?: string
  /** Existence hints (config directories) for CLIs that hide their binary. */
  paths?: () => string[]
}

/** Config directory of a CLI, resolved at runtime under the user's home. */
export function homePath(...segments: string[]): string {
  return join(homedir(), ...segments)
}

/** One sentence telling the user exactly how to get the thing. */
export function installHint(spec: InstallSpec): string {
  const options: string[] = []
  if (spec.brewCask) options.push(`\`brew install --cask ${spec.brewCask}\``)
  if (spec.brewFormula) options.push(`\`brew install ${spec.brewFormula}\``)
  if (spec.npmPackage) options.push(`\`npm i -g ${spec.npmPackage}\``)
  if (spec.pipPackage) options.push(`\`pip install ${spec.pipPackage}\``)
  if (spec.curlInstall) options.push(`\`${spec.curlInstall}\``)
  if (options.length) return `Install with ${options.join(' or ')}.`
  return spec.homepage ? `Install it from ${spec.homepage}.` : 'Not installed.'
}
