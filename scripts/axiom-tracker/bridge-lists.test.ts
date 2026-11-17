import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import { applyAxiomLists, applyDiscoverPage, axiomListsOf, axiomListsSchema, discoverNote, discoverPageSchema, discoverProbeSchema, discoverSubTabs, noteDiscoverProbe, resetAxiomLists, selectedDiscoverTab } from './axiom-lists.js'
import { keepDiscoverDigest } from './extension-intake.js'

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
  const clock = { now: 1_800_000_000_000 }
  class FakeDate extends Date { static now() { return clock.now } }
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
    URL, TextDecoder, Blob, ArrayBuffer, Uint8Array, Promise, JSON, Date: FakeDate, Map, Set, Object, Array, String, Number, Boolean, RegExp, Math, console,
  })
  for (const key of ['Worker', 'WebSocket', 'XMLHttpRequest', 'fetch']) Object.defineProperty(context, key, { get: () => window[key], set: value => { window[key] = value } })
  vm.runInContext(bridgeFile('page-hook.js'), context)
  const advance = (ms: number) => { clock.now += ms }
  const tick = () => { posted.length = 0; advance(1_000); for (const callback of intervals) callback() }
  const lists = () => { tick(); return plain(posted.find(message => message.source === 'axiom-radar-bridge-lists')?.sources ?? []) as Array<{ kind: string; name: string; rows: Array<Record<string, unknown>> }> }
  const digest = () => { advance(10_000); tick(); return plain(posted.find(message => message.source === 'axiom-radar-bridge-digest')?.entries ?? []) as Array<{ key: string; shape: string; count: number }> }
  return { window, workers, fetched, posted, tick, lists, digest, advance, settle: () => new Promise(resolve => setTimeout(resolve, 5)) }
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

test('what was collected goes out on the page\'s own data events, at most once a second, so a background tab is not held to its slowed timer', () => {
  const page = loadPageHook('/pulse')
  const worker = new page.window.Worker('/workers/PulseWorker.unified-abc.js')
  worker.postMessage({ type: 'UPDATE_USD_PER_NATIVE', payload: { chain: 'sol', usdPerNative: 70 } })
  const emit = (table: string, items: unknown[]) => { for (const listener of page.workers[0].listeners) listener(batch(table, [{ items }])) }
  const pulses = () => page.posted.filter(message => message.source === 'axiom-radar-bridge-pulse').length
  emit('newPairs', [coin(1), coin(2), coin(3)])
  assert.equal(pulses(), 1, 'sent on the first data event, with no timer tick')
  emit('newPairs', [coin(1), coin(2), coin(3), coin(4)])
  assert.equal(pulses(), 1, 'not again within the same second')
  page.advance(1_000)
  emit('newPairs', [coin(1), coin(2), coin(3), coin(4), coin(5)])
  assert.equal(pulses(), 2)
  assert.equal(page.posted.filter(message => message.source === 'axiom-radar-bridge-pulse').at(-1)?.rows.length, 5)
})

