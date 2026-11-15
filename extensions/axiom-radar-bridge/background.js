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
      if (response.status === 400 && (message.report?.stats || message.report?.pulse)) {
        const { stats, pulse, ...plain } = message.report
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
  const { cycleMissing = true } = await chrome.storage.local.get('cycleMissing')
  if (!cycleMissing) return
  const response = await fetch(`http://127.0.0.1:${await trackerPort()}/extension/status`)
  const { missing = [], stale = [] } = await response.json()
  const lastVisit = item => visitedAt.get(item.pairAddress) ?? 0
  const waiting = [...missing, ...stale].filter((item, index, all) => item.pairAddress && all.findIndex(other => other.pairAddress === item.pairAddress) === index)
  const next = waiting.filter(item => now - lastVisit(item) > revisitAfterMs).sort((first, second) => lastVisit(first) - lastVisit(second))[0]
  await chrome.storage.local.set({ missingViewers: missing.length })
  if (!next) return
  visitedAt.set(next.pairAddress, now)
  for (const [pairAddress, at] of visitedAt) if (now - at > 60 * 60_000) visitedAt.delete(pairAddress)
  const awaitingFigures = stale.some(item => item.pairAddress === next.pairAddress)
  const url = `https://axiom.trade/meme/${next.pairAddress}`
  const tab = await existingCyclerTab()
  if (tab) {
    await chrome.tabs.update(tab.id, { url, autoDiscardable: false })
    onShow = { tabId: tab.id, awaitingFigures, gotFigures: false }
    return
  }
  const created = await chrome.tabs.create({ url, active: false, windowId: pulseTab.windowId, index: pulseTab.index + 1 })
  await chrome.storage.session.set({ cyclerTabId: created.id })
  await chrome.tabs.update(created.id, { autoDiscardable: false })
  onShow = { tabId: created.id, awaitingFigures, gotFigures: false }
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== 'axiom-radar-report' || !sender.tab?.url?.startsWith('https://axiom.trade/pulse')) return
  stepMissingViewers(sender.tab).catch(() => undefined)
})
