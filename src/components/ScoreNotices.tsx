import { useCallback, useEffect, useState } from 'react'
import { Trophy, X } from 'lucide-react'
import { isModuleAvailable, learningModules } from '@/lib/modules'
import type { ModuleId } from '@/lib/modules'

type Notice = { game: string; title: string; detail: string | null; by: string; place: number; date: string }

const ordinal = (place: number) => place === 1 ? '1st' : place === 2 ? '2nd' : place === 3 ? '3rd' : `${place}th`

export function ScoreNotices({ username, onOpen }: { username: string; onOpen: (id: ModuleId) => void }) {
  const [notices, setNotices] = useState<Notice[]>([])
  const [error, setError] = useState('')

  const load = useCallback(() => {
    fetch('/api/score-notices', { credentials: 'same-origin', cache: 'no-store' })
      .then(response => response.ok ? response.json() as Promise<{ notices?: Notice[] }> : null)
      .then(result => { if (result) setNotices(result.notices ?? []) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    load()
    window.addEventListener('focus', load)
    return () => window.removeEventListener('focus', load)
  }, [load, username])

  async function clear(game?: string) {
    const before = notices
    setError('')
    setNotices(current => game ? current.filter(item => item.game !== game) : [])
    try {
      const response = await fetch('/api/score-notices', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(game ? { action: 'clear', game } : { action: 'clear' }) })
      if (!response.ok) throw new Error()
    } catch {
      setNotices(before)
      setError('The notification could not be cleared. Please try again.')
    }
  }

  if (!notices.length && !error) return null
  return <section className="score-notices" aria-label="Leaderboard notifications" aria-live="polite">
    {notices.map(notice => {
      const module = learningModules.find(item => item.id === notice.game && isModuleAvailable(item.id))
      return <div key={notice.game} className="score-notice" role="status">
        <Trophy size={17} aria-hidden="true"/>
        <p><strong>{notice.by}</strong> has knocked you out of {ordinal(notice.place)} place on {module ? <button type="button" className="score-notice-link" onClick={() => onOpen(module.id)}>{notice.title}</button> : notice.title}!{notice.detail && <small>{notice.detail}</small>}</p>
        <button type="button" className="score-notice-close" onClick={() => void clear(notice.game)} aria-label={`Clear the ${notice.title} notification`}><X size={16}/></button>
      </div>
    })}
    {notices.length > 1 && <button type="button" className="score-notice-clear" onClick={() => void clear()}>Clear all notifications</button>}
    {error && <p className="score-notice-error" role="alert">{error}</p>}
  </section>
}
