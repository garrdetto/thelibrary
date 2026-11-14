const frames = []
const reportIntervalMs = 5000

window.addEventListener('message', event => {
  if (event.source !== window || event.data?.source !== 'axiom-radar-bridge' || typeof event.data.frame !== 'string') return
  frames.push(event.data.frame)
  if (frames.length > 400) frames.splice(0, frames.length - 400)
})

function parseCompactNumber(text) {
  const match = text.trim().match(/^([\d.,]+)\s*([kKmM])?$/)
  if (!match) return null
  const base = Number(match[1].replace(/,/g, ''))
  if (!Number.isFinite(base)) return null
  const unit = match[2]?.toLowerCase()
  return Math.round(base * (unit === 'k' ? 1000 : unit === 'm' ? 1000000 : 1))
}

function visibleViewers() {
  const text = document.body?.innerText ?? ''
  const match = text.match(/([\d.,]+\s*[kKmM]?)\s*(viewers?|watching|online)\b/i) ?? text.match(/\b(viewers?|watching)\s*[:·]?\s*([\d.,]+\s*[kKmM]?)/i)
  if (!match) return null
  return parseCompactNumber(/\d/.test(match[1]) ? match[1] : match[2])
}

function pairFromUrl() {
  const match = location.pathname.match(/\/meme\/([1-9A-HJ-NP-Za-km-z]{32,44})/)
  return match ? match[1] : null
}

setInterval(() => {
  const pairAddress = pairFromUrl()
  const batch = frames.splice(0, 200)
  if (!pairAddress && !batch.length) return
  const pageViewers = pairAddress ? visibleViewers() : null
  chrome.runtime.sendMessage({ type: 'axiom-radar-report', report: { url: location.href.slice(0, 500), pairAddress, pageViewers, frames: batch } }).catch(() => undefined)
}, reportIntervalMs)
