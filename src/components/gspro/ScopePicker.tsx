import type { GsproSession } from '@/lib/gspro/types'
import type { Scope } from './GsproApp'

const ranges = [7, 30, 90, 365, 3650]

export function ScopePicker({ scope, sessions, onScope }: { scope: Scope; sessions: GsproSession[]; onScope: (scope: Scope) => void }) {
  const value = scope.kind === 'session' ? `s:${scope.id}` : `d:${scope.days}`
  return <label className="gs-field gs-scope">
    <span>Shots from</span>
    <select value={value} onChange={event => {
      const [kind, id] = event.target.value.split(/:(.*)/s)
      onScope(kind === 's' ? { kind: 'session', id } : { kind: 'days', days: Number(id) })
    }}>
      <optgroup label="Date range">
        {ranges.map(days => <option key={days} value={`d:${days}`}>{days >= 3650 ? 'All shots' : `Last ${days} days`}</option>)}
      </optgroup>
      {sessions.length > 0 && <optgroup label="Sessions">
        {sessions.map(session => <option key={session.id} value={`s:${session.id}`}>{session.label} ({session.shotCount})</option>)}
      </optgroup>}
    </select>
  </label>
}
