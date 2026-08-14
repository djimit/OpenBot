/**
 * The one containment predicate, in its own module so the path resolver and the
 * grant registry can both use it without importing each other.
 */

import { isAbsolute, relative } from 'node:path'

/** True when `child` is `parent` or lives underneath it. */
export function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}
