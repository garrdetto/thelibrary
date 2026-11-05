import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import { Archive, Eye, EyeOff, LoaderCircle, Pause, Pencil, Play, Plus, RotateCw, Send, Trash2, Upload, Wand2 } from 'lucide-react'
import { CUSTOM_RIDE_LIMITS as L, CUSTOM_RIDE_MOTIONS, sanitizeMotion } from '../../../../server/park/index.mjs'
import type { CustomRideMotion } from '../../../../server/park/index.mjs'
import { MeshyPanel } from '../../maplestreet/MeshyPanel'
import type { MeshySourceOption } from '../../maplestreet/MeshyPanel'
import type { MeshyJob } from '@/lib/meshy'
import { decodeRideMesh, encodeRideMesh, partCounts } from '@/lib/park/rideMesh'
import type { RideMesh } from '@/lib/park/rideMesh'
import { MOTION_INFO, dropTravel } from '@/lib/park/rideMotion'
import { deleteParkRide, fetchParkRideRecords, fetchParkRideSource, parkRideMeshUrl, parkRideThumbUrl, saveParkRide, setParkRideStatus } from '@/lib/park-rides'
import type { ParkRideCategory, ParkRideRecord, ParkRideSpec } from '@/lib/park-rides'
import { fitModel, fitScale, loadSource, rawExtent, reduceSource, TILE_METRES } from './bake'
import type { ReducedModel, SourceModel } from './bake'
import { RideStage, captureThumb } from './RideStage'
import { suggestStats } from './suggest'
import type { RideSuggestion } from './suggest'

type Details = Omit<ParkRideSpec, 'size' | 'height' | 'motion' | 'bake'>
type Notice = { tone: 'ok' | 'error'; text: string } | null

const CATEGORIES: { id: ParkRideCategory; label: string }[] = [{ id: 'gentle', label: 'Gentle' }, { id: 'thrill', label: 'Thrill' }, { id: 'water', label: 'Water' }, { id: 'other', label: 'Other' }]
const DEFAULT_MOTION: CustomRideMotion = sanitizeMotion({ type: 'spin', speed: 1, amount: 0.6, split: 0.6 })
const DEFAULT_DETAILS: Details = { name: '', description: '', category: 'gentle', cost: 2400, upkeep: 45, capacity: 16, rideTime: 28, loadTime: 8, price: 1.4, stats: { e: 2.2, i: 1.4, n: 1 } }
const money = (value: number) => `$${value.toLocaleString('en-US')}`
const STATUS_LABEL = { draft: 'Draft', published: 'Live in Thrill Park', retired: 'Retired' } as const

/** "A spinning octopus ride with eight tubs" → "Spinning Octopus Ride". */
function nameFromPrompt(prompt: string) {
  const words = prompt.replace(/[^\p{L}\p{N} '-]/gu, ' ').split(/\s+/).filter(Boolean)
  const stop = words.findIndex((word, i) => i > 0 && /^(with|on|in|and|that|for|of|featuring|under)$/i.test(word))
  const picked = words.slice(/^(a|an|the)$/i.test(words[0] ?? '') ? 1 : 0, stop > 0 ? stop : undefined).slice(0, 4)
  return picked.map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ').slice(0, L.nameMax)
}

function nameFromFile(file: File) {
  const base = file.name.replace(/\.(glb|gltf)$/i, '').replace(/^meshy-\w+-\w+$/i, '').replace(/[_-]+/g, ' ').replace(/[^\p{L}\p{N} .,'&!?()+#/-]/gu, '').trim()
  return (base.charAt(0).toUpperCase() + base.slice(1)).slice(0, L.nameMax)
}

function NumberField({ label, value, min, max, step = 1, onChange, suffix }: { label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void; suffix?: ReactNode }) {
  return <label>{label}{suffix && <small className="rc-suffix">{suffix}</small>}
    <input type="number" value={value} min={min} max={max} step={step} onChange={event => { const n = Number(event.target.value); if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n))) }}/>
  </label>
}

function Slider({ label, value, min, max, step, onChange, format }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void; format: (value: number) => string }) {
  return <label className="rc-slider">{label}<span>{format(value)}</span>
    <input type="range" value={value} min={min} max={max} step={step} onChange={event => onChange(Number(event.target.value))} aria-valuetext={format(value)}/>
  </label>
}

