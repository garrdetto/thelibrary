const frames = []
const apiAnswers = []
const streamFrames = []
let pulseFeed = null
let listFeed = null
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
  if (event.data?.source === 'axiom-radar-bridge-lists' && Array.isArray(event.data.sources)) listFeed = { sources: event.data.sources, at: event.data.at }
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

const listNames = ['trending', 'surge']
const listLabel = { trending: /^trending$/i, surge: /^surg(e|ing)$/i }
const boundedAddress = /(?:^|[^A-Za-z0-9])([1-9A-HJ-NP-Za-km-z]{32,44})(?:[^A-Za-z0-9]|$)/
let discoverTabCache = { at: 0, list: null, how: '', labels: '' }

function onDiscoverPage() {
  return location.pathname.startsWith('/discover')
}

/** How light a computed text color is, from 0 to 1: the selected tab is drawn brighter than the others. */
function lightness(color) {
  const numbers = (String(color).match(/-?[\d.]+%?/g) ?? []).map(part => part.endsWith('%') ? Number(part.slice(0, -1)) / 100 : Number(part))
  if (numbers.length < 3) return 0
  const alpha = numbers.length >= 4 ? Math.max(0, Math.min(1, numbers[3])) : 1
  if (/^ok(lab|lch)|^lab|^lch/i.test(color)) return Math.max(0, Math.min(1, numbers[0] > 1 ? numbers[0] / 100 : numbers[0])) * alpha
  return ((0.2126 * numbers[0] + 0.7152 * numbers[1] + 0.0722 * numbers[2]) / 255) * alpha
}

/** Which Discover list this tab is showing: from the address, else the tab marked selected, else the brighter of the Trending and Surge labels. */
function pickDiscoverList(where, found) {
  if (/surg/i.test(where)) return { list: 'surge', how: 'address' }
  if (/trend/i.test(where)) return { list: 'trending', how: 'address' }
  const { trending, surge } = found
  if (trending && surge) {
    if (trending.marked !== surge.marked) return { list: trending.marked ? 'trending' : 'surge', how: 'selected tab' }
    if (Math.abs(trending.light - surge.light) >= 0.12) return { list: trending.light > surge.light ? 'trending' : 'surge', how: 'brighter tab' }
    return { list: null, how: 'tabs look the same' }
  }
  if (trending || surge) return { list: trending ? 'trending' : 'surge', how: 'only label on the page' }
  return { list: null, how: 'no Trending or Surge label' }
}

function discoverTab() {
  const now = Date.now()
  if (now - discoverTabCache.at < 2000) return discoverTabCache
  const found = { trending: null, surge: null }
  for (const element of document.querySelectorAll('button, a, [role="tab"], [role="button"], span, p, div')) {
    if (element.childElementCount > 2) continue
    const text = (element.textContent ?? '').trim()
    if (text.length > 12) continue
    const list = listLabel.trending.test(text) ? 'trending' : listLabel.surge.test(text) ? 'surge' : null
    if (!list) continue
    const rect = element.getBoundingClientRect()
    if (!rect.width || !rect.height) continue
    const holder = element.closest('button, a, [role="tab"], [role="button"]') ?? element
    const marked = [holder, element].some(node => node.getAttribute('aria-selected') === 'true' || node.getAttribute('aria-pressed') === 'true' || ['page', 'true'].includes(node.getAttribute('aria-current') ?? '') || /^(active|on|selected|checked)$/i.test(node.getAttribute('data-state') ?? ''))
    const light = lightness(getComputedStyle(element).color)
    const best = found[list]
    if (!best || Number(marked) > Number(best.marked) || (marked === best.marked && light > best.light)) found[list] = { marked, light }
  }
  const picked = pickDiscoverList(`${location.pathname}${location.search}${location.hash}`, found)
  const labels = listNames.map(list => found[list] ? `${list} ${found[list].marked ? 'selected ' : ''}${found[list].light.toFixed(2)}` : `${list} not found`).join(', ')
  discoverTabCache = { at: now, list: picked.list, how: picked.how, labels }
  return discoverTabCache
}

