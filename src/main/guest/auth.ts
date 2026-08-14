/**
 * The daemon's whole credential check.
 *
 * Both the VM id and the bearer token are compared in constant time against
 * values the guest can only verify, never mint: the token is held as
 * SHA-256(token), so reading the guest's environment or `/proc` yields nothing
 * that authenticates back to the daemon.
 */

import { createHash, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { requiredEnv, VM_ID } from './config'

const TOKEN_HASH = tokenVerifier()

export function authorised(req: IncomingMessage): boolean {
  const id = header(req, 'x-openbot-vm-id')
  const auth = header(req, 'authorization')
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  return secretEqual(id, VM_ID) && secretEqual(createHash('sha256').update(token).digest('hex'), TOKEN_HASH)
}

function header(req: IncomingMessage, name: string): string {
  const value = req.headers[name]
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '')
}

function secretEqual(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

function tokenVerifier(): string {
  const verifier = process.env['OPENBOT_VM_TOKEN_SHA256']?.trim().toLowerCase()
  if (verifier) {
    if (!/^[a-f0-9]{64}$/.test(verifier)) throw new Error('OPENBOT_VM_TOKEN_SHA256 must be a SHA-256 hex digest.')
    return verifier
  }
  // External supervisors may still pass the raw token. The daemon immediately
  // reduces it to a verifier; the managed VM never receives this form.
  return createHash('sha256').update(requiredEnv('OPENBOT_VM_TOKEN')).digest('hex')
}
