(() => {
  if (location.pathname.startsWith('/pulse') || location.pathname.startsWith('/meme/') || location.pathname.startsWith('/token/')) {
    try {
      Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: () => false })
      Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get: () => 'visible' })
      for (const type of ['visibilitychange', 'webkitvisibilitychange']) {
        document.addEventListener(type, event => event.stopImmediatePropagation(), true)
        window.addEventListener(type, event => event.stopImmediatePropagation(), true)
      }
    } catch { }
  }

  const pulseTables = { newPairs: new Map(), finalStretch: new Map(), migrated: new Map() }
  const pulseFields = ['pairAddress', 'tokenAddress', 'tokenName', 'tokenTicker', 'createdAt', 'marketCap', 'volume', 'liquidityNative', 'numHolders', 'userCount', 'numTxns', 'numBuys', 'numSells', 'buyVolume', 'totalFees', 'bondingCurvePercent', 'top10HoldersPercent', 'devHoldsPercent', 'devSold', 'snipersHoldPercent', 'insidersHoldPercent', 'bundlersHoldPercent', 'freshWalletsHoldPercent', 'proTradersHoldPercent', 'devMigrationCount', 'devCreationCount', 'kolCount', 'dexPaid', 'twitter', 'telegram', 'website']
  let usdPerSol = null
  let pulseChangedAt = 0
  const keepFields = item => {
    const row = {}
    for (const key of pulseFields) if (item[key] !== undefined) row[key] = item[key]
    return row
  }
  const applyPulseOperations = message => {
    const table = pulseTables[message.table]
    if (!table || !Array.isArray(message.operations)) return
    for (const op of message.operations) {
      if (!op || typeof op !== 'object') continue
      if (Array.isArray(op.items)) {
        table.clear()
        for (const item of op.items) if (item?.pairAddress) table.set(item.pairAddress, keepFields(item))
      } else if (op.item?.pairAddress) table.set(op.item.pairAddress, keepFields(op.item))
      else if (op.type === 'remove' && op.pairAddress) table.delete(op.pairAddress)
      else if (op.pairAddress && op.set && table.has(op.pairAddress)) Object.assign(table.get(op.pairAddress), keepFields(op.set))
    }
    pulseChangedAt = Date.now()
  }
  const watchPulseWorker = worker => {
    worker.addEventListener('message', event => {
      const data = event.data
      if (data?.type !== 'OUTPUT_BATCH' || !Array.isArray(data.messages)) return
      for (const message of data.messages) if (message?.type === 'TABLE_OPERATIONS') applyPulseOperations(message)
    })
  }
  const NativeWorker = window.Worker
  if (NativeWorker && !NativeWorker.axiomRadarWrapped) {
    const nativePost = NativeWorker.prototype.postMessage
    NativeWorker.prototype.postMessage = function (message, ...rest) {
      if (message?.type === 'UPDATE_USD_PER_NATIVE' && message.payload?.chain === 'sol' && Number(message.payload.usdPerNative) > 0) usdPerSol = Number(message.payload.usdPerNative)
      return nativePost.call(this, message, ...rest)
    }
    function RadarWorker(url, ...rest) {
      const worker = new NativeWorker(url, ...rest)
      if (/PulseWorker/i.test(String(url))) watchPulseWorker(worker)
      return worker
    }
    RadarWorker.prototype = NativeWorker.prototype
    RadarWorker.axiomRadarWrapped = true
    window.Worker = RadarWorker
  }
  setInterval(() => {
    if (!usdPerSol || Date.now() - pulseChangedAt > 30000) return
    const rows = []
    for (const [column, table] of Object.entries(pulseTables)) for (const row of table.values()) if (row.tokenAddress) rows.push({ ...row, column })
    window.postMessage({ source: 'axiom-radar-bridge-pulse', usdPerSol, rows: rows.slice(0, 300), at: Date.now() }, window.location.origin)
  }, 1000)
  const Native = window.WebSocket
  if (!Native || Native.axiomRadarWrapped) return
  const interesting = /viewer|watch|online|concurrent/i
  const decoder = new TextDecoder()
  const recent = []
  const remember = (url, kind, text) => {
    recent.push({ at: Date.now(), url: String(url).slice(0, 200), kind, text: text.slice(0, 4000) })
    if (recent.length > 120) recent.shift()
  }
  const forward = text => {
    if (text.length <= 60000 && interesting.test(text)) window.postMessage({ source: 'axiom-radar-bridge', frame: text }, window.location.origin)
  }
  const handle = (url, data) => {
    if (typeof data === 'string') {
      remember(url, 'text', data)
      forward(data)
      return
    }
    if (data instanceof ArrayBuffer) {
      const bytes = new Uint8Array(data)
      const hex = Array.from(bytes.slice(0, 64), byte => byte.toString(16).padStart(2, '0')).join('')
      remember(url, 'binary', `len=${bytes.length} hex=${hex} utf8=${decoder.decode(bytes.slice(0, 3000))}`)
      if (bytes.length <= 60000) forward(decoder.decode(bytes))
      return
    }
    if (data instanceof Blob) data.arrayBuffer().then(buffer => handle(url, buffer)).catch(() => undefined)
  }
  function RadarWebSocket(...args) {
    const socket = new Native(...args)
    socket.addEventListener('message', event => handle(socket.url, event.data))
    return socket
  }
  RadarWebSocket.prototype = Native.prototype
  for (const key of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) RadarWebSocket[key] = Native[key]
  RadarWebSocket.axiomRadarWrapped = true
  window.WebSocket = RadarWebSocket
  window.addEventListener('message', event => {
    if (event.source !== window || event.data?.source !== 'axiom-radar-bridge-request') return
    window.postMessage({ source: 'axiom-radar-bridge-sample', frames: recent.slice() }, window.location.origin)
  })
})()
