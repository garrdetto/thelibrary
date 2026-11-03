import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, ReactNode } from 'react'
import { useGLTF } from '@react-three/drei'
import { ChevronLeft, ChevronRight, Gauge, LoaderCircle, Move3d, Pipette, RotateCw, Ruler, Upload, WandSparkles } from 'lucide-react'
import type { Object3D } from 'three'
import { TRAFFIC_ROUTES } from '../../../../modules-src/maplestreet/shared/CustomVehicles'
import type { CustomVehicleRecord, CustomVehicleSpec } from '../../../../modules-src/maplestreet/shared/CustomVehicles'
import { BODY_EXTENTS, BUILTIN_TUNING } from '../../../../modules-src/maplestreet/shared/Vehicles'
import { fetchStoreVehicles, publishStoreVehicle, suggestVehicleParts, updateStoreVehicle } from '@/lib/maplestreet-vehicles'
import type { AssetStatus } from '@/lib/maplestreet-vehicles'
import { AssetStatusActions, AssetStatusBadge, DevInstanceNote, statusOf, submitStatus } from '../AssetStatusActions'
import { MeshyPanel } from '../MeshyPanel'
import type { MeshySourceOption } from '../MeshyPanel'
import { DRIVE_TEMPLATES, draftRecord, draftRideHeight, draftSpec, fmtLen, LIMITS, newDraft, REFERENCE_KINDS, REFERENCE_LABEL, ROUTE_LABEL, sizeWarnings, solvedEngine, suspensionFor, TEMPLATE_LABEL, templatePerformance, turnedSize } from './draft'
import type { Draft, DriveTemplate, MarkerId, ReferenceKind } from './draft'
import type { ShrinkReport } from './modelTools'
import { TestDrive } from './TestDrive'
import { VehicleStage } from './VehicleStage'
import type { ModelInfo } from './VehicleStage'