test('a Discover page reports the layout of the data it receives: field names and types, never values', async () => {
  const page = loadPageHook('/discover')
  const worker = new page.window.Worker('https://axiom.trade/workers/DiscoverWorker.unified-abc.js?v=3')
  for (const listener of page.workers[0].listeners) listener(batch('hotTokens', [{ items: [coin(1), coin(2), coin(3)] }]))
  for (const listener of page.workers[0].listeners) listener({ data: { type: 'READY', version: '1.2.3' } })
  page.fetched.set('https://api7.axiom.trade/discover-list?period=5m', { type: 'application/json', body: JSON.stringify({ rows: [[pair(1), mint(1), 'SECRETNAME', 12.5, null], [pair(2), mint(2), 'OTHER', 3, null]], wallets: { [mint(9)]: { balance: 4.2 } } }) })
  await page.window.fetch('https://api7.axiom.trade/discover-list?period=5m')
  await page.settle()
  const socket = new page.window.WebSocket('wss://cluster3.axiom.trade/')
  for (const listener of socket.listeners) listener({ data: JSON.stringify({ room: 'surge-updates', content: { pair: pair(3), mc: 9 } }) })
  const entries = page.digest()
  const shapes = Object.fromEntries(entries.map(entry => [entry.key, entry.shape]))
  assert.equal(shapes['worker:DiscoverWorker.unified-abc.js started'], '{}')
  assert.equal(shapes['worker:DiscoverWorker.unified-abc.js TABLE_OPERATIONS hotTokens'], '{type, table, operations: array(1) of {items: array(3) of {pairAddress, tokenAddress, tokenTicker, tokenName, userCount, marketCap}}}')
  assert.equal(shapes['worker:DiscoverWorker.unified-abc.js READY'], '{type, version}')
  assert.equal(shapes['api:/discover-list'], '{rows: array(2) of [address, address, string(10), number, null], wallets: {<address>: {balance}}}')
  assert.equal(shapes['socket:cluster3.axiom.trade/surge-updates'], '{room, content: {pair, mc}}')
  const text = JSON.stringify(entries)
  for (const secret of ['SECRETNAME', mint(1), pair(3), '4.2', '1.2.3']) assert.ok(!text.includes(secret), secret)
  assert.ok(worker)
  const pulsePage = loadPageHook('/pulse')
  const other = new pulsePage.window.Worker('/workers/PulseWorker.unified-abc.js')
  for (const listener of pulsePage.workers[0].listeners) listener(batch('newPairs', [{ items: [coin(1), coin(2), coin(3)] }]))
  assert.deepEqual(pulsePage.digest(), [])
  assert.ok(other)
})

test('the tracker keeps the latest layout report from each Discover tab', () => {
  const now = 1_800_000_000_000
  const tab = (selected: string, feed: string) => JSON.stringify({ address: '/discover', labels: [`Trending${selected === 'Trending' ? '*' : ''}@120:0.90`, `Surge${selected === 'Surge' ? '*' : ''}@120:0.50`], counts: { rows: 30 }, feeds: [{ key: feed, shape: '{rows}', count: 4 }] })
  keepDiscoverDigest('https://axiom.trade/discover', tab('Trending', 'api:/a'), now, false)
  const snapshot = keepDiscoverDigest('https://axiom.trade/discover', tab('Surge', 'api:/b'), now + 1_000, false)
  assert.equal(snapshot?.tabs.length, 2)
  assert.equal((snapshot?.tabs[0].digest as { feeds: Array<{ key: string }> }).feeds[0].key, 'api:/b')
  assert.equal(keepDiscoverDigest('https://axiom.trade/discover', tab('Surge', 'api:/b'), now + 2_000, false)?.tabs.length, 2)
  assert.equal(keepDiscoverDigest('https://axiom.trade/discover', 'not json', now, false), null)
})

type Fake = {
  tag: string
  attributes: Record<string, string>
  children: Fake[]
  parent: Fake | null
  text: string
  box: { top: number; left: number; width: number; height: number }
  style: Record<string, string>
}

function el(tag: string, attributes: Record<string, string> = {}, children: Fake[] = [], extra: Partial<Pick<Fake, 'text' | 'box' | 'style'>> = {}): Fake {
  const node: Fake = { tag, attributes, children, parent: null, text: extra.text ?? '', box: extra.box ?? { top: 300, left: 0, width: 100, height: 40 }, style: extra.style ?? {} }
  for (const child of children) child.parent = node
  return node
}

