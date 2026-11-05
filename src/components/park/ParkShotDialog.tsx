import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Compass, ImageOff, LoaderCircle, X } from 'lucide-react'
import type { ParkScore } from '@/lib/park/api'
import { formatMoney } from '../../../server/park/index.mjs'

export function ParkShotDialog({ record, mapName, detail, onClose, onExplore, exploreBusy }: { record: Pick<ParkScore, 'parkName' | 'username' | 'value' | 'savedAt' | 'shot' | 'viewable'>; mapName: string; detail?: ReactNode; onClose: () => void; onExplore?: () => void; exploreBusy?: boolean }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(record.shot ? 'loading' : 'error')
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onClose() } }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); previous?.focus?.() }
  }, [onClose])

  const saved = new Date(record.savedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
  return <div className="pk-shot-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="pk-shot" role="dialog" aria-modal="true" aria-labelledby="pk-shot-title">
      <header>
        <div>
          <h2 id="pk-shot-title">{record.parkName}</h2>
          <p>{record.username} · {mapName} · {detail ?? <>Company value <strong>{formatMoney(record.value)}</strong> · saved <time dateTime={record.savedAt}>{saved}</time></>}</p>
        </div>
        <button ref={closeRef} type="button" className="pk-shot-close" onClick={onClose} aria-label="Close screenshot"><X size={18} /></button>
      </header>
      <div className="pk-shot-frame">
        {record.shot && <img src={record.shot} alt={`Overview of ${record.parkName} by ${record.username}`} hidden={status !== 'ready'} onLoad={() => setStatus('ready')} onError={() => setStatus('error')} />}
        {status === 'loading' && <p role="status"><LoaderCircle size={18} className="spin" /> Loading the screenshot…</p>}
        {status === 'error' && <p role="status"><ImageOff size={18} /> No screenshot yet. It appears after this park's next save or autosave.</p>}
      </div>
      {onExplore && record.viewable && <footer><button type="button" className="pk-btn" disabled={exploreBusy} onClick={onExplore}>{exploreBusy ? <LoaderCircle size={14} className="spin" /> : <Compass size={14} />} Walk around in 3D</button></footer>}
    </section>
  </div>
}
