import { bridge, errText } from './bridge'
import { store } from './core'

export async function pickFiles(): Promise<string[]> {
  try {
    return await bridge().dialog.pickFiles()
  } catch (e) {
    store.toast(errText(e), 'error')
    return []
  }
}

export async function pickDirectory(): Promise<string | null> {
  try {
    return await bridge().dialog.pickDirectory()
  } catch (e) {
    store.toast(errText(e), 'error')
    return null
  }
}
