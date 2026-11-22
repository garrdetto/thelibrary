(function () {
  if (window.__tlFoxDollar) return
  window.__tlFoxDollar = true
  var family = '__FAMILY__'
  var quoted = "'" + family + "'"
  try {
    var raw = atob('__FONT__')
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
