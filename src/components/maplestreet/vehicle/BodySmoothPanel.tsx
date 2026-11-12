import { useState } from 'react'
import type { MutableRefObject } from 'react'
import { Check, Eye, Lasso, Maximize2, Minimize2, ScanSearch, Sparkles, SquareDashed, SunMedium, Undo2, WandSparkles, X } from 'lucide-react'
import { DEFAULT_SMOOTH, SMOOTH_LIMITS, SMOOTH_METHODS } from './bodySmooth'
import type { DetectReport, Px, SelectionReport, SmoothMethod, SmoothSettings } from './bodySmooth'
import type { SmootherApi } from './DentSmoother'

type Status = { tone: 'ok' | 'error'; text: string } | null

const DEFAULT_BUMP_MM = 2
const pct = (share: number) => share < 0.01 && share > 0 ? 'under 1%' : `${Math.round(share * 100)}%`
const mm = (value: number) => value < 10 ? value.toFixed(1) : String(Math.round(value))

function Slider({ label, value, onChange, min, max, step, display }: { label: string; value: number; onChange: (value: number) => void; min: number; max: number; step: number; display: string }) {
  return <label className="ms-veh-slider">{label} <output>{display}</output><input type="range" min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))}/></label>
}

/** The Body step's state, shared by the vehicle and race car editors; the editor draws the lasso overlay with `closeLasso`. */
export function useBodySmoothing(smoother: MutableRefObject<SmootherApi | null>, setStatus: (status: Status) => void, onBodyChanged: () => void) {
  const [lasso, setLasso] = useState(false)
  const [selection, setSelection] = useState<SelectionReport | null>(null)
  const [smooth, setSmooth] = useState<SmoothSettings>(DEFAULT_SMOOTH)
  const [scan, setScan] = useState<DetectReport | null>(null)
  const [heat, setHeat] = useState<{ spots: number; share: number } | null>(null)
  const [bumpMm, setBumpMm] = useState(DEFAULT_BUMP_MM)
  const [busy, setBusy] = useState<string | null>(null)

  const run = <T,>(label: string, work: () => T, done: (result: T) => void) => {
    setBusy(label)
    window.setTimeout(() => {
      try { done(work()) } catch (error) { setStatus({ tone: 'error', text: (error as Error).message || 'The body could not be smoothed.' }) } finally { setBusy(null) }
    }, 30)
  }

  const refreshHeat = () => { const api = smoother.current; if (api && heat) setHeat(api.showHeat(bumpMm)) }

  function picked(report: SelectionReport, empty: string) {
    if (!report.vertices) { setSelection(null); setStatus({ tone: 'error', text: empty }); return false }
    setStatus(null)
    setSelection(report)
    smoother.current?.preview(smooth)
    return true
  }

  function closeLasso(polygon: Px[]) {
    setLasso(false)
    const api = smoother.current
    if (!api) return
    picked(api.select(polygon, smooth.featherPx), 'Nothing inside that loop faces the camera. Turn the preview so the dent faces you and draw the loop over the body itself.')
  }

  function tune(changes: Partial<SmoothSettings>) {
    const next = { ...smooth, ...changes }
    next.passes = Math.min(SMOOTH_METHODS[next.method].passesMax, next.passes)
    setSmooth(next)
    if (smoother.current?.hasSelection) smoother.current.preview(next)
  }

  function reset() { setLasso(false); setSelection(null); setScan(null); setHeat(null) }

  return { lasso, setLasso, selection, setSelection, closeLasso, reset, panel: { smoother, lasso, setLasso, selection, setSelection, smooth, tune, scan, setScan, heat, setHeat, bumpMm, setBumpMm, busy, run, picked, refreshHeat, setStatus, onBodyChanged, setSmooth } }
}

type PanelState = ReturnType<typeof useBodySmoothing>['panel']

