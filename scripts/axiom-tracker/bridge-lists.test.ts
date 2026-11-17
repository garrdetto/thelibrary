import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import { applyAxiomLists, axiomListsOf, axiomListsSchema, discoverNote, discoverProbeSchema, noteDiscoverProbe, resetAxiomLists } from './axiom-lists.js'

const bridgeFile = (name: string) => readFileSync(new URL(`../../extensions/axiom-radar-bridge/${name}`, import.meta.url), 'utf8')
const letters = 'ABCDEFGHJK'
const tag = (index: number) => `${letters[Math.floor(index / 10) % 10]}${letters[index % 10]}`
const mint = (index: number) => `${'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopq'.slice(0, 38)}${tag(index)}pump`
const pair = (index: number) => `${'9RBi9qMDvwu5MznPmHUr5yKhzVJzveoM1jeULnKo'.slice(0, 40)}${tag(index)}`
/** A copy made in this realm, so values built inside the stand-in page compare equal to ones built here. */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const coin = (index: number, extra: Record<string, unknown> = {}) => ({ pairAddress: pair(index), tokenAddress: mint(index), tokenTicker: `C${index}`, tokenName: `Coin ${index}`, userCount: 100 + index, marketCap: 50 + index, ...extra })

type Listener = (event: { data: unknown }) => void

/** Runs the bridge's page hook the way Chrome does at document start, on a stand-in page. */
function loadPageHook(pathname: string) {
  const posted: Array<Record<string, any>> = []
  const intervals: Array<() => void> = []
  const workers: Array<{ url: string; listeners: Listener[] }> = []
  const fetched = new Map<string, { type: string; body: string; ok?: boolean }>()
  class FakeWorker {
    url: string
    listeners: Listener[] = []
    constructor(url: string) { this.url = url; workers.push(this) }
    addEventListener(_type: string, listener: Listener) { this.listeners.push(listener) }
    postMessage() { return undefined }
  }
  class FakeSocket {
    static CONNECTING = 0
    static OPEN = 1
    static CLOSING = 2
    static CLOSED = 3
    url: string
    listeners: Listener[] = []
    constructor(url: string) { this.url = url }
    addEventListener(_type: string, listener: Listener) { this.listeners.push(listener) }
  }
  class FakeXhr { open() { return undefined } addEventListener() { return undefined } }
  const window: Record<string, any> = {
    location: { pathname, href: `https://axiom.trade${pathname}?chain=sol`, origin: 'https://axiom.trade' },
    postMessage: (message: Record<string, any>) => { posted.push(message) },
    addEventListener: () => undefined,
    Worker: FakeWorker,
    WebSocket: FakeSocket,
    XMLHttpRequest: FakeXhr,
    fetch: (url: string) => {
      const answer = fetched.get(String(url)) ?? { type: 'application/json', body: '{}' }
      return Promise.resolve({ ok: answer.ok ?? true, status: 200, url: String(url), headers: { get: () => answer.type }, clone: () => ({ text: () => Promise.resolve(answer.body) }) })
    },
  }
  const context = vm.createContext({
    window, location: window.location, document: { addEventListener: () => undefined }, Document: class { }, setInterval: (callback: () => void) => { intervals.push(callback); return intervals.length },
    URL, TextDecoder, Blob, ArrayBuffer, Uint8Array, Promise, JSON, Date, Map, Set, Object, Array, String, Number, Boolean, RegExp, Math, console,
  })
  for (const key of ['Worker', 'WebSocket', 'XMLHttpRequest', 'fetch']) Object.defineProperty(context, key, { get: () => window[key], set: value => { window[key] = value } })
  vm.runInContext(bridgeFile('page-hook.js'), context)
  const tick = () => { posted.length = 0; for (const callback of intervals) callback() }
  const lists = () => { tick(); return plain(posted.find(message => message.source === 'axiom-radar-bridge-lists')?.sources ?? []) as Array<{ kind: string; name: string; rows: Array<Record<string, unknown>> }> }
  return { window, workers, fetched, posted, tick, lists, settle: () => new Promise(resolve => setTimeout(resolve, 5)) }
}

const batch = (table: string, operations: unknown[]) => ({ data: { type: 'OUTPUT_BATCH', messages: [{ type: 'TABLE_OPERATIONS', table, operations }] } })