const simple = (node: Fake, part: string) => {
  const selector = part.trim()
  if (selector === 'img[src]') return node.tag === 'img' && 'src' in node.attributes
  if (selector === 'a[href*="/meme/"]') return node.tag === 'a' && (node.attributes.href ?? '').includes('/meme/')
  if (selector === 'i.ri-eye-line') return node.tag === 'i' && (node.attributes.class ?? '').includes('ri-eye-line')
  const role = selector.match(/^\[role="([a-z]+)"\]$/)
  if (role) return node.attributes.role === role[1]
  return node.tag === selector
}
const matchesAny = (node: Fake, selector: string) => selector.split(',').some(part => simple(node, part))
const below = (node: Fake): Fake[] => node.children.flatMap(child => [child, ...below(child)])
const textOf = (node: Fake): string => node.text + node.children.map(textOf).join('')

/** Runs the bridge's content script against a stand-in page built from `root` and returns its helper functions. */
function loadContent(root: Fake, pathname = '/discover') {
  const wrapped = new Map<Fake, any>()
  const wrap = (node: Fake | null): any => {
    if (!node) return null
    const known = wrapped.get(node)
    if (known) return known
    const proxy = {
      tagName: node.tag.toUpperCase(),
      get parentElement() { return wrap(node.parent) },
      get childElementCount() { return node.children.length },
      get textContent() { return textOf(node) },
      get innerText() { return textOf(node) },
      get className() { return node.attributes.class ?? '' },
      get attributes() { return Object.entries(node.attributes).map(([name, value]) => ({ name, value })) },
      getAttribute: (name: string) => node.attributes[name] ?? null,
      getBoundingClientRect: () => node.box,
      matches: (selector: string) => matchesAny(node, selector),
      closest: (selector: string) => { for (let current: Fake | null = node; current; current = current.parent) if (matchesAny(current, selector)) return wrap(current); return null },
      querySelector: (selector: string) => wrap(below(node).find(child => matchesAny(child, selector)) ?? null),
      querySelectorAll: (selector: string) => below(node).filter(child => matchesAny(child, selector)).map(wrap),
      fake: node,
    }
    wrapped.set(node, proxy)
    return proxy
  }
  const document = wrap(root)
  const context = vm.createContext({
    window: { addEventListener: () => undefined, postMessage: () => undefined, location: { origin: 'https://axiom.trade' } },
    location: { pathname, search: '', hash: '', href: `https://axiom.trade${pathname}` },
    document: { querySelectorAll: document.querySelectorAll, querySelector: document.querySelector, body: { innerText: '' }, documentElement: {} },
    chrome: { runtime: { id: 'x', onMessage: { addListener: () => undefined }, sendMessage: () => Promise.resolve() } },
    MutationObserver: class { observe() { return undefined } disconnect() { return undefined } },
    setInterval: () => 1, clearInterval: () => undefined, setTimeout, NodeFilter: { SHOW_ELEMENT: 1 },
    getComputedStyle: (proxy: { fake: Fake }) => ({ color: 'rgb(0, 0, 0)', fontWeight: '400', fontSize: '14px', opacity: '1', textDecorationLine: 'none', backgroundColor: 'rgba(0, 0, 0, 0)', borderBottomColor: 'rgb(0, 0, 0)', borderBottomWidth: '0px', ...proxy.fake.style }),
    Date, JSON, Map, Set, Object, Array, String, Number, Boolean, RegExp, Math, Promise, console,
  })
  vm.runInContext(bridgeFile('content.js'), context)
  return context as unknown as {
    lightness: (color: string) => number
    pickDiscoverList: (where: string, found: Record<string, { marked: boolean; light: number } | null>) => { list: string | null; how: string }
    buildLists: (sources: Array<{ kind: string; name: string; rows: unknown[] }>, tab: { list: string | null }, drawn: unknown[]) => Array<{ list: string; rows: unknown[] }>
    discoverRows: (minTop?: number) => Array<{ tokenAddress: string; pairAddress?: string; userCount?: number }>
    subTabs: () => Array<{ text: string; top: number; left: number; height: number; marked: boolean; look: string; classes: string }>
  }
}

