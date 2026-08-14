import type { SearchResult } from '../../shared/types'
import { searchAll } from '../search'
import { CHANNELS } from './channels'
import { emptyArray, handle } from './handler'
import { asIndex, asString } from './validate'

export function registerSearchIpc(): void {
  handle<SearchResult[]>(CHANNELS.searchQuery, ([query, limit, archived]) => {
    // The limit is optional, but a limit that *is* sent is a number crossing
    // the bridge and gets the same guard as every other one — `searchAll`
    // clamps the range, this refuses the shape.
    const cap = limit === undefined || limit === null ? 50 : asIndex(limit)
    return searchAll(asString(query, 500), cap, archived === true)
  }, emptyArray)
}