test('the page hook collects coin lists from any worker table and keeps only the public coin fields', () => {
  const page = loadPageHook('/discover')
  const worker = new page.window.Worker('/workers/DiscoverWorker.unified-abc.js')
  assert.equal(page.workers.length, 1)
  const emit = (event: { data: unknown }) => { for (const listener of page.workers[0].listeners) listener(event) }
  emit(batch('trendingTokens', [{ items: Array.from({ length: 6 }, (_, index) => coin(index, { walletBalance: 5, note: { deep: true } })) }]))
  emit(batch('settings', [{ items: [{ theme: 'dark' }, { theme: 'light' }, { theme: 'dim' }] }]))
  let sources = page.lists()
  assert.deepEqual(sources.map(source => `${source.kind}:${source.name}=${source.rows.length}`), ['table:trendingTokens=6'])
  assert.deepEqual(Object.keys(sources[0].rows[0]).sort(), ['pairAddress', 'tokenAddress', 'tokenName', 'tokenTicker', 'userCount'])
  emit(batch('trendingTokens', [{ type: 'remove', pairAddress: pair(0) }, { item: coin(9) }, { pairAddress: pair(1), set: { userCount: 999, marketCap: 1 } }]))
  sources = page.lists()
  assert.equal(sources[0].rows.length, 6)
  assert.equal(sources[0].rows.find(row => row.pairAddress === pair(1))?.userCount, 999)
  assert.ok(!sources[0].rows.some(row => row.pairAddress === pair(0)))
  assert.ok(worker)
})

test('Pulse tables still feed the Pulse report and are not sent as lists', () => {
  const page = loadPageHook('/pulse')
  const worker = new page.window.Worker('/workers/PulseWorker.unified-abc.js')
  worker.postMessage({ type: 'UPDATE_USD_PER_NATIVE', payload: { chain: 'sol', usdPerNative: 70 } })
  for (const listener of page.workers[0].listeners) listener(batch('newPairs', [{ items: [coin(1), coin(2), coin(3)] }]))
  page.tick()
  const pulse = page.posted.find(message => message.source === 'axiom-radar-bridge-pulse')
  assert.equal(pulse?.rows.length, 3)
  assert.equal(pulse?.rows[0].column, 'newPairs')
  assert.equal(pulse?.usdPerSol, 70)
  assert.equal(page.posted.some(message => message.source === 'axiom-radar-bridge-lists'), false)
})

test('on a Discover page, API answers and socket messages that carry coin rows become lists; elsewhere they are left alone', async () => {
  const page = loadPageHook('/discover')
  page.fetched.set('https://api7.axiom.trade/surge-tokens?minMc=1', { type: 'application/json; charset=utf-8', body: JSON.stringify({ data: Array.from({ length: 4 }, (_, index) => coin(20 + index)) }) })
  page.fetched.set('https://api7.axiom.trade/portfolio', { type: 'application/json', body: JSON.stringify({ holdings: [{ symbol: 'x' }, { symbol: 'y' }, { symbol: 'z' }] }) })
  page.fetched.set('https://example.com/list', { type: 'application/json', body: JSON.stringify([coin(1), coin(2), coin(3)]) })
  await page.window.fetch('https://api7.axiom.trade/surge-tokens?minMc=1')
  await page.window.fetch('https://api7.axiom.trade/portfolio')
  await page.window.fetch('https://example.com/list')
  await page.settle()
  const socket = new page.window.WebSocket('wss://cluster3.axiom.trade/')
  for (const listener of socket.listeners) listener({ data: JSON.stringify({ room: 'trending-5m', content: [coin(30), coin(31), coin(32)] }) })
  for (const listener of socket.listeners) listener({ data: JSON.stringify({ room: 'chat', content: 'hello' }) })
  const sources = page.lists()
  assert.deepEqual(sources.map(source => `${source.kind}:${source.name}=${source.rows.length}`).sort(), ['api:/surge-tokens?minMc=1=4', 'socket:cluster3.axiom.trade/trending-5m=3'])
  const pulsePage = loadPageHook('/pulse')
  pulsePage.fetched.set('https://api7.axiom.trade/surge-tokens', { type: 'application/json', body: JSON.stringify([coin(1), coin(2), coin(3)]) })
  await pulsePage.window.fetch('https://api7.axiom.trade/surge-tokens')
  await pulsePage.settle()
  assert.deepEqual(pulsePage.lists(), [])
})

type FakeElement = { tag: string; attributes: Record<string, string>; parentElement: FakeElement | null; children: FakeElement[] }

function element(tag: string, attributes: Record<string, string> = {}, children: FakeElement[] = []): FakeElement {
  const node: FakeElement = { tag, attributes, parentElement: null, children }
  for (const child of children) child.parentElement = node
  return node
}

