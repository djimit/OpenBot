/**
 * The hard denylist: command shapes that are refused outright, never prompted.
 *
 * This is the one place in the shell tool where the answer is "no" rather than
 * "ask". Everything here is a shape whose only plausible outcome is destroying
 * the user's machine or data, so a false negative matters far more than a false
 * positive — but a false positive that blocks ordinary work (a build clean, a
 * scratch directory) pushes people to turn the whole thing off, so the rules
 * are anchored to what they actually claim to cover.
 */

import { headBinary, splitSegments, tokenize, unquote } from './parse'

/**
 * Delete targets that are never worth prompting over, as an alternation.
 *
 * Depth is the whole point. A home directory is irreplaceable; a workspace
 * *inside* it is ordinary, and workspaces normally live under home — so
 * `~`, `$HOME` and `/Users/<name>` are refused while anything below them is
 * left to the risk classifier to prompt for. System trees are refused at any
 * depth, since `/usr/local` and `/etc/nginx` are as unrecoverable as their
 * roots. Every branch is anchored by the caller's end-of-argument lookahead,
 * without which a bare `\/` matches the first slash of *any* absolute path and
 * `rm -rf /tmp/build` is hard-blocked.
 */
const IRREPLACEABLE = [
  String.raw`\/+`, // the filesystem root
  String.raw`\/\*`, // everything directly under it
  String.raw`~\/?\*?`, // the home directory itself
  String.raw`\$HOME\/?\*?`,
  String.raw`\$\{HOME\}\/?\*?`, // the braced spelling reaches the same directory
  String.raw`\/Users\/?\*?`, // every home directory on the machine
  String.raw`\/Users\/[^\s\/]+\/?\*?`, // one entire home directory
  String.raw`\/(?:System|Library|Applications|Volumes|etc|usr|sbin|bin|var|private)(?:\/[^\s]*)?`
].join('|')

/*
 * What may terminate the target argument.
 *
 * This was `(?=\s|$)`, which reads "followed by whitespace or the end of the
 * line" — true of `rm -rf ~` but not of `echo $(rm -rf ~)`, where the target is
 * followed by the closing parenthesis of the substitution. The rule therefore
 * missed the very form that hides a delete from the risk classifier.
 *
 * A quote deliberately does *not* close an argument here. Quoting is already
 * handled by `scanForms`, which unquotes the command for interpreter segments
 * and drops whole quoted arguments otherwise — and treating `"` as a terminator
 * made `echo "rm -rf /" >> notes.txt` and `grep -rn "rm -rf /" docs` read as
 * deletes, refusing outright two commands that only mention one.
 *
 * Every rule is also case-insensitive: the macOS filesystem is, so `/USERS/example`
 * and `/ETC` reach exactly what their lowercase spellings reach, and a
 * case-sensitive rule refused one and waved the other through.
 */
const ENDS_ARGUMENT = String.raw`(?=[\s)\`;&|]|$)`

const DENY_RULES: Array<{ rx: RegExp; why: string }> = [
  {
    // A recursive force-delete of one of the targets above.
    rx: new RegExp(
      String.raw`\brm\b(?=[^\n;&|]*\s-[^\s]*[rR])(?=[^\n;&|]*\s-[^\s]*f)[^\n;&|]*\s(?:-[^\s]+\s+)*(?:${IRREPLACEABLE})${ENDS_ARGUMENT}`,
      'i'
    ),
    why: 'a recursive force-delete of a root, home or system directory'
  },
  { rx: /:\s*\(\s*\)\s*\{[^}]*\|[^}]*&[^}]*\}\s*;?\s*:/, why: 'a fork bomb' },
  { rx: /\bdd\b[^\n;&|]*\bof=\/dev\//i, why: 'a raw write to a block device' },
  { rx: /(^|[\s;&|])>\s*\/dev\/(disk|rdisk|sd[a-z])/i, why: 'a redirect onto a raw disk device' },
  { rx: /\b(mkfs(\.\w+)?|newfs(_\w+)?)\b/i, why: 'a filesystem format' },
  {
    rx: /\bdiskutil\b[^\n;&|]*\b(eraseDisk|eraseVolume|partitionDisk|reformat|secureErase)\b/i,
    why: 'a destructive diskutil operation'
  },
  { rx: /\bfind\s+\/\s[^\n;&|]*-delete\b/i, why: 'a delete sweep starting at the filesystem root' },
  {
    rx: new RegExp(String.raw`\bch(mod|own)\b[^\n;&|]*\s-[^\s]*R[^\n;&|]*\s\/${ENDS_ARGUMENT}`, 'i'),
    why: 'a recursive permission change on the filesystem root'
  }
]

/** Commands that take an argument and run it as shell input. */
const INTERPRETERS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'eval', 'source', '.', 'ssh', 'su'])

/**
 * The forms every rule is tested against.
 *
 * The raw text alone is not enough: the shell strips quotes before acting, so
 * `rm -rf "/"` and `rm -rf /` do the same thing and matching only the raw text
 * left the whole denylist one character from being bypassed. But unquoting the
 * *whole line* has the opposite failure — it turns a quoted argument into
 * apparent command text, so `echo "rm -rf /" >> notes.txt` was refused as
 * though it were running the delete rather than writing it to a file.
 *
 * So quoted arguments are dropped rather than flattened: a single argument
 * cannot be a multi-word command. The exception is a segment that hands its
 * arguments to an interpreter, where `bash -c "rm -rf /"` really does run
 * them — there the flattened form is what the shell will see.
 *
 * Segments are rejoined with newlines because the rules use `[^\n;&|]` to stay
 * inside one command, and tokenising has already removed the separators.
 */
function scanForms(command: string): string[] {
  const tokenised = splitSegments(command).map(tokenize)
  const interpreted = tokenised.some((tokens) => INTERPRETERS.has(headBinary(tokens)?.binary ?? ''))
  const derived = interpreted
    ? unquote(command)
    : tokenised
        // Each surviving token is still unquoted, so a backslash-escaped `rm -rf \/`
        // reads the same as the plain form; only whole *arguments* are dropped.
        .map((tokens) => tokens.map(unquote).filter((t) => !/\s/.test(t)).join(' '))
        .join('\n')
  return derived === command ? [command] : [command, derived]
}

/**
 * Why this command is refused, or `undefined` to let it through to the risk
 * classifier.
 */
export function firstDenyReason(command: string, userDenylist: string[]): string | undefined {
  const forms = scanForms(command)

  for (const rule of DENY_RULES) {
    if (forms.some((form) => rule.rx.test(form))) return rule.why
  }
  for (const raw of userDenylist) {
    const pattern = raw.trim()
    if (!pattern) continue
    let hit = false
    try {
      const rx = new RegExp(pattern, 'i')
      hit = forms.some((form) => rx.test(form))
    } catch {
      // Not a valid regex — treat the entry as a literal substring.
      const needle = pattern.toLowerCase()
      hit = forms.some((form) => form.toLowerCase().includes(needle))
    }
    if (hit) return `the user's denylist entry "${pattern}"`
  }
  return undefined
}
