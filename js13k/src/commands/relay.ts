import express from 'express'
import { createServer as createHttpServer } from 'http'
import WebSocket, { WebSocketServer } from 'ws'

export async function runRelay(): Promise<void> {
  const app = express()
  const server = createHttpServer(app)
  const rooms = new Map<string, Set<WebSocket>>()
  const port = Number(process.env.PORT) || 4321

  const wss = new WebSocketServer({ noServer: true })

  wss.on('connection', (ws: WebSocket, request: any, room: string) => {
    let listeners = rooms.get(room)
    if (!listeners) {
      listeners = new Set()
      console.log('new room', room)
      rooms.set(room, listeners)
    }
    console.log('add connection to room', room)
    listeners.add(ws)

    ws.on('message', (data: any) => {
      console.log('rx', data.toString())
      const current = rooms.get(room)
      if (!current) return
      for (const client of current) {
        if (client !== ws) {
          try {
            client.send(data, { binary: false })
          } catch {}
        }
      }
    })

    ws.on('close', () => {
      const current = rooms.get(room)
      if (!current) return
      console.log('remove connection from room', room)
      current.delete(ws)
      if (current.size === 0) rooms.delete(room)
    })
  })

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '/', 'http://localhost')
    const match = url.pathname.match(/^\/parties\/relay\/(.+)$/)
    if (!match) return (socket as any).destroy()
    const room = decodeURIComponent(match[1]!)
    wss.handleUpgrade(request as any, socket as any, head as any, (ws) => {
      wss.emit('connection', ws, request as any, room)
    })
  })

  server.listen(port, () => {
    console.log(`Relay listening on ws://localhost:${port}/parties/relay/<room>`)
  })
}
