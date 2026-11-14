const defaultPort = 8791

async function trackerPort() {
  const { port } = await chrome.storage.local.get('port')
  return Number(port) || defaultPort
}

const pinnedTabs = new Set()

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== 'axiom-radar-report' || !sender.tab?.url?.startsWith('https://axiom.trade/')) return
  if (sender.tab.id !== undefined && !pinnedTabs.has(sender.tab.id)) {
    pinnedTabs.add(sender.tab.id)
    chrome.tabs.update(sender.tab.id, { autoDiscardable: false }).catch(() => pinnedTabs.delete(sender.tab.id))
  }
  void (async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${await trackerPort()}/extension/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message.report),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`)
      await chrome.storage.local.set({ lastSentAt: Date.now(), lastMatched: result.matched ?? 0, lastError: null })
    } catch (error) {
      await chrome.storage.local.set({ lastError: `${error instanceof Error ? error.message : error} (is the tracker running with AXIOM_COLLECTOR=extension?)`, lastErrorAt: Date.now() })
    }
  })()
})

const cycleStepMs = 6_000
const revisitAfterMs = 45_000
const visitedAt = new Map()
let lastStepAt = 0

async function existingCyclerTab() {
  const { cyclerTabId } = await chrome.storage.session.get('cyclerTabId')
  if (!cyclerTabId) return null
  try { return await chrome.tabs.get(cyclerTabId) } catch { return null }
}

async function stepMissingViewers(pulseTab) {
  const now = Date.now()
  if (now - lastStepAt < cycleStepMs) return
  lastStepAt = now
  const { cycleMissing = true } = await chrome.storage.local.get('cycleMissing')
  if (!cycleMissing) return
  const response = await fetch(`http://127.0.0.1:${await trackerPort()}/extension/status`)
  const { missing = [] } = await response.json()
  const next = missing.find(item => item.pairAddress && now - (visitedAt.get(item.pairAddress) ?? 0) > revisitAfterMs)
  await chrome.storage.local.set({ missingViewers: missing.length })
  if (!next) return
  visitedAt.set(next.pairAddress, now)
  const url = `https://axiom.trade/meme/${next.pairAddress}`
  const tab = await existingCyclerTab()
  if (tab) {
    await chrome.tabs.update(tab.id, { url, autoDiscardable: false })
    return
  }
  const created = await chrome.tabs.create({ url, active: false, windowId: pulseTab.windowId, index: pulseTab.index + 1 })
  await chrome.storage.session.set({ cyclerTabId: created.id })
  await chrome.tabs.update(created.id, { autoDiscardable: false })
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== 'axiom-radar-report' || !sender.tab?.url?.startsWith('https://axiom.trade/pulse')) return
  stepMissingViewers(sender.tab).catch(() => undefined)
})
