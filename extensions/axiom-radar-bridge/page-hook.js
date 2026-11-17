(() => {
  if (location.pathname.startsWith('/pulse') || location.pathname.startsWith('/discover') || location.pathname.startsWith('/meme/') || location.pathname.startsWith('/token/')) {
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
    for (const key of pulseFields) {
      const value = item[key]
      if (value === undefined) continue
      row[key] = value instanceof Date ? value.getTime() : value
    }
    for (const [key, value] of Object.entries(item)) {
      if (key in row) continue
      if (value instanceof Date) row[key] = value.getTime()
      else if (value === null || typeof value === 'number' || typeof value === 'boolean') row[key] = value
      else if (typeof value === 'string' && value.length <= 200) row[key] = value
      else if (value && typeof value === 'object') {
        try { const json = JSON.stringify(value); if (json.length <= 1500) row[key] = value } catch { }
      }
    }
    return row
  }
  const onDiscover = () => location.pathname.startsWith('/discover')
  const address = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
  const listFields = ['tokenAddress', 'pairAddress', 'tokenTicker', 'tokenName', 'userCount']
  const listSources = new Map()
  const isCoinRow = item => Boolean(item) && typeof item === 'object' && typeof item.pairAddress === 'string' && address.test(item.pairAddress) && typeof item.tokenAddress === 'string' && address.test(item.tokenAddress)
  const listRow = item => {
    const row = {}
    for (const key of listFields) {
      const value = item[key]
      if (typeof value === 'string' ? value.length <= 120 : typeof value === 'number' && Number.isFinite(value)) row[key] = value
    }
    return row
  }
  const sourceFor = (kind, name) => {
    const key = `${kind}:${name}`
    let source = listSources.get(key)
    if (!source) {
      if (listSources.size >= 24) {
        const oldest = [...listSources.entries()].sort((first, second) => first[1].at - second[1].at)[0]
        if (oldest) listSources.delete(oldest[0])
      }
      source = { kind, name: String(name).slice(0, 160), rows: new Map(), at: 0 }
      listSources.set(key, source)
    }
    return source
  }
  const coinRowsIn = value => {
    const arrays = Array.isArray(value) ? [value] : value && typeof value === 'object' ? Object.values(value).filter(Array.isArray) : []
    if (value && typeof value === 'object' && !Array.isArray(value)) for (const inner of Object.values(value)) if (inner && typeof inner === 'object' && !Array.isArray(inner)) arrays.push(...Object.values(inner).filter(Array.isArray))
    return arrays.find(list => list.length >= 3 && list.slice(0, 5).every(isCoinRow)) ?? null
  }
  const noteCoinList = (kind, name, body) => {
    if (typeof body !== 'string' || body.length > 3000000 || !body.includes('"pairAddress"') || !body.includes('"tokenAddress"')) return
    let parsed
    try { parsed = JSON.parse(body) } catch { return }
    const rows = coinRowsIn(parsed)
    if (!rows) return
    const source = sourceFor(kind, name)
    source.rows = new Map(rows.filter(isCoinRow).slice(0, 300).map(item => [item.pairAddress, listRow(item)]))
    source.at = Date.now()
  }
  const applyListOperations = message => {
    if (typeof message.table !== 'string' || !Array.isArray(message.operations)) return
    let source = listSources.get(`table:${message.table}`) ?? null
    for (const op of message.operations) {
      if (!op || typeof op !== 'object') continue
      if (Array.isArray(op.items)) {
        if (!op.items.some(isCoinRow)) continue
        source = source ?? sourceFor('table', message.table)
        source.rows = new Map(op.items.filter(isCoinRow).slice(0, 400).map(item => [item.pairAddress, listRow(item)]))
      } else if (isCoinRow(op.item)) {
        source = source ?? sourceFor('table', message.table)
        if (source.rows.size < 400 || source.rows.has(op.item.pairAddress)) source.rows.set(op.item.pairAddress, listRow(op.item))
      } else if (source && op.type === 'remove' && op.pairAddress) source.rows.delete(op.pairAddress)
      else if (source && op.pairAddress && op.set && source.rows.has(op.pairAddress)) Object.assign(source.rows.get(op.pairAddress), listRow(op.set))
    }
    if (source) source.at = Date.now()
  }
  const applyPulseOperations = message => {
    const table = Object.hasOwn(pulseTables, message.table) ? pulseTables[message.table] : null
    if (!table) return applyListOperations(message)
    if (!Array.isArray(message.operations)) return
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
  const digest = new Map()
  const describe = (value, depth = 0) => {
    if (Array.isArray(value)) {
      if (!value.length || depth >= 6) return `array(${value.length})`
      if (depth > 0 && value.length <= 90 && value.every(item => item === null || typeof item !== 'object')) return `[${value.map(item => describe(item, depth + 1)).join(', ')}]`
      return `array(${value.length}) of ${describe(value[0], depth + 1)}`
    }
    if (value && typeof value === 'object') {
      const keys = Object.keys(value)
      const named = key => address.test(key) ? '<address>' : key.slice(0, 40)
      let last = null
      return `{${keys.slice(0, 80).map(key => {
        if (depth >= 5 || !value[key] || typeof value[key] !== 'object') return named(key)
        const inner = describe(value[key], depth + 1)
        const same = inner === last && inner.length > 12
        last = inner
        return `${named(key)}: ${same ? '(same)' : inner}`
      }).join(', ')}${keys.length > 80 ? ', ...' : ''}}`
    }
    if (typeof value === 'string') return address.test(value) ? 'address' : `string(${value.length > 40 ? '40+' : value.length})`
    return value === null ? 'null' : typeof value
  }
  /** Notes the layout (field names and types, never values) of one kind of data a Discover page receives, the first time it is seen. */
  const noteShape = (kind, name, read) => {
    if (!onDiscover()) return
    const key = `${kind}:${String(name).slice(0, 160)}`
    const entry = digest.get(key)
    if (entry) { entry.count += 1; return }
    if (digest.size >= 70) return
    let shape = 'unreadable'
    try { shape = describe(read()).slice(0, 4000) } catch { }
    digest.set(key, { shape, count: 1 })
  }
  const scriptName = url => String(url).split(/[?#]/)[0].split('/').pop().slice(0, 80)
  const watchPulseWorker = (worker, url) => {
    const name = scriptName(url)
    noteShape('worker', `${name} started`, () => ({}))
    worker.addEventListener('message', event => {
      const data = event.data
      if (data?.type !== 'OUTPUT_BATCH' || !Array.isArray(data.messages)) {
        noteShape('worker', `${name} ${typeof data?.type === 'string' ? data.type.slice(0, 60) : typeof data}`, () => data)
        return
      }
      for (const message of data.messages) {
        if (message?.type === 'TABLE_OPERATIONS') applyPulseOperations(message)
        noteShape('worker', `${name} ${String(message?.type).slice(0, 60)}${typeof message?.table === 'string' ? ` ${message.table.slice(0, 60)}` : ''}`, () => message)
      }
      pump()
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
      watchPulseWorker(worker, url)
      return worker
    }
    RadarWorker.prototype = NativeWorker.prototype
    RadarWorker.axiomRadarWrapped = true
    window.Worker = RadarWorker
  }
  const postPulse = now => {
    if (!usdPerSol || now - pulseChangedAt > 30000) return
    const rows = []
    for (const [column, table] of Object.entries(pulseTables)) for (const row of table.values()) if (row.tokenAddress) rows.push({ ...row, column })
    window.postMessage({ source: 'axiom-radar-bridge-pulse', usdPerSol, rows: rows.slice(0, 300), at: now }, window.location.origin)
  }
  const postLists = now => {
    const sources = []
    for (const source of listSources.values()) if (now - source.at <= 60000 && source.rows.size) sources.push({ kind: source.kind, name: source.name, at: source.at, rows: [...source.rows.values()].slice(0, 300) })
    if (sources.length) window.postMessage({ source: 'axiom-radar-bridge-lists', sources, at: now }, window.location.origin)
  }
  const postDigest = now => {
    if (!digest.size) return
    window.postMessage({ source: 'axiom-radar-bridge-digest', entries: [...digest.entries()].map(([key, entry]) => ({ key, shape: entry.shape, count: entry.count })), at: now }, window.location.origin)
  }
  let pumpedAt = 0
  let digestAt = 0
  /**
   * Sends what has been collected, at most once a second. It runs from the page's own data events as well as a timer:
   * Chrome slows timers in a background tab to as little as once a minute, while worker and socket messages keep arriving.
   */
  function pump() {
    const now = Date.now()
    if (now - pumpedAt < 1000) return
    pumpedAt = now
    postPulse(now)
    postLists(now)
    if (now - digestAt >= 10000) {
      digestAt = now
      postDigest(now)
    }
  }
  setInterval(pump, 1000)
  const pathOf = url => {
    try { return new URL(url, location.href).pathname.slice(0, 120) } catch { return 'unknown' }
  }
  const listName = url => {
    try {
      const parsed = new URL(url, location.href)
      return parsed.hostname.endsWith('axiom.trade') ? `${parsed.pathname}${parsed.search}`.slice(0, 160) : null
    } catch { return null }
  }
  const marketPaths = new Set(['/transactions-feed', '/transactions-feed-trader-info', '/transactions-from-traders', '/trader-details-v2', '/sniper-transactions', '/token-info-v2', '/token-and-best-pair-info', '/token-stats', '/dev-tokens', '/dev-transfers', '/reused-image-tokens', '/similar-tokens', '/dex-paid', '/shareholder-claims', '/lighthouse', '/volume-overview', '/pool-state'])
  const isAxiomApi = url => {
    try {
      const parsed = new URL(url, location.href)
      return parsed.hostname.endsWith('axiom.trade') && (marketPaths.has(parsed.pathname) || /holder|top-?trader/i.test(parsed.pathname))
    } catch { return false }
  }
  const notePath = url => {
    try {
      const parsed = new URL(url, location.href)
      if (!parsed.hostname.endsWith('axiom.trade') || parsed.hostname === location.hostname || /\.(js|css|png|jpe?g|webp|svg|woff2?|ico)$/i.test(parsed.pathname)) return
      window.postMessage({ source: 'axiom-radar-bridge-path', path: parsed.pathname.replace(/[1-9A-HJ-NP-Za-km-z]{32,44}/g, ':address').replace(/\/\d{3,}/g, '/:n').slice(0, 100) }, window.location.origin)
    } catch { }
  }
  const shareApi = (url, status, body) => {
    if (typeof body !== 'string' || body.length > 400000) return
    const start = body.trimStart()[0]
    if (start !== '{' && start !== '[') return
    window.postMessage({ source: 'axiom-radar-bridge-api', url: String(url).slice(0, 600), status, body }, window.location.origin)
  }
  const nativeFetch = window.fetch
  if (nativeFetch && !nativeFetch.axiomRadarWrapped) {
    const radarFetch = function (input, init) {
      const result = nativeFetch.call(window, input, init)
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url
      if (url) notePath(url)
      if (url && isAxiomApi(url)) {
        result.then(response => {
          if (!/json|text/i.test(response.headers.get('content-type') ?? '')) return
          response.clone().text().then(body => shareApi(response.url || url, response.status, body)).catch(() => undefined)
        }).catch(() => undefined)
      } else if (url && onDiscover() && listName(url)) {
        result.then(response => {
          if (!response.ok || !/json/i.test(response.headers.get('content-type') ?? '')) return
          response.clone().text().then(body => {
            noteCoinList('api', listName(response.url || url) ?? listName(url), body)
            if (body.length <= 3000000) noteShape('api', pathOf(response.url || url), () => JSON.parse(body))
            pump()
          }).catch(() => undefined)
        }).catch(() => undefined)
      }
      return result
    }
    radarFetch.axiomRadarWrapped = true
    window.fetch = radarFetch
  }
  const NativeXhr = window.XMLHttpRequest
  if (NativeXhr && !NativeXhr.prototype.axiomRadarWrapped) {
    const nativeOpen = NativeXhr.prototype.open
    NativeXhr.prototype.open = function (method, url, ...rest) {
      notePath(String(url))
      if (isAxiomApi(String(url))) {
        this.addEventListener('load', () => {
          try {
            const body = this.responseType === '' || this.responseType === 'text' ? this.responseText : this.responseType === 'json' ? JSON.stringify(this.response) : null
            shareApi(this.responseURL || url, this.status, body)
          } catch { }
        })
      } else if (onDiscover() && listName(String(url))) {
        this.addEventListener('load', () => {
          try {
            if (this.status < 200 || this.status >= 300) return
            const body = this.responseType === '' || this.responseType === 'text' ? this.responseText : this.responseType === 'json' ? JSON.stringify(this.response) : null
            noteCoinList('api', listName(this.responseURL || String(url)) ?? listName(String(url)), body)
            if (typeof body === 'string' && body.length <= 3000000) noteShape('api', pathOf(this.responseURL || String(url)), () => JSON.parse(body))
            pump()
          } catch { }
        })
      }
      return nativeOpen.call(this, method, url, ...rest)
    }
    NativeXhr.prototype.axiomRadarWrapped = true
  }
  const Native = window.WebSocket
  if (!Native || Native.axiomRadarWrapped) return
  const interesting = /viewer|watch|online|concurrent/i
  const decoder = new TextDecoder()
  const recent = []
  const remember = (url, kind, text) => {
    recent.push({ at: Date.now(), url: String(url).slice(0, 200), kind, text: text.slice(0, 4000) })
    if (recent.length > 120) recent.shift()
  }
  const forward = (text, url) => {
    if (text.length > 60000) return
    if (interesting.test(text)) window.postMessage({ source: 'axiom-radar-bridge', frame: text }, window.location.origin)
  }
  const handle = (url, data) => {
    if (typeof data === 'string') {
      remember(url, 'text', data)
      forward(data, url)
      if (onDiscover()) {
        try {
          const room = data.slice(0, 600).match(/"(?:room|channel|event|type)"\s*:\s*"([^"]{1,60})"/)
          const name = `${new URL(url).hostname}${room ? `/${room[1]}` : ''}`
          noteCoinList('socket', name, data)
          if (data.length <= 300000) noteShape('socket', name, () => JSON.parse(data))
          pump()
        } catch { }
      }
      return
    }
    if (data instanceof ArrayBuffer) {
      const bytes = new Uint8Array(data)
      if (onDiscover()) {
        try { noteShape('socket', `${new URL(url).hostname} binary`, () => ({ bytes: bytes.length })) } catch { }
      }
      const hex = Array.from(bytes.slice(0, 64), byte => byte.toString(16).padStart(2, '0')).join('')
      remember(url, 'binary', `len=${bytes.length} hex=${hex} utf8=${decoder.decode(bytes.slice(0, 3000))}`)
      if (bytes.length <= 60000) forward(decoder.decode(bytes), url)
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
