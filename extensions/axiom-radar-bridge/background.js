const defaultPort = 8791

async function trackerPort() {
  const { port } = await chrome.storage.local.get('port')
  return Number(port) || defaultPort
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== 'axiom-radar-report' || !sender.tab?.url?.startsWith('https://axiom.trade/')) return
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
