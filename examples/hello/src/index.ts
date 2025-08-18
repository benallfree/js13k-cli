export function safeWebSocket(url: string, onConnect: (ws: WebSocket) => void = () => {}, timeout = 3000) {
  const connect = () => {
    const ws = new WebSocket(url)
    const close = () => setTimeout(connect, timeout)
    ws.addEventListener('close', close)
    onConnect(ws)
  }
  connect()
}

safeWebSocket('ws://localhost:4321/parties/relay/hello', (ws) => {
  ws.addEventListener('open', () => {
    ws.send('hello!')
  })

  ws.addEventListener('message', (e) => {
    console.log(`${e.data}`)
  })
})
