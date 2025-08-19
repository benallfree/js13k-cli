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
const syncOverlay = document.getElementById('syncOverlay') as HTMLDivElement | null

// Set up canvas for pixel-perfect drawing
ctx.imageSmoothingEnabled = false

let isDrawing = false
let ws: WebSocket | null = null

// --- Sync state ---
const clientId = Array.from(crypto.getRandomValues(new Uint32Array(2)))
  .map((n) => n.toString(16).padStart(8, '0'))
  .join('')
let isSyncing = false
const queuedDeltas: string[] = []
const pendingSnapshotTimers = new Map<string, number>() // reqId -> timer id
let requestedReqId: string | null = null
let syncFallbackTimer: number | null = null
const LOCAL_STORAGE_KEY = 'paint:last-snapshot'
let saveThrottleTimer: number | null = null

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
    ws.send(`P|${x}|${y}|${radius}|${compactColor}`)
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
    scheduleSave()
  }
}

// Deterministic selection: compute a delay based on request id and our client id
function computeDeterministicDelay(reqId: string, responderClientId: string) {
  const a = simpleHash32(reqId)
  const b = simpleHash32(responderClientId)
  const score = (a ^ b) >>> 0
  const MIN = 30
  const WINDOW = 220
  return MIN + (score % WINDOW)
}

function simpleHash32(s: string) {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

// Wait until a condition is true or a timeout expires
function waitUntil(condition: () => boolean, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now()
    const check = () => {
      if (condition()) return resolve(true)
      if (Date.now() - start >= timeoutMs) return resolve(false)
      setTimeout(check, 20)
    }
    check()
  })
}

function scheduleSave() {
  if (saveThrottleTimer) return
  saveThrottleTimer = setTimeout(() => {
    saveThrottleTimer = null
    try {
      const dataUrl = canvas.toDataURL('image/webp', 0.8)
      localStorage.setItem(LOCAL_STORAGE_KEY, dataUrl)
    } catch {}
  }, 300) as unknown as number
}

function showSyncingOverlay() {
  if (syncOverlay) syncOverlay.style.display = 'flex'
}

function hideSyncingOverlay() {
  if (syncOverlay) syncOverlay.style.display = 'none'
}

function applySnapshot(dataUrl: string, onDone: () => void) {
  const img = new Image()
  img.onload = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0)
    scheduleSave()
    onDone()
  }
  img.src = dataUrl
}

function maybeRespondToSnapshot(reqId: string, requesterId: string) {
  if (requesterId === clientId) return

  // Register an intent to possibly respond so that if someone else
  // answers first, our intent gets canceled by the 'S' handler.
  if (!pendingSnapshotTimers.has(reqId)) pendingSnapshotTimers.set(reqId, -1 as unknown as number)

  const scheduleResponse = () => {
    if (!pendingSnapshotTimers.has(reqId)) return
    const delay = computeDeterministicDelay(reqId, clientId)
    const timer = setTimeout(() => {
      if (!pendingSnapshotTimers.has(reqId)) return
      const dataUrl = canvas.toDataURL('image/webp', 0.8)
      const parts = dataUrl.split(',', 2)
      const header = parts[0] || 'data:image/webp;base64'
      const b64 = parts[1] || ''
      ws?.send(`S|${reqId}|${clientId}|${header}|${b64}`)
    }, delay) as unknown as number
    pendingSnapshotTimers.set(reqId, timer)
  }

  // Only answer after we have a base image (isSyncing === false)
  // or after we have timed out waiting for one.
  if (!isSyncing) {
    scheduleResponse()
    return
  }

  // Wait up to ~400ms (same as our own sync fallback) before answering.
  waitUntil(() => !isSyncing, 450).then(() => {
    scheduleResponse()
  })
}

function handleMessage(message: string) {
  // New framed protocol: TYPE|...
  if (message.length >= 2 && message[1] === '|') {
    const type = message[0]
    const rest = message.slice(2)

    if (type === 'P') {
      if (isSyncing) {
        queuedDeltas.push(message)
        return
      }
      // rest is x|y|r|color
      handleIncomingPixel(rest)
      return
    }

    if (type === 'R') {
      const [reqId, requesterId] = rest.split('|', 3)
      if (reqId && requesterId) maybeRespondToSnapshot(reqId, requesterId)
      return
    }

    if (type === 'S') {
      const [reqId, fromId, header, b64] = rest.split('|', 4)
      // Cancel any local response timers for this reqId on ALL peers
      const t = pendingSnapshotTimers.get(reqId)
      if (t) {
        clearTimeout(t)
        pendingSnapshotTimers.delete(reqId)
      }
      // If we are the requester for this snapshot, apply it
      if (requestedReqId && reqId === requestedReqId) {
        // Stop solo-session fallback
        if (syncFallbackTimer !== null) {
          clearTimeout(syncFallbackTimer)
          syncFallbackTimer = null
        }
        applySnapshot(`${header},${b64}`, () => {
          isSyncing = false
          requestedReqId = null
          hideSyncingOverlay()
          // Replay queued deltas now that we have base image
          for (const queued of queuedDeltas) handleMessage(queued)
          queuedDeltas.length = 0
        })
      }
      return
    }

    if (type === 'H') {
      // Presence message – not used right now
      return
    }
  }

  // Back-compat: legacy paint messages without prefix
  if (isSyncing) {
    queuedDeltas.push(`P|${message}`)
    return
  }
  handleIncomingPixel(message)
}

// Mouse event handlers
canvas.addEventListener('mousedown', (e) => {
  isDrawing = true
  const pos = getMousePos(e)
  const color = colorPicker.value
  drawPixel(pos.x, pos.y, color, markRadius)
  sendPixel(pos.x, pos.y, color, markRadius)
  scheduleSave()
})

canvas.addEventListener('mousemove', (e) => {
  if (isDrawing) {
    const pos = getMousePos(e)
    const color = colorPicker.value
    drawPixel(pos.x, pos.y, color, markRadius)
    sendPixel(pos.x, pos.y, color, markRadius)
    scheduleSave()
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

    // Begin sync process: request snapshot and buffer deltas
    isSyncing = true
    showSyncingOverlay()
    requestedReqId = Array.from(crypto.getRandomValues(new Uint32Array(2)))
      .map((n) => n.toString(16).padStart(8, '0'))
      .join('')

    // Optional presence broadcast
    ws?.send(`H|${clientId}`)
    // Snapshot request: R|reqId|requesterId|w|h
    ws?.send(`R|${requestedReqId}|${clientId}|${canvas.width}|${canvas.height}`)

    // If we are alone in the room, stop syncing after a short delay
    syncFallbackTimer = setTimeout(() => {
      if (!isSyncing) return
      const stored = (() => {
        try {
          return localStorage.getItem(LOCAL_STORAGE_KEY)
        } catch {
          return null
        }
      })()
      if (stored) {
        applySnapshot(stored, () => {
          isSyncing = false
          requestedReqId = null
          hideSyncingOverlay()
          for (const queued of queuedDeltas) handleMessage(queued)
          queuedDeltas.length = 0
        })
      } else {
        isSyncing = false
        requestedReqId = null
        hideSyncingOverlay()
        // Replay any queued deltas (likely none if we were alone)
        for (const queued of queuedDeltas) handleMessage(queued)
        queuedDeltas.length = 0
      }
    }, 400) as unknown as number
  })

  ws.addEventListener('message', (e) => {
    handleMessage(e.data)
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