const tabLabel = (text: string, left: number, style: Record<string, string> = {}, top = 88, badge = false) =>
  el('button', { class: `tab ${style.color ? 'tab-on' : 'tab-off'}` }, [el('span', {}, [], { text, box: { top, left, width: 50, height: 20 }, style }), ...(badge ? [el('span', { class: 'badge' }, [], { text: 'New', box: { top, left: left + 52, width: 20, height: 12 }, style: { fontSize: '9px' } })] : [])], { box: { top: top - 4, left: left - 8, width: badge ? 90 : 66, height: 28 }, style })

/** A stand-in Discover page: nav, the sub-tab row with `selected` drawn brighter, a ticker of recently viewed coins, and a grid of coin cards. */
function discoverPage(selected: string, cards: number[], ticker: number[] = [1, 2, 3, 4]) {
  const nav = el('nav', {}, ['Discover', 'Pulse', 'Trackers', 'Portfolio'].map((text, index) => el('a', { href: '/x' }, [], { text, box: { top: 16, left: 100 + index * 90, width: 70, height: 20 } })))
  const tabs = el('div', {}, [['Top', 0], ['Surge', 1], ['Callouts', 2], ['Streamers', 3]].map(([text, index]) => tabLabel(String(text), 40 + Number(index) * 90, text === selected ? { color: 'rgb(255, 255, 255)', fontWeight: '600' } : { color: 'rgb(120, 124, 130)' }, 88, text === 'Streamers')))
  const image = (index: number) => el('img', { src: `https://axiom-sol-v2.sfo3.cdn.digitaloceanspaces.com/${mint(index)}.webp` })
  const recents = el('div', {}, ticker.map(index => el('div', {}, [el('div', {}, [image(index)])], { box: { top: 50, left: index * 60, width: 50, height: 24 } })))
  const card = (index: number, row: number) => el('div', { class: 'card' }, [
    el('div', {}, [el('div', {}, [image(index)]), el('div', {}, [image(index)])]),
    el('div', {}, [el('span', {}, [], { text: `Coin ${index}` }), el('span', {}, [el('i', { class: 'ri-eye-line' }), el('span', {}, [], { text: String(200 + index) })])]),
  ], { box: { top: 187 + row * 186, left: 0, width: 300, height: 170 } })
  const grid = el('div', { class: 'grid' }, cards.map((index, position) => card(index, Math.floor(position / 4))))
  return el('body', {}, [nav, tabs, recents, grid])
}

test('the content script reads the sub-tab row and how each tab is drawn', () => {
  const content = loadContent(discoverPage('Surge', [10, 11, 12, 13, 14, 15]))
  const tabs = plain(content.subTabs())
  assert.ok(tabs.some(tab => tab.text === 'Top') && tabs.some(tab => tab.text === 'Surge') && tabs.some(tab => tab.text === 'Callouts'))
  assert.ok(!tabs.some(tab => tab.text === 'Pulse'), 'the main navigation is not part of the sub-tab row')
  const surge = tabs.find(tab => tab.text === 'Surge')
  const top = tabs.find(tab => tab.text === 'Top')
  assert.ok(surge?.look.startsWith('600|14px|rgb(255, 255, 255)'), surge?.look)
  assert.notEqual(surge?.look, top?.look)
  assert.equal(tabs.find(tab => tab.text === 'Callouts')?.look, top?.look)
  assert.equal(surge?.classes, 'tab tab-on')
  const selected = selectedDiscoverTab(tabs)
  assert.equal(selected?.tab.text, 'Surge')
  assert.equal(selected?.list, 'surge')
  assert.equal(selectedDiscoverTab(plain(loadContent(discoverPage('Top', [10, 11, 12])).subTabs()))?.list, 'trending')
  assert.equal(selectedDiscoverTab(plain(loadContent(discoverPage('Callouts', [10, 11, 12])).subTabs()))?.list, null)
  assert.equal(selectedDiscoverTab(plain(loadContent(discoverPage('Callouts', [10, 11, 12])).subTabs()))?.tab.text, 'Callouts')
})

