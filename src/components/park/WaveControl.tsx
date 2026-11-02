import { WAVE_SETTINGS, FLAT_RIDES } from '../../../server/park/index.mjs'
import type { Entity } from '../../../server/park/index.mjs'

export function WaveControl({ ride, readOnly, onChange }: { ride: Entity; readOnly: boolean; onChange: (wave: string) => void }) {
  const current = ride.wave ?? FLAT_RIDES[ride.ride as string]?.waves ?? 'rolling'
  return <div className="pk-waves">
    <p className="pk-label" id={`pk-waves-${ride.id}`}>Waves</p>
    <div className="pk-chips" role="radiogroup" aria-labelledby={`pk-waves-${ride.id}`}>
      {Object.entries(WAVE_SETTINGS).map(([id, setting]) => <button key={id} role="radio" aria-checked={current === id} className={current === id ? 'on' : ''} disabled={readOnly} onClick={() => { if (current !== id) onChange(id) }}>{setting.name}</button>)}
    </div>
    <p className="pk-hint">Bigger waves raise excitement and intensity. Storm surf can make guests queasy.</p>
  </div>
}