const MARKERS: { id: MarkerId; label: string }[] = [
  { id: 'front', label: 'Front axle' }, { id: 'rear', label: 'Rear axle' }, { id: 'seat', label: 'Driver seat' },
  { id: 'head', label: 'Headlight' }, { id: 'tail', label: 'Taillight' }, { id: 'hitch', label: 'Tow hitch' },
]
const STEPS = [
  { id: 'placement', label: 'Placement' }, { id: 'drive', label: 'Driving' }, { id: 'wheels', label: 'Wheels' },
  { id: 'markers', label: 'Seat & lights' }, { id: 'paint', label: 'Paint' }, { id: 'dealer', label: 'Dealer & traffic' }, { id: 'size', label: 'File size' },
] as const
type Step = (typeof STEPS)[number]['id']
type View = 'build' | 'library' | 'meshy'
const kb = (bytes: number) => bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`
const money = (value: number) => `$${value.toLocaleString('en-US')}`
const r3 = (v: number) => Math.round(v * 1000) / 1000

class ModelErrorBoundary extends Component<{ resetKey: string; onError: (message: string) => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { this.props.onError('That model could not be opened. Check that it is a valid glTF 2.0 file without Draco or Basis compression.') }
  componentDidUpdate(previous: { resetKey: string }) { if (previous.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false }) }
  render() { return this.state.failed ? null : this.props.children }
}

function Num({ label, value, onChange, step = 0.01, min, max, suffix }: { label: string; value: number; onChange: (value: number) => void; step?: number; min?: number; max?: number; suffix?: string }) {
  return <label>{label}{suffix ? ` (${suffix})` : ''}<input type="number" step={step} min={min} max={max} value={Number.isFinite(value) ? value : ''} onChange={event => { const n = Number(event.target.value); if (Number.isFinite(n)) onChange(n) }}/></label>
}

function Slider({ label, value, onChange, min, max, step, display }: { label: string; value: number; onChange: (value: number) => void; min: number; max: number; step: number; display: string }) {
  return <label className="ms-veh-slider">{label} <output>{display}</output><input type="range" min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))}/></label>
}

export default function VehicleEditor() {
  const [file, setFile] = useState<File | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [wheelFile, setWheelFile] = useState<File | null>(null)
  const [info, setInfo] = useState<ModelInfo | null>(null)
  const [draft, setDraft] = useState<Draft>(() => newDraft('sedan', null))
  const [reference, setReference] = useState<ReferenceKind | null>('sedan')
  const [overlap, setOverlap] = useState(false)
  const [selected, setSelected] = useState<MarkerId | null>(null)
  const [picking, setPicking] = useState(false)
  const [report, setReport] = useState<ShrinkReport | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [vehicles, setVehicles] = useState<CustomVehicleRecord[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [drive, setDrive] = useState<{ record: CustomVehicleRecord; urls: string[] } | null>(null)
  const [measured, setMeasured] = useState<{ topMph: number; time: number | null } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>('placement')
  const [view, setView] = useState<View>('build')
  const stepIndex = STEPS.findIndex(item => item.id === step)
  const fitted = useRef(false)
  const modelScene = useRef<Object3D | null>(null)
  const onScene = useCallback((scene: Object3D | null) => { modelScene.current = scene }, [])

  const patch = useCallback((changes: Partial<Draft>) => { setDraft(current => ({ ...current, ...changes })); setMeasured(null) }, [])

  const loadVehicles = useCallback(async () => {
    setListError(null)
    try { setVehicles(await fetchStoreVehicles()) } catch (error) { setListError((error as Error).message) }
  }, [])
  useEffect(() => { void loadVehicles() }, [loadVehicles])
  useEffect(() => () => { if (url) { useGLTF.clear(url); URL.revokeObjectURL(url) } }, [url])
  useEffect(() => () => { drive?.urls.forEach(u => URL.revokeObjectURL(u)) }, [drive])

  const size = info ? turnedSize(info.raw, draft.yaw) : null
  const length = size ? size.x * draft.scale : 0
  const width = size ? size.z * draft.scale : 0
  const height = size ? size.y * draft.scale : 0
  const wheelbase = draft.axles[0].x - draft.axles[1].x
  const wheelDia = Math.max(...draft.axles.map(a => a.radius * 2))
  const warnings = useMemo(() => size ? sizeWarnings(draft, length) : [], [draft, size, length])
  const engine = useMemo(() => solvedEngine(draft), [draft])
  const spec = useMemo<CustomVehicleSpec | null>(() => info ? draftSpec(draft, info.raw, info.center) : null, [draft, info])

  function openFile(chosen: File) {
    setStatus(null); setReport(null); setMeasured(null)
    if (!/\.(glb|gltf)$/i.test(chosen.name)) { setStatus({ tone: 'error', text: 'Choose a .glb or .gltf file.' }); return }
    if (chosen.size > 60 * 1024 * 1024) { setStatus({ tone: 'error', text: 'That file is over 60 MB. Remesh it in Meshy or reduce it before uploading.' }); return }
    fitted.current = false
    setInfo(null)
    setFile(chosen)
    setUrl(URL.createObjectURL(chosen))
    if (!draft.name.trim()) patch({ name: chosen.name.replace(/\.(glb|gltf)$/i, '').replace(/[_-]+/g, ' ').replace(/[^\p{L}\p{N} .,'&()+#/-]/gu, '').trim().slice(0, LIMITS.nameMax) })
  }

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0]
    if (chosen) openFile(chosen)
  }

  const onInfo = useCallback((next: ModelInfo) => {
    setInfo(next)
    if (!fitted.current) {
      fitted.current = true
      const yaw = next.raw.z > next.raw.x * 1.15 ? 1 : 0
      setDraft(current => newDraft(current.template, next.raw, { name: current.name, yaw, paint: current.paint, dealer: current.dealer, traffic: current.traffic, removeWheels: current.removeWheels }))
    }
  }, [])

  function refit(template: DriveTemplate, scale?: number, yaw = draft.yaw) {
    if (!info) { setDraft(current => newDraft(template, null, { name: current.name })); return }
    setDraft(current => newDraft(template, info.raw, { name: current.name, yaw, scale, shiftX: current.shiftX, lift: current.lift, paint: current.paint, traffic: current.traffic, removeWheels: current.removeWheels, maxTriangles: current.maxTriangles, maxTexture: current.maxTexture, ...(template === current.template ? { dealer: current.dealer } : {}) }))
    setMeasured(null)
  }

  function matchSize() {
    if (!info || !reference) return
    const ext = BODY_EXTENTS[reference]
    const scale = r3((ext.front - ext.rear) / turnedSize(info.raw, draft.yaw).x)
    const template = (DRIVE_TEMPLATES as readonly string[]).includes(reference) ? reference as DriveTemplate : draft.template
    refit(template, scale)
    const t = BUILTIN_TUNING[reference]
    setDraft(current => ({ ...current, axles: current.axles.map((a, i) => ({ ...a, x: t.axles[i]?.x ?? a.x, radius: t.axles[i]?.radius ?? a.radius, width: t.axles[i]?.width ?? a.width, halfTrack: t.axles[i]?.halfTrack ?? a.halfTrack })) }))
  }

  function turnNose() {
    const yaw = (draft.yaw + 1) % 4
    refit(draft.template, undefined, yaw)
  }

  function setTemplate(template: DriveTemplate) {
    const perf = templatePerformance(template)
    const base = BUILTIN_TUNING[template]
    setDraft(current => ({ ...current, template, topSpeedMph: perf.topSpeedMph, zeroToSeconds: perf.zeroToSeconds, frictionSlip: base.frictionSlip, maxSteerDeg: Math.round((base.maxSteer * 180) / Math.PI), stiffness: base.suspension.stiffness, mass: Math.round(base.mass * Math.max(0.3, (length || 1) / (BODY_EXTENTS[template].front - BODY_EXTENTS[template].rear))), axles: current.axles.map((a, i) => ({ ...a, steer: base.axles[i]?.steer ?? a.steer, drive: base.axles[i]?.drive ?? a.drive })), hitch: base.hitch ? current.hitch ?? { x: r3(-length / 2 - 0.15), y: base.hitch.y } : null }))
    setMeasured(null)
  }

  const onMarker = useCallback((id: MarkerId, p: { x: number; y: number; z: number }) => {
    setMeasured(null)
    setDraft(current => {
      const axle = (i: number) => current.axles.map((a, j) => j === i ? { ...a, x: r3(p.x), halfTrack: r3(Math.max(0.2, Math.abs(p.z))) } : a)
      switch (id) {
        case 'front': return { ...current, axles: axle(0) }
        case 'rear': return { ...current, axles: axle(1) }
        case 'seat': return { ...current, seat: { x: r3(p.x), y: r3(p.y), z: r3(p.z) } }
        case 'head': return { ...current, head: { x: r3(p.x), y: r3(p.y), z: r3(Math.abs(p.z)) } }
        case 'tail': return { ...current, tail: { x: r3(p.x), y: r3(p.y), z: r3(Math.abs(p.z)) } }
        case 'hitch': return { ...current, hitch: { x: r3(Math.min(0, p.x)), y: r3(p.y) } }
      }
    })
  }, [])

  async function suggestPoints() {
    const scene = modelScene.current
    if (!scene || !info || busy) return
    setBusy('suggest'); setStatus(null); setSelected(null)
    try {
      const { groundMatrix, groundTriangles, renderViews } = await import('./suggestRender')
      const { detectAxles, partsFromViews, surfaceSamples } = await import('./suggest')
      const ground = groundMatrix(draft, info.center)
      const found: string[] = [], missed: string[] = []
      let next: Draft = draft
      const axles = detectAxles(surfaceSamples(groundTriangles(scene, ground)), { length, width, height })
      if (axles) {
        next = { ...next, lift: 0, axles: next.axles.map((a, i) => {
          const w = i === 0 ? axles.front : axles.rear
          return { ...a, x: w.x, radius: Math.min(LIMITS.wheelRadiusMax, Math.max(LIMITS.wheelRadiusMin, w.radius)), width: w.width, halfTrack: w.halfTrack }
        }) }
        found.push('wheels')
      } else missed.push('wheels')

      let aiError: string | null = null
      try {
        const { images, frames } = renderViews(scene, ground)
        const parts = partsFromViews(await suggestVehicleParts({ kind: TEMPLATE_LABEL[draft.template], views: images }), frames)
        const drop = draftRideHeight(next, length) - next.lift
        const base = BUILTIN_TUNING[draft.template]
        const centered = !!base.seat.straddle || base.seat.z === 0
        if (parts.seat) { next = { ...next, seat: { x: parts.seat.x, y: r3(parts.seat.y - drop), z: centered ? 0 : parts.seat.z ? -Math.abs(parts.seat.z) : next.seat.z } }; found.push('seat') } else missed.push('seat')
        if (parts.head) { next = { ...next, head: { x: parts.head.x, y: r3(parts.head.y - drop), z: parts.head.z || next.head.z } }; found.push('headlights') } else missed.push('headlights')
        if (parts.tail) { next = { ...next, tail: { x: parts.tail.x, y: r3(parts.tail.y - drop), z: parts.tail.z || next.tail.z } }; found.push('taillights') } else missed.push('taillights')
        if (parts.hitch && next.hitch) { next = { ...next, hitch: { x: r3(Math.min(0, parts.hitch.x)), y: r3(parts.hitch.y - drop) } }; found.push('hitch') }
      } catch (error) { aiError = (error as Error).message }

      setDraft(next); setMeasured(null)
      const list = (items: string[]) => items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}` : items[0]
      const text = [
        found.length ? `Suggested the ${list(found)}. Drag any marker to fine-tune.` : '',
        missed.length && !aiError ? `Couldn’t find the ${list(missed)}; place ${missed.length > 1 ? 'those' : 'it'} by hand.` : '',
        !axles && aiError ? 'Couldn’t find the wheels; place them by hand.' : '',
        aiError ? `Seat and light suggestions are unavailable: ${aiError}` : '',
      ].filter(Boolean).join(' ')
      setStatus({ tone: found.length ? 'ok' : 'error', text })
    } catch (error) {
      setStatus({ tone: 'error', text: (error as Error).message })
    } finally { setBusy(null) }
  }

  const onPick = useCallback(({ material, color }: { material: string; color: string | null }) => {
    setDraft(current => ({ ...current, paint: current.paint.mode === 'material' ? { ...current.paint, material } : { ...current.paint, mode: 'color', key: color ?? current.paint.key } }))
    setPicking(false)
  }, [])

  async function shrink() {
    if (!file || !spec) throw new Error('Load a model first.')
    const { shrinkModel, toGlb } = await import('./modelTools')
    const s = suspensionFor(draft, length)
    const wheels = draft.removeWheels ? draft.axles.flatMap(a => [1, -1].map(side => ({ x: a.x, y: s.wheelY - s.rest * 0.8, z: a.halfTrack * side, radius: a.radius, width: a.width }))) : []
    const result = await shrinkModel(await toGlb(file), { targetTriangles: draft.maxTriangles, maxTexture: draft.maxTexture, cutWheels: wheels.length ? { transform: spec.model, wheels } : null })
    setReport(result.report)
    return result.bytes
  }

  async function checkSize() {
    setBusy('shrink'); setStatus(null)
    try { await shrink() } catch (error) { setStatus({ tone: 'error', text: (error as Error).message }) } finally { setBusy(null) }
  }

  async function testDrive() {
    if (!spec) return
    setBusy('drive'); setStatus(null)
    try {
      const bytes = await shrink()
      const modelUrl = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'model/gltf-binary' }))
      const wheelUrl = wheelFile ? URL.createObjectURL(wheelFile) : null
      setDrive({ record: draftRecord(spec, draft.name, modelUrl, wheelUrl), urls: [modelUrl, ...(wheelUrl ? [wheelUrl] : [])] })
    } catch (error) {
      setStatus({ tone: 'error', text: (error as Error).message })
    } finally { setBusy(null) }
  }

  async function publish(event: FormEvent) {
    event.preventDefault()
    if (!spec || busy) return
    const target = submitStatus(event)
    setBusy('publish'); setStatus(null)
    try {
      const bytes = await shrink()
      if (bytes.byteLength > LIMITS.modelBytes) throw new Error(`Even after shrinking, the model is ${kb(bytes.byteLength)}. Lower the triangle or texture limits.`)
      const vehicle = await publishStoreVehicle({ name: draft.name.trim(), spec, model: new Blob([bytes as BlobPart], { type: 'model/gltf-binary' }), wheel: wheelFile, status: target })
      setVehicles(current => [...(current ?? []), vehicle])
      if (target === 'draft') setStatus({ tone: 'ok', text: `Saved “${vehicle.name}” as a draft. Drive it in the developer instance, then publish it from the list below.` })
      else setStatus({ tone: 'ok', text: `Published “${vehicle.name}”. ${vehicle.dealer.forSale ? 'It’s for sale at Maple Motors' : 'It isn’t for sale'}${vehicle.traffic.enabled ? ' and drives around town' : ''} the next time players load the module.` })
    } catch (error) {
      setStatus({ tone: 'error', text: (error as Error).message })
    } finally { setBusy(null) }
  }

  async function change(vehicle: CustomVehicleRecord, changes: { active?: boolean; status?: AssetStatus; spec?: CustomVehicleSpec }) {
    try {
      const next = await updateStoreVehicle(vehicle.id, changes)
      setVehicles(current => current?.map(v => v.id === next.id ? next : v) ?? null)
    } catch (error) { setListError((error as Error).message) }
  }

  const specOf = (v: CustomVehicleRecord): CustomVehicleSpec => ({ template: v.template, model: v.model, physics: v.physics, lights: v.lights, paint: v.paint, targets: v.targets, dealer: v.dealer, traffic: v.traffic, wheelsRemoved: v.wheelsRemoved })

  const meshySources = useMemo<MeshySourceOption[]>(() => (vehicles ?? []).map(v => ({ label: v.name, source: { vehicleId: v.id } })), [vehicles])
  const onMeshyOpen = (opened: File) => { openFile(opened); setView('build') }

  const ready = !!spec && draft.name.trim().length >= LIMITS.nameMin && !busy
  const ride = size ? draftRideHeight(draft, length) : 0

  return <section className="account-home ms-items ms-veh">
    <span className="section-eyebrow">MAPLE STREET · DEV MODE</span>
    <h1>Publish vehicles</h1>
    <div className="adm-viewtabs" role="group" aria-label="Vehicle tools">
      <button type="button" aria-pressed={view === 'build'} className={view === 'build' ? 'is-active' : ''} onClick={() => setView('build')}>Build a vehicle</button>
      <button type="button" aria-pressed={view === 'library'} className={view === 'library' ? 'is-active' : ''} onClick={() => setView('library')}>Your vehicles{vehicles ? <span>{vehicles.length}</span> : null}</button>
      <button type="button" aria-pressed={view === 'meshy'} className={view === 'meshy' ? 'is-active' : ''} onClick={() => setView('meshy')}>Generate with Meshy</button>
    </div>
    {view === 'build' && <p className="adm-help">Load a .glb or .gltf body, size it against the built-in vehicles and a resident, then work through the steps. Keep every design original: no real makes, model names, logos or badges.</p>}

    {view === 'build' && <form className="ms-items-editor ms-veh-editor" onSubmit={publish} noValidate>
      <div className="ms-veh-left">
        <div className="ms-items-stage ms-veh-stage">
          {url
            ? <ModelErrorBoundary resetKey={url} onError={text => { setStatus({ tone: 'error', text }); setFile(null); setUrl(null) }}>
                <Suspense fallback={<p className="ms-items-loading" role="status"><LoaderCircle className="spin" size={16}/> Opening model…</p>}>
                  <VehicleStage url={url} draft={draft} reference={reference} overlap={overlap} selected={selected} picking={picking} onInfo={onInfo} onMarker={onMarker} onPick={onPick} onSelect={setSelected} onScene={onScene}/>
                </Suspense>
              </ModelErrorBoundary>
            : <button type="button" className="ms-items-drop" onClick={() => fileInput.current?.click()}><Upload size={22} aria-hidden/> Choose a vehicle model</button>}
          {picking && <p className="ms-veh-hint" role="status"><Pipette size={14} aria-hidden/> Click the part of the model that should take the player’s paint color.</p>}
        </div>

        <div className="ms-veh-toolbar">
          <label>Compare to<select value={reference ?? ''} onChange={event => setReference((event.target.value || null) as ReferenceKind | null)}>
            <option value="">Nothing</option>
            {REFERENCE_KINDS.map(k => <option key={k} value={k}>{REFERENCE_LABEL[k]}</option>)}
          </select></label>
          <label className="ms-veh-inline"><input type="checkbox" checked={overlap} onChange={event => setOverlap(event.target.checked)}/> Overlap</label>
          <button type="button" onClick={matchSize} disabled={!info || !reference}><Ruler size={14} aria-hidden/> Match size of {reference ? REFERENCE_LABEL[reference].toLowerCase() : '…'}</button>
          <button type="button" onClick={turnNose} disabled={!info}><RotateCw size={14} aria-hidden/> Turn nose 90°</button>
          <button type="button" className="ms-veh-suggest" onClick={() => void suggestPoints()} disabled={!info || !!busy} title="Find the wheels from the model's shape and ask AI for the seat, lights and hitch">{busy === 'suggest' ? <LoaderCircle className="spin" size={14}/> : <WandSparkles size={14} aria-hidden/>} {busy === 'suggest' ? 'Finding points…' : 'Suggest points'}</button>
          <div className="ms-veh-markers" role="group" aria-label="Drag a marker">
            <Move3d size={14} aria-hidden/>
            {MARKERS.filter(m => m.id !== 'hitch' || draft.hitch).map(m => <button key={m.id} type="button" aria-pressed={selected === m.id} className={selected === m.id ? 'is-active' : ''} onClick={() => setSelected(selected === m.id ? null : m.id)} disabled={!info}>{m.label}</button>)}
          </div>
        </div>

        <dl className="ms-items-readout ms-veh-readout" aria-live="polite">
          <div><dt>Length</dt><dd>{size ? fmtLen(length) : '—'}</dd></div>
          <div><dt>Width</dt><dd>{size ? fmtLen(width) : '—'}</dd></div>
          <div><dt>Height</dt><dd>{size ? fmtLen(height) : '—'}</dd></div>
          <div><dt>Wheelbase</dt><dd>{fmtLen(wheelbase)}</dd></div>
          <div><dt>Wheel diameter</dt><dd>{fmtLen(wheelDia)}</dd></div>
          <div><dt>Ride height</dt><dd>{size ? fmtLen(ride) : '—'}</dd></div>
        </dl>
        {warnings.map(w => <p key={w} className="ms-veh-warn" role="status">{w}</p>)}
      </div>

      <div className="ms-items-fields">
        <label className="ms-items-file">Vehicle model (.glb or .gltf)<input ref={fileInput} type="file" accept=".glb,.gltf" onChange={onFile}/></label>
        <label>Name<input value={draft.name} maxLength={LIMITS.nameMax} onChange={event => patch({ name: event.target.value })} required/></label>

        <div className="adm-steps" role="group" aria-label="Vehicle settings">
          {STEPS.map((item, index) => <button key={item.id} type="button" aria-current={step === item.id ? 'step' : undefined} className={step === item.id ? 'is-active' : ''} onClick={() => setStep(item.id)}><span>{index + 1}</span>{item.label}</button>)}
        </div>

        {step === 'placement' && <fieldset>
          <legend>Placement</legend>
          <Num label="Scale" value={draft.scale} step={0.001} min={0.0001} onChange={scale => patch({ scale: Math.max(0.0001, scale) })}/>
          <Num label="Shift along length" suffix="m" value={draft.shiftX} onChange={shiftX => patch({ shiftX })}/>
          <Num label="Lift off the road" suffix="m" value={draft.lift} onChange={lift => patch({ lift })}/>
        </fieldset>}

        {step === 'drive' && <fieldset>
          <legend>Drives like</legend>
          <label>Template<select value={draft.template} onChange={event => setTemplate(event.target.value as DriveTemplate)}>{DRIVE_TEMPLATES.map(t => <option key={t} value={t}>{TEMPLATE_LABEL[t]}</option>)}</select></label>
          <div className="ms-veh-pair">
            <Num label="Top speed" suffix="mph" step={1} min={2} max={LIMITS.topSpeedMphMax} value={draft.topSpeedMph} onChange={topSpeedMph => patch({ topSpeedMph })}/>
            <Num label={`0–${engine.zeroToMph} mph`} suffix="s" step={0.1} min={0.5} max={120} value={draft.zeroToSeconds} onChange={zeroToSeconds => patch({ zeroToSeconds })}/>
          </div>
          <Slider label="Mass" min={LIMITS.massMin} max={LIMITS.massMax} step={10} value={draft.mass} onChange={mass => patch({ mass })} display={`${draft.mass.toLocaleString()} kg`}/>
          <Slider label="Grip" min={0.8} max={4} step={0.05} value={draft.frictionSlip} onChange={frictionSlip => patch({ frictionSlip })} display={draft.frictionSlip.toFixed(2)}/>
          <Slider label="Steering angle" min={10} max={60} step={1} value={draft.maxSteerDeg} onChange={maxSteerDeg => patch({ maxSteerDeg })} display={`${draft.maxSteerDeg}°`}/>
          <Slider label="Suspension stiffness" min={10} max={80} step={1} value={draft.stiffness} onChange={stiffness => patch({ stiffness })} display={String(draft.stiffness)}/>
          <p className="ms-veh-note">Engine: {engine.engineForce.toLocaleString()} N per driven wheel, torque fades out at {Math.round(engine.topSpeed * 2.237)} mph.{measured && <> Test drive measured {measured.topMph} mph and {measured.time == null ? 'never reached' : `${measured.time} s to`} {engine.zeroToMph} mph.</>}</p>
          <button type="button" onClick={() => void testDrive()} disabled={!spec || !!busy}>{busy === 'drive' ? <LoaderCircle className="spin" size={14}/> : <Gauge size={14} aria-hidden/>} Test drive</button>
        </fieldset>}

        {step === 'wheels' && <fieldset>
          <legend>Wheels</legend>
          <label className="ms-veh-inline"><input type="checkbox" checked={draft.removeWheels} onChange={event => patch({ removeWheels: event.target.checked })}/> Remove the model’s baked-in wheels (use the game’s spinning, steering wheels)</label>
          {draft.axles.map((a, i) => <div key={i} className="ms-veh-axle">
            <strong>{i === 0 ? 'Front axle' : 'Rear axle'}</strong>
            <Num label="Position" suffix="m" value={a.x} onChange={x => patch({ axles: draft.axles.map((b, j) => j === i ? { ...b, x } : b) })}/>
            <Num label="Diameter" suffix="m" value={r3(a.radius * 2)} min={LIMITS.wheelRadiusMin * 2} max={LIMITS.wheelRadiusMax * 2} onChange={d => patch({ axles: draft.axles.map((b, j) => j === i ? { ...b, radius: Math.max(LIMITS.wheelRadiusMin, d / 2) } : b) })}/>
            <Num label="Tire width" suffix="m" value={a.width} min={0.05} max={1} onChange={w => patch({ axles: draft.axles.map((b, j) => j === i ? { ...b, width: w } : b) })}/>
            <Num label="Track width" suffix="m" value={r3(a.halfTrack * 2)} min={0.4} max={3.2} onChange={t => patch({ axles: draft.axles.map((b, j) => j === i ? { ...b, halfTrack: t / 2 } : b) })}/>
            <label className="ms-veh-inline"><input type="checkbox" checked={a.steer} onChange={event => patch({ axles: draft.axles.map((b, j) => j === i ? { ...b, steer: event.target.checked } : b) })}/> Steers</label>
            <label className="ms-veh-inline"><input type="checkbox" checked={a.drive} onChange={event => patch({ axles: draft.axles.map((b, j) => j === i ? { ...b, drive: event.target.checked } : b) })}/> Driven</label>
          </div>)}
          <label>Separate wheel model (optional)<input type="file" accept=".glb" onChange={event => setWheelFile(event.target.files?.[0] ?? null)}/></label>
        </fieldset>}

        {step === 'markers' && <fieldset>
          <legend>Seat, lights and hitch</legend>
          <p className="ms-veh-note">Pick a marker above the preview to drag it, or type exact positions (meters from the body’s center; forward is +).</p>
          {(['seat', 'head', 'tail'] as const).map(key => <div key={key} className="ms-veh-xyz">
            <strong>{key === 'seat' ? 'Driver seat' : key === 'head' ? 'Headlights' : 'Taillights'}</strong>
            {(['x', 'y', 'z'] as const).map(axis => <Num key={axis} label={axis.toUpperCase()} value={draft[key][axis]} onChange={v => patch({ [key]: { ...draft[key], [axis]: v } } as Partial<Draft>)}/>)}
          </div>)}
          <label className="ms-veh-inline"><input type="checkbox" checked={!!draft.hitch} onChange={event => patch({ hitch: event.target.checked ? { x: r3(-(length || 4) / 2 - 0.15), y: -0.25 } : null })}/> Tow hitch for the trailer</label>
        </fieldset>}

        {step === 'paint' && <fieldset>
          <legend>Paint</legend>
          <label>Paintable part<select value={draft.paint.mode} onChange={event => patch({ paint: { ...draft.paint, mode: event.target.value as Draft['paint']['mode'] } })}>
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
          {draft.paint.mode !== 'none' && <label>Showroom color<input type="color" value={draft.paint.color} onChange={event => patch({ paint: { ...draft.paint, color: event.target.value } })}/></label>}
        </fieldset>}

        {step === 'dealer' && <fieldset>
          <legend>Maple Motors</legend>
          <label className="ms-veh-inline"><input type="checkbox" checked={draft.dealer.forSale} onChange={event => patch({ dealer: { ...draft.dealer, forSale: event.target.checked } })}/> For sale at the dealer</label>
          <Num label="Price" suffix="$" step={100} min={0} max={LIMITS.priceMax} value={draft.dealer.price} onChange={price => patch({ dealer: { ...draft.dealer, price: Math.round(price) } })}/>
          <label>Fuel<select value={draft.dealer.fuel} onChange={event => patch({ dealer: { ...draft.dealer, fuel: event.target.value as 'gas' | 'electric' } })}><option value="gas">Gas</option><option value="electric">Electric</option></select></label>
          <div className="ms-veh-pair">
            <Num label={draft.dealer.fuel === 'electric' ? 'Battery' : 'Tank'} suffix={draft.dealer.fuel === 'electric' ? 'kWh' : 'gal'} step={0.5} min={0.5} max={200} value={draft.dealer.tank} onChange={tank => patch({ dealer: { ...draft.dealer, tank } })}/>
            <Num label={draft.dealer.fuel === 'electric' ? 'Efficiency' : 'Economy'} suffix={draft.dealer.fuel === 'electric' ? 'mi/unit' : 'mpg'} step={1} min={1} max={500} value={draft.dealer.mpg} onChange={mpg => patch({ dealer: { ...draft.dealer, mpg } })}/>
          </div>
        </fieldset>}

        {step === 'dealer' && <fieldset>
          <legend>Neighbor traffic</legend>
          <label className="ms-veh-inline"><input type="checkbox" checked={draft.traffic.enabled} onChange={event => patch({ traffic: { ...draft.traffic, enabled: event.target.checked } })}/> Drives around town</label>
          <label>Driver name<input value={draft.traffic.driver} maxLength={40} placeholder={draft.name || 'Neighbor'} onChange={event => patch({ traffic: { ...draft.traffic, driver: event.target.value } })}/></label>
          <label>Route<select value={draft.traffic.route} onChange={event => patch({ traffic: { ...draft.traffic, route: event.target.value as Draft['traffic']['route'] } })}>{TRAFFIC_ROUTES.map(r => <option key={r} value={r}>{ROUTE_LABEL[r]}</option>)}</select></label>
          <Num label="Cruising speed" suffix="mph" step={1} min={3} max={60} value={draft.traffic.mph} onChange={mph => patch({ traffic: { ...draft.traffic, mph } })}/>
        </fieldset>}

        {step === 'size' && <fieldset>
          <legend>File size</legend>
          <div className="ms-veh-pair">
            <Num label="Max triangles" step={1000} min={2000} max={150000} value={draft.maxTriangles} onChange={maxTriangles => patch({ maxTriangles: Math.round(maxTriangles) })}/>
            <label>Max texture<select value={draft.maxTexture} onChange={event => patch({ maxTexture: Number(event.target.value) })}>{[512, 1024, 2048].map(n => <option key={n} value={n}>{n} px</option>)}</select></label>
          </div>
          <button type="button" onClick={() => void checkSize()} disabled={!spec || !!busy}>{busy === 'shrink' ? <LoaderCircle className="spin" size={14}/> : null} Shrink and check size</button>
          {report && <p className="ms-veh-note" role="status">{kb(report.bytesBefore)} → {kb(report.bytesAfter)} · {report.trianglesBefore.toLocaleString()} → {report.trianglesAfter.toLocaleString()} triangles · {report.texturesResized} texture{report.texturesResized === 1 ? '' : 's'} resized{report.wheelTrianglesRemoved ? ` · ${report.wheelTrianglesRemoved.toLocaleString()} baked-in wheel triangles removed` : ''}</p>}
        </fieldset>}

        <div className="adm-step-nav">
          <button type="button" onClick={() => setStep(STEPS[stepIndex - 1].id)} disabled={stepIndex === 0}><ChevronLeft size={14} aria-hidden/> {stepIndex > 0 ? STEPS[stepIndex - 1].label : 'Back'}</button>
          <span>Step {stepIndex + 1} of {STEPS.length}</span>
          <button type="button" onClick={() => setStep(STEPS[stepIndex + 1].id)} disabled={stepIndex === STEPS.length - 1}>{stepIndex < STEPS.length - 1 ? STEPS[stepIndex + 1].label : 'Next'} <ChevronRight size={14} aria-hidden/></button>
        </div>

        <div className="ms-items-submit">
          <button type="submit" value="draft" className="ms-items-draft" disabled={!ready}>Save as draft</button>
          <button type="submit" value="published" className="ms-items-publish" disabled={!ready}>{busy === 'publish' ? <><LoaderCircle className="spin" size={16}/> Shrinking and saving…</> : 'Publish vehicle'}</button>
        </div>
        {status && <p role={status.tone === 'error' ? 'alert' : 'status'} className={status.tone === 'error' ? 'ms-items-error' : 'ms-items-ok'}>{status.text}</p>}
      </div>
    </form>}

    {view === 'meshy' && <MeshyPanel target="vehicle" sources={meshySources} onOpen={onMeshyOpen}/>}

    {drive && <TestDrive record={drive.record} onClose={() => setDrive(null)} onResult={result => setMeasured({ topMph: result.topMph, time: result.time })}/>}

    {view === 'library' && <>
    <p className="adm-help">Retiring takes a vehicle off the dealer lot and out of traffic. Players who already own it keep it in their garage.</p>
    <DevInstanceNote/>
    {listError && <p role="alert" className="ms-items-error">{listError} <button type="button" onClick={() => void loadVehicles()}>Retry</button></p>}
    {vehicles === null && !listError && <p role="status"><LoaderCircle className="spin" size={16}/> Loading vehicles…</p>}
    {vehicles?.length === 0 && <p>No vehicles published yet.</p>}
    {!!vehicles?.length && <ul className="ms-items-list">
      {vehicles.map(v => <li key={v.id} className={statusOf(v) === 'retired' ? 'is-retired' : statusOf(v) === 'draft' ? 'is-draft' : ''}>
        <div>
          <strong>{v.name}</strong>
          <span>{TEMPLATE_LABEL[v.template]} · {v.targets.topSpeedMph} mph · 0–{v.targets.zeroToMph} in {v.targets.zeroToSeconds} s · {(v.physics.chassis.hx * 2).toFixed(2)} m long · {v.dealer.forSale ? money(v.dealer.price) : 'not for sale'}{v.traffic.enabled ? ` · traffic: ${ROUTE_LABEL[v.traffic.route]}` : ''}</span>
        </div>
        <AssetStatusBadge status={statusOf(v)}/>
        <label className="ms-veh-inline"><input type="checkbox" checked={v.dealer.forSale} onChange={event => void change(v, { spec: { ...specOf(v), dealer: { ...v.dealer, forSale: event.target.checked } } })}/> For sale</label>
        <label className="ms-veh-inline"><input type="checkbox" checked={v.traffic.enabled} onChange={event => void change(v, { spec: { ...specOf(v), traffic: { ...v.traffic, enabled: event.target.checked } } })}/> In traffic</label>
        <a href={v.modelUrl} download>Model</a>
        <AssetStatusActions status={statusOf(v)} onChange={next => void change(v, { status: next })}/>
      </li>)}
    </ul>}
    </>}
  </section>
}