test('the selected sub-tab is the one drawn unlike the rest; when none stands out the tracker does not guess', () => {
  const tab = (text: string, look: string, extra: Partial<{ marked: boolean; classes: string; top: number; height: number }> = {}) => ({ text, top: 88, left: 0, height: 20, marked: false, look, classes: 'tab', ...extra })
  const dim = '400|14px|rgb(120, 124, 130)|1|none|rgba(0, 0, 0, 0)|rgb(0, 0, 0)|0px|rgb(120, 124, 130)'
  const bright = dim.replaceAll('rgb(120, 124, 130)', 'rgb(255, 255, 255)')
  assert.equal(selectedDiscoverTab([tab('Top', bright), tab('Surge', dim), tab('Callouts', dim), tab('Streamers', dim)])?.list, 'trending')
  assert.equal(selectedDiscoverTab([tab('Top', dim), tab('Surge', dim), tab('Callouts', dim), tab('Streamers', dim)]), null)
  assert.equal(selectedDiscoverTab([tab('Top', dim), tab('Surge', dim, { marked: true }), tab('Callouts', dim)])?.how, 'marked selected')
  assert.equal(selectedDiscoverTab([tab('Top', dim), tab('Surge', dim, { classes: 'tab text-primary' }), tab('Callouts', dim), tab('Streamers', dim)])?.how, 'styled unlike the other tabs')
  assert.equal(selectedDiscoverTab([tab('Top', dim), tab('Surge', dim, { top: 86, height: 24 }), tab('Callouts', dim), tab('Streamers', dim)])?.how, 'sits unlike the other tabs')
  assert.equal(selectedDiscoverTab([tab('Top', bright), tab('Surge', dim), tab('Callouts', dim), tab('Streamers', dim), tab('New', '700|9px|x'), tab('StreamersNew', '500|14px|y')])?.tab.text, 'Top', 'a badge and a tab with its badge attached are left out')
  assert.equal(selectedDiscoverTab([tab('Top', bright), tab('Surge', dim)]), null, 'two tabs cannot show which is the odd one')
  assert.equal(selectedDiscoverTab([]), null)
})

test("the labels Axiom's live Discover page reported: Surge is selected, and labels from outside the tab row are ignored", () => {
  const grey = 'rgb(130, 133, 152)'
  const white = 'rgb(252, 252, 252)'
  const rest = '1|none|rgba(0, 0, 0, 0)|rgb(229, 231, 235)|0px|rgb(252, 252, 252)'
  const row = 'flex flex-row h-[32px] gap-[24px] justify-start items-center'
  const label = (text: string, top: number, left: number, height: number, look: string, classes = row) => ({ text, top, left, height, marked: false, look, classes })
  const reported = (selected: 'Top' | 'Surge' | 'Callouts') => [
    label('All', 140, 202, 32, `500|12px|${grey}|${rest}`, 'relative flex items-center justify-center rounded-full'),
    label('Top', 89, 250, 30, `500|20px|${selected === 'Top' ? white : grey}|${rest}`),
    label('Early', 144, 263, 24, `500|16px|${white}|${rest}`, 'text-[16px] font-medium'),
    label('Surge', 91, 306, 27, `500|18px|${selected === 'Surge' ? white : grey}|${rest}`, 'flex flex-row h-[36px] justify-center items-center cursor-pointer group'),
    label('Callouts', 89, 402, 30, `500|20px|${selected === 'Callouts' ? white : grey}|${rest}`),
    label('StreamersNew', 89, 502, 30, `400|16px|${white}|${rest}`),
    label('Streamers', 89, 502, 30, `500|20px|${grey}|${rest}`),
    label('New', 82, 586, 7, `700|8px|rgb(226, 192, 75)|0|none|rgba(0, 0, 0, 0)|rgb(229, 231, 235)|0px|${white}`),
    label('Surging', 300, 420, 18, `500|12px|${white}|${rest}`, 'badge'),
    label('bought more', 302, 520, 18, `400|12px|${grey}|${rest}`, 'feed'),
    label('Quick Buy', 298, 700, 24, `500|12px|${white}|${rest}`, 'button'),
  ]
  assert.deepEqual(discoverSubTabs(reported('Surge')).map(tab => tab.text), ['Top', 'Surge', 'Callouts', 'Streamers'])
  const surge = selectedDiscoverTab(reported('Surge'))
  assert.equal(surge?.tab.text, 'Surge')
  assert.equal(surge?.list, 'surge')
  assert.equal(surge?.how, 'its text is a different colour from the other tabs')
  assert.equal(selectedDiscoverTab(reported('Top'))?.list, 'trending')
  assert.equal(selectedDiscoverTab(reported('Callouts'))?.tab.text, 'Callouts')
  assert.equal(selectedDiscoverTab(reported('Callouts'))?.list, null)
  resetAxiomLists()
  const now = 1_800_000_000_000
  const coins = [50, 51, 52, 53].map(index => ({ tokenAddress: mint(index), userCount: 100 + index }))
  const first = applyDiscoverPage({ tabs: reported('Surge'), coins }, [], now)
  assert.equal(first.status.list, 'surge')
  assert.equal(first.changed, true)
  const withOtherCardLabels = reported('Surge').map(tab => tab.text === 'bought more' ? { ...tab, text: 'added liquidity' } : tab)
  assert.equal(applyDiscoverPage({ tabs: withOtherCardLabels, coins }, [], now + 1_000).changed, false, 'card labels changing every second do not make a new status')
  assert.deepEqual(axiomListsOf(mint(52), now + 1_000), ['surge'])
})

