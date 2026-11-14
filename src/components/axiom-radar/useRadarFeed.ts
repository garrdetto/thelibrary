import { useEffect, useRef, useState } from 'react'
import type { RadarPayload, RadarTokenDetail } from '@/lib/axiom-radar-types'

export type RadarConnection = 'connecting' | 'streaming' | 'polling' | 'error'

const pollIntervalMs = 3_000

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

  useEffect(() => {
    let disposed = false
    let source: EventSource | null = null
    let pollTimer: ReturnType<typeof setTimeout> | null = null
    const controller = new AbortController()

    const accept = (next: RadarPayload) => {
      if (disposed) return
      setPayload(next)
      setReceivedAt(Date.now())
      setError('')
      failuresRef.current = 0
    }

    const poll = async () => {
      if (disposed) return
      try {
        accept(await fetchPayload(controller.signal))
        setConnection('polling')
      } catch (failure) {
        if (disposed || controller.signal.aborted) return
        failuresRef.current += 1
        setError(failure instanceof Error ? failure.message : 'Axiom Radar is unavailable.')
        if (failuresRef.current >= 3) setConnection('error')
      }
      pollTimer = setTimeout(poll, pollIntervalMs * Math.min(4, 1 + Math.floor(failuresRef.current / 3)))
    }

    const startStream = () => {
      if (typeof EventSource === 'undefined') return void poll()
      let streamFailures = 0
      source = new EventSource('/api/admin/axiom/stream')
      source.onmessage = event => {
        streamFailures = 0
        try {
          accept(JSON.parse(event.data) as RadarPayload)
          setConnection('streaming')
        } catch { }
      }
      source.onerror = () => {
        streamFailures += 1
        if (streamFailures >= 3 && source) {
          source.close()
          source = null
          void poll()
        }
      }
    }

    fetchPayload(controller.signal)
      .then(initial => {
        accept(initial)
        startStream()
      })
      .catch(failure => {
        if (disposed || controller.signal.aborted) return
        setError(failure instanceof Error ? failure.message : 'Axiom Radar is unavailable.')
        setConnection('error')
      })

    return () => {
      disposed = true
      controller.abort()
      source?.close()
      if (pollTimer) clearTimeout(pollTimer)
    }
  }, [attempt])

  return { payload, connection, error, receivedAt, retry: () => { setConnection('connecting'); setError(''); setAttempt(value => value + 1) } }
}

export async function fetchTokenDetail(mint: string, signal?: AbortSignal) {
  const response = await fetch(`/api/admin/axiom/data?mint=${encodeURIComponent(mint)}`, { signal })
  const result = await response.json().catch(() => ({ error: 'Unreadable response.' }))
  if (!response.ok) throw new Error((result as { error?: string }).error ?? 'Token details are unavailable.')
  return result as RadarTokenDetail
}
