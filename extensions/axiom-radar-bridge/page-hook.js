(() => {
  const Native = window.WebSocket
  if (!Native || Native.axiomRadarWrapped) return
  const interesting = /viewer|watch|online|concurrent/i
  const decoder = new TextDecoder()
  const forward = text => {
    if (text.length <= 60000 && interesting.test(text)) window.postMessage({ source: 'axiom-radar-bridge', frame: text }, window.location.origin)
  }
  function RadarWebSocket(...args) {
    const socket = new Native(...args)
    socket.addEventListener('message', event => {
      if (typeof event.data === 'string') forward(event.data)
      else if (event.data instanceof ArrayBuffer && event.data.byteLength <= 60000) forward(decoder.decode(event.data))
    })
    return socket
  }
  RadarWebSocket.prototype = Native.prototype
  for (const key of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) RadarWebSocket[key] = Native[key]
  RadarWebSocket.axiomRadarWrapped = true
  window.WebSocket = RadarWebSocket
})()
