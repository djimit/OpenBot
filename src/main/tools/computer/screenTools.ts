/**
 * `screenshot` — look at the screen the bot is driving.
 */

import type { ToolSchema } from '../../../shared/types'
import { defineTool } from '../results'
import { frameResult, withComputerApproval } from './gate'

const NAME = 'screenshot'

export const schema: ToolSchema = {
  name: NAME,
  description:
    'Capture what is currently on screen and return it as an image. Always take a screenshot before ' +
    'clicking, typing or scrolling, and again afterwards to confirm the result. All coordinates you give ' +
    'to the other computer tools are in the pixel space of the most recent screenshot, origin top-left.',
  parameters: { type: 'object', properties: {} },
  mutating: false,
  computerUse: true
}

export const screenshotTool = defineTool(schema, async (_args, ctx) => {
  const outcome = await withComputerApproval(
    ctx,
    {
      toolName: NAME,
      summary: 'Take a screenshot',
      detail: 'Capture the current screen and show it to the model.',
      reusePreviewAsResult: true
    },
    async () => undefined
  )
  return frameResult(ctx, NAME, 'Captured the screen.', outcome)
})