export function BodySmoothPanel({ state, disabled, onStartLasso, savedNote }: { state: PanelState; disabled: boolean; onStartLasso: () => void; savedNote: string }) {
  const { smoother, lasso, setLasso, selection, setSelection, smooth, tune, scan, setScan, heat, setHeat, bumpMm, setBumpMm, busy, run, picked, refreshHeat, setStatus, onBodyChanged, setSmooth } = state
  const [comparing, setComparing] = useState(false)
  const api = smoother.current
  const bodyEdits = api?.edits ?? 0
  const undoDepth = api?.undoDepth ?? 0
  const off = disabled || !!busy

  function autoSmooth() {
    if (!api) return
    run('auto', () => api.autoPlan(smooth), plan => {
      if (!plan) { setSelection(null); setStatus({ tone: 'ok', text: 'No rough areas found: this body is already smooth at this crease angle.' }); return }
      setSmooth(plan.settings)
      setSelection(plan.selection)
      if (heat) refreshHeat()
      setStatus({ tone: 'ok', text: `Auto smooth found rough surface on about ${pct(plan.share)} of the body (typical bump ${mm(plan.typicalMm)} mm) and is previewing an edge-keeping clean-up there. Keep it, adjust the sliders, or clear it.` })
    })
  }

  function scanBody() {
    if (!api) return
    run('scan', () => { const report = api.analyse(smooth.creaseDeg); return { report, shown: api.showHeat(bumpMm) } }, ({ report, shown }) => {
      setSelection(null); setScan(report); setHeat(shown)
    })
  }

  function setThreshold(value: number) {
    setBumpMm(value)
    if (api && heat) setHeat(api.showHeat(value))
  }

  function toggleHeat(show: boolean) {
    if (!api) return
    if (!show) { api.showHeat(null); setHeat(null); return }
    if (!api.analysed) { scanBody(); return }
    setHeat(api.showHeat(bumpMm))
  }

  function finish() {
    setSelection(null); onBodyChanged()
    if (heat) refreshHeat()
  }

  function keep() { run('keep', () => api?.apply(), finish) }
  function undo() { run('undo', () => api?.undo(), finish) }
  function shade() { run('shade', () => api?.shadeSmooth(smooth.creaseDeg), () => { finish(); setStatus({ tone: 'ok', text: 'Shading re-smoothed over the whole body. Edges sharper than the crease angle stay crisp. Undo puts the old shading back.' }) }) }
  function clear() { api?.cancel(); setSelection(null); setLasso(false) }
  function compare(on: boolean) { if (!selection || comparing === on) return; setComparing(on); api?.compare(on) }

  const method = SMOOTH_METHODS[smooth.method]

  return <fieldset className="ms-veh-body">
    <legend>Body smoothing</legend>
    <p className="ms-veh-note">Generated bodies come out grainy and lumpy. Start with <strong>Auto smooth</strong>, or scan for rough spots and choose where to smooth yourself. Everything previews first and nothing changes until you keep it.</p>

    <div className="ms-veh-pair">
      <button type="button" className="ms-veh-suggest" onClick={autoSmooth} disabled={off} title="Measure the whole body and smooth just the rough areas, keeping panel lines and trim">{busy === 'auto' ? <Sparkles className="spin" size={14} aria-hidden/> : <WandSparkles size={14} aria-hidden/>} {busy === 'auto' ? 'Smoothing…' : 'Auto smooth'}</button>
      <button type="button" onClick={shade} disabled={off} title="Re-shade the whole body smoothly; edges sharper than the crease angle stay crisp"><SunMedium size={14} aria-hidden/> Smooth shading</button>
    </div>

    <h4 className="ms-veh-subhead">Find dents and bumps</h4>
    <div className="ms-veh-pair">
      <button type="button" onClick={scanBody} disabled={off}><ScanSearch size={14} aria-hidden/> {busy === 'scan' ? 'Scanning…' : scan ? 'Scan again' : 'Scan the body'}</button>
      <button type="button" onClick={() => api && picked(api.selectMarked(bumpMm), 'No spots are marked at this depth. Lower “Mark bumps deeper than”.')} disabled={off || !heat}><SquareDashed size={14} aria-hidden/> Select marked spots</button>
    </div>
    <label className="ms-veh-inline"><input type="checkbox" checked={!!heat} disabled={off} onChange={event => toggleHeat(event.target.checked)}/> Show rough spots on the model (yellow to red)</label>
    <Slider label="Mark bumps deeper than" min={SMOOTH_LIMITS.bumpMin} max={SMOOTH_LIMITS.bumpMax} step={0.1} value={bumpMm} onChange={setThreshold} display={`${bumpMm.toFixed(1)} mm`}/>
    {scan && heat && <p className="ms-veh-note" role="status">{heat.spots.toLocaleString()} rough {heat.spots === 1 ? 'spot' : 'spots'} marked, covering {pct(heat.share)} of the surface. Typical bump {mm(scan.typicalMm)} mm, deepest {mm(scan.worstMm)} mm (measured as if the model were a full-size car).</p>}

    <h4 className="ms-veh-subhead">Choose where to smooth</h4>
    <div className="ms-veh-pair">
      <button type="button" onClick={() => { onStartLasso(); setLasso(current => !current) }} aria-pressed={lasso} disabled={off}><Lasso size={14} aria-hidden/> {lasso ? 'Drawing… (Esc to stop)' : 'Draw around a dent'}</button>
      <button type="button" onClick={() => api && picked(api.selectAll(), 'This model has no surfaces to smooth.')} disabled={off}><Maximize2 size={14} aria-hidden/> Whole body</button>
      <button type="button" onClick={() => api && setSelection(api.resize('grow'))} disabled={off || !selection}><Maximize2 size={14} aria-hidden/> Grow selection</button>
      <button type="button" onClick={() => api && setSelection(api.resize('shrink'))} disabled={off || !selection}><Minimize2 size={14} aria-hidden/> Shrink selection</button>
    </div>
    <Slider label="Loop edge blend (next loop you draw)" min={0} max={SMOOTH_LIMITS.featherMax} step={1} value={smooth.featherPx} onChange={featherPx => tune({ featherPx })} display={`${smooth.featherPx} px`}/>
    {selection && <p className="ms-veh-note" role="status">{selection.vertices.toLocaleString()} vertices selected on {selection.meshes} {selection.meshes === 1 ? 'part' : 'parts'} (blue dots). The preview updates as you change the settings.</p>}

    <h4 className="ms-veh-subhead">How to smooth</h4>
    <label>Method<select value={smooth.method} onChange={event => tune({ method: event.target.value as SmoothMethod })}>
      {(Object.keys(SMOOTH_METHODS) as SmoothMethod[]).map(id => <option key={id} value={id}>{SMOOTH_METHODS[id].label}</option>)}
    </select></label>
    <p className="ms-veh-note">{method.help}</p>
    <Slider label="Strength" min={0} max={1} step={0.01} value={smooth.strength} onChange={strength => tune({ strength })} display={`${Math.round(smooth.strength * 100)}%`}/>
    <Slider label={smooth.method === 'clean' ? 'Passes (rougher surfaces need more)' : 'Passes (wider dents need more)'} min={1} max={method.passesMax} step={1} value={Math.min(smooth.passes, method.passesMax)} onChange={passes => tune({ passes })} display={String(Math.min(smooth.passes, method.passesMax))}/>
    <Slider label="Keep creases sharper than" min={SMOOTH_LIMITS.creaseMin} max={SMOOTH_LIMITS.creaseMax} step={1} value={smooth.creaseDeg} onChange={creaseDeg => tune({ creaseDeg })} display={`${smooth.creaseDeg}°`}/>
    <button type="button" className={comparing ? 'is-active' : ''} disabled={!selection} aria-pressed={comparing}
      onPointerDown={() => compare(true)} onPointerUp={() => compare(false)} onPointerLeave={() => compare(false)}
      onKeyDown={event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); compare(true) } }} onKeyUp={() => compare(false)} onBlur={() => compare(false)}>
      <Eye size={14} aria-hidden/> Hold to see the original
    </button>

    <div className="ms-veh-pair">
      <button type="button" onClick={keep} disabled={off || !selection}><Check size={14} aria-hidden/> Keep this smoothing</button>
      <button type="button" onClick={clear} disabled={off || (!selection && !lasso)}><X size={14} aria-hidden/> Clear selection</button>
    </div>
    <button type="button" onClick={undo} disabled={off || !undoDepth}><Undo2 size={14} aria-hidden/> Undo last change{undoDepth ? ` (${undoDepth})` : ''}</button>
    {bodyEdits > 0 && <p className="ms-veh-note" role="status">{bodyEdits} body {bodyEdits === 1 ? 'change is' : 'changes are'} kept. {savedNote}</p>}
  </fieldset>
}
