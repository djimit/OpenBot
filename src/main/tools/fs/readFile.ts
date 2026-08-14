/**
 * `read_file` — read a text file, optionally a line range, with a byte cap and
 * binary detection.
 */

import { open, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import type { ToolSchema } from '../../../shared/types'
import { clamp, optBool, optNum, reqStr } from '../args'
import { ToolError } from '../errors'
import { displayPath, resolvePath, resolvedTargetPath } from '../paths'
import { defineTool } from '../results'
import { bytesOf, formatBytes, looksBinary, splitLines } from '../text'

const NAME = 'read_file'
const DEFAULT_MAX_BYTES = 256 * 1024
const HARD_MAX_BYTES = 4 * 1024 * 1024
const SNIFF_BYTES = 8192
/** PNGs are handed to the model as an image instead of being refused. */
const MAX_INLINE_PNG_BYTES = 3 * 1024 * 1024

export const schema: ToolSchema = {
  name: NAME,
  description:
    'Read a UTF-8 text file. Returns the whole file unless start_line/end_line narrow it. ' +
    'Output is capped (default 256 KB) and truncation is reported. Binary files are refused, ' +
    'except PNGs, which come back as an image. Paths are relative to the working directory.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File to read, relative to the working directory or absolute.' },
      start_line: { type: 'number', description: '1-based first line to return (inclusive).' },
      end_line: { type: 'number', description: '1-based last line to return (inclusive).' },
      max_bytes: { type: 'number', description: `Byte ceiling for the returned text. Default ${DEFAULT_MAX_BYTES}.` },
      line_numbers: { type: 'boolean', description: 'Prefix each line with its number. Default false.' }
    },
    required: ['path']
  },
  mutating: false
}

export const readFileTool = defineTool(schema, async (args, ctx) => {
  const input = reqStr(args, 'path', NAME)
  const absolute = await resolvePath(ctx, input, { tool: NAME, mode: 'read' })
  const shown = displayPath(ctx, absolute)
  /*
   * Read the physical path the containment check was answered about, not the
   * model-supplied one. `resolvePath` verifies the target after `realpath`, but
   * returns the lexical path — opening that followed the symlink a second time,
   * so the file that was approved and the file that was read were only ever the
   * same by luck. The mutation layer already commits to the resolved path for
   * exactly this reason; this makes the read side match.
   */
  const physical = await resolvedTargetPath(absolute)
  const startLine = optNum(args, 'start_line')
  const endLine = optNum(args, 'end_line')
  const withNumbers = optBool(args, 'line_numbers', false)
  const maxBytes = clamp(optNum(args, 'max_bytes') ?? DEFAULT_MAX_BYTES, 1024, HARD_MAX_BYTES)

  const info = await stat(physical)
  if (info.isDirectory()) {
    throw new ToolError(`${shown} is a directory, not a file.`, 'Use list_dir to see what is inside it.')
  }
  if (!info.isFile()) throw new ToolError(`${shown} is not a regular file.`)
  if (info.size === 0) {
    return {
      callId: ctx.callId ?? '',
      name: NAME,
      ok: true,
      output: `${shown} is empty (0 bytes).`,
      detail: { path: shown, absolute, bytes: 0, totalLines: 0, truncated: false }
    }
  }

  const handle = await open(physical, 'r')
  try {
    const sniff = Buffer.alloc(Math.min(SNIFF_BYTES, info.size))
    await handle.read(sniff, 0, sniff.length, 0)

    if (looksBinary(sniff)) {
      if (extname(absolute).toLowerCase() === '.png' && info.size <= MAX_INLINE_PNG_BYTES) {
        const png = await handle.readFile()
        return {
          callId: ctx.callId ?? '',
          name: NAME,
          ok: true,
          output: `${shown} is a PNG image (${formatBytes(info.size)}); it is attached as an image.`,
          screenshot: png.toString('base64'),
          detail: { path: shown, absolute, bytes: info.size, kind: 'image/png' }
        }
      }
      throw new ToolError(
        `${shown} looks like a binary file (${formatBytes(info.size)}), so it was not read as text.`,
        'Use the shell tool with `file`, `strings` or `xxd` if you need to inspect it.'
      )
    }

    // Read at most the cap, plus a little slack so truncation is detectable.
    const wantWholeFile = startLine === undefined && endLine === undefined
    const readLen = wantWholeFile ? Math.min(info.size, maxBytes) : Math.min(info.size, HARD_MAX_BYTES)
    const buf = Buffer.alloc(readLen)
    await handle.read(buf, 0, readLen, 0)
    let content = buf.toString('utf8')
    let truncated = readLen < info.size

    const allLines = splitLines(content)
    let firstLine = 1
    let lastLine = allLines.length

    if (!wantWholeFile) {
      firstLine = clamp(Math.floor(startLine ?? 1), 1, Math.max(1, allLines.length))
      lastLine = clamp(Math.floor(endLine ?? allLines.length), firstLine, allLines.length)
      if (firstLine > allLines.length) {
        throw new ToolError(
          `${shown} has ${allLines.length} lines; start_line ${firstLine} is past the end.`,
          'Read the file without a range first to see how long it is.'
        )
      }
      content = allLines.slice(firstLine - 1, lastLine).join('\n')
      if (bytesOf(content) > maxBytes) {
        content = Buffer.from(content, 'utf8').subarray(0, maxBytes).toString('utf8')
        truncated = true
      }
    }

    const body = withNumbers
      ? splitLines(content)
          .map((line, i) => `${String(firstLine + i).padStart(6)}\t${line}`)
          .join('\n')
      : content

    const header =
      wantWholeFile && !truncated
        ? ''
        : `[${shown}: lines ${firstLine}-${lastLine} of ${truncated ? '≥' : ''}${allLines.length}` +
          `${truncated ? `, output capped at ${formatBytes(maxBytes)} of ${formatBytes(info.size)}` : ''}]\n`

    return {
      callId: ctx.callId ?? '',
      name: NAME,
      ok: true,
      output: header + body,
      detail: {
        path: shown,
        absolute,
        bytes: info.size,
        firstLine,
        lastLine,
        totalLines: allLines.length,
        truncated
      }
    }
  } finally {
    await handle.close().catch(() => undefined)
  }
})
