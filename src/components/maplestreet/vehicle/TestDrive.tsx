import { useEffect, useRef, useState } from 'react'
import { Gauge, LoaderCircle, RotateCcw, X } from 'lucide-react'
import type { CustomVehicleRecord } from '../../../../modules-src/maplestreet/shared/CustomVehicles'

type Result = { time: number | null; targetMph: number; topMph: number; duration: number; trace: number[] }
type Message =
  | { type: 'tl-vehicle-test-result'; result: Result; targetTopMph: number }
  | { type: 'tl-vehicle-test-live'; mph: number; launch: number | null }
  | { type: 'tl-vehicle-test-error'; message: string }

const SRC = '/modules/maplestreet.html?vehicleTest=1'

export function TestDrive({ record, onClose, onResult }: { record: CustomVehicleRecord; onClose: () => void; onResult: (result: Result) => void }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [ready, setReady] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [live, setLive] = useState<{ mph: number; launch: number | null }>({ mph: 0, launch: null })
  const [error, setError] = useState<string | null>(null)
  const sent = useRef(false)

  useEffect(() => {
    function onMessage(event: MessageEvent<Message>) {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow || !event.data || typeof event.data !== 'object') return
      const data = event.data
      if (data.type === 'tl-vehicle-test-live') {
        setLive({ mph: data.mph, launch: data.launch })
        setReady(true)
        if (!sent.current) { sent.current = true; frame.current?.contentWindow?.postMessage({ type: 'tl-vehicle-test', record }, location.origin) }
      } else if (data.type === 'tl-vehicle-test-result') {
        setResult(data.result)
        onResult(data.result)
      } else if (data.type === 'tl-vehicle-test-error') setError(data.message)
    }
    addEventListener('message', onMessage)
    return () => removeEventListener('message', onMessage)
  }, [record, onResult])

  function rerun() {
    setResult(null)
    frame.current?.contentWindow?.postMessage({ type: 'tl-vehicle-test-rerun' }, location.origin)
  }

  const t = record.targets
  const timeOff = result?.time != null && Math.abs(result.time - t.zeroToSeconds) > Math.max(0.3, t.zeroToSeconds * 0.06)
  const topOff = result && Math.abs(result.topMph - t.topSpeedMph) > 2
  return <div className="ms-veh-drive" role="dialog" aria-modal="false" aria-label="Test drive">
    <header>
      <strong><Gauge size={16} aria-hidden/> Test drive · {record.name}</strong>
      <div>
        <button type="button" onClick={rerun} disabled={!ready}><RotateCcw size={14} aria-hidden/> Run again</button>
        <button type="button" onClick={onClose} aria-label="Close test drive"><X size={16} aria-hidden/></button>
      </div>
    </header>
    <div className="ms-veh-drive-body">
      <iframe ref={frame} src={SRC} title="Test drive on the game's physics" allow="autoplay"/>
      <dl className="ms-veh-drive-stats" aria-live="polite">
        <div><dt>Top speed</dt><dd className={topOff ? 'is-off' : ''}>{result ? `${result.topMph} mph` : '…'} <small>target {t.topSpeedMph} mph</small></dd></div>
        <div><dt>0–{t.zeroToMph} mph</dt><dd className={timeOff ? 'is-off' : ''}>{result ? (result.time == null ? 'not reached' : `${result.time} s`) : '…'} <small>target {t.zeroToSeconds} s</small></dd></div>
        <div><dt>Live speed</dt><dd>{live.mph.toFixed(0)} mph</dd></div>
        <div><dt>Your last 0–60</dt><dd>{live.launch == null ? '—' : `${live.launch} s`}</dd></div>
        {!result && !error && <p role="status"><LoaderCircle className="spin" size={14}/> {ready ? 'Running a full-throttle pull on the game’s physics…' : 'Loading the test pad…'}</p>}
        {result && <p>Click the view and drive with E (forward), S (reverse), A (left) and D (right); the arrow keys turn the camera, Space is the handbrake and R restarts. The numbers come from the same physics every game mode uses.</p>}
        {error && <p role="alert" className="ms-items-error">{error}</p>}
      </dl>
    </div>
  </div>
}