test('drawn coins come from the largest group of cards, with viewer counts, ignoring the ticker above the tabs', () => {
  const content = loadContent(discoverPage('Surge', [10, 11, 12, 13, 14, 15], [1, 2, 3, 4, 5, 6, 7, 8]))
  const all = plain(content.discoverRows())
  assert.equal(all.length, 8, 'without a floor the larger ticker group would win')
  const drawn = plain(content.discoverRows(84))
  assert.deepEqual(drawn.map(row => row.tokenAddress), [10, 11, 12, 13, 14, 15].map(mint))
  assert.deepEqual(drawn.map(row => row.userCount), [210, 211, 212, 213, 214, 215])
  assert.deepEqual(plain(loadContent(discoverPage('Surge', [10, 11])).discoverRows(84)), [])
})

test('the content script works out which Discover list a tab shows', () => {
  const content = loadContent(el('body'))
  assert.ok(Math.abs(content.lightness('rgb(255, 255, 255)') - 1) < 1e-9)
  assert.ok(Math.abs(content.lightness('rgba(255, 255, 255, 0.5)') - 0.5) < 1e-9)
  assert.ok(Math.abs(content.lightness('oklab(0.67 -0.09 0.04)') - 0.67) < 1e-9)
  assert.ok(Math.abs(content.lightness('oklch(70% 0.1 200)') - 0.7) < 1e-9)
  assert.equal(content.lightness('transparent'), 0)
  const dim = { marked: false, light: 0.45 }
  assert.deepEqual({ ...content.pickDiscoverList('/discover?tab=surge', { trending: null, surge: null }) }, { list: 'surge', how: 'address' })
  assert.deepEqual({ ...content.pickDiscoverList('/discover', { trending: { marked: true, light: 0.45 }, surge: dim }) }, { list: 'trending', how: 'selected tab' })
  assert.deepEqual({ ...content.pickDiscoverList('/discover', { trending: dim, surge: { marked: false, light: 0.95 } }) }, { list: 'surge', how: 'brighter tab' })
  assert.equal(content.pickDiscoverList('/discover', { trending: dim, surge: dim }).list, null)
})

