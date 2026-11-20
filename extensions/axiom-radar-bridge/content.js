const frames = []
const apiAnswers = []
let pollStats = null
const streamFrames = []
let pulseFeed = null
let listFeed = null
let digestFeed = null
let pageDigestAt = 0
const reportIntervalMs = 1000
let sampleResolver = null
const pathsSeen = new Map()
let tabsFound = null

window.addEventListener('message', event => {
  if (event.source !== window) return
  if (event.data?.source === 'axiom-radar-bridge' && typeof event.data.frame === 'string') {
    frames.push(event.data.frame)
    if (frames.length > 400) frames.splice(0, frames.length - 400)
  }
  if (event.data?.source === 'axiom-radar-bridge-poll-stats') {
    const number = value => Math.max(0, Math.min(1e9, Math.round(Number(value) || 0)))
    pollStats = { sent: number(event.data.sent), ok: number(event.data.ok), failed: number(event.data.failed), status: Math.max(-1, Math.min(999, Math.round(Number(event.data.status) || 0))), mints: number(event.data.mints), hidden: event.data.hidden === true }
  }
  if (event.data?.source === 'axiom-radar-bridge-api' && typeof event.data.body === 'string') {
    apiAnswers.push({ url: String(event.data.url).slice(0, 600), status: Number(event.data.status) || 0, body: event.data.body, ...(event.data.poll === true ? { poll: true } : {}) })
    if (apiAnswers.length > 60) apiAnswers.splice(0, apiAnswers.length - 60)
  }
  if (event.data?.source === 'axiom-radar-bridge-stream' && typeof event.data.text === 'string') {
    streamFrames.push({ url: String(event.data.url).slice(0, 200), text: event.data.text })
    if (streamFrames.length > 2000) streamFrames.splice(0, streamFrames.length - 2000)
  }
  if (event.data?.source === 'axiom-radar-bridge-path' && typeof event.data.path === 'string') {
    pathsSeen.set(event.data.path.slice(0, 100), Date.now())
    if (pathsSeen.size > 200) pathsSeen.delete(pathsSeen.keys().next().value)
  }
  if (event.data?.source === 'axiom-radar-bridge-pulse' && Array.isArray(event.data.rows)) pulseFeed = { usdPerSol: event.data.usdPerSol, rows: event.data.rows, at: event.data.at }
  if (event.data?.source === 'axiom-radar-bridge-lists' && Array.isArray(event.data.sources)) listFeed = { sources: event.data.sources, at: event.data.at }
  if (event.data?.source === 'axiom-radar-bridge-digest' && Array.isArray(event.data.entries)) digestFeed = { entries: event.data.entries, at: event.data.at }
  if (event.data?.source === 'axiom-radar-bridge-sample' && sampleResolver) {
    sampleResolver(event.data.frames)
    sampleResolver = null
  }
  if (/^axiom-radar-bridge(-pulse|-lists|-digest|-api)?$/.test(String(event.data?.source))) reportIfDue()
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
const listLabel = { trending: /^(top|trending)$/i, surge: /^surg(e|ing)$/i }
const subTabName = /^(top|trending|surge|surging)$/i
let subTabCache = { at: 0, tabs: [] }
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

function isMarked(node) {
  return node.getAttribute('aria-selected') === 'true' || node.getAttribute('aria-pressed') === 'true' || ['page', 'true'].includes(node.getAttribute('aria-current') ?? '') || /^(active|on|selected|checked)$/i.test(node.getAttribute('data-state') ?? '')
}

/**
 * The labels in the row of Discover's sub-tabs (Top, Surge, Callouts, ...), each with how it is drawn: weight, size, colours,
 * underline and class names. Axiom does not mark the selected tab, so the tracker tells it from the others by its look.
 */
function subTabs() {
  const now = Date.now()
  if (now - subTabCache.at < 2000) return subTabCache.tabs
  const found = []
  for (const element of document.querySelectorAll('button, a, [role="tab"], [role="button"], span, p, div')) {
    if (element.childElementCount > 2) continue
    const text = (element.textContent ?? '').trim()
    if (!text || text.length > 16 || /\d/.test(text)) continue
    const rect = element.getBoundingClientRect()
    if (!rect.width || !rect.height || rect.top < 0 || rect.top > 460) continue
    found.push({ element, text, top: rect.top, left: rect.left, height: rect.height, area: rect.width * rect.height })
  }
  const anchors = found.filter(item => subTabName.test(item.text))
  const byText = new Map()
  for (const item of found) {
    if (!anchors.some(anchor => Math.abs(anchor.top - item.top) <= 10)) continue
    const best = byText.get(item.text)
    if (!best || item.area < best.area) byText.set(item.text, item)
  }
  const tabs = [...byText.values()].sort((first, second) => first.left - second.left).slice(0, 12).map(item => {
    const holder = item.element.closest('button, a, [role="tab"], [role="button"]') ?? item.element
    const style = getComputedStyle(item.element)
    const around = getComputedStyle(holder)
    return {
      text: item.text.slice(0, 24),
      top: Math.round(item.top),
      left: Math.round(item.left),
      height: Math.round(item.height),
      marked: [holder, item.element].some(isMarked),
      look: [style.fontWeight, style.fontSize, style.color, style.opacity, style.textDecorationLine, around.backgroundColor, around.borderBottomColor, around.borderBottomWidth, around.color].join('|').slice(0, 240),
      classes: (typeof holder.className === 'string' ? holder.className : '').slice(0, 200),
    }
  })
  subTabCache = { at: now, tabs }
  return tabs
}

/**
 * The coins drawn in the page's main list, each with its viewer count when the card shows one. A card is the largest
 * element around a token image that holds no other coin's image; cards are grouped by the element they share and the
 * largest group wins, so a ticker bar or a side panel is not mistaken for the list. Images above `minTop` are ignored.
 */
function discoverRows(minTop = 0) {
  const mintOf = image => (image.getAttribute('src') ?? '').match(boundedAddress)?.[1] ?? null
  const groups = new Map()
  for (const image of document.querySelectorAll('img[src]')) {
    const mint = mintOf(image)
    if (!mint) continue
    let card = image
    for (let depth = 0; depth < 16 && card.parentElement; depth++) {
      const mints = new Set()
      for (const other of card.parentElement.querySelectorAll('img[src]')) {
        const found = mintOf(other)
        if (found) mints.add(found)
        if (mints.size > 1) break
      }
      if (mints.size > 1) break
      card = card.parentElement
    }
    const container = card.parentElement
    if (!container || card.getBoundingClientRect().top < minTop) continue
    const link = card.matches?.('a[href*="/meme/"]') ? card : card.querySelector?.('a[href*="/meme/"]')
    const pair = link?.getAttribute('href')?.match(/\/meme\/([1-9A-HJ-NP-Za-km-z]{32,44})/)?.[1] ?? null
    const eye = card.querySelector?.('i.ri-eye-line')
    const viewers = eye ? parseCompactNumber((eye.parentElement?.innerText ?? '').trim()) : null
    const coins = groups.get(container) ?? new Map()
    if (!coins.has(mint)) coins.set(mint, { tokenAddress: mint, ...(pair ? { pairAddress: pair } : {}), ...(viewers !== null ? { userCount: viewers } : {}) })
    groups.set(container, coins)
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
  if (!onDiscoverPage()) return { lists: buildLists(sources, { list: null }, []), probe: null, discover: null }
  const tab = discoverTab()
  const tabs = subTabs()
  const drawn = discoverRows(tabs.length ? Math.min(...tabs.map(item => item.top)) : 0)
  const probe = { page: location.pathname.slice(0, 120), tab: tab.list, how: tab.how.slice(0, 40), labels: tab.labels.slice(0, 200), sources: sources.map(source => `${source.kind}:${source.name}=${source.rows.length}`).join('; ').slice(0, 800), drawn: drawn.length }
  return { lists: buildLists(sources, tabs.length ? { list: null } : tab, drawn), probe, discover: { tabs, coins: drawn } }
}

/**
 * How a Discover page is laid out, so its lists can be read: the short labels near the top (which one is selected), how
 * many rows, links and token images it has, one row's text and structure, and the layout of the data it receives (field
 * names and types from the page hook, never values). Labels with figures in them are left out.
 */
function pageDigest() {
  const marked = node => node.getAttribute('aria-selected') === 'true' || node.getAttribute('aria-pressed') === 'true' || ['page', 'true'].includes(node.getAttribute('aria-current') ?? '') || /^(active|on|selected|checked)$/i.test(node.getAttribute('data-state') ?? '')
  const anyAddress = /[1-9A-HJ-NP-Za-km-z]{32,44}/g
  const shapeOfUrl = value => String(value).replace(anyAddress, '<address>').replace(/[?#].*$/, '').slice(0, 120)
  const labels = []
  for (const element of document.querySelectorAll('button, a, [role="tab"], [role="button"]')) {
    const text = (element.textContent ?? '').trim().replace(/\s+/g, ' ')
    if (!text || text.length > 28 || (/\d/.test(text) && !/^\d{1,2}\s?[smhdw]$/i.test(text))) continue
    const rect = element.getBoundingClientRect()
    if (!rect.width || rect.top < 0 || rect.top > 460) continue
    labels.push(`${text}${marked(element) ? '*' : ''}@${Math.round(rect.top)}:${lightness(getComputedStyle(element).color).toFixed(2)}`)
    if (labels.length >= 70) break
  }
  const withAddress = Array.from(document.querySelectorAll('img[src]')).filter(image => boundedAddress.test(image.getAttribute('src') ?? ''))
  const links = Array.from(document.querySelectorAll('a[href]'), link => link.getAttribute('href') ?? '').filter(href => href.search(anyAddress) >= 0)
  const rows = Array.from(document.querySelectorAll('[role="row"], tr, a[href*="/meme/"], a[href*="/token/"]')).filter(row => {
    const rect = row.getBoundingClientRect()
    return rect.width > 200 && rect.height > 20 && rect.height < 200
  })
  const sample = rows[Math.min(2, rows.length - 1)] ?? null
  const layout = row => [row, ...row.querySelectorAll('*')].slice(0, 45).map(node => `${node.tagName.toLowerCase()}${Array.from(node.attributes).filter(attribute => attribute.name !== 'class' && attribute.name !== 'style').slice(0, 6).map(attribute => `[${attribute.name}${attribute.value.search(anyAddress) >= 0 ? `=${shapeOfUrl(attribute.value)}` : ''}]`).join('')}`).join(' ').slice(0, 1500)
  const feeds = []
  let budget = 60000
  for (const entry of digestFeed?.entries ?? []) {
    const size = String(entry.key).length + String(entry.shape).length
    if (size > budget) break
    budget -= size
    feeds.push({ key: String(entry.key).slice(0, 200), shape: String(entry.shape).slice(0, 4000), count: Number(entry.count) || 0 })
  }
  return {
    address: `${location.pathname}${location.search}`.slice(0, 200),
    labels,
    counts: { rows: document.querySelectorAll('[role="row"]').length, tableRows: document.querySelectorAll('tr').length, memeLinks: document.querySelectorAll('a[href*="/meme/"]').length, tokenLinks: document.querySelectorAll('a[href*="/token/"]').length, addressImages: withAddress.length, images: document.querySelectorAll('img').length, eyes: document.querySelectorAll('i.ri-eye-line').length },
    imageShapes: [...new Set(withAddress.slice(0, 40).map(image => shapeOfUrl(image.getAttribute('src'))))].slice(0, 4),
    linkShapes: [...new Set(links.slice(0, 60).map(shapeOfUrl))].slice(0, 6),
    headings: Array.from(document.querySelectorAll('h1, h2, h3, th, [role="columnheader"]'), node => (node.textContent ?? '').trim().slice(0, 30)).filter(Boolean).slice(0, 30),
    rowText: sample ? (sample.innerText ?? '').split('\n').map(line => line.trim()).filter(Boolean).slice(0, 16).map(line => line.slice(0, 40)) : [],
    rowLayout: sample ? layout(sample) : '',
    tabs: subTabs(),
    feeds,
  }
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

const tabPattern = { holders: /^holders?\s*\(\s*[\d.,]+\s*[kKmM]?\s*\)$/i, traders: /^top\s*traders?$/i, trades: /^trades$/i }

/** The tab in the coin page's lower panel whose label matches: the smallest visible clickable element with that text. */
function panelTab(name) {
  let best = null
  for (const element of document.querySelectorAll('button, [role="tab"]')) {
    const text = (element.textContent ?? '').trim().replace(/\s+/g, ' ')
    if (!text || text.length > 24 || !tabPattern[name].test(text)) continue
    const rect = element.getBoundingClientRect()
    if (!rect.width || !rect.height) continue
    const target = element.closest('button, [role="tab"], a') ?? element
    const area = rect.width * rect.height
    if (!best || area < best.area) best = { target, area }
  }
  return best?.target ?? null
}

/** Wallets in the holders table drawn on the page: each row with one full wallet address in a link or attribute and a percentage. */
function holderRowsOnPage(pairAddress) {
  const rows = new Map()
  const address = /[1-9A-HJ-NP-Za-km-z]{32,44}/
  for (const node of document.querySelectorAll('a[href], [data-address], [data-wallet], [title]')) {
    const value = node.getAttribute('data-wallet') || node.getAttribute('data-address') || node.getAttribute('href') || node.getAttribute('title') || ''
    if (/\/(meme|token)\//.test(value)) continue
    const wallet = value.match(address)?.[0]
    if (!wallet || wallet === pairAddress || location.pathname.includes(wallet) || rows.has(wallet)) continue
    let row = node.closest('tr, [role="row"]')
    if (!row) {
      row = node
      for (let depth = 0; depth < 6 && row.parentElement && !/%/.test(row.innerText ?? ''); depth++) row = row.parentElement
    }
    const percent = (row.innerText ?? '').match(/(\d+(?:\.\d+)?)\s*%/)
    if (!percent) continue
    rows.set(wallet, { wallet, pct: Math.min(100, Number(percent[1])) })
    if (rows.size >= 150) break
  }
  return [...rows.values()]
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

/** Opens the coin page's Holders and Top Traders tabs so Axiom loads those lists, notes which addresses each one loaded, then returns to Trades. */
async function openListTabs() {
  const pairAddress = pairFromUrl()
  if (!pairAddress) return { done: false, reason: 'not on a coin page' }
  const holders = panelTab('holders')
  const traders = panelTab('traders')
  if (!holders && !traders) return { done: false, reason: 'the Holders and Top Traders tabs have not loaded yet' }
  const found = { pairAddress }
  if (holders) {
    const clickedAt = Date.now()
    holders.click()
    await wait(3000)
    found.holders = { paths: [...pathsSeen].filter(([, at]) => at >= clickedAt).map(([path]) => path).slice(0, 40), rows: holderRowsOnPage(pairAddress) }
  }
  const tradersTab = panelTab('traders')
  if (tradersTab) {
    const clickedAt = Date.now()
    tradersTab.click()
    await wait(3000)
    found.traders = { paths: [...pathsSeen].filter(([, at]) => at >= clickedAt).map(([path]) => path).slice(0, 40) }
  }
  panelTab('trades')?.click()
  tabsFound = found
  return { done: true, ok: true, holders: Boolean(found.holders), traders: Boolean(found.traders) }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'axiom-radar-open-tabs') return
  openListTabs().then(sendResponse, error => sendResponse({ done: false, reason: String(error) }))
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
  reloadOrphanedPulse()
}

/** When the extension restarts, this tab's copy of the script is cut off and the tracker stops getting Pulse coins. The Pulse tab reloads itself (at most once a minute) so the new copy takes over. */
function reloadOrphanedPulse() {
  if (!location.pathname.startsWith('/pulse')) return
  let last = 0
  try { last = Number(sessionStorage.getItem('axiom-radar-reloaded-at')) || 0 } catch { }
  if (Date.now() - last < 60_000) return
  try { sessionStorage.setItem('axiom-radar-reloaded-at', String(Date.now())) } catch { }
  setTimeout(() => location.reload(), 2_000)
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
  const { lists, probe, discover } = pairAddress ? { lists: [], probe: null, discover: null } : listReport()
  let digest = null
  if (!pairAddress && onDiscoverPage() && Date.now() - pageDigestAt >= 10000) {
    pageDigestAt = Date.now()
    try { digest = JSON.stringify(pageDigest()).slice(0, 78000) } catch { }
  }
  const tabs = tabsFound && tabsFound.pairAddress === pairAddress ? { ...(tabsFound.holders ? { holders: tabsFound.holders } : {}), ...(tabsFound.traders ? { traders: tabsFound.traders } : {}) } : null
  tabsFound = null
  const poll = pollStats
  pollStats = null
  if (!pairAddress && !batch.length && !cards.length && !pulse && !api.length && !streams.length && !lists.length && !probe && !poll) return
  const pageViewers = pairAddress ? pageEyeViewers() ?? visibleViewers() : null
  const stats = pairAddress ? pageStats() : null
  try {
    chrome.runtime.sendMessage({ type: 'axiom-radar-report', report: { url: location.href.slice(0, 500), pairAddress, pageViewers, frames: batch, cards, ...(stats ? { stats } : {}), ...(pulse ? { pulse: { usdPerSol: pulse.usdPerSol, rows: pulse.rows } } : {}), ...(api.length ? { api } : {}), ...(streams.length ? { streams } : {}), ...(lists.length ? { lists } : {}), ...(probe ? { probe } : {}), ...(discover ? { discover } : {}), ...(digest ? { digest } : {}), ...(tabs ? { tabs } : {}), ...(poll ? { poll } : {}) } }).catch(() => undefined)
  } catch {
    stopReporting()
  }
}

let pollListAt = 0

/** On the Pulse tab, asks the tracker which coins to follow and hands them to the page, which reads each one's trades feed in turn. */
function refreshPollList() {
  if (!location.pathname.startsWith('/pulse') || Date.now() - pollListAt < 5000 || !extensionAlive()) return
  pollListAt = Date.now()
  chrome.runtime.sendMessage({ type: 'axiom-radar-poll-list' }).then(answer => {
    if (Array.isArray(answer?.mints)) window.postMessage({ source: 'axiom-radar-bridge-poll', mints: answer.mints.slice(0, 60) }, window.location.origin)
  }).catch(() => undefined)
}
setInterval(refreshPollList, 5000)
refreshPollList()

const reportIfDue = () => {
  if (Date.now() - lastReportAt < reportIntervalMs) return
  try { report() } catch (error) { if (/context invalidated/i.test(String(error?.message ?? error))) stopReporting() }
}
reportTimer = setInterval(reportIfDue, reportIntervalMs)
reportObserver = new MutationObserver(reportIfDue)
reportObserver.observe(document.documentElement, { subtree: true, childList: true, characterData: true })
