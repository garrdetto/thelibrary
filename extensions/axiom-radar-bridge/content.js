const frames = []
const reportIntervalMs = 5000
let sampleResolver = null

window.addEventListener('message', event => {
  if (event.source !== window) return
  if (event.data?.source === 'axiom-radar-bridge' && typeof event.data.frame === 'string') {
    frames.push(event.data.frame)
    if (frames.length > 400) frames.splice(0, frames.length - 400)
  }
  if (event.data?.source === 'axiom-radar-bridge-sample' && sampleResolver) {
    sampleResolver(event.data.frames)
    sampleResolver = null
  }
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

const fullAddress = /[1-9A-HJ-NP-Za-km-z]{32,44}/
const shortAddress = /\b([1-9A-HJ-NP-Za-km-z]{3,8})\.{2,3}([1-9A-HJ-NP-Za-km-z]{3,8})\b/

function addressesIn(element) {
  const found = { pairAddress: null, mint: null }
  for (const link of element.querySelectorAll('a[href]')) {
    const match = link.getAttribute('href').match(/\/meme\/([1-9A-HJ-NP-Za-km-z]{32,44})/)
    if (match) { found.pairAddress = match[1]; break }
  }
  for (const node of element.querySelectorAll('img[src], [data-address], [data-mint], [data-token]')) {
    const value = node.getAttribute('data-mint') || node.getAttribute('data-address') || node.getAttribute('data-token') || node.getAttribute('src') || ''
    const match = value.match(fullAddress)
    if (match) { found.mint = match[0]; break }
  }
  return found
}

function eyeCards() {
  const cards = []
  const icons = document.querySelectorAll('i.ri-eye-line')
  for (const icon of icons) {
    const viewers = parseCompactNumber((icon.parentElement?.innerText ?? '').trim())
    if (viewers === null) continue
    let card = icon.parentElement
    let short = null
    for (let depth = 0; card && depth < 14; depth++, card = card.parentElement) {
      if (card.querySelectorAll('i.ri-eye-line').length > 1) { card = null; break }
      const match = (card.innerText ?? '').match(shortAddress)
      if (match) { short = { prefix: match[1], suffix: match[2] }; break }
      if (card.querySelector('a[href*="/meme/"]')) break
    }
    if (!card) continue
    const { pairAddress, mint } = addressesIn(card)
    if (!short && !pairAddress && !mint) continue
    cards.push({ viewers, pairAddress, mint, short })
    if (cards.length >= 300) break
  }
  return cards
}

function pageEyeViewers() {
  const icon = document.querySelector('i.ri-eye-line')
  return icon ? parseCompactNumber((icon.parentElement?.innerText ?? '').trim()) : null
}

function domHints() {
  const hints = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT)
  while (walker.nextNode() && hints.length < 40) {
    const element = walker.currentNode
    const className = typeof element.className === 'string' ? element.className : element.getAttribute('class') ?? ''
    const label = `${element.getAttribute('title') ?? ''} ${element.getAttribute('aria-label') ?? ''} ${element.getAttribute('data-tooltip') ?? ''} ${className}`
    const isEyeIcon = element.tagName.toLowerCase() === 'svg' && /eye/i.test(element.outerHTML.slice(0, 400))
    if (/view|watch|eye|online|live/i.test(label) || isEyeIcon) {
      const container = element.parentElement ?? element
      hints.push({ tag: element.tagName, label: label.trim().slice(0, 160), text: (container.innerText ?? '').slice(0, 160), html: container.outerHTML.slice(0, 600) })
    }
  }
  return hints
}

async function collectSample() {
  const wsFrames = await new Promise(resolve => {
    sampleResolver = resolve
    window.postMessage({ source: 'axiom-radar-bridge-request' }, window.location.origin)
    setTimeout(() => {
      if (sampleResolver) {
        sampleResolver([])
        sampleResolver = null
      }
    }, 1500)
  })
  return {
    url: location.href.slice(0, 500),
    title: document.title.slice(0, 200),
    pairAddress: pairFromUrl(),
    visibleViewers: visibleViewers(),
    bodyText: (document.body?.innerText ?? '').slice(0, 6000),
    domHints: domHints(),
    frames: wsFrames,
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'axiom-radar-collect-sample') return
  collectSample().then(sendResponse, error => sendResponse({ url: location.href, error: String(error) }))
  return true
})

setInterval(() => {
  const pairAddress = pairFromUrl()
  const batch = frames.splice(0, 200)
  const cards = pairAddress ? [] : eyeCards()
  if (!pairAddress && !batch.length && !cards.length) return
  const pageViewers = pairAddress ? pageEyeViewers() ?? visibleViewers() : null
  chrome.runtime.sendMessage({ type: 'axiom-radar-report', report: { url: location.href.slice(0, 500), pairAddress, pageViewers, frames: batch, cards } }).catch(() => undefined)
}, reportIntervalMs)