/** Runs the bridge's content script against a stand-in page and returns its helper functions. */
function loadContent(images: FakeElement[], pathname = '/discover') {
  const matches = (node: FakeElement, selector: string) => selector.split(',').map(part => part.trim()).some(part => part === 'a[href*="/meme/"]' ? node.tag === 'a' && (node.attributes.href ?? '').includes('/meme/') : part === '[role="row"]' ? node.attributes.role === 'row' : node.tag === part)
  const wrap = (node: FakeElement | null): any => node && {
    node,
    getAttribute: (name: string) => node.attributes[name] ?? null,
    get parentElement() { return wrap(node.parentElement) },
    closest: (selector: string) => { for (let current: FakeElement | null = node; current; current = current.parentElement) if (matches(current, selector)) return wrap(current); return null },
    matches: (selector: string) => matches(node, selector),
    querySelector: (selector: string) => { const visit = (current: FakeElement): FakeElement | null => { for (const child of current.children) { if (matches(child, selector)) return child; const inner = visit(child); if (inner) return inner } return null }; return wrap(visit(node)) },
  }
  const wrapped = new Map<FakeElement, any>()
  const once = (node: FakeElement | null) => { if (!node) return null; if (!wrapped.has(node)) wrapped.set(node, wrap(node)); return wrapped.get(node) }
  const stable = (node: FakeElement | null): any => {
    const proxy = once(node)
    if (!proxy) return null
    Object.defineProperty(proxy, 'parentElement', { get: () => stable(node!.parentElement), configurable: true })
    proxy.closest = (selector: string) => { for (let current: FakeElement | null = node; current; current = current.parentElement) if (matches(current, selector)) return stable(current); return null }
    return proxy
  }
  const context = vm.createContext({
    window: { addEventListener: () => undefined, postMessage: () => undefined, location: { origin: 'https://axiom.trade' } },
    location: { pathname, search: '', hash: '', href: `https://axiom.trade${pathname}` },
    document: { querySelectorAll: (selector: string) => selector === 'img[src]' ? images.map(stable) : [], body: { innerText: '' }, documentElement: {} },
    chrome: { runtime: { id: 'x', onMessage: { addListener: () => undefined }, sendMessage: () => Promise.resolve() } },
    MutationObserver: class { observe() { return undefined } disconnect() { return undefined } },
    setInterval: () => 1, clearInterval: () => undefined, setTimeout, getComputedStyle: () => ({ color: 'rgb(0, 0, 0)' }), NodeFilter: { SHOW_ELEMENT: 1 },
    Date, JSON, Map, Set, Object, Array, String, Number, Boolean, RegExp, Math, Promise, console,
  })
  vm.runInContext(bridgeFile('content.js'), context)
  return context as unknown as {
    lightness: (color: string) => number
    pickDiscoverList: (where: string, found: Record<string, { marked: boolean; light: number } | null>) => { list: string | null; how: string }
    buildLists: (sources: Array<{ kind: string; name: string; rows: unknown[] }>, tab: { list: string | null }, drawn: unknown[]) => Array<{ list: string; rows: unknown[] }>
    discoverRows: () => Array<{ tokenAddress: string; pairAddress?: string }>
  }
}

test('the content script works out which Discover list a tab shows', () => {
  const content = loadContent([])
  assert.ok(Math.abs(content.lightness('rgb(255, 255, 255)') - 1) < 1e-9)
  assert.ok(Math.abs(content.lightness('rgba(255, 255, 255, 0.5)') - 0.5) < 1e-9)
  assert.ok(Math.abs(content.lightness('oklab(0.67 -0.09 0.04)') - 0.67) < 1e-9)
  assert.ok(Math.abs(content.lightness('oklch(70% 0.1 200)') - 0.7) < 1e-9)
  assert.equal(content.lightness('transparent'), 0)
  const dim = { marked: false, light: 0.45 }
  assert.deepEqual({ ...content.pickDiscoverList('/discover?tab=surge', { trending: null, surge: null }) }, { list: 'surge', how: 'address' })
  assert.deepEqual({ ...content.pickDiscoverList('/discover/trending', { trending: null, surge: null }) }, { list: 'trending', how: 'address' })
  assert.deepEqual({ ...content.pickDiscoverList('/discover', { trending: { marked: true, light: 0.45 }, surge: dim }) }, { list: 'trending', how: 'selected tab' })
  assert.deepEqual({ ...content.pickDiscoverList('/discover', { trending: dim, surge: { marked: false, light: 0.95 } }) }, { list: 'surge', how: 'brighter tab' })
  assert.equal(content.pickDiscoverList('/discover', { trending: dim, surge: dim }).list, null)
  assert.deepEqual({ ...content.pickDiscoverList('/discover', { trending: dim, surge: null }) }, { list: 'trending', how: 'only label on the page' })
  assert.equal(content.pickDiscoverList('/discover', { trending: null, surge: null }).list, null)
})