/** The coins drawn in the page's main list: token images grouped by the element their rows share, largest group wins, so a ticker bar or a side panel is not mistaken for the list. */
function discoverRows() {
  const groups = new Map()
  for (const image of document.querySelectorAll('img[src]')) {
    const match = (image.getAttribute('src') ?? '').match(boundedAddress)
    if (!match) continue
    const row = image.closest('a[href*="/meme/"], tr, [role="row"], li') ?? image.parentElement?.parentElement
    const parent = row?.parentElement
    if (!parent) continue
    const link = row.matches?.('a[href*="/meme/"]') ? row : row.querySelector?.('a[href*="/meme/"]')
    const pair = link?.getAttribute('href')?.match(/\/meme\/([1-9A-HJ-NP-Za-km-z]{32,44})/)?.[1] ?? null
    const coins = groups.get(parent) ?? new Map()
    if (!coins.has(match[1])) coins.set(match[1], { tokenAddress: match[1], ...(pair ? { pairAddress: pair } : {}) })
    groups.set(parent, coins)
  }
  let best = null
  for (const coins of groups.values()) if (!best || coins.size > best.size) best = coins
  return best && best.size >= 3 ? [...best.values()].slice(0, 300) : []
}

/**
 * The Trending and Surge coins to report. A feed whose own name says which list it is (a worker table, an API answer or
 * a socket room with "trending" or "surge" in it) is used whole; otherwise the rows drawn on a Discover tab are reported
 * under the list that tab is showing. Feeds with other names are only counted, never sent.
 */
function buildLists(sources, tab, drawn) {
  const named = { trending: null, surge: null }
  for (const source of sources) {
    const list = /surg/i.test(source.name) ? 'surge' : /trend/i.test(source.name) ? 'trending' : null
    if (list && Array.isArray(source.rows) && (!named[list] || source.rows.length > named[list].rows.length)) named[list] = source
  }
  const lists = []
  for (const list of listNames) {
    if (named[list]) lists.push({ list, rows: named[list].rows.slice(0, 300) })
    else if (tab.list === list && drawn.length >= 3) lists.push({ list, rows: drawn })
  }
  return lists
}

function listReport() {
  const sources = listFeed && Date.now() - listFeed.at < 5000 ? listFeed.sources : []
  if (!onDiscoverPage()) return { lists: buildLists(sources, { list: null }, []), probe: null }
  const tab = discoverTab()
  const drawn = discoverRows()
  const probe = { page: location.pathname.slice(0, 120), tab: tab.list, how: tab.how.slice(0, 40), labels: tab.labels.slice(0, 200), sources: sources.map(source => `${source.kind}:${source.name}=${source.rows.length}`).join('; ').slice(0, 800), drawn: drawn.length }
  return { lists: buildLists(sources, tab, drawn), probe }
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
  const { lists, probe } = pairAddress ? { lists: [], probe: null } : listReport()
  if (!pairAddress && !batch.length && !cards.length && !pulse && !api.length && !streams.length && !lists.length && !probe) return
  const pageViewers = pairAddress ? pageEyeViewers() ?? visibleViewers() : null
  const stats = pairAddress ? pageStats() : null
  try {
    chrome.runtime.sendMessage({ type: 'axiom-radar-report', report: { url: location.href.slice(0, 500), pairAddress, pageViewers, frames: batch, cards, ...(stats ? { stats } : {}), ...(pulse ? { pulse: { usdPerSol: pulse.usdPerSol, rows: pulse.rows } } : {}), ...(api.length ? { api } : {}), ...(streams.length ? { streams } : {}), ...(lists.length ? { lists } : {}), ...(probe ? { probe } : {}) } }).catch(() => undefined)
  } catch {
    stopReporting()
  }
}

const reportIfDue = () => { if (Date.now() - lastReportAt >= reportIntervalMs) report() }
reportTimer = setInterval(reportIfDue, reportIntervalMs)
reportObserver = new MutationObserver(reportIfDue)
reportObserver.observe(document.documentElement, { subtree: true, childList: true, characterData: true })
