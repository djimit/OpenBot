/** Web tools: fetch, web_search. */

import type { Tool } from '../types'
import { fetchTool } from './fetchTool'
import { webSearchTool } from './searchTool'

export { fetchTool, webSearchTool }

export const webTools: Tool[] = [fetchTool, webSearchTool]
