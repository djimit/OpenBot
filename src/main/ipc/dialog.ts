/**
 * IPC for `OpenBotApi.dialog`. Native pickers are the only way the renderer
 * can name a path on disk — it never gets to pass one in blind.
 */

import { BrowserWindow, dialog, type OpenDialogOptions } from 'electron'
import { CHANNELS } from './channels'
import { emptyArray, handle, nullResult } from './handler'

type OpenProperty = NonNullable<OpenDialogOptions['properties']>[number]

function parentWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
}

async function open(properties: OpenProperty[], title: string): Promise<string[]> {
  const parent = parentWindow()
  const options: OpenDialogOptions = { title, properties, buttonLabel: 'Select' }
  const result = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options)
  return result.canceled ? [] : result.filePaths
}

export function registerDialogIpc(): void {
  handle<string | null>(
    CHANNELS.dialogPickDirectory,
    async () => {
      const paths = await open(['openDirectory', 'createDirectory'], 'Choose a working directory')
      return paths[0] ?? null
    },
    nullResult
  )

  handle<string[]>(
    CHANNELS.dialogPickFiles,
    () => open(['openFile', 'multiSelections'], 'Attach files'),
    emptyArray
  )
}
