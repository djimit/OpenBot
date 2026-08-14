import type { CollaborationRoom } from '../../shared/types'
import { collaborationOrigin, ensureCollaborationServer, stopCollaborationServer } from '../collaboration/server'
import { getSession } from '../store/sessions'
import { removeRoom, shareRoom, sharedRooms, storedRooms, type StoredRoom } from '../store/rooms'
import { CHANNELS } from './channels'
import { emptyArray, handle, handleVoid, nullResult } from './handler'
import { asId, asString } from './validate'

/** The room as the renderer may see it: everything except the token, which stays in main. */
function publicRoom(room: StoredRoom, origin: string): CollaborationRoom {
  const { token, ...visible } = room
  return { ...visible, inviteUrl: room.enabled && origin ? `${origin}/room/${token}` : '' }
}

/*
 * Listing rooms must never start the listener.
 *
 * `roomsList` runs on every renderer boot, so calling `ensureCollaborationServer`
 * from here meant that creating a single room, once, bound an HTTP server on
 * 0.0.0.0 at every launch from then on — no prompt, nothing on screen, and no
 * way to stop it short of quitting. Listing now only reports what is already
 * being served, so rooms come back without an invite URL until the user shares
 * one deliberately.
 */
function publicRooms(): CollaborationRoom[] {
  const origin = collaborationOrigin()
  return storedRooms().map((room) => publicRoom(room, origin))
}

export function registerRoomIpc(): void {
  handle<CollaborationRoom[]>(CHANNELS.roomsList, () => publicRooms(), emptyArray)
  /*
   * The only channel that may start the server: it is the user pressing share,
   * either on a chat with no room yet or on one whose room is currently off.
   */
  handle<CollaborationRoom | null>(CHANNELS.roomsCreate, async ([sessionId, name]) => {
    const session = getSession(asId(sessionId))
    if (!session) return null
    const room = shareRoom(session.id, name === undefined ? session.title : asString(name, 200))
    return publicRoom(room, await ensureCollaborationServer())
  }, nullResult)
  /*
   * Deleting the last shared room takes the listener down with it. Without this
   * the port stayed open until quit, long after the panel said nothing was
   * shared and every invite URL had stopped resolving to a room.
   */
  handleVoid(CHANNELS.roomsRemove, async ([id]) => {
    removeRoom(asId(id))
    if (sharedRooms().length === 0) await stopCollaborationServer()
  })
}
