/**
 * The paths a command line refers to.
 *
 * `read_file` asks before touching anything outside the workspace, but `shell`
 * classified `cat` as read-only and ran it unprompted — so `cat ~/.ssh/id_rsa`
 * walked straight through the containment the file tools enforce. Reading the
 * arguments closes that: a "safe" command that names somewhere outside the
 * workspace is still a read of somewhere outside the workspace.
 *
 * This is a filter, not a parser. It errs towards *reporting* a candidate and
 * letting the caller resolve it, because the caller knows the workspace root
 * and a path that turns out to be inside it costs nothing.
 */

import { splitSegments, tokenize } from './parse'

/** Redirection targets: `> out.txt`, `2>> log`, `< in.txt`. */
const REDIRECT = /(?:^|\s)\d*(?:>>?|<)\s*([^\s;&|]+)/g

/**
 * Character devices every build writes to, which are not "reaching outside the
 * workspace" in any sense the user cares about.
 *
 * `npm test > /dev/null` was raising a forced approval card that no policy and
 * no allowlist could silence — the fastest possible route to someone switching
 * the whole gate off, which costs far more than these paths could.
 */
const DEV_NULL = /^\/dev\/(null|stdout|stderr|tty|fd\/\d+)$/

/**
 * Candidate paths named anywhere in the command.
 *
 * Every argument is a candidate, not just the ones that *look* absolute. A
 * first cut only reported `/…`, `~…` and `../…`, which missed the case the file
 * tools already defend against: a plain relative name that is a symlink out of
 * the workspace. Deciding that needs `realpath`, which is the caller's job — so
 * this reports the names and lets containment resolve them.
 *
 * Filtered out are only bare flags and the character devices every build
 * redirects to. Notably NOT filtered: a token containing spaces. Dropping those
 * as "quoted prose" made `cat "/Library/Application Support/x"` invisible to
 * containment — and on macOS a path with a space in it is exactly where the
 * interesting files live. Prose resolves inside the workspace anyway, so
 * containment discards it a step later.
 */
export function pathArguments(command: string): string[] {
  const out = new Set<string>()

  for (const segment of splitSegments(command)) {
    for (const token of tokenize(segment)) {
      const value = token.startsWith('-') ? afterEquals(token) : withoutRedirect(token)
      if (value) out.add(value)
    }
  }

  for (const match of command.matchAll(REDIRECT)) {
    if (match[1]) out.add(match[1])
  }

  return [...out].filter((value) => !DEV_NULL.test(value))
}

/** The value of `--flag=value`, or `''` for a bare flag. */
function afterEquals(token: string): string {
  const at = token.indexOf('=')
  return at === -1 ? '' : token.slice(at + 1)
}

/**
 * A token with any redirection operator peeled off, or `''` when nothing but an
 * operator is left.
 *
 * `tokenize` splits on whitespace only, so `2>/dev/null` arrives whole and a
 * bare `>` arrives as its own token. Both were being offered to containment as
 * paths — which is how `npm test > /dev/null` came to raise a forced card.
 */
function withoutRedirect(token: string): string {
  const rest = token.replace(/^(?:\d*>>?|<)/, '')
  // `2>&1` and `>&2` duplicate a file descriptor; they name no file.
  return /^&\d*$/.test(rest) ? '' : rest
}
