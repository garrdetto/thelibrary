const frames = []
const apiAnswers = []
const streamFrames = []
let pulseFeed = null
const reportIntervalMs = 1000
let sampleResolver = null

window.addEventListener('message', event => {
  if (event.source !== window) return
  if (event.data?.source === 'axiom-radar-bridge' && typeof event.data.frame === 'string') {
    frames.push(event.data.frame)
    if (frames.length > 400) frames.splice(0, frames.length - 400)
  }
  if (event.data?.source === 'axiom-radar-bridge-api' && typeof event.data.body === 'string') {
    apiAnswers.push({ url: String(event.data.url).slice(0, 600), status: Number(event.data.status) || 0, body: event.data.body })
    if (apiAnswers.length > 60) apiAnswers.splice(0, apiAnswers.length - 60)
  }
  if (event.data?.source === 'axiom-radar-bridge-stream' && typeof event.data.text === 'string') {
    streamFrames.push({ url: String(event.data.url).slice(0, 200), text: event.data.text })
    if (streamFrames.length > 2000) streamFrames.splice(0, streamFrames.length - 2000)
  }
  if (event.data?.source === 'axiom-radar-bridge-pulse' && Array.isArray(event.data.rows)) pulseFeed = { usdPerSol: event.data.usdPerSol, rows: event.data.rows, at: event.data.at }
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
  const match = location.pathname.match(/\/(?:meme|token)\/([1-9A-HJ-NP-Za-km-z]{32,44})/)
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
    let full = card
    for (let depth = 0; depth < 10 && full.parentElement && full.parentElement.querySelectorAll('i.ri-eye-line').length === 1; depth++) full = full.parentElement
    const lines = (full.innerText ?? '').split('\n').map(line => line.trim()).filter(Boolean).slice(0, 60).map(line => line.slice(0, 60))
    const icons = Array.from(full.querySelectorAll('i[class*="ri-"]'), node => (node.getAttribute('class') ?? '').split(/\s+/).find(name => name.startsWith('ri-')) ?? '').filter(Boolean).slice(0, 40)
    cards.push({ viewers, pairAddress, mint, short, lines, icons })
    if (cards.length >= 300) break
  }
  return cards
}

const percentLine = /^<?\s*(\d+(?:\.\d+)?)\s*%$/
let pageStatsCache = { at: 0, stats: null }

const holderLabel = /top\s*10|\bdev\b|snip|insid|bundl|fresh|pro\s*trader/i

function readPageStats() {
  const lines = (document.body?.innerText ?? '').split('\n').map(line => line.trim()).filter(Boolean)
  const stats = {}
  let found = 0
  for (let index = 0; index < lines.length - 1 && found < 20; index++) {
    const value = lines[index].match(percentLine)
    const label = lines[index + 1]
    if (!value || label.length > 28 || !holderLabel.test(label) || label in stats) continue
    stats[label] = Math.min(100, Number(value[1]))
    found += 1
  }
  return found >= 2 ? stats : null
}

function pageStats() {
  const now = Date.now()
  if (now - pageStatsCache.at < (pageStatsCache.stats ? 5000 : 700)) return pageStatsCache.stats
  pageStatsCache = { at: now, stats: readPageStats() }
  return pageStatsCache.stats
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
    stats: readPageStats(),
    frames: wsFrames,
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'axiom-radar-collect-sample') return
  collectSample().then(sendResponse, error => sendResponse({ url: location.href, error: String(error) }))
  return true
})

/** The star beside the coin's name at the top of a coin page, which adds it to or takes it off the Axiom watchlist. */
function headerStar() {
  const buttons = Array.from(document.querySelectorAll('button')).filter(button => button.querySelector(':scope > div > i.ri-star-line, :scope > div > i.ri-star-fill'))
  const visible = buttons.map(button => ({ button, rect: button.getBoundingClientRect() })).filter(({ rect }) => rect.width > 0 && rect.top >= 0 && rect.top < 220)
  visible.sort((first, second) => first.rect.top - second.rect.top || first.rect.left - second.rect.left)
  return visible[0]?.button ?? null
}

function starred(button) {
  return Boolean(button.querySelector('i.ri-star-fill:not(.hidden)')) && !button.querySelector('i.ri-star-line:not(.hidden)')
}

function onCoinPage(mint, pairAddress) {
  return location.pathname.includes(mint) || location.pathname.includes(pairAddress)
}

async function setStar(mint, pairAddress, want) {
  if (!onCoinPage(mint, pairAddress)) return { done: false, reason: 'the coin page has not opened yet' }
  const button = headerStar()
  if (!button) return { done: false, reason: 'the star button has not loaded yet' }
  if (starred(button) === want) return { done: true, ok: true }
  button.click()
  for (let waited = 0; waited < 5_000; waited += 500) {
    await new Promise(resolve => setTimeout(resolve, 500))
    const after = headerStar()
    if (after && starred(after) === want) return { done: true, ok: true }
  }
  return { done: true, ok: false, reason: want ? 'the star did not fill within 5 seconds of the click' : 'the star stayed filled 5 seconds after the click' }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'axiom-radar-star' || typeof message.mint !== 'string' || typeof message.pairAddress !== 'string') return
  setStar(message.mint, message.pairAddress, message.want === true).then(sendResponse, error => sendResponse({ done: true, ok: false, reason: String(error).slice(0, 160) }))
  return true
})

let lastReportAt = 0
let reportTimer = null
let reportObserver = null

function stopReporting() {
  if (reportTimer !== null) clearInterval(reportTimer)
  reportTimer = null
  reportObserver?.disconnect()
  reportObserver = null
}

function extensionAlive() {
  try { return Boolean(chrome.runtime?.id) } catch { return false }
}

function report() {
  if (!extensionAlive()) return stopReporting()
  lastReportAt = Date.now()
  const pairAddress = pairFromUrl()
  const batch = frames.splice(0, 200)
  const api = []
  let apiBytes = 0
  while (apiAnswers.length && api.length < 30 && apiBytes + apiAnswers[0].body.length <= 3000000) { apiBytes += apiAnswers[0].body.length; api.push(apiAnswers.shift()) }
  const streams = []
  let streamBytes = 0
  while (streamFrames.length && streams.length < 400 && streamBytes + streamFrames[0].text.length <= 2000000) { streamBytes += streamFrames[0].text.length; streams.push(streamFrames.shift()) }
  const cards = pairAddress ? [] : eyeCards()
  const pulse = !pairAddress && pulseFeed && Date.now() - pulseFeed.at < 5000 ? pulseFeed : null
  if (!pairAddress && !batch.length && !cards.length && !pulse && !api.length && !streams.length) return
  const pageViewers = pairAddress ? pageEyeViewers() ?? visibleViewers() : null
  const stats = pairAddress ? pageStats() : null
  try {
    chrome.runtime.sendMessage({ type: 'axiom-radar-report', report: { url: location.href.slice(0, 500), pairAddress, pageViewers, frames: batch, cards, ...(stats ? { stats } : {}), ...(pulse ? { pulse: { usdPerSol: pulse.usdPerSol, rows: pulse.rows } } : {}), ...(api.length ? { api } : {}), ...(streams.length ? { streams } : {}) } }).catch(() => undefined)
  } catch {
    stopReporting()
  }
}

const reportIfDue = () => { if (Date.now() - lastReportAt >= reportIntervalMs) report() }
reportTimer = setInterval(reportIfDue, reportIntervalMs)
reportObserver = new MutationObserver(reportIfDue)
reportObserver.observe(document.documentElement, { subtree: true, childList: true, characterData: true })
