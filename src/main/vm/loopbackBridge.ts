/**
 * The private tunnel between the host and one VM's guest daemon.
 *
 * The daemon listens on the VM's own interface, which changes address on every
 * boot; the bot's stored endpoint must not. A per-VM `127.0.0.1` listener owns
 * the stable port and re-points at the current private address after each
 * start, and holds every socket it opened so closing the bridge really does
 * tear the connection down.
 */

import { createServer, connect, type Server, type Socket } from 'node:net'
import type { VmTarget } from './types'

/** The fixed port the guest daemon is told to bind inside its VM. */
export const DAEMON_PORT = 8790

export interface LoopbackBridge {
  server: Server
  sockets: Set<Socket>
  port: number
  remoteIp?: string
}

const bridges = new Map<string, LoopbackBridge>()

export function bridgeFor(vmId: string): LoopbackBridge | undefined {
  return bridges.get(vmId)
}

export async function createLoopbackBridge(vmId: string, requestedPort = 0): Promise<LoopbackBridge> {
  closeBridge(vmId)
  const sockets = new Set<Socket>()
  const bridge: LoopbackBridge = { server: undefined as unknown as Server, sockets, port: requestedPort }
  const server = createServer((client) => {
    sockets.add(client)
    client.once('close', () => sockets.delete(client))
    if (!bridge.remoteIp) {
      client.destroy()
      return
    }
    const upstream = connect({ host: bridge.remoteIp, port: DAEMON_PORT })
    sockets.add(upstream)
    upstream.once('close', () => sockets.delete(upstream))
    client.once('error', () => upstream.destroy())
    upstream.once('error', () => client.destroy())
    client.pipe(upstream)
    upstream.pipe(client)
  })
  bridge.server = server
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const error = (cause: Error): void => rejectPromise(cause)
    server.once('error', error)
    server.listen(requestedPort, '127.0.0.1', () => {
      server.off('error', error)
      resolvePromise()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('Could not reserve a loopback endpoint for the managed VM.')
  }
  bridge.port = address.port
  bridges.set(vmId, bridge)
  return bridge
}

export function targetPort(target: VmTarget): number {
  let url: URL
  try {
    url = new URL(target.endpoint)
  } catch {
    throw new Error('The managed VM endpoint is malformed.')
  }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port) {
    throw new Error('A managed VM endpoint must be an explicit 127.0.0.1 HTTP port.')
  }
  const port = Number(url.port)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('The managed VM port is malformed.')
  return port
}

export function closeBridge(vmId: string): void {
  const bridge = bridges.get(vmId)
  if (!bridge) return
  bridges.delete(vmId)
  for (const socket of bridge.sockets) socket.destroy()
  bridge.server.close()
}
