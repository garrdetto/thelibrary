import { Component, Suspense, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, ReactNode } from 'react'
import { useGLTF } from '@react-three/drei'
import { Check, ChevronLeft, ChevronRight, ExternalLink, Lasso, LoaderCircle, Move3d, Pipette, Plus, RotateCw, Ruler, SquarePen, Undo2, Upload, WandSparkles, X } from 'lucide-react'
import type { Object3D } from 'three'
import { CAR_LIMITS, STOCK_CAR, STOCK_LENGTH } from '../../../../modules-src/shorttrack/shared/CustomCars'
import { fetchCarModel, fetchCars, publishCar, updateCar } from '@/lib/shorttrack-cars'
import type { CarStatus, CustomCarRecord } from '@/lib/shorttrack-cars'
import { suggestVehicleParts } from '@/lib/maplestreet-vehicles'
import { AssetStatusBadge, statusOf, submitStatus } from '../../maplestreet/AssetStatusActions'
import { MeshyPanel } from '../../maplestreet/MeshyPanel'
import type { MeshySourceOption } from '../../maplestreet/MeshyPanel'
import { DEFAULT_SMOOTH, exportScene, SMOOTH_LIMITS } from '../../maplestreet/vehicle/bodySmooth'
import type { Px, SelectionReport, SmoothSettings } from '../../maplestreet/vehicle/bodySmooth'
import { SmoothOverlay } from '../../maplestreet/vehicle/DentSmoother'
import type { SmootherApi } from '../../maplestreet/vehicle/DentSmoother'
import type { ShrinkReport } from '../../maplestreet/vehicle/modelTools'
import { carProblems, carSpec, draftFromCar, fmtLen, newCarDraft, placement, turnedSize } from './carDraft'
import type { CarDraft, CarMarker } from './carDraft'
import { CarStage } from './CarStage'
import type { CarModelInfo } from './CarStage'
import { NumberInput } from '../../admin/NumberInput'