test('a feed named for its list is sent whole, drawn rows go under the tab on show, and other feeds are never sent', () => {
  const content = loadContent(el('body'))
  const rows = (count: number, from = 0) => Array.from({ length: count }, (_, index) => ({ tokenAddress: mint(from + index), pairAddress: pair(from + index) }))
  const drawn = rows(5, 50)
  const lists = content.buildLists([{ kind: 'table', name: 'trendingTokens', rows: rows(8) }, { kind: 'api', name: '/portfolio-positions', rows: rows(4, 20) }], { list: 'surge' }, drawn)
  assert.deepEqual(plain(lists).map(item => `${item.list}=${item.rows.length}`), ['trending=8', 'surge=5'])
  assert.deepEqual(content.buildLists([{ kind: 'api', name: '/portfolio-positions', rows: rows(4) }], { list: null }, drawn).length, 0)
  assert.deepEqual(content.buildLists([], { list: 'trending' }, rows(2)).length, 0)
})

test('the tracker takes a Discover tab: the coins on Top or Surge join that list, other sub-tabs are left alone', () => {
  resetAxiomLists()
  const now = 1_800_000_000_000
  const page = (selected: string, cards: number[]) => {
    const content = loadContent(discoverPage(selected, cards))
    const tabs = plain(content.subTabs())
    return discoverPageSchema.parse({ tabs, coins: plain(content.discoverRows(Math.min(...tabs.map(tab => tab.top)))) })
  }
  const surge = applyDiscoverPage(page('Surge', [10, 11, 12, 13]), [{ mint: mint(13), viewers: 999 }, { mint: mint(20), viewers: 5 }, { mint: null, viewers: 1 }], now)
  assert.equal(surge.status.list, 'surge')
  assert.equal(surge.status.coins, 5)
  assert.equal(surge.changed, true)
  assert.deepEqual(axiomListsOf(mint(10), now), ['surge'])
  assert.deepEqual(axiomListsOf(mint(20), now), ['surge'])
  assert.equal(applyDiscoverPage(page('Surge', [10, 11, 12, 13]), [], now + 1_000).changed, false)
  const top = applyDiscoverPage(page('Top', [10, 30, 31]), [], now + 2_000)
  assert.equal(top.status.list, 'trending')
  assert.deepEqual(axiomListsOf(mint(10), now + 2_000), ['trending', 'surge'])
  assert.equal(discoverNote(now + 3_000), "Surge (Axiom's Surge tab is selected: its text is a different colour from the other tabs): 4 coins read | Trending (Axiom's Top tab is selected: its text is a different colour from the other tabs): 3 coins read")
  const callouts = applyDiscoverPage(page('Callouts', [40, 41, 42]), [], now + 4_000)
  assert.equal(callouts.status.list, null)
  assert.deepEqual(axiomListsOf(mint(40), now + 4_000), [])
  assert.ok(discoverNote(now + 5_000)?.includes('A Discover tab is on Callouts, which is not a coin list the tracker follows'))
  const unclear = applyDiscoverPage({ tabs: page('Surge', [10, 11, 12]).tabs.map(tab => ({ ...tab, look: 'same', classes: 'same', top: 88, height: 20 })), coins: [{ tokenAddress: mint(50) }, { tokenAddress: mint(51) }, { tokenAddress: mint(52) }] }, [], now + 40_000)
  assert.equal(unclear.status.list, null)
  assert.deepEqual(axiomListsOf(mint(50), now + 40_000), [])
  assert.ok(discoverNote(now + 41_000)?.startsWith('A Discover tab is open but no sub-tab stands out as selected: Top [same]'))
  const probe = discoverProbeSchema.parse({ page: '/discover', tab: 'surge', how: 'selected tab', labels: 'x', sources: '', drawn: 3 })
  assert.equal(noteDiscoverProbe(probe, now), true)
  assert.equal(noteDiscoverProbe(probe, now + 1_000), false)
  assert.equal(axiomListsSchema.safeParse([{ list: 'surge', rows: [] }]).success, true)
  assert.equal(applyAxiomLists([{ list: 'surge', rows: [{ tokenAddress: mint(60) }] }], now), 1)
})
