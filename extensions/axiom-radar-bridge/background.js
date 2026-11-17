const defaultPort = 8791

async function trackerPort() {
  const { port } = await chrome.storage.local.get('port')
  return Number(port) || defaultPort
}

const pinnedTabs = new Set()

chrome.runtime.onInstalled.addListener(async () => {
  const tabs = await chrome.tabs.query({ url: 'https://axiom.trade/*' }).catch(() => [])
  for (const tab of tabs) if (tab.id !== undefined) chrome.tabs.reload(tab.id).catch(() => undefined)
})

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== 'axiom-radar-report' || !sender.tab?.url?.startsWith('https://axiom.trade/')) return
  if (onShow && sender.tab.id === onShow.tabId && message.report?.stats) onShow = { ...onShow, awaitingFigures: false, gotFigures: true }
  if (sender.tab.id !== undefined && !pinnedTabs.has(sender.tab.id)) {
    pinnedTabs.add(sender.tab.id)
    chrome.tabs.update(sender.tab.id, { autoDiscardable: false }).catch(() => pinnedTabs.delete(sender.tab.id))
  }
  void (async () => {
    try {
      const send = async report => fetch(`http://127.0.0.1:${await trackerPort()}/extension/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(report),
      })
      let response = await send(message.report)
      if (response.status === 400 && (message.report?.stats || message.report?.pulse || message.report?.api || message.report?.streams || message.report?.lists || message.report?.probe)) {
        const { stats, pulse, api, streams, lists, probe, ...plain } = message.report
        response = await send(plain)
      }
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`)
      await chrome.storage.local.set({ lastSentAt: Date.now(), lastMatched: result.matched ?? 0, lastError: null })
    } catch (error) {
      await chrome.storage.local.set({ lastError: `${error instanceof Error ? error.message : error} (is the tracker running with AXIOM_COLLECTOR=extension?)`, lastErrorAt: Date.now() })
    }
  })()
})

const cycleStepMs = 6_000
const cycleMinMs = 4_000
const cycleMaxMs = 15_000
const revisitAfterMs = 45_000
const visitedAt = new Map()
let lastStepAt = 0
let onShow = null

const watchRetryMs = 30_000
const watchTriedAt = new Map()

/** Asks the coin page to set its Axiom watchlist star, retrying while the page loads, then tells the tracker how it went. */
async function runWatchJob(tabId, job) {
  const started = Date.now()
  let answer = null
  while (Date.now() - started < cycleMaxMs - 1_000) {
    await new Promise(resolve => setTimeout(resolve, 1_500))
    answer = await chrome.tabs.sendMessage(tabId, { type: 'axiom-radar-star', mint: job.mint, pairAddress: job.pairAddress, want: job.action === 'add' }).catch(() => null)
    if (answer?.done) break
  }
  if (onShow?.tabId === tabId) onShow = { ...onShow, awaitingFigures: false, gotFigures: true }
  const ok = Boolean(answer?.done && answer.ok)
  await fetch(`http://127.0.0.1:${await trackerPort()}/extension/watchlist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mint: job.mint, pairAddress: job.pairAddress, symbol: String(job.symbol ?? '').slice(0, 40), action: job.action, ok, ...(ok ? { reason: String(job.reason ?? '').slice(0, 200) } : { reason: String(answer?.reason ?? 'the star button did not load').slice(0, 200) }) }),
  }).catch(() => undefined)
  const { watchlistDone = 0 } = await chrome.storage.local.get('watchlistDone')
  await chrome.storage.local.set({ watchlistDone: watchlistDone + (ok ? 1 : 0), watchlistLast: { symbol: job.symbol, action: job.action, ok, at: Date.now() } })
}

function nextWatchJob(watchlist, now) {
  if (!watchlist) return null
  const jobs = [...(watchlist.remove ?? []).map(item => ({ ...item, action: 'remove' })), ...(watchlist.add ?? []).map(item => ({ ...item, action: 'add' }))]
  for (const [key, at] of watchTriedAt) if (now - at > 10 * 60_000) watchTriedAt.delete(key)
  return jobs.find(job => job.pairAddress && job.mint && now - (watchTriedAt.get(`${job.action}:${job.mint}`) ?? 0) > watchRetryMs) ?? null
}

async function showInCycler(pulseTab, url) {
  const tab = await existingCyclerTab()
  if (tab) {
    await chrome.tabs.update(tab.id, { url, autoDiscardable: false })
    return tab.id
  }
  const created = await chrome.tabs.create({ url, active: false, windowId: pulseTab.windowId, index: pulseTab.index + 1 })
  await chrome.storage.session.set({ cyclerTabId: created.id })
  await chrome.tabs.update(created.id, { autoDiscardable: false })
  return created.id
}

/** How long the coin page on show keeps its turn: until its holder figures arrive (they load about 6 seconds in) or 15 seconds pass, and 6 seconds when only its viewer count is wanted. */
function turnOver(now) {
  const shown = now - lastStepAt
  if (!onShow) return shown >= cycleStepMs
  if (onShow.awaitingFigures) return shown >= cycleMaxMs
  return shown >= (onShow.gotFigures ? cycleMinMs : cycleStepMs)
}

async function existingCyclerTab() {
  const { cyclerTabId } = await chrome.storage.session.get('cyclerTabId')
  if (!cyclerTabId) return null
  try { return await chrome.tabs.get(cyclerTabId) } catch { return null }
}

async function stepMissingViewers(pulseTab) {
  const now = Date.now()
  if (!turnOver(now)) return
  lastStepAt = now
  onShow = null
  const { cycleMissing = true, keepWatchlist = true } = await chrome.storage.local.get(['cycleMissing', 'keepWatchlist'])
  if (!cycleMissing && !keepWatchlist) return
  const response = await fetch(`http://127.0.0.1:${await trackerPort()}/extension/status`)
  const { missing = [], stale = [], watchlist = null } = await response.json()
  const job = keepWatchlist ? nextWatchJob(watchlist, now) : null
  if (job) {
    watchTriedAt.set(`${job.action}:${job.mint}`, now)
    visitedAt.set(job.pairAddress, now)
    const tabId = await showInCycler(pulseTab, `https://axiom.trade/meme/${job.pairAddress}`)
    onShow = { tabId, awaitingFigures: true, gotFigures: false }
    void runWatchJob(tabId, job).catch(() => undefined)
    return
  }
  if (!cycleMissing) return
  const lastVisit = item => visitedAt.get(item.pairAddress) ?? 0
  const waiting = [...missing, ...stale].filter((item, index, all) => item.pairAddress && all.findIndex(other => other.pairAddress === item.pairAddress) === index)
  const next = waiting.filter(item => now - lastVisit(item) > revisitAfterMs).sort((first, second) => lastVisit(first) - lastVisit(second))[0]
  await chrome.storage.local.set({ missingViewers: missing.length })
  if (!next) return
  visitedAt.set(next.pairAddress, now)
  for (const [pairAddress, at] of visitedAt) if (now - at > 60 * 60_000) visitedAt.delete(pairAddress)
  const awaitingFigures = stale.some(item => item.pairAddress === next.pairAddress)
  const tabId = await showInCycler(pulseTab, `https://axiom.trade/meme/${next.pairAddress}`)
  onShow = { tabId, awaitingFigures, gotFigures: false }
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== 'axiom-radar-report' || !sender.tab?.url?.startsWith('https://axiom.trade/pulse')) return
  stepMissingViewers(sender.tab).catch(() => undefined)
})
