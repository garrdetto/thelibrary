import { useCallback, useEffect, useRef, useState } from 'react'
import { FIELD_REFS } from '../../../../modules-src/shorttrack/shared/FieldRefs'
import type { FieldRef } from '../../../../modules-src/shorttrack/shared/FieldRefs'
import type { CustomScheme } from '../../../../modules-src/shorttrack/shared/PaintScheme'

type FieldState = { designs: Record<string, CustomScheme>; info: Record<string, { updatedAt: number; research: string }> }

const ENDPOINT = '/api/shorttrack-paint'

async function readError(response: Response) {
  try { return ((await response.json()) as { error?: string }).error ?? 'Something went wrong. Please try again.' } catch { return 'Something went wrong. Please try again.' }
}

async function post(body: Record<string, unknown>) {
  const response = await fetch(ENDPOINT, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!response.ok) throw new Error(await readError(response))
  return response.json() as Promise<{ scheme?: CustomScheme; research?: string; message?: string }>
}

/** A flat side view of a scheme in its own frame: t 0 (nose, left) → 1 (tail, right), s 0 (rocker) → 1.15 (window line). */
function SchemePreview({ scheme }: { scheme: CustomScheme }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const W = 360, H = 80, g = cv.getContext('2d')!
    cv.width = W; cv.height = H
    const X = (t: number) => t * W, Y = (s: number) => H - (s / 1.15) * H
    g.fillStyle = scheme.primary; g.fillRect(0, 0, W, H)
    for (const o of scheme.side) {
      switch (o.type) {
        case 'band': g.fillStyle = o.color; g.fillRect(X(o.t0), Y(o.s1), X(o.t1) - X(o.t0), Y(o.s0) - Y(o.s1)); break
        case 'poly': g.fillStyle = o.color; g.beginPath(); o.points.forEach(([t, s], i) => (i ? g.lineTo(X(t), Y(s)) : g.moveTo(X(t), Y(s)))); g.closePath(); g.fill(); break
        case 'streak': g.fillStyle = o.color; g.beginPath(); g.moveTo(X(o.t0), Y(o.s0 - o.w0 / 2)); g.lineTo(X(o.t1), Y(o.s1 - o.w1 / 2)); g.lineTo(X(o.t1), Y(o.s1 + o.w1 / 2)); g.lineTo(X(o.t0), Y(o.s0 + o.w0 / 2)); g.closePath(); g.fill(); break
        case 'dot': g.fillStyle = o.color; g.beginPath(); g.arc(X(o.t), Y(o.s), (o.r / 5.3) * W, 0, Math.PI * 2); g.fill(); break
        case 'text': g.fillStyle = o.fill; g.font = `${o.italic ? 'italic ' : ''}900 ${Math.max(7, (o.h / 0.69) * H)}px system-ui`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(o.text, X(o.t), Y(o.s)); break
        case 'logo': {
          const l = scheme.logos[o.logo], w = (o.w / 5.3) * W, h = w * 0.4
          if (!l) break
          g.fillStyle = l.bg; g.fillRect(X(o.t) - w / 2, Y(o.s) - h / 2, w, h)
          g.fillStyle = l.fg; g.font = `900 ${Math.max(6, h * 0.55)}px system-ui`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(l.text, X(o.t), Y(o.s), w * 0.9)
          break
        }
      }
    }
  }, [scheme])
  return <canvas ref={ref} className="stf-preview" aria-label={`Side view of ${scheme.name}`}/>
}

function Swatches({ scheme }: { scheme: CustomScheme }) {
  return <span className="stf-swatches" aria-hidden>{[scheme.primary, scheme.secondary, scheme.accent, scheme.num.fill].map((c, i) => <span key={i} style={{ background: c }}/>)}</span>
}

