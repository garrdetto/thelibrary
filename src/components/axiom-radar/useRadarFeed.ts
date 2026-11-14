import { useEffect, useRef, useState } from 'react'
import type { RadarSettings } from '@/lib/axiom-radar-settings'
import type { RadarPayload, RadarTokenDetail } from '@/lib/axiom-radar-types'

export type RadarConnection = 'connecting' | 'local' | 'streaming' | 'polling' | 'error'

const localOrigin = 'http://127.0.0.1:8791'
const pollIntervalMs = 3_000
let localAvailable = false

async function fetchPayload(signal?: AbortSignal) {
  const response = await fetch('/api/admin/axiom/data', { signal, headers: { Accept: 'application/json' } })
  const result = await response.json().catch(() => ({ error: 'Axiom Radar returned an unreadable response.' }))
  if (!response.ok) throw new Error((result as { error?: string }).error ?? 'Axiom Radar is unavailable.')
  return result as RadarPayload
}

export function useRadarFeed() {
  const [payload, setPayload] = useState<RadarPayload | null>(null)
  const [connection, setConnection] = useState<RadarConnection>('connecting')
  const [error, setError] = useState('')
  const [receivedAt, setReceivedAt] = useState(0)
  const [attempt, setAttempt] = useState(0)
  const failuresRef = useRef(0)
  const savedSettingsRef = useRef<RadarSettings | null>(null)

  useEffect(() => {
    let disposed = false
    let relay: EventSource | null = null
    let local: EventSource | null = null
    let pollTimer: ReturnType<typeof setTimeout> | null = null
    let localTimer: ReturnType<typeof setTimeout> | null = null
    const controller = new AbortController()

    const accept = (next: RadarPayload) => {
      if (disposed) return
      if (next.savedSettings !== undefined) savedSettingsRef.current = next.savedSettings ?? null
      setPayload({ ...next, savedSettings: next.savedSettings ?? savedSettingsRef.current })
      setReceivedAt(Date.now())
      setError('')
      failuresRef.current = 0
    }

    const poll = async () => {
      if (disposed) return
      if (!localAvailable) {
        try {
          accept(await fetchPayload(controller.signal))
          setConnection('polling')
        } catch (failure) {
          if (disposed || controller.signal.aborted) return
          failuresRef.current += 1
          setError(failure instanceof Error ? failure.message : 'Axiom Radar is unavailable.')
          if (failuresRef.current >= 3) setConnection('error')
        }
      }
      pollTimer = setTimeout(poll, pollIntervalMs * Math.min(4, 1 + Math.floor(failuresRef.current / 3)))
    }

    const startRelay = () => {
      if (relay || disposed) return
      if (typeof EventSource === 'undefined') return void poll()
      let streamFailures = 0
      relay = new EventSource('/api/admin/axiom/stream')
      relay.onmessage = event => {
        streamFailures = 0
        try {
          const next = JSON.parse(event.data) as RadarPayload
          if (localAvailable) {
            if (next.savedSettings !== undefined) savedSettingsRef.current = next.savedSettings ?? null
            return
          }
          accept(next)
          setConnection('streaming')
        } catch { }
      }
      relay.onerror = () => {
        streamFailures += 1
        if (streamFailures >= 3 && relay) {
          relay.close()
          relay = null
          void poll()
        }
      }
    }

    const startLocal = () => {
      if (typeof EventSource === 'undefined' || disposed) return
      local = new EventSource(`${localOrigin}/live/stream`)
      local.onmessage = event => {
        try {
          const next = JSON.parse(event.data) as RadarPayload
          localAvailable = true
          accept(next)
          setConnection('local')
        } catch { }
      }
      local.onerror = () => {
        if (!localAvailable) {
          local?.close()
          local = null
          localTimer = setTimeout(startLocal, 30_000)
          return
        }
        localAvailable = false
        setConnection('streaming')
      }
    }

    fetchPayload(controller.signal)
      .then(initial => {
        accept(initial)
        startRelay()
        startLocal()
      })
      .catch(failure => {
        if (disposed || controller.signal.aborted) return
        setError(failure instanceof Error ? failure.message : 'Axiom Radar is unavailable.')
        setConnection('error')
      })

    return () => {
      disposed = true
      localAvailable = false
      controller.abort()
      relay?.close()
      local?.close()
      if (pollTimer) clearTimeout(pollTimer)
      if (localTimer) clearTimeout(localTimer)
    }
  }, [attempt])

  const applySavedSettings = (settings: RadarSettings) => {
    savedSettingsRef.current = settings
    setPayload(current => current ? { ...current, savedSettings: settings } : current)
  }

  return { payload, connection, error, receivedAt, applySavedSettings, retry: () => { setConnection('connecting'); setError(''); setAttempt(value => value + 1) } }
}

export async function fetchTokenDetail(mint: string, signal?: AbortSignal) {
  if (localAvailable) {
    try {
      const response = await fetch(`${localOrigin}/live/data?mint=${encodeURIComponent(mint)}`, { signal })
      if (response.ok) return await response.json() as RadarTokenDetail
    } catch { }
  }
  const response = await fetch(`/api/admin/axiom/data?mint=${encodeURIComponent(mint)}`, { signal })
  const result = await response.json().catch(() => ({ error: 'Unreadable response.' }))
  if (!response.ok) throw new Error((result as { error?: string }).error ?? 'Token details are unavailable.')
  return result as RadarTokenDetail
}

export async function saveRadarSettings(settings: RadarSettings) {
  const response = await fetch('/api/admin/axiom/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) })
  const result = await response.json().catch(() => ({ error: 'Unreadable response.' }))
  if (!response.ok) throw new Error((result as { error?: string }).error ?? 'Settings could not be saved.')
  return (result as { settings: RadarSettings }).settings
}