test('a feed named for its list is sent whole, drawn rows go under the tab on show, and other feeds are never sent', () => {
  const content = loadContent([])
  const rows = (count: number, from = 0) => Array.from({ length: count }, (_, index) => ({ tokenAddress: mint(from + index), pairAddress: pair(from + index) }))
  const drawn = rows(5, 50)
  const lists = content.buildLists([{ kind: 'table', name: 'trendingTokens', rows: rows(8) }, { kind: 'api', name: '/portfolio-positions', rows: rows(4, 20) }], { list: 'surge' }, drawn)
  assert.deepEqual(plain(lists).map(item => `${item.list}=${item.rows.length}`), ['trending=8', 'surge=5'])
  assert.deepEqual(content.buildLists([{ kind: 'api', name: '/portfolio-positions', rows: rows(4) }], { list: null }, drawn).length, 0)
  assert.deepEqual(content.buildLists([], { list: 'trending' }, rows(2)).length, 0)
  assert.deepEqual(plain(content.buildLists([{ kind: 'api', name: '/surge?x=1', rows: rows(3) }, { kind: 'socket', name: 'cluster/surge-live', rows: rows(9) }], { list: 'trending' }, drawn)).map(item => `${item.list}=${item.rows.length}`), ['trending=5', 'surge=9'])
})

test('drawn rows come from the largest group of token images, with the pair from the row link', () => {
  const image = (index: number) => element('img', { src: `https://cdn.axiom.trade/tokens/${mint(index)}.webp` })
  const tickerItems = [1, 2, 3, 4].map(index => element('div', {}, [element('div', {}, [image(index)])]))
  const ticker = element('div', {}, tickerItems)
  const tableRows = [10, 11, 12, 13, 14, 15].map(index => element('a', { href: `/meme/${pair(index)}?chain=sol` }, [element('div', {}, [image(index)])]))
  const table = element('div', {}, tableRows)
  const logo = element('img', { src: 'https://axiom.trade/images/logo-9f8e7d6c5b4a39281706f5e4d3c2b1a0.png' })
  element('header', {}, [element('div', {}, [logo])])
  const images = [...tickerItems, ...tableRows].map(item => item.children[0].children[0])
  const content = loadContent([...images, logo])
  const drawn = plain(content.discoverRows())
  assert.equal(drawn.length, 6)
  assert.deepEqual(drawn.map(row => row.tokenAddress), [10, 11, 12, 13, 14, 15].map(mint))
  assert.equal(drawn[0].pairAddress, pair(10))
  assert.ok(ticker && table)
  assert.deepEqual(loadContent(images.slice(0, 2)).discoverRows().length, 0)
})

test('the tracker takes the lists and the tab report the bridge sends, and says what each Discover tab is doing', () => {
  resetAxiomLists()
  const now = 1_800_000_000_000
  const content = loadContent([])
  const lists = content.buildLists([{ kind: 'table', name: 'trendingTokens', rows: [coin(1), coin(2), coin(3)].map(({ tokenAddress, pairAddress, userCount }) => ({ tokenAddress, pairAddress, userCount })) }], { list: 'surge' }, [{ tokenAddress: mint(7) }, { tokenAddress: mint(8) }, { tokenAddress: mint(9) }])
  const parsed = axiomListsSchema.parse(JSON.parse(JSON.stringify(lists)))
  assert.equal(applyAxiomLists(parsed, now), 6)
  assert.deepEqual(axiomListsOf(mint(1), now), ['trending'])
  assert.deepEqual(axiomListsOf(mint(8), now), ['surge'])
  const probe = discoverProbeSchema.parse({ page: '/discover', tab: 'surge', how: 'selected tab', labels: 'trending 0.45, surge selected 0.95', sources: 'table:trendingTokens=3', drawn: 3 })
  assert.equal(noteDiscoverProbe(probe, now), true)
  assert.equal(noteDiscoverProbe(probe, now + 1_000), false)
  assert.equal(discoverNote(now + 2_000), 'Surge tab (selected tab): 3 coins from the 3 rows drawn; other feeds table:trendingTokens=3')
  noteDiscoverProbe({ page: '/discover', tab: null, how: 'tabs look the same', labels: 'trending 0.45, surge 0.45', sources: '', drawn: 22 }, now + 3_000)
  assert.ok(discoverNote(now + 4_000)?.includes('cannot tell which list it shows (tabs look the same'))
  assert.equal(discoverNote(now + 60_000), null)
  assert.equal(discoverProbeSchema.safeParse({ ...probe, tab: 'portfolio' }).success, false)
})
