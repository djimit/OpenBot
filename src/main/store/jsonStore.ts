/**
 * The JSON document primitives, at one address.
 *
 * Reading and writing share nothing but the file format, and both grew guards
 * worth reading on their own, so they live in `jsonRead` and `jsonWrite`.
 * Everything in the app imports them from here.
 */

export type { DirRead, JsonRead, JsonReadStatus } from './jsonRead'
export { readJson, readJsonDir, readJsonDirState, readJsonState } from './jsonRead'

export type { FlushReport } from './jsonWrite'
export {
  deleteJson,
  flushAll,
  reviveJson,
  writeJsonDebounced,
  writeJsonNow
} from './jsonWrite'
