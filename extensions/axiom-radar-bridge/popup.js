const statusLine = document.getElementById('status')
const trackedLine = document.getElementById('tracked')
const portInput = document.getElementById('port')

function ago(timestamp) {
  const seconds = Math.round((Date.now() - timestamp) / 1000)
  return seconds < 60 ? `${seconds}s ago` : `${Math.round(seconds / 60)}m ago`
}

async function refresh() {
  const state = await chrome.storage.local.get(['port', 'lastSentAt', 'lastMatched', 'lastError', 'lastErrorAt'])
  const port = Number(state.port) || 8791
  portInput.value = port
  if (state.lastSentAt && (!state.lastErrorAt || state.lastSentAt > state.lastErrorAt)) {
    statusLine.className = 'ok'
    statusLine.textContent = `Sent ${ago(state.lastSentAt)}; matched ${state.lastMatched} tracked coin${state.lastMatched === 1 ? '' : 's'}.`
  } else if (state.lastError) {
    statusLine.className = 'bad'
    statusLine.textContent = state.lastError
  } else {
    statusLine.className = 'muted'
    statusLine.textContent = 'Nothing sent yet. Open an Axiom tab.'
  }
  try {
    const response = await fetch(`http://127.0.0.1:${port}/extension/status`)
    const result = await response.json()
    const symbols = (result.tracked || []).slice(0, 12).map(item => item.symbol).join(', ')
    trackedLine.textContent = result.tracked?.length ? `Tracker is watching ${result.tracked.length} coins: ${symbols}${result.tracked.length > 12 ? '…' : ''}` : 'Tracker is running but has no coins yet.'
  } catch {
    trackedLine.textContent = 'Tracker not reachable on this port.'
  }
}

document.getElementById('sample').addEventListener('click', async () => {
  const line = document.getElementById('sample-status')
  line.textContent = 'Collecting from open Axiom tabs…'
  try {
    const tabs = await chrome.tabs.query({ url: 'https://axiom.trade/*' })
    if (!tabs.length) {
      line.textContent = 'Open an axiom.trade tab first.'
      return
    }
    const samples = []
    for (const tab of tabs) {
      try {
        samples.push(await chrome.tabs.sendMessage(tab.id, { type: 'axiom-radar-collect-sample' }))
      } catch {
        samples.push({ url: tab.url, error: 'Reload this tab so the updated extension runs in it.' })
      }
    }
    const port = Number(portInput.value) || 8791
    const response = await fetch(`http://127.0.0.1:${port}/extension/sample`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ samples }) })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`)
    const frameCount = samples.reduce((total, sample) => total + (sample?.frames?.length ?? 0), 0)
    const reloads = samples.filter(sample => sample?.error).length
    line.textContent = `Saved ${samples.length} tab sample(s) with ${frameCount} live messages.${reloads ? ` ${reloads} tab(s) need a reload first.` : ''}`
  } catch (error) {
    line.textContent = `Could not send the sample: ${error instanceof Error ? error.message : error}`
  }
})

portInput.addEventListener('change', async () => {
  const port = Number(portInput.value)
  if (port > 0 && port < 65536) await chrome.storage.local.set({ port })
  void refresh()
})

void refresh()