export default function RideCreator() {
  const [records, setRecords] = useState<ParkRideRecord[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [editing, setEditing] = useState<ParkRideRecord | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [sourceChanged, setSourceChanged] = useState(false)
  const [sourceJob, setSourceJob] = useState<string | null>(null)
  const [source, setSource] = useState<SourceModel | null>(null)
  const [reduced, setReduced] = useState<ReducedModel | null>(null)
  const [fixedMesh, setFixedMesh] = useState<RideMesh | null>(null)
  const [size, setSize] = useState<[number, number]>([3, 3])
  const [scale, setScale] = useState(1)
  const [yaw, setYaw] = useState(0)
  const [triangles, setTriangles] = useState(8000)
  const [motion, setMotion] = useState<CustomRideMotion>(DEFAULT_MOTION)
  const [details, setDetails] = useState<Details>(DEFAULT_DETAILS)
  const [suggestion, setSuggestion] = useState<RideSuggestion | null>(null)
  const [playing, setPlaying] = useState(true)
  const [guides, setGuides] = useState(true)
  const [working, setWorking] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice>(null)
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const loadRecords = useCallback(async () => {
    setListError(null)
    try { setRecords(await fetchParkRideRecords()) } catch (error) { setListError((error as Error).message) }
  }, [])
  useEffect(() => { void loadRecords() }, [loadRecords])

  const mesh = useMemo<RideMesh | null>(() => {
    if (reduced) return fitModel(reduced, { size, scale, yaw, motion })
    if (!fixedMesh) return null
    const parts = new Uint8Array(fixedMesh.triangles * 3)
    for (let t = 0; t < fixedMesh.triangles; t++) {
      const centroid = (fixedMesh.positions[t * 9 + 2] + fixedMesh.positions[t * 9 + 5] + fixedMesh.positions[t * 9 + 8]) / 3
      parts.fill(motion.type !== 'none' && centroid >= motion.split ? 1 : 0, t * 3, t * 3 + 3)
    }
    return { ...fixedMesh, parts }
  }, [reduced, fixedMesh, size, scale, yaw, motion])

  const height = mesh ? Math.round(mesh.height * 10) / 10 : 0
  const counts = useMemo(() => mesh ? partCounts(mesh) : null, [mesh])
  const extent = reduced ? rawExtent(reduced, yaw) : null
  const k = reduced ? fitScale(reduced, { size, scale, yaw }) : 1
  const overhang = !!extent && (extent.x * k > size[0] * TILE_METRES + 0.05 || extent.y * k > size[1] * TILE_METRES + 0.05)
  const tooTall = height > L.heightMax

  const updateMotion = (patch: Partial<CustomRideMotion>) => setMotion(current => sanitizeMotion({ ...current, ...patch }))
  const updateDetails = (patch: Partial<Details>) => setDetails(current => ({ ...current, ...patch }))

  async function bake(from: SourceModel, budget: number) {
    setWorking('bake')
    try {
      await new Promise(resolve => setTimeout(resolve, 20))
      setReduced(await reduceSource(from, budget))
    } catch (error) {
      setNotice({ tone: 'error', text: (error as Error).message || 'That model could not be baked.' })
    } finally { setWorking(null) }
  }

  async function openFile(chosen: File, job: MeshyJob | null = null, fromSaved = false, budgetOverride?: number) {
    setNotice(null)
    if (!/\.(glb|gltf)$/i.test(chosen.name)) { setNotice({ tone: 'error', text: 'Choose a .glb or .gltf file.' }); return }
    if (chosen.size > L.sourceBytes) { setNotice({ tone: 'error', text: 'Models must be smaller than 15 MB. Remesh it in the Meshy panel first.' }); return }
    setWorking('load')
    try {
      const loaded = await loadSource(chosen)
      setFile(chosen); setSource(loaded); setFixedMesh(null)
      if (!fromSaved) { setSourceChanged(true); setSourceJob(job?.id ?? null) }
      if (!fromSaved && !details.name) updateDetails({ name: job ? nameFromPrompt(job.prompt) : nameFromFile(chosen) })
      const budget = Math.min(budgetOverride ?? triangles, Math.max(L.trianglesMin, loaded.triangles))
      await bake(loaded, budget)
    } catch (error) {
      setNotice({ tone: 'error', text: 'That model could not be opened. Check that it is a valid glTF 2.0 file.' })
      console.error(error)
      setWorking(null)
    }
  }

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0]
    event.target.value = ''
    if (chosen) void openFile(chosen)
  }

  function reset() {
    setEditing(null); setFile(null); setSource(null); setReduced(null); setFixedMesh(null); setSourceChanged(false); setSourceJob(null)
    setSize([3, 3]); setScale(1); setYaw(0); setTriangles(8000); setMotion(DEFAULT_MOTION); setDetails(DEFAULT_DETAILS); setSuggestion(null); setNotice(null)
  }

  async function edit(record: ParkRideRecord) {
    reset()
    setEditing(record)
    const spec = record.spec
    setSize(spec.size); setScale(spec.bake.scale); setYaw(spec.bake.yaw); setTriangles(spec.bake.triangles); setMotion(spec.motion)
    setDetails({ name: spec.name, description: spec.description, category: spec.category, cost: spec.cost, upkeep: spec.upkeep, capacity: spec.capacity, rideTime: spec.rideTime, loadTime: spec.loadTime, price: spec.price, stats: spec.stats })
    setSourceJob(record.sourceJob)
    document.querySelector('.rc-editor')?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    try {
      if (record.source) {
        setWorking('load')
        const saved = await fetchParkRideSource(record.id)
        await openFile(saved, null, true, spec.bake.triangles)
      } else if (record.meshVersion) {
        setWorking('load')
        const response = await fetch(parkRideMeshUrl(record.id, record.meshVersion), { credentials: 'same-origin' })
        if (!response.ok) throw new Error('The baked model could not be loaded.')
        setFixedMesh(decodeRideMesh(await response.arrayBuffer()))
        setWorking(null)
      }
    } catch (error) {
      setNotice({ tone: 'error', text: (error as Error).message })
      setWorking(null)
    }
  }

  function suggest() {
    const next = suggestStats({ category: details.category, size, height: height || 6, motion: motion.type })
    setSuggestion(next)
    updateDetails({ cost: next.cost, upkeep: next.upkeep, capacity: next.capacity, rideTime: next.rideTime, loadTime: next.loadTime, price: next.price, stats: next.stats })
  }

  function centerPivot() {
    if (!mesh) return
    let sx = 0, sy = 0, n = 0, top = 0
    for (let c = 0; c < mesh.triangles * 3; c++) if (mesh.parts[c]) { sx += mesh.positions[c * 3]; sy += mesh.positions[c * 3 + 1]; top = Math.max(top, mesh.positions[c * 3 + 2]); n++ }
    const x = n ? sx / n : 0, y = n ? sy / n : 0
    const z = motion.type === 'swing' ? top : motion.type === 'wheel' ? motion.split + (top - motion.split) / 2 : motion.split
    updateMotion({ pivot: [Math.round(x * 100) / 100, Math.round(y * 100) / 100, Math.round(z * 100) / 100] })
  }

  function buildSpec(): ParkRideSpec | null {
    if (details.name.trim().length < L.nameMin) { setNotice({ tone: 'error', text: 'Give the ride a name.' }); return null }
    if (!mesh) { setNotice({ tone: 'error', text: 'Open a model first.' }); return null }
    if (tooTall) { setNotice({ tone: 'error', text: `Rides can be at most ${L.heightMax} m tall. Lower the scale.` }); return null }
    return { ...details, name: details.name.trim(), description: details.description.trim(), size, height: Math.max(L.heightMin, height), motion: sanitizeMotion(motion), bake: { scale, yaw, triangles } }
  }

  async function save(status: 'draft' | 'published') {
    const spec = buildSpec()
    if (!spec || !mesh) return
    setWorking(status)
    setNotice(null)
    try {
      const encoded = encodeRideMesh(mesh)
      if (encoded.byteLength > L.meshBytes) throw new Error('The baked ride is too large. Lower the triangle count.')
      const thumb = canvas.current ? await captureThumb(canvas.current) : null
      const record = await saveParkRide({ id: editing?.id, spec, status, mesh: new Blob([encoded], { type: 'application/octet-stream' }), thumb: thumb ?? undefined, source: sourceChanged && file ? file : undefined, sourceJob })
      setEditing(record); setSourceChanged(false)
      setNotice({ tone: 'ok', text: record.status === 'published' ? `${spec.name} is live. Players see it in Thrill Park’s ${CATEGORIES.find(c => c.id === spec.category)?.label} rides the next time they open a park.` : `${spec.name} is saved as a draft. Only you can see it.` })
      await loadRecords()
    } catch (error) {
      setNotice({ tone: 'error', text: (error as Error).message })
    } finally { setWorking(null) }
  }

  async function changeStatus(record: ParkRideRecord, status: ParkRideRecord['status']) {
    setWorking(`status-${record.id}`)
    try {
      const updated = await setParkRideStatus(record.id, status)
      if (editing?.id === record.id) setEditing(updated)
      await loadRecords()
    } catch (error) { setListError((error as Error).message) } finally { setWorking(null) }
  }

  async function remove(record: ParkRideRecord) {
    if (!window.confirm(`Delete the draft “${record.spec.name}”? This can’t be undone.`)) return
    setWorking(`delete-${record.id}`)
    try {
      await deleteParkRide(record.id)
      if (editing?.id === record.id) reset()
      await loadRecords()
    } catch (error) { setListError((error as Error).message) } finally { setWorking(null) }
  }

  const sources: MeshySourceOption[] = useMemo(() => (records ?? []).filter(r => r.source).map(r => ({ label: r.spec.name, source: { rideId: r.id } })), [records])
  const busy = working !== null
  const status = editing?.status ?? 'draft'

  return <div className="account-home ms-items rc">
    <p className="ms-items-note">Turn a Meshy generation or your own .glb into a Thrill Park flat ride. The model is baked into the park’s own lightweight format with its colours, so it runs on every device. Keep rides original: no real park, ride or film names, mascots or logos.</p>

    <MeshyPanel target="ride" sources={sources} onOpen={(opened, job) => void openFile(opened, job)}/>

    <section className="rc-editor" aria-label="Ride editor">
      <header className="rc-editor-head">
        <h2>{editing ? `Editing ${editing.spec.name}` : 'New ride'}</h2>
        {editing && <span className={`ms-items-state is-${status}`}>{STATUS_LABEL[status]}</span>}
        <div className="rc-head-actions">
          <button type="button" onClick={() => fileInput.current?.click()} disabled={busy}><Upload size={14} aria-hidden/> {file ? 'Replace model' : 'Upload .glb'}</button>
          {(editing || file) && <button type="button" onClick={reset} disabled={busy}><Plus size={14} aria-hidden/> Start a new ride</button>}
        </div>
        <input ref={fileInput} type="file" accept=".glb,.gltf,model/gltf-binary,model/gltf+json" hidden onChange={onFile}/>
      </header>

      <div className="ms-items-editor">
        <div className="rc-left">
          <div className="ms-items-stage rc-stage">
            {mesh ? <RideStage mesh={mesh} motion={motion} size={size} rideTime={details.rideTime} loadTime={Math.min(details.loadTime, 4)} playing={playing} guides={guides} onCanvas={c => { canvas.current = c }}/>
              : <button type="button" className="ms-items-drop" onClick={() => fileInput.current?.click()} disabled={busy} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const dropped = event.dataTransfer.files?.[0]; if (dropped) void openFile(dropped) }}>
                <Upload size={22} aria-hidden/> Drop a .glb here, upload one, or pick “Open in editor” on a finished Meshy job above
              </button>}
            {working === 'load' && <p className="ms-items-loading" role="status"><LoaderCircle className="spin" size={14}/> Opening the model…</p>}
            {working === 'bake' && <p className="ms-items-loading" role="status"><LoaderCircle className="spin" size={14}/> Baking colours and simplifying…</p>}
            {mesh && <div className="rc-stage-tools">
              <button type="button" onClick={() => setPlaying(p => !p)} aria-pressed={playing}>{playing ? <Pause size={14} aria-hidden/> : <Play size={14} aria-hidden/>} {playing ? 'Pause' : 'Run cycle'}</button>
              <button type="button" onClick={() => setGuides(g => !g)} aria-pressed={guides}>{guides ? <EyeOff size={14} aria-hidden/> : <Eye size={14} aria-hidden/>} Guides</button>
            </div>}
          </div>

          {mesh && <dl className="ms-items-readout rc-readout">
            <div><dt>Footprint</dt><dd>{size[0]} × {size[1]} squares ({size[0] * TILE_METRES} × {size[1] * TILE_METRES} m)</dd></div>
            <div><dt>Height</dt><dd>{height.toFixed(1)} m{tooTall ? ' · too tall' : ''}</dd></div>
            <div><dt>Triangles</dt><dd>{mesh.triangles.toLocaleString()}{source ? ` of ${source.triangles.toLocaleString()}` : ''}</dd></div>
            {counts && motion.type !== 'none' && <div><dt>Moving part</dt><dd>{counts.moving.toLocaleString()} triangles{counts.moving === 0 ? ' · lower the split height' : ''}</dd></div>}
            <div><dt>Baked size</dt><dd>{Math.round((16 + mesh.triangles * 42) / 1024).toLocaleString()} KB</dd></div>
          </dl>}
          {overhang && <p className="ms-items-error" role="alert">The model hangs over the footprint. Guests and paths next to it will clip into it; lower the scale or enlarge the footprint.</p>}
        </div>

        <div className="ms-items-fields">
          <fieldset disabled={!mesh || busy}>
            <legend>Fit</legend>
            <fieldset className="rc-plain" disabled={status !== 'draft'}>
              <div className="rc-grid2">
                <NumberField label="Width (squares)" value={size[0]} min={L.sizeMin} max={L.sizeMax} onChange={w => setSize([w, size[1]])}/>
                <NumberField label="Depth (squares)" value={size[1]} min={L.sizeMin} max={L.sizeMax} onChange={h => setSize([size[0], h])}/>
              </div>
            </fieldset>
            {status !== 'draft' && <p className="ms-items-note">The footprint is locked because parks have already built this ride.</p>}
            <Slider label="Fill footprint" value={scale} min={0.3} max={1.6} step={0.01} onChange={setScale} format={v => `${Math.round(v * 100)}%`}/>
            <div className="ms-items-scale-actions">
              <button type="button" onClick={() => setYaw((yaw + 1) % 4)}><RotateCw size={14} aria-hidden/> Turn 90° ({yaw * 90}°)</button>
              <button type="button" onClick={() => setScale(1)}>Fit exactly</button>
            </div>
            {source && <div className="rc-bake">
              <NumberField label="Triangle budget" value={triangles} min={L.trianglesMin} max={L.trianglesMax} step={500} onChange={setTriangles} suffix="more looks sharper, fewer runs faster"/>
              <button type="button" onClick={() => void bake(source, triangles)} disabled={busy}>{working === 'bake' ? <LoaderCircle className="spin" size={14}/> : null} Re-bake</button>
            </div>}
          </fieldset>

          <fieldset disabled={!mesh || busy}>
            <legend>Motion</legend>
            <label>How it moves<select value={motion.type} onChange={event => updateMotion({ type: event.target.value as CustomRideMotion['type'] })}>
              {CUSTOM_RIDE_MOTIONS.map(type => <option key={type} value={type}>{MOTION_INFO[type].label}</option>)}
            </select></label>
            <p className="ms-items-note">{MOTION_INFO[motion.type].hint}</p>
            {motion.type !== 'none' && <>
              <Slider label="Moving part starts at" value={Math.min(motion.split, height)} min={0} max={Math.max(0.5, height)} step={0.05} onChange={split => updateMotion({ split })} format={v => v <= 0.001 ? 'the ground (everything moves)' : `${v.toFixed(2)} m`}/>
              <Slider label="Speed" value={motion.speed} min={L.speedMin} max={L.speedMax} step={0.05} onChange={speed => updateMotion({ speed })} format={v => `${v.toFixed(2)}×`}/>
              {(motion.type === 'swing' || motion.type === 'drop' || motion.type === 'bob') && <Slider label={motion.type === 'swing' ? 'Swing' : motion.type === 'drop' ? 'Climb' : 'Bounce'} value={motion.amount} min={0} max={1} step={0.01} onChange={amount => updateMotion({ amount })}
                format={v => motion.type === 'swing' ? `${Math.round(v * 1.4 * 180 / Math.PI)}°` : motion.type === 'drop' ? `${dropTravel({ ...motion, amount: v }, height).toFixed(1)} m` : `${(v * 2).toFixed(2)} m`}/>}
              {(motion.type === 'swing' || motion.type === 'wheel') && <label>Axle runs along<select value={motion.axis} onChange={event => updateMotion({ axis: event.target.value as 'x' | 'y' })}><option value="x">Width</option><option value="y">Depth</option></select></label>}
              {motion.type !== 'drop' && motion.type !== 'bob' && <>
                <div className="rc-grid3">
                  <NumberField label="Pivot X (m)" value={motion.pivot[0]} min={-30} max={30} step={0.1} onChange={x => updateMotion({ pivot: [x, motion.pivot[1], motion.pivot[2]] })}/>
                  <NumberField label="Pivot Y (m)" value={motion.pivot[1]} min={-30} max={30} step={0.1} onChange={y => updateMotion({ pivot: [motion.pivot[0], y, motion.pivot[2]] })}/>
                  <NumberField label="Pivot height (m)" value={motion.pivot[2]} min={0} max={L.heightMax} step={0.1} onChange={z => updateMotion({ pivot: [motion.pivot[0], motion.pivot[1], z] })}/>
                </div>
                <div className="ms-items-scale-actions"><button type="button" onClick={centerPivot}><Wand2 size={14} aria-hidden/> Place pivot from moving part</button></div>
              </>}
            </>}
          </fieldset>

          <fieldset disabled={busy}>
            <legend>Ride details</legend>
            <label>Name<input value={details.name} onChange={event => updateDetails({ name: event.target.value })} maxLength={L.nameMax} placeholder="Comet Spinner"/></label>
            <label>Build menu description<input value={details.description} onChange={event => updateDetails({ description: event.target.value })} maxLength={L.descriptionMax} placeholder="Eight tubs whirl around a towering hub."/></label>
            <label>Category<select value={details.category} onChange={event => updateDetails({ category: event.target.value as ParkRideCategory })}>{CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
            <div className="ms-items-scale-actions"><button type="button" onClick={suggest} disabled={!mesh}><Wand2 size={14} aria-hidden/> Suggest numbers from similar rides</button></div>
            {suggestion && <p className="ms-items-note">Based on {suggestion.neighbours.map(n => `${n.name} (${n.weight}%)`).join(', ')}. Adjust anything below.</p>}
            <div className="rc-grid2">
              <NumberField label="Build cost ($)" value={details.cost} min={L.costMin} max={L.costMax} step={50} onChange={cost => updateDetails({ cost })}/>
              <NumberField label="Upkeep ($/month)" value={details.upkeep} min={0} max={L.upkeepMax} onChange={upkeep => updateDetails({ upkeep })}/>
              <NumberField label="Riders per cycle" value={details.capacity} min={L.capacityMin} max={L.capacityMax} onChange={capacity => updateDetails({ capacity })}/>
              <NumberField label="Ticket price ($)" value={details.price} min={0} max={L.priceMax} step={0.1} onChange={price => updateDetails({ price })}/>
              <NumberField label="Ride time (s)" value={details.rideTime} min={L.rideTimeMin} max={L.rideTimeMax} onChange={rideTime => updateDetails({ rideTime })}/>
              <NumberField label="Loading time (s)" value={details.loadTime} min={L.loadTimeMin} max={L.loadTimeMax} onChange={loadTime => updateDetails({ loadTime })}/>
            </div>
            <div className="rc-grid3">
              <NumberField label="Excitement" value={details.stats.e} min={0} max={L.statMax} step={0.05} onChange={e => updateDetails({ stats: { ...details.stats, e } })}/>
              <NumberField label="Intensity" value={details.stats.i} min={0} max={L.statMax} step={0.05} onChange={i => updateDetails({ stats: { ...details.stats, i } })}/>
              <NumberField label="Nausea" value={details.stats.n} min={0} max={L.statMax} step={0.05} onChange={n => updateDetails({ stats: { ...details.stats, n } })}/>
            </div>
            <p className="ms-items-note">Guests skip rides above their intensity limit: kids stay under about 3, casual guests about 5.5 and thrill seekers ride almost anything. Players pay {money(details.cost)} to build it.</p>
          </fieldset>

          {notice && <p role={notice.tone === 'error' ? 'alert' : 'status'} className={notice.tone === 'error' ? 'ms-items-error' : 'ms-items-ok'}>{notice.text}</p>}
          <div className="ms-items-submit">
            {status === 'draft' && <button type="button" className="ms-items-draft" disabled={busy || !mesh} onClick={() => void save('draft')}>{working === 'draft' ? <LoaderCircle className="spin" size={14}/> : null} Save draft</button>}
            <button type="button" className="ms-items-publish" disabled={busy || !mesh} onClick={() => void save('published')}>{working === 'published' ? <LoaderCircle className="spin" size={14}/> : <Send size={14} aria-hidden/>} {status === 'draft' ? 'Publish to Thrill Park' : 'Save and publish changes'}</button>
          </div>
          {status !== 'draft' && <p className="ms-items-note">Changes reach parks the next time they’re opened. Rides already built keep their place and footprint.</p>}
        </div>
      </div>
    </section>

    <h2>Your rides</h2>
    {listError && <p className="ms-items-error" role="alert">{listError}</p>}
    {records === null && !listError && <p role="status"><LoaderCircle className="spin" size={16}/> Loading rides…</p>}
    {records?.length === 0 && <p className="ms-items-note">No custom rides yet. Generate one with Meshy above or upload a .glb.</p>}
    {!!records?.length && <ul className="ms-items-list rc-list">
      {records.map(record => <li key={record.id} className={`is-${record.status}`}>
        {record.thumb ? <img src={parkRideThumbUrl(record.id, record.meshVersion)} alt="" width={96} height={60} loading="lazy"/> : <span className="rc-thumb" aria-hidden/>}
        <div>
          <strong>{record.spec.name}</strong>
          <span>{CATEGORIES.find(c => c.id === record.spec.category)?.label} · {record.spec.size[0]}×{record.spec.size[1]} · {record.spec.height.toFixed(1)} m · {MOTION_INFO[record.spec.motion.type].label} · {money(record.spec.cost)}</span>
          <span className={`ms-items-state is-${record.status}`}>{STATUS_LABEL[record.status]}</span>
        </div>
        <button type="button" onClick={() => void edit(record)} disabled={busy}><Pencil size={14} aria-hidden/> Edit</button>
        {record.status === 'draft' && <button type="button" onClick={() => void changeStatus(record, 'published')} disabled={busy || !record.meshVersion}><Send size={14} aria-hidden/> Publish</button>}
        {record.status === 'published' && <button type="button" onClick={() => void changeStatus(record, 'retired')} disabled={busy}><Archive size={14} aria-hidden/> Retire</button>}
        {record.status === 'retired' && <button type="button" onClick={() => void changeStatus(record, 'published')} disabled={busy}><Send size={14} aria-hidden/> Restore</button>}
        {record.status === 'draft' && <button type="button" onClick={() => void remove(record)} disabled={busy} aria-label={`Delete ${record.spec.name}`}><Trash2 size={14} aria-hidden/></button>}
      </li>)}
    </ul>}
    <p className="ms-items-note">Retired rides leave the build menu, but parks that already built one keep it running. Only drafts can be deleted.</p>
  </div>
}
