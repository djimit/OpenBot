/**
 * `visualize` — draw an inline chart in the transcript.
 *
 * The whole tool is a normalisation pass: arguments in, `VisualizationSpec` out,
 * carried on `ToolResult.detail` for the renderer to draw. Nothing is read,
 * written or executed, so it is non-mutating and never reaches the approval gate.
 *
 * `output` is the model's own view of what happened. It stays a plain sentence
 * rather than an echo of the spec: repeating the JSON back would burn context
 * describing a picture the model just described.
 */

import type { ToolResult } from '../../../shared/types'
import type { VisualizationDetail } from '../../../shared/visualization'
import { defineTool } from '../results'
import { describeVisualization, normaliseVisualization } from './normalise'
import { VISUALIZE_TOOL_NAME, visualizeSchema } from './schema'

export const visualizeTool = defineTool(visualizeSchema, async (args, ctx): Promise<ToolResult> => {
  const spec = normaliseVisualization(args)
  const detail: VisualizationDetail = { visualization: spec }

  // A spec whose payload array is empty still renders — as an empty frame with
  // its title — so say so plainly instead of failing the call.
  const empty =
    (spec.kind === 'flow' && !spec.nodes?.length) ||
    (spec.kind === 'bar' && !spec.bars?.length) ||
    (spec.kind === 'stats' && !spec.metrics?.length) ||
    (spec.kind === 'timeline' && !spec.events?.length)

  const output = empty
    ? `Drew an empty ${describeVisualization(spec)}. Send the "${dataKey(spec.kind)}" array to fill it in.`
    : `Drew a ${describeVisualization(spec)}. The user can see it; do not restate its contents.`

  return { callId: ctx.callId ?? '', name: VISUALIZE_TOOL_NAME, ok: true, output, detail }
})

/** Which argument the model forgot, named the way the schema names it. */
function dataKey(kind: VisualizationDetail['visualization']['kind']): string {
  switch (kind) {
    case 'bar':
      return 'bars'
    case 'stats':
      return 'metrics'
    case 'timeline':
      return 'events'
    default:
      return 'nodes'
  }
}

export { VISUALIZE_TOOL_NAME, visualizeSchema } from './schema'
export {
  LIMITS,
  describeVisualization,
  normaliseVisualization,
  parseVisualization
} from './normalise'
