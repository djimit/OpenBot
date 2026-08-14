/**
 * Validation for the attachments that ride along with a chat message.
 *
 * These are the one IPC payload whose fields end up inside the model's
 * context: `path` is shown to the bot verbatim, and `data` is forwarded as
 * inline content. Unchecked, that made the channel a way to put an arbitrary
 * string — or an arbitrary number of megabytes — in front of the model under
 * the renderer's name, so every field is bounded and shaped here.
 *
 * Malformed entries are dropped rather than thrown on: one bad attachment must
 * not swallow the message the user actually typed.
 */

import type { Attachment } from '../../shared/types'
import { asAbsolutePath } from './validate'

const KINDS: ReadonlyArray<Attachment['kind']> = ['file', 'image', 'selection']

/** Comfortably a screenshot or a pasted image; nowhere near a file dump. */
const MAX_DATA_LENGTH = 8 * 1024 * 1024
const MAX_NAME_LENGTH = 255
const MAX_MIME_LENGTH = 255

/** RFC 6838 type/subtype, no parameters. Anything else is not a media type. */
const MIME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,62}\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,62}$/

function stringField(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key]
  return typeof value === 'string' ? value : undefined
}

/**
 * An absolute path, or `null` to reject the whole attachment.
 *
 * A `file` attachment whose path is unusable is not a partial attachment, it
 * is a fabricated one — dropping only the field would still hand the model an
 * entry claiming to be a file the user attached.
 */
function pathField(source: Record<string, unknown>): string | undefined | null {
  const raw = stringField(source, 'path')
  if (raw === undefined) return undefined
  try {
    return asAbsolutePath(raw)
  } catch {
    return null
  }
}

function one(raw: unknown): Attachment | null {
  if (typeof raw !== 'object' || raw === null) return null
  const source = raw as Record<string, unknown>
  const kind = source['kind']
  if (!(KINDS as ReadonlyArray<unknown>).includes(kind)) return null

  const path = pathField(source)
  if (path === null) return null

  const id = stringField(source, 'id')
  const name = stringField(source, 'name')
  const attachment: Attachment = {
    id: id ? id.slice(0, MAX_NAME_LENGTH) : randomId(),
    kind: kind as Attachment['kind'],
    name: name ? name.slice(0, MAX_NAME_LENGTH) : 'attachment'
  }

  if (path !== undefined) attachment.path = path

  const mime = stringField(source, 'mime')
  if (mime && mime.length <= MAX_MIME_LENGTH && MIME_PATTERN.test(mime)) {
    attachment.mime = mime
  }

  const data = stringField(source, 'data')
  if (data !== undefined) attachment.data = data.slice(0, MAX_DATA_LENGTH)

  return attachment
}

/** Drop anything malformed rather than failing the whole send. */
export function asAttachments(value: unknown): Attachment[] {
  if (!Array.isArray(value)) return []
  const out: Attachment[] = []
  for (const raw of value) {
    const attachment = one(raw)
    if (attachment) out.push(attachment)
  }
  return out
}

function randomId(): string {
  return `att_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}
