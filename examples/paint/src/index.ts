import './style.css'

export function safeWebSocket(url: string, onConnect: (ws: WebSocket) => void = () => {}, timeout = 3000) {
  const connect = () => {
    const ws = new WebSocket(url)
    const close = () => setTimeout(connect, timeout)
    ws.addEventListener('close', close)
    onConnect(ws)
  }
  connect()
}

// Canvas and painting setup
const canvas = document.getElementById('canvas') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!
const colorPicker = document.getElementById('colorPicker') as HTMLInputElement
const connectionStatus = document.getElementById('connectionStatus') as HTMLSpanElement
const radiusSlider = document.getElementById('radiusSlider') as HTMLInputElement
const radiusValue = document.getElementById('radiusValue') as HTMLSpanElement

// Set up canvas for pixel-perfect drawing
ctx.imageSmoothingEnabled = false

let isDrawing = false
let ws: WebSocket | null = null

// Visual size of a painted mark (radius in pixels)
let markRadius = Number(radiusSlider?.value ?? 5)
if (radiusValue) radiusValue.textContent = String(markRadius)
radiusSlider?.addEventListener('input', () => {
  markRadius = Number(radiusSlider.value)
  if (radiusValue) radiusValue.textContent = String(markRadius)
})

// Get mouse position relative to canvas
function getMousePos(e: MouseEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect()
  return {
    x: Math.floor(e.clientX - rect.left),
    y: Math.floor(e.clientY - rect.top),
  }
}

// Draw a single pixel
function drawPixel(x: number, y: number, color: string, radius: number = markRadius) {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x + 0.5, y + 0.5, radius, 0, Math.PI * 2)
  ctx.fill()
}

// Send pixel data to server in compact format: x|y|r|color
function sendPixel(x: number, y: number, color: string, radius: number = markRadius) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    // Remove # from hex color for compactness
    const compactColor = color.startsWith('#') ? color.slice(1) : color
    ws.send(`${x}|${y}|${radius}|${compactColor}`)
  }
}

// Parse incoming pixel data and draw
function handleIncomingPixel(data: string) {
  const parts = data.split('|')
  if (parts.length !== 4) return
  const x = parseInt(parts[0])
  const y = parseInt(parts[1])
  const radius = Number(parts[2])
  const color = '#' + parts[3]

  if (!isNaN(x) && !isNaN(y) && x >= 0 && x < canvas.width && y >= 0 && y < canvas.height) {
    drawPixel(x, y, color, radius)
  }
}

// Mouse event handlers
canvas.addEventListener('mousedown', (e) => {
  isDrawing = true
  const pos = getMousePos(e)
  const color = colorPicker.value
  drawPixel(pos.x, pos.y, color, markRadius)
  sendPixel(pos.x, pos.y, color, markRadius)
})

canvas.addEventListener('mousemove', (e) => {
  if (isDrawing) {
    const pos = getMousePos(e)
    const color = colorPicker.value
    drawPixel(pos.x, pos.y, color, markRadius)
    sendPixel(pos.x, pos.y, color, markRadius)
  }
})

canvas.addEventListener('mouseup', () => {
  isDrawing = false
})

canvas.addEventListener('mouseleave', () => {
  isDrawing = false
})

// WebSocket connection
safeWebSocket('ws://localhost:4321/parties/relay/paint', (websocket) => {
  ws = websocket

  ws.addEventListener('open', () => {
    connectionStatus.textContent = 'Connected'
    connectionStatus.style.color = '#4CAF50'
  })

  ws.addEventListener('message', (e) => {
    handleIncomingPixel(e.data)
  })

  ws.addEventListener('close', () => {
    connectionStatus.textContent = 'Reconnecting...'
    connectionStatus.style.color = '#FF9800'
  })

  ws.addEventListener('error', () => {
    connectionStatus.textContent = 'Connection Error'
    connectionStatus.style.color = '#F44336'
  })
})