const MODULE_URL = '/#module-shorttrack'
const MARKERS: { id: CarMarker; label: string }[] = [
  { id: 'front', label: 'Front axle' }, { id: 'rear', label: 'Rear axle' }, { id: 'door', label: 'Door number' },
  { id: 'roof', label: 'Roof number' }, { id: 'tail', label: 'Tail number' }, { id: 'light', label: 'Tail light' },
]
const STEPS = [
  { id: 'placement', label: 'Placement' }, { id: 'body', label: 'Body' }, { id: 'wheels', label: 'Wheels' },
  { id: 'numbers', label: 'Numbers & lights' }, { id: 'paint', label: 'Paint' }, { id: 'size', label: 'File size' },
] as const
type Step = (typeof STEPS)[number]['id']
type View = 'build' | 'library' | 'meshy'
const kb = (bytes: number) => bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`
const r3 = (v: number) => Math.round(v * 1000) / 1000

class ModelErrorBoundary extends Component<{ resetKey: string; onError: (message: string) => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { this.props.onError('That model could not be opened. Check that it is a valid glTF 2.0 file without Draco or Basis compression.') }
  componentDidUpdate(previous: { resetKey: string }) { if (previous.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false }) }
  render() { return this.state.failed ? null : this.props.children }
}

function Num({ label, value, onChange, step = 0.01, min, max, suffix }: { label: string; value: number; onChange: (value: number) => void; step?: number; min?: number; max?: number; suffix?: string }) {
  return <label>{label}{suffix ? ` (${suffix})` : ''}<NumberInput step={step} min={min} max={max} value={value} onChange={onChange}/></label>
}

function Slider({ label, value, onChange, min, max, step, display }: { label: string; value: number; onChange: (value: number) => void; min: number; max: number; step: number; display: string }) {
  return <label className="ms-veh-slider">{label} <output>{display}</output><input type="range" min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))}/></label>
}

export default function CarEditor() {
  const [file, setFile] = useState<File | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [info, setInfo] = useState<CarModelInfo | null>(null)
  const [draft, setDraft] = useState<CarDraft>(() => newCarDraft(null))
  const [compare, setCompare] = useState(true)
  const [overlap, setOverlap] = useState(false)
  const [selected, setSelected] = useState<CarMarker | null>(null)
  const [picking, setPicking] = useState(false)
  const [report, setReport] = useState<ShrinkReport | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [cars, setCars] = useState<CustomCarRecord[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [step, setStep] = useState<Step>('placement')
  const [view, setView] = useState<View>('build')
  const [editing, setEditing] = useState<CustomCarRecord | null>(null)
  const [modelChanged, setModelChanged] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const stepIndex = STEPS.findIndex(item => item.id === step)
  const fitted = useRef(false)
  const pendingRecord = useRef<CustomCarRecord | null>(null)
  const modelScene = useRef<Object3D | null>(null)
  const onScene = useCallback((scene: Object3D | null) => { modelScene.current = scene }, [])
  const smoother = useRef<SmootherApi | null>(null)
  const [lasso, setLasso] = useState(false)
  const [selection, setSelection] = useState<SelectionReport | null>(null)
  const [smooth, setSmooth] = useState<SmoothSettings>(DEFAULT_SMOOTH)
  const [, bodyChanged] = useReducer((n: number) => n + 1, 0)

  const patch = useCallback((changes: Partial<CarDraft>) => setDraft(current => ({ ...current, ...changes })), [])

  const loadCars = useCallback(async () => {
    setListError(null)
    try { setCars(await fetchCars()) } catch (error) { setListError((error as Error).message) }
  }, [])
  useEffect(() => { void loadCars() }, [loadCars])
  useEffect(() => () => { if (url) { useGLTF.clear(url); URL.revokeObjectURL(url) } }, [url])

  const size = info ? turnedSize(info.raw, draft.yaw) : null
  const length = size ? size.x * draft.scale : 0
  const width = size ? size.z * draft.scale : 0
  const height = size ? size.y * draft.scale : 0
  const problems = useMemo(() => size ? carProblems(draft, length, width) : { blocking: [], notes: [] }, [draft, size, length, width])

  function openFile(chosen: File, fromRecord = false) {
    setStatus(null); setReport(null)
    if (!/\.(glb|gltf)$/i.test(chosen.name)) { setStatus({ tone: 'error', text: 'Choose a .glb or .gltf file.' }); return }
    if (chosen.size > 60 * 1024 * 1024) { setStatus({ tone: 'error', text: 'That file is over 60 MB. Remesh it in Meshy or reduce it before uploading.' }); return }
    fitted.current = false
    setLasso(false); setSelection(null); bodyChanged()
    setInfo(null)
    setFile(chosen)
    setUrl(URL.createObjectURL(chosen))
    setModelChanged(!fromRecord)
    if (!draft.name.trim() && !fromRecord) patch({ name: chosen.name.replace(/\.(glb|gltf)$/i, '').replace(/[_-]+/g, ' ').replace(/[^\p{L}\p{N} .,'&()+#/-]/gu, '').trim().slice(0, CAR_LIMITS.nameMax) })
  }

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0]
    if (chosen) openFile(chosen)
  }

  const onInfo = useCallback((next: CarModelInfo) => {
    setInfo(next)
    const record = pendingRecord.current
    if (record) {
      pendingRecord.current = null
      fitted.current = true
      setDraft(draftFromCar(record, next.center))
      return
    }
    if (!fitted.current) {
      fitted.current = true
      const yaw = next.raw.z > next.raw.x * 1.15 ? 1 : 0
      setDraft(current => newCarDraft(next.raw, { name: current.name, blurb: current.blurb, yaw, paint: current.paint, removeWheels: current.removeWheels }))
    }
  }, [])

  function refit(scale?: number, yaw = draft.yaw) {
    if (!info) return
    setDraft(current => newCarDraft(info.raw, { name: current.name, blurb: current.blurb, yaw, scale, shiftX: current.shiftX, lift: current.lift, paint: current.paint, removeWheels: current.removeWheels, maxTriangles: current.maxTriangles, maxTexture: current.maxTexture }))
  }

  function matchStock() {
    if (!info) return
    refit(r3(STOCK_LENGTH / turnedSize(info.raw, draft.yaw).x))
  }

  function turnNose() { refit(undefined, (draft.yaw + 1) % 4) }

  const onMarker = useCallback((id: CarMarker, p: { x: number; y: number; z: number }) => {
    setDraft(current => {
      const n = current.numbers
      const axles = (i: number) => current.axles.map((a, j) => j === i ? { ...a, x: r3(p.x), halfTrack: r3(Math.max(0.4, Math.abs(p.z))) } : a) as CarDraft['axles']
      switch (id) {
        case 'front': return { ...current, axles: axles(0) }
        case 'rear': return { ...current, axles: axles(1) }
        case 'door': return n.door ? { ...current, numbers: { ...n, door: { ...n.door, x: r3(p.x), y: r3(Math.max(0, p.y)) } } } : current
        case 'roof': return n.roof ? { ...current, numbers: { ...n, roof: { ...n.roof, x: r3(p.x) } } } : current
        case 'tail': return n.tail ? { ...current, numbers: { ...n, tail: { ...n.tail, y: r3(Math.max(0, p.y)) } } } : current
        case 'light': return { ...current, tail: { x: r3(p.x), y: r3(Math.max(0, p.y)), z: r3(Math.abs(p.z)) } }
      }
    })
  }, [])

  async function suggestPoints() {
    const scene = modelScene.current
    if (!scene || !info || busy) return
    setBusy('suggest'); setStatus(null); setSelected(null)
    try {
      const { groundMatrix, groundTriangles, renderViews } = await import('../../maplestreet/vehicle/suggestRender')
      const { detectAxles, partsFromViews, surfaceSamples } = await import('../../maplestreet/vehicle/suggest')
      const ground = groundMatrix(draft, info.center)
      const tris = groundTriangles(scene, ground)
      const found: string[] = [], missed: string[] = []
      let next: CarDraft = { ...draft, lift: 0 }
      const axles = detectAxles(surfaceSamples(tris), { length, width, height })
      if (axles) {
        const fit = (w: typeof axles.front) => ({ x: w.x, radius: Math.min(CAR_LIMITS.wheelRadiusMax, Math.max(CAR_LIMITS.wheelRadiusMin, w.radius)), width: Math.min(0.8, Math.max(0.1, w.width)), halfTrack: Math.min(1.3, Math.max(0.4, w.halfTrack)) })
        next = { ...next, axles: [fit(axles.front), fit(axles.rear)] }
        found.push('wheels')
      } else missed.push('wheels')

      let top = 0, roofMin = Infinity, roofMax = -Infinity, rear = Infinity
      for (let i = 1; i < tris.length; i += 3) top = Math.max(top, tris[i])
      for (let i = 0; i < tris.length; i += 3) {
        const x = tris[i], y = tris[i + 1]
        rear = Math.min(rear, x)
        if (y > top * 0.88) { roofMin = Math.min(roofMin, x); roofMax = Math.max(roofMax, x) }
      }
      const doorX = r3((next.axles[0].x + next.axles[1].x) / 2)
      next = { ...next, numbers: {
        door: next.numbers.door && { ...next.numbers.door, x: doorX, y: r3(top * 0.47) },
        roof: next.numbers.roof && Number.isFinite(roofMin) ? { ...next.numbers.roof, x: r3((roofMin + roofMax) / 2) } : next.numbers.roof,
        tail: next.numbers.tail && { ...next.numbers.tail, y: r3(top * 0.62) },
      } }
      found.push('number spots')

      let aiError: string | null = null
      try {
        const { images, frames } = renderViews(scene, ground)
        const answer = await suggestVehicleParts({ kind: 'Short-track race car', views: images })
        const parts = partsFromViews(answer, frames)
        if (parts.tail) { next = { ...next, tail: { x: parts.tail.x, y: Math.max(0, parts.tail.y), z: Math.abs(parts.tail.z) || r3(width * 0.33) } }; found.push('tail lights') } else missed.push('tail lights')
      } catch (error) {
        aiError = (error as Error).message
        if (Number.isFinite(rear)) next = { ...next, tail: { x: r3(rear + 0.03), y: r3(top * 0.6), z: r3(width * 0.33) } }
      }
      setDraft(next)
      const list = (items: string[]) => items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}` : items[0]
      setStatus({ tone: 'ok', text: [
        `Suggested the ${list(found)}. Drag any marker to fine-tune.`,
        missed.length && !aiError ? `Couldn’t find the ${list(missed)}; place ${missed.length > 1 ? 'those' : 'it'} by hand.` : '',
        aiError ? `The tail lights were set from the body’s shape because AI suggestions are unavailable: ${aiError}` : '',
      ].filter(Boolean).join(' ') })
    } catch (error) {
      setStatus({ tone: 'error', text: (error as Error).message })
    } finally { setBusy(null) }
  }

  const onPick = useCallback(({ material, color }: { material: string; color: string | null }) => {
    setDraft(current => ({ ...current, paint: current.paint.mode === 'material' ? { ...current.paint, material } : { ...current.paint, mode: 'color', key: color ?? current.paint.key } }))
    setPicking(false)
  }, [])

  async function sourceBytes() {
    if (!file) throw new Error('Load a model first.')
    if (smoother.current?.hasSelection) smoother.current.apply()
    if (smoother.current?.edits && modelScene.current) { bodyChanged(); return exportScene(modelScene.current) }
    const { toGlb } = await import('../../maplestreet/vehicle/modelTools')
    return toGlb(file)
  }

  async function shrink() {
    if (!file || !info) throw new Error('Load a model first.')
    const { shrinkModel } = await import('../../maplestreet/vehicle/modelTools')
    const wheels = draft.removeWheels && (modelChanged || !editing?.wheelsRemoved) ? draft.axles.flatMap(a => [1, -1].map(side => ({ x: a.x, y: a.radius, z: a.halfTrack * side, radius: a.radius, width: a.width }))) : []
    const result = await shrinkModel(await sourceBytes(), { targetTriangles: draft.maxTriangles, maxTexture: draft.maxTexture, cutWheels: wheels.length ? { transform: placement(draft, info.center), wheels } : null })
    setReport(result.report)
    return result.bytes
  }

  async function checkSize() {
    setBusy('shrink'); setStatus(null)
    try { await shrink() } catch (error) { setStatus({ tone: 'error', text: (error as Error).message }) } finally { setBusy(null) }
  }

  async function publish(event: FormEvent) {
    event.preventDefault()
    if (!info || busy) return
    const target = submitStatus(event)
    setBusy('publish'); setStatus(null)
    try {
      const bodyEdited = (smoother.current?.edits ?? 0) > 0
      const sendModel = !editing || modelChanged || bodyEdited || (draft.removeWheels && !editing.wheelsRemoved)
      let model: Blob | null = null
      if (sendModel) {
        const bytes = await shrink()
        if (bytes.byteLength > CAR_LIMITS.modelBytes) throw new Error(`Even after shrinking, the model is ${kb(bytes.byteLength)}. Lower the triangle or texture limits.`)
        model = new Blob([bytes as BlobPart], { type: 'model/gltf-binary' })
      }
      const spec = carSpec(draft, info.center)
      if (editing && !modelChanged) spec.wheelsRemoved = editing.wheelsRemoved || (!!model && draft.removeWheels)
      const car = await publishCar({ id: editing?.id, name: draft.name.trim(), spec, model, status: target })
      setCars(current => current?.some(c => c.id === car.id) ? current.map(c => c.id === car.id ? car : c) : [...(current ?? []), car])
      setEditing(car); setModelChanged(false); setSelection(null); bodyChanged()
      if (model) {
        pendingRecord.current = car
        const saved = new File([model], `${car.id}.glb`, { type: 'model/gltf-binary' })
        openFile(saved, true)
      }
      setStatus({ tone: 'ok', text: target === 'draft'
        ? `Saved “${car.name}” as a draft. Open Short Track Showdown while signed in as the administrator: drafts appear only in your vehicle list, so you can race it before publishing.`
        : `Published “${car.name}”. Drivers can pick it on the track screen and in the garage the next time they open Short Track Showdown.` })
    } catch (error) {
      setStatus({ tone: 'error', text: (error as Error).message })
    } finally { setBusy(null) }
  }

  async function change(car: CustomCarRecord, changes: { status?: CarStatus }) {
    try {
      const next = await updateCar(car.id, changes)
      setCars(current => current?.map(c => c.id === next.id ? next : c) ?? [next])
    } catch (error) { setListError((error as Error).message) }
  }

  async function openRecord(car: CustomCarRecord) {
    if (busy) return
    setBusy('open'); setStatus(null); setListError(null)
    try {
      const model = await fetchCarModel(car)
      pendingRecord.current = car
      setEditing(car)
      openFile(model, true)
      setView('build'); setStep('placement')
      setStatus({ tone: 'ok', text: `Editing “${car.name}”. Change any step and save: the car keeps its id, so drivers who picked it keep it.` })
    } catch (error) {
      setListError((error as Error).message)
    } finally { setBusy(null) }
  }

  function startNew() {
    pendingRecord.current = null
    setEditing(null); setFile(null); setUrl(null); setInfo(null); setReport(null); setStatus(null); setModelChanged(false)
    setLasso(false); setSelection(null); bodyChanged()
    fitted.current = false
    setDraft(newCarDraft(null)); setStep('placement')
  }

  function closeLasso(polygon: Px[]) {
    setLasso(false)
    const api = smoother.current
    if (!api) return
    const picked = api.select(polygon, smooth.featherPx)
    if (!picked.vertices) { setSelection(null); setStatus({ tone: 'error', text: 'Nothing inside that loop faces the camera. Turn the preview so the dent faces you and draw the loop over the body itself.' }); return }
    setStatus(null)
    setSelection(picked)
    api.preview(smooth)
  }

  function tune(changes: Partial<SmoothSettings>) {
    const next = { ...smooth, ...changes }
    setSmooth(next)
    if (smoother.current?.hasSelection) smoother.current.preview(next)
  }

  const bodyEdits = smoother.current?.edits ?? 0
  const undoDepth = smoother.current?.undoDepth ?? 0
  const meshySources = useMemo<MeshySourceOption[]>(() => (cars ?? []).map(c => ({ label: c.name, source: { carId: c.id } })), [cars])
  const ready = !!info && draft.name.trim().length >= CAR_LIMITS.nameMin && !problems.blocking.length && !busy
  const setSpot = (key: 'door' | 'roof' | 'tail', value: object | null) => patch({ numbers: { ...draft.numbers, [key]: value } as CarDraft['numbers'] })
  const numberRow = (key: 'door' | 'roof' | 'tail', label: string) => {
    const spot = draft.numbers[key]
    const fallback = { door: { x: 0, y: r3(height * 0.47 || 0.52), h: STOCK_CAR.numbers.door!.h }, roof: { x: 0, h: STOCK_CAR.numbers.roof!.h }, tail: { y: r3(height * 0.62 || 0.8), h: STOCK_CAR.numbers.tail!.h } }[key]
    return <div className="ms-veh-xyz">
      <label className="ms-veh-inline"><input type="checkbox" checked={!!spot} onChange={event => setSpot(key, event.target.checked ? fallback : null)}/> <strong>{label}</strong></label>
      {spot && 'x' in spot && <Num label="Along" suffix="m" value={spot.x} onChange={x => setSpot(key, { ...spot, x })}/>}
      {spot && 'y' in spot && <Num label="Height" suffix="m" value={spot.y} min={0} onChange={y => setSpot(key, { ...spot, y })}/>}
      {spot && <Num label="Number height" suffix="m" value={spot.h} min={0.05} max={0.8} onChange={h => setSpot(key, { ...spot, h })}/>}
    </div>
  }

  return <section className="account-home ms-items ms-veh">
    <span className="section-eyebrow">SHORT TRACK SHOWDOWN · CARS</span>
    <h1>{editing ? `Editing ${editing.name}` : 'Build a race car'}</h1>
    <div className="adm-viewtabs" role="group" aria-label="Car tools">
      <button type="button" aria-pressed={view === 'build'} className={view === 'build' ? 'is-active' : ''} onClick={() => setView('build')}>Build a car</button>
      <button type="button" aria-pressed={view === 'library'} className={view === 'library' ? 'is-active' : ''} onClick={() => setView('library')}>Your cars{cars ? <span>{cars.length}</span> : null}</button>
      <button type="button" aria-pressed={view === 'meshy'} className={view === 'meshy' ? 'is-active' : ''} onClick={() => setView('meshy')}>Generate with Meshy</button>
    </div>
    {view === 'build' && <p className="adm-help">Load a .glb or .gltf body, size it against the stock Super Late Model, then work through the steps. Every custom car races on the stock car’s physics; the driver’s main color and race numbers are painted on in the game. Keep designs original: no real makes, models, series, sponsors or logos.</p>}

    {view === 'build' && <form className="ms-items-editor ms-veh-editor" onSubmit={publish} noValidate>
      <div className="ms-veh-left">
        <div className="ms-items-stage ms-veh-stage">
          {url
            ? <ModelErrorBoundary resetKey={url} onError={text => { setStatus({ tone: 'error', text }); setFile(null); setUrl(null) }}>
                <Suspense fallback={<p className="ms-items-loading" role="status"><LoaderCircle className="spin" size={16}/> Opening model…</p>}>
                  <CarStage url={url} draft={draft} compare={compare} overlap={overlap} selected={selected} picking={picking} onInfo={onInfo} onMarker={onMarker} onPick={onPick} onSelect={setSelected} onScene={onScene} smoother={smoother} locked={lasso}/>
                </Suspense>
              </ModelErrorBoundary>
            : <button type="button" className="ms-items-drop" onClick={() => fileInput.current?.click()}><Upload size={22} aria-hidden/> Choose a car model</button>}
          {lasso && url && <SmoothOverlay onClose={closeLasso} onCancel={() => setLasso(false)}/>}
          {picking && <p className="ms-veh-hint" role="status"><Pipette size={14} aria-hidden/> Click the part of the body that should take the driver’s main color.</p>}
          {lasso && <p className="ms-veh-hint" role="status"><Lasso size={14} aria-hidden/> Click around the dent to draw a loop; click the first corner or press Enter to close it, Esc to stop.</p>}
        </div>

        <div className="ms-veh-toolbar">
          <label className="ms-veh-inline"><input type="checkbox" checked={compare} onChange={event => setCompare(event.target.checked)}/> Show the stock car</label>
          <label className="ms-veh-inline"><input type="checkbox" checked={overlap} disabled={!compare} onChange={event => setOverlap(event.target.checked)}/> Overlap</label>
          <button type="button" onClick={matchStock} disabled={!info}><Ruler size={14} aria-hidden/> Match stock car length</button>
          <button type="button" onClick={turnNose} disabled={!info}><RotateCw size={14} aria-hidden/> Turn nose 90°</button>
          <button type="button" className="ms-veh-suggest" onClick={() => void suggestPoints()} disabled={!info || !!busy} title="Find the wheels and number spots from the model's shape and ask AI for the tail lights">{busy === 'suggest' ? <LoaderCircle className="spin" size={14}/> : <WandSparkles size={14} aria-hidden/>} {busy === 'suggest' ? 'Finding points…' : 'Suggest points'}</button>
          <div className="ms-veh-markers" role="group" aria-label="Drag a marker">
            <Move3d size={14} aria-hidden/>
            {MARKERS.filter(m => m.id === 'front' || m.id === 'rear' || (m.id === 'light' ? !!draft.tail : !!draft.numbers[m.id as 'door' | 'roof' | 'tail'])).map(m => <button key={m.id} type="button" aria-pressed={selected === m.id} className={selected === m.id ? 'is-active' : ''} onClick={() => setSelected(selected === m.id ? null : m.id)} disabled={!info}>{m.label}</button>)}
          </div>
        </div>

        <dl className="ms-items-readout ms-veh-readout" aria-live="polite">
          <div><dt>Length</dt><dd>{size ? fmtLen(length) : '—'}</dd></div>
          <div><dt>Width</dt><dd>{size ? fmtLen(width) : '—'}</dd></div>
          <div><dt>Height</dt><dd>{size ? fmtLen(height) : '—'}</dd></div>
          <div><dt>Wheelbase</dt><dd>{fmtLen(draft.axles[0].x - draft.axles[1].x)}</dd></div>
          <div><dt>Stock car</dt><dd>{STOCK_LENGTH.toFixed(2)} × {STOCK_CAR.width} m</dd></div>
        </dl>
        {problems.blocking.map(w => <p key={w} className="ms-veh-warn" role="alert">{w}</p>)}
        {problems.notes.map(w => <p key={w} className="ms-veh-warn" role="status">{w}</p>)}
      </div>

      <div className="ms-items-fields">
        {editing && <p className="ms-veh-editing"><SquarePen size={14} aria-hidden/> <span>Changes save over <strong>{editing.name}</strong>.</span> <button type="button" onClick={startNew}><Plus size={14} aria-hidden/> Start a new car</button></p>}
        <label className="ms-items-file">{editing ? 'Replace the model (.glb or .gltf, optional)' : 'Car model (.glb or .gltf)'}<input ref={fileInput} type="file" accept=".glb,.gltf" onChange={onFile}/></label>
        <label>Name<input value={draft.name} maxLength={CAR_LIMITS.nameMax} onChange={event => patch({ name: event.target.value })} required/></label>
        <label>Card description (optional)<input value={draft.blurb} maxLength={CAR_LIMITS.blurbMax} placeholder="Wedge-nosed late model with a tall spoiler" onChange={event => patch({ blurb: event.target.value })}/></label>

        <div className="adm-steps" role="group" aria-label="Car settings">
          {STEPS.map((item, index) => <button key={item.id} type="button" aria-current={step === item.id ? 'step' : undefined} className={step === item.id ? 'is-active' : ''} onClick={() => setStep(item.id)}><span>{index + 1}</span>{item.label}</button>)}
        </div>

        {step === 'placement' && <fieldset>
          <legend>Placement</legend>
          <Num label="Scale" value={draft.scale} step={0.001} min={0.0001} onChange={scale => patch({ scale: Math.max(0.0001, scale) })}/>
          <Num label="Shift along length" suffix="m" value={draft.shiftX} onChange={shiftX => patch({ shiftX })}/>
          <Num label="Lift off the track" suffix="m" value={draft.lift} onChange={lift => patch({ lift })}/>
          <p className="ms-veh-note">The nose points along the green arrow. The lowest point of the model sits on the track; lift a body without wheels so its sills clear the ground.</p>
        </fieldset>}

        {step === 'body' && <fieldset>
          <legend>Body dents</legend>
          <p className="ms-veh-note">Turn the preview until a dent faces you, draw a loop around it, then raise the strength. Only the surface facing the camera moves, edges sharper than the crease angle stay put, and the loop’s edge blends in.</p>
          <button type="button" onClick={() => { setSelected(null); setPicking(false); setLasso(current => !current) }} aria-pressed={lasso} disabled={!info}><Lasso size={14} aria-hidden/> {lasso ? 'Drawing… (Esc to stop)' : selection ? 'Draw around another dent' : 'Draw around a dent'}</button>
          {selection && <p className="ms-veh-note" role="status">{selection.vertices.toLocaleString()} vertices selected on {selection.meshes} {selection.meshes === 1 ? 'part' : 'parts'}. The preview updates as you move the sliders.</p>}
          <Slider label="Strength" min={0} max={1} step={0.01} value={smooth.strength} onChange={strength => tune({ strength })} display={`${Math.round(smooth.strength * 100)}%`}/>
          <Slider label="Passes (wider dents need more)" min={1} max={SMOOTH_LIMITS.passesMax} step={1} value={smooth.passes} onChange={passes => tune({ passes })} display={String(smooth.passes)}/>
          <Slider label="Keep creases sharper than" min={SMOOTH_LIMITS.creaseMin} max={SMOOTH_LIMITS.creaseMax} step={1} value={smooth.creaseDeg} onChange={creaseDeg => tune({ creaseDeg })} display={`${smooth.creaseDeg}°`}/>
          <Slider label="Feather (applies when you draw the next loop)" min={0} max={SMOOTH_LIMITS.featherMax} step={1} value={smooth.featherPx} onChange={featherPx => tune({ featherPx })} display={`${smooth.featherPx} px`}/>
          <div className="ms-veh-pair">
            <button type="button" onClick={() => { smoother.current?.apply(); setSelection(null); bodyChanged(); setReport(null) }} disabled={!selection}><Check size={14} aria-hidden/> Keep this smoothing</button>
            <button type="button" onClick={() => { smoother.current?.cancel(); setSelection(null); setLasso(false) }} disabled={!selection && !lasso}><X size={14} aria-hidden/> Clear selection</button>
          </div>
          <button type="button" onClick={() => { smoother.current?.undo(); setSelection(null); bodyChanged(); setReport(null) }} disabled={!undoDepth}><Undo2 size={14} aria-hidden/> Undo last smoothing{undoDepth ? ` (${undoDepth})` : ''}</button>
          {bodyEdits > 0 && <p className="ms-veh-note" role="status">{bodyEdits} smoothing {bodyEdits === 1 ? 'pass is' : 'passes are'} kept. They’re baked into the model when you save.</p>}
        </fieldset>}

        {step === 'wheels' && <fieldset>
          <legend>Wheels</legend>
          <label className="ms-veh-inline"><input type="checkbox" checked={draft.removeWheels} onChange={event => patch({ removeWheels: event.target.checked })}/> Remove the model’s baked-in wheels (the game adds racing wheels that spin and steer)</label>
          {draft.axles.map((a, i) => <div key={i} className="ms-veh-axle">
            <strong>{i === 0 ? 'Front axle' : 'Rear axle'}</strong>
            <Num label="Position" suffix="m" value={a.x} onChange={x => patch({ axles: draft.axles.map((b, j) => j === i ? { ...b, x } : b) as CarDraft['axles'] })}/>
            <Num label="Diameter" suffix="m" value={r3(a.radius * 2)} min={CAR_LIMITS.wheelRadiusMin * 2} max={CAR_LIMITS.wheelRadiusMax * 2} onChange={d => patch({ axles: draft.axles.map((b, j) => j === i ? { ...b, radius: Math.min(CAR_LIMITS.wheelRadiusMax, Math.max(CAR_LIMITS.wheelRadiusMin, d / 2)) } : b) as CarDraft['axles'] })}/>
            <Num label="Tire width" suffix="m" value={a.width} min={0.1} max={0.8} onChange={w => patch({ axles: draft.axles.map((b, j) => j === i ? { ...b, width: w } : b) as CarDraft['axles'] })}/>
            <Num label="Track width" suffix="m" value={r3(a.halfTrack * 2)} min={0.8} max={2.6} onChange={t => patch({ axles: draft.axles.map((b, j) => j === i ? { ...b, halfTrack: t / 2 } : b) as CarDraft['axles'] })}/>
          </div>)}
          <p className="ms-veh-note">The stock car runs {(STOCK_CAR.axles[0].radius * 2).toFixed(2)} m wheels on a {(STOCK_CAR.axles[0].x - STOCK_CAR.axles[1].x).toFixed(2)} m wheelbase. Wheels only change the look; grip and speed match the stock car.</p>
        </fieldset>}

        {step === 'numbers' && <fieldset>
          <legend>Race numbers</legend>
          <p className="ms-veh-note">Pick a spot above the preview to drag it. Each number is laid on the body where a line from outside first meets it, on both doors, the roof and the tail. Drivers still choose the number, font and colors in the garage and can turn placements off.</p>
          {numberRow('door', 'Doors')}
          {numberRow('roof', 'Roof')}
          {numberRow('tail', 'Tail')}
        </fieldset>}

        {step === 'numbers' && <fieldset>
          <legend>Tail lights</legend>
          <label className="ms-veh-inline"><input type="checkbox" checked={!!draft.tail} onChange={event => patch({ tail: event.target.checked ? { x: r3(-length / 2 + 0.04), y: r3(height * 0.6), z: r3(width * 0.33) } : null })}/> Brake lights (mirrored to both sides)</label>
          {draft.tail && <div className="ms-veh-xyz">{(['x', 'y', 'z'] as const).map(axis => <Num key={axis} label={axis.toUpperCase()} value={draft.tail![axis]} onChange={v => patch({ tail: { ...draft.tail!, [axis]: v } })}/>)}</div>}
        </fieldset>}

        {step === 'paint' && <fieldset>
          <legend>Paint</legend>
          <label>Part that takes the driver’s color<select value={draft.paint.mode} onChange={event => patch({ paint: { ...draft.paint, mode: event.target.value as CarDraft['paint']['mode'] } })}>
            <option value="none">None (keep the model’s colors)</option>
            <option value="material">A material on the model</option>
            <option value="color">Everything close to a color</option>
          </select></label>
          {draft.paint.mode === 'material' && <label>Material<select value={draft.paint.material} onChange={event => patch({ paint: { ...draft.paint, material: event.target.value } })}>
            <option value="">Choose…</option>
            {(info?.materials ?? []).map(m => <option key={m} value={m}>{m}</option>)}
          </select></label>}
          {draft.paint.mode !== 'none' && <button type="button" onClick={() => setPicking(p => !p)} aria-pressed={picking} disabled={!info}><Pipette size={14} aria-hidden/> {picking ? 'Click the model…' : 'Pick on the model'}</button>}
          {draft.paint.mode === 'color' && <>
            <label>Picked color<input type="color" value={draft.paint.key} onChange={event => patch({ paint: { ...draft.paint, key: event.target.value } })}/></label>
            <Slider label="Match range" min={0.03} max={0.6} step={0.01} value={draft.paint.tolerance} onChange={tolerance => patch({ paint: { ...draft.paint, tolerance } })} display={`${Math.round(draft.paint.tolerance * 100)}%`}/>
          </>}
          {draft.paint.mode !== 'none' && <label>Preview color<input type="color" value={draft.paint.color} onChange={event => patch({ paint: { ...draft.paint, color: event.target.value } })}/></label>}
          <p className="ms-veh-note">In the game this part wears each driver’s main color. Stripes, flames and sponsor patterns stay on the built-in car and truck.</p>
        </fieldset>}

        {step === 'size' && <fieldset>
          <legend>File size</legend>
          <div className="ms-veh-pair">
            <Num label="Max triangles" step={1000} min={2000} max={150000} value={draft.maxTriangles} onChange={maxTriangles => patch({ maxTriangles: Math.round(maxTriangles) })}/>
            <label>Max texture<select value={draft.maxTexture} onChange={event => patch({ maxTexture: Number(event.target.value) })}>{[512, 1024, 2048].map(n => <option key={n} value={n}>{n} px</option>)}</select></label>
          </div>
          <p className="ms-veh-note">Up to a dozen cars race at once, so keep each one light: 40,000–60,000 triangles is plenty.</p>
          <button type="button" onClick={() => void checkSize()} disabled={!info || !!busy}>{busy === 'shrink' ? <LoaderCircle className="spin" size={14}/> : null} Shrink and check size</button>
          {report && <p className="ms-veh-note" role="status">{kb(report.bytesBefore)} → {kb(report.bytesAfter)} · {report.trianglesBefore.toLocaleString()} → {report.trianglesAfter.toLocaleString()} triangles · {report.texturesResized} texture{report.texturesResized === 1 ? '' : 's'} resized{report.wheelTrianglesRemoved ? ` · ${report.wheelTrianglesRemoved.toLocaleString()} baked-in wheel triangles removed` : ''}</p>}
        </fieldset>}

        <div className="adm-step-nav">
          <button type="button" onClick={() => setStep(STEPS[stepIndex - 1].id)} disabled={stepIndex === 0}><ChevronLeft size={14} aria-hidden/> {stepIndex > 0 ? STEPS[stepIndex - 1].label : 'Back'}</button>
          <span>Step {stepIndex + 1} of {STEPS.length}</span>
          <button type="button" onClick={() => setStep(STEPS[stepIndex + 1].id)} disabled={stepIndex === STEPS.length - 1}>{stepIndex < STEPS.length - 1 ? STEPS[stepIndex + 1].label : 'Next'} <ChevronRight size={14} aria-hidden/></button>
        </div>

        <div className="ms-items-submit">
          {(!editing || editing.status === 'draft') && <button type="submit" value="draft" className="ms-items-draft" disabled={!ready}>Save as draft</button>}
          <button type="submit" value="published" className="ms-items-publish" disabled={!ready}>{busy === 'publish' ? <><LoaderCircle className="spin" size={16}/> Shrinking and saving…</> : editing ? (editing.status === 'draft' ? 'Publish car' : 'Save changes') : 'Publish car'}</button>
        </div>
        {status && <p role={status.tone === 'error' ? 'alert' : 'status'} className={status.tone === 'error' ? 'ms-items-error' : 'ms-items-ok'}>{status.text}</p>}
      </div>
    </form>}

    {view === 'meshy' && <MeshyPanel target="racecar" sources={meshySources} onOpen={opened => { startNew(); openFile(opened); setView('build') }}/>}

    {view === 'library' && <>
      <p className="adm-help">Every custom car you’ve saved. Drafts show up only for you in Short Track Showdown, so you can race one before publishing it. Retiring a car takes it out of the vehicle list; drivers who had it picked go back to the race truck.</p>
      <p className="ms-items-note"><a href={MODULE_URL} target="_blank" rel="noopener">Open Short Track Showdown <ExternalLink size={12} aria-hidden/></a></p>
      {listError && <p role="alert" className="ms-items-error">{listError} <button type="button" onClick={() => void loadCars()}>Retry</button></p>}
      {cars === null && !listError && <p role="status"><LoaderCircle className="spin" size={16}/> Loading cars…</p>}
      {cars?.length === 0 && <p className="ms-items-note">No custom cars yet. Generate one with Meshy or load a model under Build a car.</p>}
      {!!cars?.length && <ul className="ms-items-list">
        {cars.map(c => <li key={c.id} className={statusOf(c) === 'retired' ? 'is-retired' : statusOf(c) === 'draft' ? 'is-draft' : ''}>
          <div>
            <strong>{c.name}</strong>
            <span>{c.blurb || 'No description'} · wheels {(c.axles[0].radius * 2).toFixed(2)} m · numbers on {[c.numbers.door && 'doors', c.numbers.roof && 'roof', c.numbers.tail && 'tail'].filter(Boolean).join(', ') || 'nowhere'}</span>
          </div>
          <AssetStatusBadge status={statusOf(c)}/>
          <button type="button" onClick={() => void openRecord(c)} disabled={!!busy}>{busy === 'open' ? <LoaderCircle className="spin" size={12}/> : <SquarePen size={12} aria-hidden/>} Edit</button>
          <a href={c.modelUrl} download>Model</a>
          {c.status === 'draft' && <button type="button" onClick={() => void change(c, { status: 'published' })}>Publish</button>}
          {c.status === 'published' && <button type="button" onClick={() => void change(c, { status: 'retired' })}>Retire</button>}
          {c.status === 'retired' && <button type="button" onClick={() => void change(c, { status: 'published' })}>Restore</button>}
        </li>)}
      </ul>}
    </>}
  </section>
}