/** Admin: recreate the AI field's iconic schemes with the AI paint designer (research + design per car). */
export function FieldPaint() {
  const [state, setState] = useState<FieldState | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [queue, setQueue] = useState<string[]>([])
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [loadError, setLoadError] = useState('')

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${ENDPOINT}?field=1`, { credentials: 'same-origin', cache: 'no-store' })
      if (!response.ok) throw new Error(await readError(response))
      const data = (await response.json()) as Partial<FieldState>
      setState({ designs: data.designs ?? {}, info: data.info ?? {} })
      setLoadError('')
    } catch (error) { setLoadError(error instanceof Error ? error.message : 'The AI field could not be loaded.') }
  }, [])
  useEffect(() => { void load() }, [load])

  const designOne = useCallback(async (car: FieldRef) => {
    setBusy(car.scheme); setErrors(e => ({ ...e, [car.scheme]: '' }))
    try {
      const result = await post({ action: 'field', scheme: car.scheme, ...(notes[car.scheme]?.trim() ? { notes: notes[car.scheme].trim() } : {}) })
      if (result.scheme) setState(s => s && { designs: { ...s.designs, [car.scheme]: result.scheme! }, info: { ...s.info, [car.scheme]: { updatedAt: Date.now(), research: result.research ?? '' } } })
    } catch (error) { setErrors(e => ({ ...e, [car.scheme]: error instanceof Error ? error.message : 'That car could not be painted.' })) }
    setBusy(null)
  }, [notes])

  useEffect(() => {
    if (busy || !queue.length) return
    const [next, ...rest] = queue
    setQueue(rest)
    const car = FIELD_REFS.find(f => f.scheme === next)
    if (car) void designOne(car)
  }, [busy, queue, designOne])

  async function clear(car: FieldRef) {
    setBusy(car.scheme)
    try {
      await post({ action: 'field-clear', scheme: car.scheme })
      setState(s => { if (!s) return s; const designs = { ...s.designs }; delete designs[car.scheme]; return { ...s, designs } })
    } catch (error) { setErrors(e => ({ ...e, [car.scheme]: error instanceof Error ? error.message : 'That car could not be reset.' })) }
    setBusy(null)
  }

  const missing = FIELD_REFS.filter(f => !state?.designs[f.scheme]).map(f => f.scheme)
  return <div className="stf">
    <p className="adm-help">The AI paint designer (Claude Opus) looks up each opponent's real car on the web and recreates its paint: colors, stripes, panels, hood and roof art and number colors. Sponsors stay parodies (the real logos and names are never painted). A designed car races with its new scheme for everyone; Use hand-made goes back to the built-in scheme. Each car takes a minute or two.</p>
    <div className="stf-bar">
      <button type="button" disabled={!state || !!busy || !missing.length} onClick={() => setQueue(missing)}>Design all missing ({missing.length})</button>
      <button type="button" disabled={!state || !!busy} onClick={() => setQueue(FIELD_REFS.map(f => f.scheme))}>Redesign all</button>
      {(busy || queue.length > 0) && <span role="status">Painting #{FIELD_REFS.find(f => f.scheme === busy)?.number ?? ''}… {queue.length ? `${queue.length} waiting` : ''}</span>}
      {queue.length > 0 && <button type="button" onClick={() => setQueue([])}>Stop after this car</button>}
    </div>
    {loadError && <p className="adm-error" role="alert">{loadError}</p>}
    {!state && !loadError && <p className="adm-help">Loading the AI field…</p>}
    {state && <ul className="stf-list">
      {FIELD_REFS.map(car => {
        const scheme = state.designs[car.scheme], info = state.info[car.scheme]
        return <li key={car.scheme} className="stf-car">
          <div className="stf-head">
            <strong>#{car.number} {car.driver}</strong>
            <span className="stf-ref">{car.ref}</span>
          </div>
          {scheme ? <div className="stf-look"><SchemePreview scheme={scheme}/><Swatches scheme={scheme}/><span>{scheme.name}{info ? ` · ${new Date(info.updatedAt).toLocaleString()}` : ''}</span></div>
            : <p className="stf-ref">Hand-made scheme (not designed yet)</p>}
          <label className="stf-notes">Notes for the designer (optional)<input value={notes[car.scheme] ?? ''} maxLength={400} placeholder="e.g. use the 1998 version with the silver stripe" onChange={event => setNotes(n => ({ ...n, [car.scheme]: event.target.value }))}/></label>
          <div className="stf-actions">
            <button type="button" disabled={!!busy} onClick={() => void designOne(car)}>{busy === car.scheme ? 'Painting…' : scheme ? 'Redesign' : 'Design with AI'}</button>
            {scheme && <button type="button" disabled={!!busy} onClick={() => void clear(car)}>Use hand-made</button>}
          </div>
          {errors[car.scheme] && <p className="adm-error" role="alert">{errors[car.scheme]}</p>}
          {info?.research && <details><summary>Research notes</summary><p className="stf-research">{info.research}</p></details>}
        </li>
      })}
    </ul>}
  </div>
}
