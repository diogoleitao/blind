import { chmodSync, rmSync } from 'node:fs'
import { connect, createServer, type Server } from 'node:net'
import type { BlindSpot } from './blind-spot'
import { type AppMessage, receiveMessages, sendMessage } from './protocol'

// Whether a Blind Spot already listens on the socket.
function answers (socketPath: string) {
  return new Promise<boolean>((resolve) => {
    const socket = connect(socketPath)
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })
}

// Listens for the app on the socket, which only the user can open, replacing one a Blind Spot that's gone left behind.
// Answers undefined when another Blind Spot already listens there.
export async function serveBlindSpot (blindSpot: BlindSpot, socketPath: string): Promise<Server | undefined> {
  if (await answers(socketPath)) return undefined
  rmSync(socketPath, { force: true })
  const server = createServer((socket) => {
    const connection = blindSpot.connected({
      send: (message) => sendMessage(socket, message),
      close: () => socket.destroy(),
    })
    receiveMessages<AppMessage>(socket, (message) => connection.received(message))
    socket.on('close', () => connection.closed())
    // A broken connection closes, which is all there is to it.
    socket.on('error', () => {})
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, resolve)
  })
  chmodSync(socketPath, 0o600)
  return server
}
