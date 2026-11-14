import { useCallback, useEffect, useRef, useState } from 'react'
import type { BotCommand, BotSettings, BotValues, BotView } from '@/lib/axiom-bot'

const pollMs = 5_000

async function call<T>(path: string, init?: { method: string; body: unknown }): Promise<T> {
  const response = await fetch(path, init ? { method: init.method, headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(init.body) } : { headers: { Accept: 'application/json' } })
  const body = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) throw new Error(body.error ?? 'The paper-trading bot could not be reached. Try again.')
  return body
}

/** Polls the bot's dials and last report from the site, and saves dials and commands for the bot to pick up. A save sends only the dials given; the site keeps the rest. */
export function useBot() {
  const [view, setView] = useState<BotView | null>(null)
  const [error, setError] = useState('')
  const [receivedAt, setReceivedAt] = useState(0)
  const alive = useRef(true)

  const refresh = useCallback(async () => {
    try {
      const next = await call<BotView>('/api/admin/axiom/bot')
      if (!alive.current) return
      setView(next)
      setReceivedAt(Date.now())
      setError('')
    } catch (failure) {
      if (alive.current) setError(failure instanceof Error ? failure.message : 'The paper-trading bot could not be reached. Try again.')
    }
  }, [])

  useEffect(() => {
    alive.current = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const loop = async () => {
      if (!document.hidden) await refresh()
      if (alive.current) timer = setTimeout(loop, pollMs)
    }
    void loop()
    return () => {
      alive.current = false
      clearTimeout(timer)
    }
  }, [refresh])

  const saveSettings = useCallback(async (values: BotValues) => {
    const { settings } = await call<{ settings: BotSettings }>('/api/admin/axiom/bot/settings', { method: 'PUT', body: { values } })
    setView(current => current && { ...current, settings })
    return settings
  }, [])

  const sendCommand = useCallback(async (action: keyof BotCommand) => {
    const { command } = await call<{ command: BotCommand }>('/api/admin/axiom/bot/command', { method: 'POST', body: { action } })
    setView(current => current && { ...current, command })
  }, [])

  return { view, error, receivedAt, loading: view === null && !error, refresh, saveSettings, sendCommand }
}
