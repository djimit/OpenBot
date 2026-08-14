/** Filesystem tools: read_file, write_file, edit_file, list_dir, glob, grep. */

import type { Tool } from '../types'
import { editFileTool } from './editFile'
import { globTool } from './globTool'
import { grepTool } from './grepTool'
import { listDirTool } from './listDir'
import { readFileTool } from './readFile'
import { writeFileTool } from './writeFile'

export { editFileTool, globTool, grepTool, listDirTool, readFileTool, writeFileTool }

export const fsTools: Tool[] = [
  readFileTool,
  writeFileTool,
  editFileTool,
  listDirTool,
  globTool,
  grepTool
]
