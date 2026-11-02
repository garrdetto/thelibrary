import type { Park } from '../../../server/park/index.mjs'

const LIMIT_TEXT: Record<string, string> = {
  rides: 'More rides needed. Each new ride and shop raises how many guests will come.',
  land: 'Buy more land. Your park is as full as its land allows.',
  max: 'Your park has reached the largest crowd it can hold.',
  closed: 'The park is closed to new guests.',
}

export function GuestCapacity({ park }: { park: Park }) {
  const spawn = park.spawn
  if (!spawn) return null
  const cap = Math.max(0, spawn.cap)
  const pct = cap ? Math.min(100, park.guestsIn / cap * 100) : 0
  const limit = spawn.limit ?? 'rides'
  return <div className="pk-capacity">
    <div className="pk-bar"><span>Guest capacity {park.guestsIn.toLocaleString()} / {cap.toLocaleString()}</span><i><b style={{ width: `${pct}%`, background: pct > 90 ? '#e2b33d' : '#4caf62' }} /></i></div>
    <dl className="pk-dl">
      <dt>Rides and shops allow</dt><dd>{(spawn.buildCap ?? cap).toLocaleString()}</dd>
      <dt>Land allows</dt><dd>{(spawn.landCap ?? cap).toLocaleString()}</dd>
    </dl>
    <p className={`pk-hint pk-limit-${limit}`}>{LIMIT_TEXT[limit] ?? LIMIT_TEXT.rides}</p>
  </div>
}
