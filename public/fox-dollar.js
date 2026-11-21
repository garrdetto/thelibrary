(function () {
  if (window.__tlFoxDollar) return
  window.__tlFoxDollar = true
  var family = 'TL Fox Dollar'
  var quoted = "'" + family + "'"
  try {
    var raw = atob('d09GMgABAAAAAAQMAAoAAAAABlQAAAPCAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAABmAANAqHbIZRATYCJAMICwYABCAFcgcmG/4EIB4H1Y31xhNlFE/+CKsyKK+qToZYIQuYr4OMe239NuC74DOTZAOeTFYQ23+I6d7hXmkn1oqXZqVr60VnUlHx6DDEXGoD59RV4BpwNsEhV7zDDtpAWWaVINfTCC7AN2/Pu432Fce2nqLf6BdBUwlkAthggWoC0A8Imo1hTO/97w7UHTgB+AwASgYagIpPzGc1xlkASMrG///r5P+7i/gUQNY1EUAGATIdSGvydRGvW+KCHVv16NqEmqw3c8gc2nK2OYBGTNNizgQPl6bdtW7fTqkksVSGEKgISteBLIbWgkSxMGLuPd2pVKLCyWoxIFA1cZ63pTEijrVWCgCsJUmloDhjLgdmYEwLE0I+qOLXdhucwPjIzfs8N7LkgcwWHLK1kCilUHofOTchUmOKKdU9komciyRn2U+F966YpzF1bo5LU4qJmScOHJhRaS0oqQeammi5VC6t7XyPWK6hgISR5O1hkQ8qU60dlgeI6CO0EKiaIAOZOoYQs4xYSGeMNLMdIKZSeukxtOAKKYmASg7BgndoAaqISERQKgWRXJKRElE7jn9XXGKN65jq/4xZOOVYcoDK0dM9GOOa1RPSeeVF29i4377xuzyR4ALVrTt8XXoOXv+9+YuaYlC9Gokax5xyJs2DzF6f7mIWQqveSz8b5a4ln4nOyvbVGhO0vR3oMtxyOqHMq/mjSaGa6z6OEbvf7lp583YDuT3eW66n49QH4+2vTTJUOzM92VTXK7Ys+XGgMN8LNplLAy9fD+Sp7/hjH/Ij95cw53JxwwW5T98l19N/KRbMMGde7TRQ6XPgD03E77f6Mrc4xks27lbltIXDsxxusvuptolNomz/iWsDRRpj2z142uN5cJ1+bnKR0RrUCT55+v3/PIkRyiAsb9JCgkO7usyg/uiEt5dPi6NIfILe7EWjVKNeg6c5P0zpEburxTWTmt2+OS7JTj9720Wyy/4rxdTbW5RZPm3xRVPZm6GV3bFiofG/e/o3m5yaf8Hm5MeVAyOqq0vWPJZ91iHLNoZ9WJqqtvNRkP5Ntf6w1nxll51PppW5nDpUlFl6aYNd065Kgc7AsfWswkHzF5crr2VYtBh46HuShgiqVRZN2hlydwmQ/WvMVZ/kSb3/8mj6Bdh4bnqyw71s/n8ONUKrBQANaqBxu+PU2g4EzHMgQJAhX+CTRHkQoqY+YJkF1ylEEIjNsECBawDdw+KDQAsqOEVBAtvkyczYze1f0TYfVduLZESDQSjq0O6Cwe+qUY0CNCIRJShDiyxBgVoXjwsAAA==')
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
