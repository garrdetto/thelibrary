import { useEffect, useState } from 'react'
import type { ParkSession, RideComments as RideCommentsData } from '@/lib/park/session'

const MOOD_LABEL = { pos: 'Positive', mix: 'Mixed', neg: 'Negative' } as const
const MOOD_COLOR = { pos: '#4caf62', mix: '#e2b33d', neg: '#d9573f' } as const

function ago(seconds: number) {
  if (seconds < 20) return 'just now'
  if (seconds < 90) return `${Math.round(seconds)}s ago`
  return `${Math.round(seconds / 60)} min ago`
}

export function RideComments({ session, rideId }: { session: ParkSession; rideId: number }) {
  const [data, setData] = useState<RideCommentsData | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let live = true
    setLoading(true)
    const load = async () => { const next = await session.rideComments(rideId); if (live) { setData(next); setLoading(false) } }
    void load()
    const timer = setInterval(() => void load(), 3000)
    return () => { live = false; clearInterval(timer) }
  }, [session, rideId])
  const counts = data?.counts ?? { pos: 0, mix: 0, neg: 0 }
  const total = counts.pos + counts.mix + counts.neg
  return <section className="pk-comments" aria-labelledby={`pk-comments-${rideId}`}>
    <p className="pk-label" id={`pk-comments-${rideId}`}>What guests are saying</p>
    {loading && !data ? <p className="pk-hint">Listening to the crowd…</p> : !data || !data.comments.length ? <p className="pk-hint">No one has ridden yet.</p> : <>
      <div className="pk-sentiment" role="img" aria-label={(['pos', 'mix', 'neg'] as const).map(m => `${MOOD_LABEL[m]} ${total ? Math.round(counts[m] / total * 100) : 0}%`).join(', ')}>
        {(['pos', 'mix', 'neg'] as const).map(m => counts[m] ? <b key={m} style={{ width: `${counts[m] / total * 100}%`, background: MOOD_COLOR[m] }} /> : null)}
      </div>
      <p className="pk-hint pk-sentiment-key">{(['pos', 'mix', 'neg'] as const).map(m => `${MOOD_LABEL[m]} ${total ? Math.round(counts[m] / total * 100) : 0}%`).join(' · ')}</p>
      <ul className="pk-comment-list">{data.comments.map((c, i) => <li key={`${c.t}-${i}`} className={`pk-mood-${c.mood}`}><q>{c.text}</q><small>{c.who} · {ago(Math.max(0, data.now - c.t))}</small></li>)}</ul>
    </>}
  </section>
}
