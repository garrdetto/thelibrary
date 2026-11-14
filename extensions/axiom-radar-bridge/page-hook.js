(() => {
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
