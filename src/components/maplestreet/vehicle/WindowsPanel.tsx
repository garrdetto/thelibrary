import { useEffect, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import { useThree } from '@react-three/fiber'
import { Check, Lasso, LoaderCircle, ScanSearch, Undo2, WandSparkles, X } from 'lucide-react'
import type { Matrix4, Object3D } from 'three'
import type { Px } from './bodySmooth'
import { WindowTool } from './windowTool'
import type { WindowMode, WindowReport } from './windowTool'

type Status = { tone: 'ok' | 'error'; text: string } | null
export type LassoMode = 'add' | 'remove'

/** What the editor can ask of the window tool inside the canvas. */
export type WindowsApi = {
  find: () => WindowReport
  lasso: (polygon: Px[], mode: LassoMode) => WindowReport
  apply: (mode: WindowMode) => WindowReport
  auto: (mode: WindowMode) => WindowReport
  clear: () => void
  undo: () => void
  readonly undoDepth: number
  readonly edits: number
  readonly hasGlass: boolean
}

/** Lives inside the Canvas: it knows the camera and size, and hands the editor an imperative API. */
export function WindowWorker({ scene, api, toBody }: { scene: Object3D; api: MutableRefObject<WindowsApi | null>; toBody: MutableRefObject<() => Matrix4> }) {
  const camera = useThree(state => state.camera)
  const size = useThree(state => state.size)
  const invalidate = useThree(state => state.invalidate)
  const view = useRef({ camera, size })
  view.current = { camera, size }
  useEffect(() => {
    const tool = new WindowTool(scene, () => toBody.current())
    const after = <T,>(result: T) => { invalidate(); return result }
    const current: WindowsApi = {
      find: () => after(tool.find()),
      lasso: (polygon, mode) => after(tool.lasso(polygon, view.current.camera, view.current.size, mode)),
      apply: mode => after(tool.apply(mode)),
      auto: mode => { tool.find(); return after(tool.apply(mode)) },
      clear: () => { tool.clear(); invalidate() },
      undo: () => { tool.undo(); invalidate() },
      get undoDepth() { return tool.undoDepth },
      get edits() { return tool.edits },
      get hasGlass() { return tool.hasGlass },
    }
    api.current = current
    return () => { tool.dispose(); if (api.current === current) api.current = null }
  }, [scene, api, toBody, invalidate])
  return null
}

const squareMetres = (area: number) => area < 0.1 ? area.toFixed(2) : area.toFixed(1)
/** More glass than any car or truck has: the paint is as dark as the windows, so the one-click button asks first. */
const TOO_MUCH_GLASS = 7

/** The Windows tool's state; the editor draws the lasso overlay and closes it with `closeLasso`. */
export function useWindows(api: MutableRefObject<WindowsApi | null>, setStatus: (status: Status) => void, onChanged: () => void) {
  const [mode, setMode] = useState<WindowMode>('glass')
  const [found, setFound] = useState<WindowReport | null>(null)
  const [lasso, setLasso] = useState<LassoMode | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const run = <T,>(label: string, work: () => T, done: (result: T) => void) => {
    setBusy(label)
    window.setTimeout(() => {
      try { done(work()) } catch (error) { setStatus({ tone: 'error', text: (error as Error).message || 'The windows could not be changed.' }) } finally { setBusy(null) }
    }, 30)
  }

  function closeLasso(polygon: Px[]) {
    const current = lasso
    setLasso(null)
    if (!api.current || !current) return
    const report = api.current.lasso(polygon, current)
    setFound(report)
    if (current === 'add' && !report.triangles) setStatus({ tone: 'error', text: 'Nothing inside that loop faces the camera. Turn the preview so the window faces you and draw the loop over the glass.' })
  }

  function reset() { setFound(null); setLasso(null) }

  return { lasso, setLasso, closeLasso, reset, panel: { api, mode, setMode, found, setFound, lasso, setLasso, busy, run, setStatus, onChanged } }
}

type PanelState = ReturnType<typeof useWindows>['panel']

export function WindowsPanel({ state, disabled, onStartLasso }: { state: PanelState; disabled: boolean; onStartLasso: () => void }) {
  const { api, mode, setMode, found, setFound, lasso, setLasso, busy, run, setStatus, onChanged } = state
  const tool = api.current
  const off = disabled || !!busy
  const undoDepth = tool?.undoDepth ?? 0
  const done = (report: WindowReport, as: WindowMode) => `${as === 'glass' ? 'Turned' : 'Removed'} about ${squareMetres(report.area)} m² of windows${as === 'glass' ? ' into clear glass' : ''}. Undo puts the painted windows back.`
  const none = () => tool?.hasGlass
    ? 'This model already has glass windows and no painted ones were found.'
    : 'No windows were found on this model. Press “Find windows”, then draw around each pane yourself.'

  function auto() {
    if (!tool) return
    run('auto', () => { const found = tool.find(); return found.area > TOO_MUCH_GLASS ? { found, applied: false } : { found: tool.apply('glass'), applied: true } }, ({ found: report, applied }) => {
      setLasso(null)
      if (!applied) {
        setFound(report)
        setStatus({ tone: 'error', text: `This body’s paint is as dark as its glass, so about ${squareMetres(report.area)} m² got marked, more than just the windows. Nothing was changed. Use “Unmark a patch” on the parts that aren’t glass, then “Make clear glass”.` })
        return
      }
      setFound(null); onChanged()
      setStatus(report.triangles ? { tone: 'ok', text: done(report, 'glass') } : { tone: 'error', text: none() })
    })
  }

  function find() {
    if (!tool) return
    run('find', () => tool.find(), report => {
      setFound(report); setLasso(null)
      setStatus(report.triangles ? (report.area > TOO_MUCH_GLASS ? { tone: 'error', text: 'A lot more than the windows is marked: this body’s paint is as dark as its glass. Use “Unmark a patch” on the parts that aren’t glass.' } : null) : { tone: 'error', text: tool.hasGlass ? 'This model already has glass windows and no painted ones were found. You can still draw around a pane to add it.' : 'No windows were found. Draw around each pane with “Add a pane”.' })
    })
  }

  function apply() {
    if (!tool) return
    run('apply', () => tool.apply(mode), report => {
      setFound(null); setLasso(null); onChanged()
      setStatus(report.triangles ? { tone: 'ok', text: done(report, mode) } : { tone: 'error', text: 'Nothing is selected. Find the windows or draw around a pane first.' })
    })
  }

  function undo() {
    if (!tool) return
    run('undo', () => tool.undo(), () => { setFound(null); setLasso(null); onChanged(); setStatus({ tone: 'ok', text: 'Put the windows back the way they were.' }) })
  }

  function cancel() { tool?.clear(); setFound(null); setLasso(null) }
  function draw(next: LassoMode) { onStartLasso(); setLasso(lasso === next ? null : next) }

  return <fieldset className="ms-veh-body">
    <legend>Windows</legend>
    <p className="ms-veh-note">Scanned models have their windows painted on. This finds the panes and turns them into real see-through glass, or takes them out.</p>
    <button type="button" className="ms-veh-suggest" onClick={auto} disabled={off}>{busy === 'auto' ? <LoaderCircle className="spin" size={14} aria-hidden/> : <WandSparkles size={14} aria-hidden/>} {busy === 'auto' ? 'Finding the windows…' : 'Auto: clear glass windows'}</button>
    <div className="ms-veh-pair">
      <button type="button" onClick={find} disabled={off}><ScanSearch size={14} aria-hidden/> {busy === 'find' ? 'Looking…' : found ? 'Find again' : 'Find windows'}</button>
      <button type="button" onClick={undo} disabled={off || !undoDepth}><Undo2 size={14} aria-hidden/> Undo{undoDepth ? ` (${undoDepth})` : ''}</button>
    </div>
    {found && <>
      <p className="ms-veh-note" role="status">{found.triangles ? `About ${squareMetres(found.area)} m² is marked as window, shown in blue on the model.` : 'Nothing is marked yet.'} Turn the model to check every side.</p>
      <div className="ms-veh-pair">
        <button type="button" onClick={() => draw('add')} aria-pressed={lasso === 'add'} className={lasso === 'add' ? 'is-active' : ''} disabled={off}><Lasso size={14} aria-hidden/> {lasso === 'add' ? 'Drawing… (Esc to stop)' : 'Add a pane'}</button>
        <button type="button" onClick={() => draw('remove')} aria-pressed={lasso === 'remove'} className={lasso === 'remove' ? 'is-active' : ''} disabled={off || !found.triangles}><Lasso size={14} aria-hidden/> {lasso === 'remove' ? 'Drawing… (Esc to stop)' : 'Unmark a patch'}</button>
      </div>
      <div className="ms-veh-choice" role="radiogroup" aria-label="What to do with the marked windows">
        <label className={mode === 'glass' ? 'is-active' : ''}><input type="radio" name="ms-veh-window-mode" checked={mode === 'glass'} disabled={off} onChange={() => setMode('glass')}/> Make them clear glass</label>
        <label className={mode === 'open' ? 'is-active' : ''}><input type="radio" name="ms-veh-window-mode" checked={mode === 'open'} disabled={off} onChange={() => setMode('open')}/> Remove them (open)</label>
      </div>
      <div className="ms-veh-pair">
        <button type="button" onClick={apply} disabled={off || !found.triangles}><Check size={14} aria-hidden/> {mode === 'glass' ? 'Make clear glass' : 'Remove the windows'}</button>
        <button type="button" onClick={cancel} disabled={off}><X size={14} aria-hidden/> Cancel</button>
      </div>
    </>}
  </fieldset>
}
