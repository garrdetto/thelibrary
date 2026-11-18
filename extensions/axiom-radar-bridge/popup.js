const statusLine = document.getElementById('status')
const trackedLine = document.getElementById('tracked')
const addressInput = document.getElementById('address')
const keyInput = document.getElementById('key')
const saveLine = document.getElementById('save-status')
const cycleInput = document.getElementById('cycle')
const missingLine = document.getElementById('missing')

chrome.storage.local.get(['cycleMissing', 'missingViewers']).then(({ cycleMissing = true, missingViewers }) => {
  cycleInput.checked = cycleMissing
  missingLine.textContent = typeof missingViewers === 'number' ? `${missingViewers} tracked coin${missingViewers === 1 ? '' : 's'} not on screen in Pulse right now.` : ''
})
cycleInput.addEventListener('change', () => chrome.storage.local.set({ cycleMissing: cycleInput.checked }))

const watchInput = document.getElementById('watch')
const watchLine = document.getElementById('watch-status')
chrome.storage.local.get(['keepWatchlist', 'watchlistLast']).then(({ keepWatchlist = true, watchlistLast }) => {
  watchInput.checked = keepWatchlist
  if (watchlistLast) watchLine.textContent = `Last: ${watchlistLast.ok ? '' : 'could not '}${watchlistLast.action === 'add' ? 'star' : 'un-star'} ${watchlistLast.symbol} ${ago(watchlistLast.at)}.`
})
watchInput.addEventListener('change', () => chrome.storage.local.set({ keepWatchlist: watchInput.checked }))

function ago(timestamp) {
  const seconds = Math.round((Date.now() - timestamp) / 1000)
  return seconds < 60 ? `${seconds}s ago` : `${Math.round(seconds / 60)}m ago`
}

/** The tracker's base address from a typed port number or server address. */
function addressOf(typed) {
  const text = String(typed ?? '').trim().replace(/\/+$/, '')
  if (!text) return { base: 'http://127.0.0.1:8791', port: 8791, url: '' }
  if (/^\d+$/.test(text)) return { base: `http://127.0.0.1:${text}`, port: Number(text), url: '' }
  const url = /^https?:\/\//i.test(text) ? text : `https://${text}`
  return { base: url, port: null, url }
}

async function savedTracker() {
  const { port, trackerUrl, bridgeKey } = await chrome.storage.local.get(['port', 'trackerUrl', 'bridgeKey'])
  const base = String(trackerUrl ?? '').trim().replace(/\/+$/, '') || `http://127.0.0.1:${Number(port) || 8791}`
  const key = String(bridgeKey ?? '').trim()
  return { base, typed: trackerUrl || String(Number(port) || 8791), key, headers: key ? { Authorization: `Bearer ${key}` } : {} }
}

async function refresh() {
  const state = await chrome.storage.local.get(['lastSentAt', 'lastMatched', 'lastError', 'lastErrorAt', 'lastTripMs'])
  const saved = await savedTracker()
  if (document.activeElement !== addressInput) addressInput.value = saved.typed
  if (document.activeElement !== keyInput) keyInput.value = saved.key
  if (state.lastSentAt && (!state.lastErrorAt || state.lastSentAt > state.lastErrorAt)) {
    statusLine.className = 'ok'
    statusLine.textContent = `Sent ${ago(state.lastSentAt)}; matched ${state.lastMatched} tracked coin${state.lastMatched === 1 ? '' : 's'}.${typeof state.lastTripMs === 'number' ? ` Round trip ${state.lastTripMs} ms.` : ''}`
  } else if (state.lastError) {
    statusLine.className = 'bad'
    statusLine.textContent = state.lastError
  } else {
    statusLine.className = 'muted'
    statusLine.textContent = 'Nothing sent yet. Open an Axiom tab.'
  }
  try {
    const response = await fetch(`${saved.base}/extension/status`, { headers: saved.headers })
    if (response.status === 403) throw new Error('key')
    const result = await response.json()
    const symbols = (result.tracked || []).slice(0, 12).map(item => item.symbol).join(', ')
    trackedLine.textContent = result.tracked?.length ? `Tracker is watching ${result.tracked.length} coins: ${symbols}${result.tracked.length > 12 ? '…' : ''}` : 'Tracker is running but has no coins yet.'
  } catch (error) {
    trackedLine.textContent = error instanceof Error && error.message === 'key' ? 'The tracker turned the key down. Check it matches AXIOM_BRIDGE_KEY on the server.' : 'Tracker not reachable at this address.'
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
    const saved = await savedTracker()
    const response = await fetch(`${saved.base}/extension/sample`, { method: 'POST', headers: { ...saved.headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ samples }) })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`)
    const frameCount = samples.reduce((total, sample) => total + (sample?.frames?.length ?? 0), 0)
    const reloads = samples.filter(sample => sample?.error).length
    line.textContent = `Saved ${samples.length} tab sample(s) with ${frameCount} live messages.${reloads ? ` ${reloads} tab(s) need a reload first.` : ''}`
  } catch (error) {
    line.textContent = `Could not send the sample: ${error instanceof Error ? error.message : error}`
  }
})

document.getElementById('save').addEventListener('click', async () => {
  const address = addressOf(addressInput.value)
  if (address.port !== null && !(address.port > 0 && address.port < 65536)) {
    saveLine.textContent = 'That port is not between 1 and 65535.'
    return
  }
  if (address.url) {
    let origin
    try { origin = new URL(address.url).origin } catch {
      saveLine.textContent = 'That address could not be read.'
      return
    }
    const granted = await chrome.permissions.request({ origins: [`${origin}/*`] }).catch(() => false)
    if (!granted) {
      saveLine.textContent = 'Chrome needs your permission to send to that server. Press Save again and choose Allow.'
      return
    }
    if (keyInput.value.trim().length < 24) {
      saveLine.textContent = 'A server needs its key (AXIOM_BRIDGE_KEY, 24 characters or more).'
      return
    }
  }
  await chrome.storage.local.set({ trackerUrl: address.url, bridgeKey: keyInput.value.trim(), ...(address.port !== null ? { port: address.port } : {}), lastError: null })
  saveLine.textContent = address.url ? `Sending to ${address.url}.` : `Sending to the tracker on this computer (port ${address.port}).`
  void refresh()
})

void refresh()
