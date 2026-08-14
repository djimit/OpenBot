/**
 * Deny-by-default capability and device permissions.
 *
 * With no handler installed Electron grants every permission a page asks for,
 * and OpenBOT already ships the macOS camera and microphone usage strings — so
 * a renderer displaying attacker-influenced content could open the camera, the
 * microphone or a screen capture with no prompt whatsoever. Nothing in the app
 * needs any of that.
 */

import type { Session } from 'electron'

/**
 * The one capability the UI genuinely uses: the copy buttons in the transcript
 * call `navigator.clipboard.writeText`. A *sanitized write* cannot read the
 * clipboard back, so granting it discloses nothing.
 */
const ALLOWED: ReadonlySet<string> = new Set(['clipboard-sanitized-write'])

/** Sessions already hardened, so a second `session-created` never re-registers. */
const hardened = new WeakSet<Session>()

/** The whole policy, in one place so it can be asserted without an Electron run. */
export function isPermissionAllowed(permission: string): boolean {
  return ALLOWED.has(permission)
}

export function hardenSession(session: Session): void {
  if (hardened.has(session)) return
  hardened.add(session)

  session.setPermissionRequestHandler((_contents, permission, callback) => {
    const granted = isPermissionAllowed(permission)
    if (!granted) {
      console.warn('[openbot/security] denied permission request:', permission)
    }
    callback(granted)
  })

  // Chromium consults the *check* handler for capabilities a page queries
  // rather than requests. Leaving it unset lets `navigator.permissions.query`
  // report a capability as available that the request handler would refuse,
  // and some APIs skip the request path entirely once the check says yes.
  session.setPermissionCheckHandler((_contents, permission) => isPermissionAllowed(permission))

  // WebUSB / WebHID / Web Serial device pickers. Nothing here talks to
  // hardware, so no device is ever the right answer.
  session.setDevicePermissionHandler(() => false)
}
