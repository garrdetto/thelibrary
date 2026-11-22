(function () {
  if (window.__tlFoxDollar) return
  window.__tlFoxDollar = true
  var family = 'TL Fox Dollar'
  var quoted = "'" + family + "'"
  try {
    var raw = atob('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')
    var bytes = new Uint8Array(raw.length)
    for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
    var face = new FontFace(family, bytes.buffer, {
      unicodeRange: 'U+0024',
      weight: '1 1000',
      display: 'block',
    })
    document.fonts.add(face)
    face.load().then(function () {
      window.dispatchEvent(new Event('tl-fox-dollar-ready'))
    }, function () {})
  } catch (error) {}
  var size = /^(.*?\d[\d.]*(?:px|pt|pc|em|rem|%|ex|ch|vh|vw|vmin|vmax|cm|mm|in)(?:\s*\/\s*\S+)?\s+)(.+)$/i
  function withFox(value) {
    if (typeof value !== 'string' || value.indexOf(family) !== -1) return value
    var match = size.exec(value)
    return match ? match[1] + quoted + ', ' + match[2] : value
  }
  function patch(proto) {
    if (!proto) return
    var descriptor = Object.getOwnPropertyDescriptor(proto, 'font')
    if (!descriptor || !descriptor.set || !descriptor.configurable) return
    Object.defineProperty(proto, 'font', {
      configurable: true,
      enumerable: descriptor.enumerable,
      get: descriptor.get,
      set: function (value) {
        descriptor.set.call(this, withFox(value))
      },
    })
  }
  patch(window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype)
  patch(window.OffscreenCanvasRenderingContext2D && OffscreenCanvasRenderingContext2D.prototype)
})()
