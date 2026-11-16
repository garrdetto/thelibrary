import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Eye, EyeOff, LocateFixed, RotateCcw, RotateCw, Trash2 } from 'lucide-react'
import type { BuildingData, BuildingKind, LotData, RoadData, RoadKind } from '../../../modules-src/tello/data/MapData'
import { ROOF } from '../../../modules-src/tello/data/MapData'
import { densify, offsetDense, simplify, type Box } from '../../../modules-src/tello/edits/Geom'
import { BUILDING_KINDS, ROAD_KIND_NAMES, describeOp, newOpId, type BuildingSetOp, type EditOp } from '../../../modules-src/tello/edits/WorldEdits'
import type { EditorModel } from './model'
import { fromLake, toLake } from './model'
import type { ToolRunner } from './tools'
import { opBounds } from './opDraw'
import { ROAD_KIND_OPTIONS, ROOF_OPTIONS } from './ToolPanel'
import { Check, Colour, Num, Pick, Section, Text } from './ui'

interface Props { model: EditorModel; runner: ToolRunner | null; zoomTo: (box: Box) => void }

const base = () => ({ id: newOpId(), ts: Date.now() })

/** The ops a feature came from, when an edit added it (`<op id>` or `<op id>:<part>`). */
function sourceOp(model: EditorModel, id: string | undefined): EditOp | undefined {
  if (!id) return undefined
  const head = id.split(':')[0]
  return model.ops.find((o) => o.id === head)
}

export function Inspector({ model, runner, zoomTo }: Props) {
  const sel = model.selection
  const land = model.land
  if (!sel || !land) return <Section title="Selection"><p className="we-hint">Pick the Select tool (V) and click a road, building, parking lot, light, wall or rail on the map, or an edit in the list below.</p></Section>
  if (sel.kind === 'road') {
    const r = land.doc.roads.find((x) => x.id === sel.id)
    return r ? <RoadInspector key={r.id} model={model} runner={runner} road={r} /> : <Gone model={model} />
  }
  if (sel.kind === 'building') {
    const b = land.doc.buildings.find((x) => x.id === sel.id && !x.x)
    return b ? <BuildingInspector key={b.id} model={model} runner={runner} b={b} /> : <Gone model={model} />
  }
  if (sel.kind === 'lot') {
    const l = land.doc.lots.find((x) => x.id === sel.id)
    return l ? <LotInspector key={l.id} model={model} runner={runner} lot={l} /> : <Gone model={model} />
  }
  const op = model.ops.find((o) => o.id === sel.id)
  return op ? <OpInspector key={op.id} model={model} op={op} zoomTo={zoomTo} /> : <Gone model={model} />
}

function Gone({ model }: { model: EditorModel }) {
  return <Section title="Selection"><p className="we-hint">That is no longer on the map.</p><button type="button" className="we-btn" onClick={() => model.select(null)}>Clear selection</button></Section>
}

function FromEdit({ model, id }: { model: EditorModel; id?: string }) {
  const op = sourceOp(model, id)
  if (!op) return null
  return <p className="we-note">Added by an edit: <button type="button" className="we-link" onClick={() => model.select({ kind: 'op', id: op.id })}>{describeOp(op)}</button></p>
}

function RoadInspector({ model, runner, road }: { model: EditorModel; runner: ToolRunner | null; road: RoadData }) {
  const [n, setN] = useState(road.n)
  const [k, setK] = useState<RoadKind>(road.k)
  const [w, setW] = useState(road.w)
  const [walkW, setWalkW] = useState(1.8)
  const [shoulder, setShoulder] = useState(1.5)
  const [smooth, setSmooth] = useState(40)
  const changed = n !== road.n || k !== road.k || Math.abs(w - road.w) > 0.001
  const apply = () => model.add({ ...base(), type: 'roadSet', ref: road.id!, n: n !== road.n ? n.trim() : undefined, k: k !== road.k ? k : undefined, w: Math.abs(w - road.w) > 0.001 ? w : undefined })
  const grade = () => {
    const land = model.land!
    const dense = densify(road.p, 2)
    const raw: number[] = []
    for (let i = 0; i < dense.length; i += 2) raw.push(land.heightAt(dense[i], dense[i + 1]))
    const win = Math.max(1, Math.round(smooth / 4))
    const avg = (v: number[]) => v.map((_x, i) => { let s = 0, c = 0; for (let j = Math.max(0, i - win); j <= Math.min(v.length - 1, i + win); j++) { s += v[j]; c++ } return s / c })
    const prof = avg(avg(raw))
    const pts = simplify(dense, 0.05)
    const heights: number[] = []
    let di = 0
    for (let k2 = 0; k2 < pts.length; k2 += 2) {
      while (di < dense.length / 2 - 1 && (dense[di * 2] !== pts[k2] || dense[di * 2 + 1] !== pts[k2 + 1])) di++
      heights.push(Math.round(prof[Math.min(di, prof.length - 1)] * 100) / 100)
    }
    model.add({ ...base(), type: 'terrain', mode: 'grade', shape: { k: 'path', pts: pts.map((v) => Math.round(v * 100) / 100), r: road.w / 2 + shoulder }, heights, falloff: 8, strength: 1, carry: false, note: `Even out ${road.n || ROAD_KIND_NAMES[road.k].toLowerCase()}` })
  }
  const sidewalks = () => {
    const d = road.w / 2 + 1.2 + walkW / 2
    const dense = densify(road.p, 2)
    const ops: EditOp[] = [1, -1].map((side) => ({ ...base(), id: newOpId(Date.now() + side), type: 'road' as const, pts: simplify(offsetDense(dense, d * side), 0.05).map((v) => Math.round(v * 100) / 100), curve: 0, w: walkW, k: 4 as RoadKind, n: '', grade: null }))
    model.add(ops)
  }
  return <Section title={road.n || ROAD_KIND_NAMES[road.k]}>
    <FromEdit model={model} id={road.id} />
    <p className="we-hint small">{ROAD_KIND_NAMES[road.k]} · {road.w.toFixed(1)} m wide · {(road.p.length / 2) | 0} points · id {road.id}</p>
    <Text label="Name" value={n} onChange={setN} />
    <Pick label="Kind" value={k} options={ROAD_KIND_OPTIONS} onChange={setK} />
    <Num label="Width" value={w} min={0.8} max={40} step={0.1} unit="m" onChange={setW} />
    <div className="we-row"><button type="button" className="we-btn is-primary" disabled={!changed} onClick={apply}>Apply changes</button></div>
    <div className="we-row wrap">
      <button type="button" className="we-btn" onClick={() => runner?.startRedraw(road)}>Redraw its line</button>
      <button type="button" className="we-btn danger" onClick={() => { model.add({ ...base(), type: 'roadRemove', ids: [road.id!] }); model.select(null) }}><Trash2 size={14} aria-hidden /> Remove</button>
    </div>
    <div className="we-callout">
      <strong>Even out the road</strong>
      <p>Levels the ground under it flat across and smooth along, so the surface has no bumps.</p>
      <Num label="Shoulder" value={shoulder} min={0} max={20} step={0.5} unit="m" onChange={setShoulder} />
      <Num label="Smooth along" value={smooth} min={4} max={300} step={2} log unit="m" onChange={setSmooth} />
      <button type="button" className="we-btn" onClick={grade}>Level the ground under it</button>
    </div>
    {road.k <= 2 && <div className="we-callout">
      <strong>Add sidewalks</strong>
      <Num label="Sidewalk width" value={walkW} min={0.8} max={6} step={0.1} unit="m" onChange={setWalkW} />
      <button type="button" className="we-btn" onClick={sidewalks}>Add a sidewalk on both sides</button>
    </div>}
  </Section>
}

function BuildingInspector({ model, runner, b }: { model: EditorModel; runner: ToolRunner | null; b: BuildingData }) {
  const r0 = b.r[0] ?? [0, 0, 1, 1, 0, 0, b.h, b.h]
  const [k, setK] = useState<BuildingKind>(b.k)
  const [h, setH] = useState(b.h)
  const [roof, setRoof] = useState<number>(r0[5] < 0 ? ROOF.flat : r0[5])
  const [ridge, setRidge] = useState(Math.max(0, r0[7] - r0[6]))
  const [rc, setRc] = useState(b.rc ?? '#5c5853')
  const [n, setN] = useState(b.n ?? '')
  const [f, setF] = useState(toLake(b.f))
  useEffect(() => { setF(toLake(b.f)); setH(b.h) }, [b.f, b.h])
  const apply = () => {
    const op: BuildingSetOp = { ...base(), type: 'buildingSet', ref: b.id! }
    if (k !== b.k) op.k = k
    if (Math.abs(h - b.h) > 0.001) op.h = h
    if (roof !== r0[5]) op.roof = roof
    if (Math.abs(ridge - (r0[7] - r0[6])) > 0.001) op.ridge = ridge
    if (rc !== (b.rc ?? '#5c5853')) op.rc = rc
    if (n !== (b.n ?? '')) op.n = n.trim()
    if (Math.abs(fromLake(f) - b.f) > 0.005) op.f = Math.round(fromLake(f) * 100) / 100
    if (Object.keys(op).length <= 4) return
    model.add(op)
  }
  return <Section title={b.n || `${b.k[0].toUpperCase()}${b.k.slice(1)}`}>
    <FromEdit model={model} id={b.id} />
    <p className="we-hint small">{b.r.length} block{b.r.length === 1 ? '' : 's'} · id {b.id}. Drag it on the map to move it.</p>
    <Pick label="Kind" value={k} options={BUILDING_KINDS.map((x) => ({ value: x, label: x[0].toUpperCase() + x.slice(1) }))} onChange={setK} />
    <Num label="Wall height" value={h} min={2} max={60} step={0.1} unit="m" onChange={setH} />
    <Pick label="Roof" value={roof} options={ROOF_OPTIONS} onChange={setRoof} />
    {roof !== ROOF.flat && <Num label="Roof rise" value={ridge} min={0} max={20} step={0.1} unit="m" onChange={setRidge} />}
    <Colour label="Roof colour" value={rc} onChange={setRc} />
    <Text label="Name" value={n} onChange={setN} />
    <Num label="Floor height" value={f} min={toLake(0)} max={60} step={0.05} slider={false} unit="m" hint="vs the lake" onChange={setF} />
    <div className="we-row wrap">
      <button type="button" className="we-btn is-primary" onClick={apply}>Apply changes</button>
      <button type="button" className="we-btn" title="Turn 15° left" onClick={() => runner?.rotateSelected(15)}><RotateCcw size={14} aria-hidden /> 15°</button>
      <button type="button" className="we-btn" title="Turn 15° right" onClick={() => runner?.rotateSelected(-15)}><RotateCw size={14} aria-hidden /> 15°</button>
      <button type="button" className="we-btn danger" onClick={() => { model.add({ ...base(), type: 'buildingRemove', ids: [b.id!] }); model.select(null) }}><Trash2 size={14} aria-hidden /> Remove</button>
    </div>
  </Section>
}

function LotInspector({ model, runner, lot }: { model: EditorModel; runner: ToolRunner | null; lot: LotData }) {
  const [n, setN] = useState(lot.n ?? '')
  const [stripes, setStripes] = useState(!lot.ns)
  const [f, setF] = useState(toLake(lot.f))
  const changed = n !== (lot.n ?? '') || stripes !== !lot.ns || Math.abs(fromLake(f) - lot.f) > 0.005
  return <Section title={lot.n || 'Parking lot'}>
    <FromEdit model={model} id={lot.id} />
    <p className="we-hint small">{lot.p.length / 2} corners · id {lot.id}</p>
    <Text label="Name" value={n} onChange={setN} />
    <Check label="Paint parking stalls" checked={stripes} onChange={setStripes} />
    <Num label="Slab height" value={f} min={toLake(0)} max={60} step={0.05} slider={false} unit="m" hint="vs the lake" onChange={setF} />
    <div className="we-row wrap">
      <button type="button" className="we-btn is-primary" disabled={!changed} onClick={() => model.add({ ...base(), type: 'lotSet', ref: lot.id!, n: n !== (lot.n ?? '') ? n.trim() : undefined, stripes: stripes !== !lot.ns ? stripes : undefined, f: Math.abs(fromLake(f) - lot.f) > 0.005 ? Math.round(fromLake(f) * 100) / 100 : undefined })}>Apply changes</button>
      <button type="button" className="we-btn" onClick={() => { model.setTool('lotEdit'); if (runner) { runner.lotEdit = { lot, ring: [...lot.p] }; model.emit() } }}>Reshape</button>
      <button type="button" className="we-btn" onClick={() => model.add({ ...base(), type: 'lotClip', ids: [lot.id!], margin: model.settings.lot.margin })}>Trim off the roads</button>
      <button type="button" className="we-btn danger" onClick={() => { model.add({ ...base(), type: 'lotRemove', ids: [lot.id!] }); model.select(null) }}><Trash2 size={14} aria-hidden /> Remove</button>
    </div>
  </Section>
}

const SKIP_KEYS = new Set(['id', 'ts', 'type', 'pts', 'ring', 'shape', 'heights', 'ids', 'yaw', 'at', 'replaces', 'on', 'note', 'ref', 'mix', 'levels', 'height', 'walk', 'grade'])
const HEIGHT_KEYS = new Set(['height', 'level', 'f'])

function OpInspector({ model, op, zoomTo }: { model: EditorModel; op: EditOp; zoomTo: (box: Box) => void }) {
  const index = model.ops.indexOf(op)
  const problem = model.report.skipped.find((s) => s.id === op.id)
  const [note, setNote] = useState(op.note ?? '')
  const fields = Object.entries(op).filter(([key, v]) => !SKIP_KEYS.has(key) && (typeof v === 'number' || typeof v === 'boolean' || (typeof v === 'string' && key !== 'mode' && key !== 'style')))
  const patch = (p: Partial<EditOp>) => model.update(op.id, p)
  const shapeRadius = 'shape' in op && op.shape && op.shape.k === 'path' ? op.shape.r : null
  return <Section title={describeOp(op)}>
    <p className="we-hint small">Edit {index + 1} of {model.ops.length} · {op.type}{'mode' in op && op.mode ? ` · ${op.mode}` : ''} · {new Date(op.ts).toLocaleString()}</p>
    {problem && <p className="we-warn">Not applied: {problem.why}</p>}
    <Text label="Label" value={note} placeholder="Your own name for this edit" max={120} onChange={setNote} />
    {note !== (op.note ?? '') && <div className="we-row"><button type="button" className="we-btn" onClick={() => patch({ note: note.trim() || undefined })}>Save label</button></div>}
    {shapeRadius !== null && 'shape' in op && op.shape && <Num label="Radius" value={shapeRadius} min={0.5} max={4000} step={0.5} log unit="m" onChange={(r) => patch({ shape: { ...(op.shape as { k: 'path'; pts: number[]; r: number }), r } } as Partial<EditOp>)} />}
    {'height' in op && typeof op.height === 'number' && <Num label="Height" value={toLake(op.height)} min={toLake(0)} max={60} step={0.05} slider={false} unit="m" hint="vs the lake" onChange={(v) => patch({ height: Math.round(fromLake(v) * 100) / 100 } as Partial<EditOp>)} />}
    {fields.map(([key, v]) => {
      if (typeof v === 'boolean') return <Check key={key} label={label(key)} checked={v} onChange={(x) => patch({ [key]: x } as Partial<EditOp>)} />
      if (typeof v === 'string') return <Text key={key} label={label(key)} value={v} onChange={(x) => patch({ [key]: x } as Partial<EditOp>)} />
      if (HEIGHT_KEYS.has(key)) return <Num key={key} label={label(key)} value={toLake(v as number)} min={toLake(0)} max={60} step={0.05} slider={false} unit="m" hint="vs the lake" onChange={(x) => patch({ [key]: Math.round(fromLake(x) * 100) / 100 } as Partial<EditOp>)} />
      const num = v as number
      const max = Math.max(1, Math.abs(num) * 4, key === 'strength' ? 1 : 10)
      return <Num key={key} label={label(key)} value={num} min={key === 'strength' ? 0 : Math.min(0, num)} max={key === 'strength' ? 1 : max} step={key === 'k' || key === 'roof' ? 1 : 0.05} slider={false} onChange={(x) => patch({ [key]: x } as Partial<EditOp>)} />
    })}
    <div className="we-row wrap">
      <button type="button" className="we-btn" onClick={() => model.toggle(op.id)}>{op.on === false ? <><Eye size={14} aria-hidden /> Switch on</> : <><EyeOff size={14} aria-hidden /> Switch off</>}</button>
      <button type="button" className="we-btn" onClick={() => { const b = model.land && opBounds(op, model.land); if (b) zoomTo(b) }}><LocateFixed size={14} aria-hidden /> Show</button>
      <button type="button" className="we-btn" disabled={index <= 0} title="Apply earlier" onClick={() => model.move(op.id, index - 1)}><ArrowUp size={14} aria-hidden /></button>
      <button type="button" className="we-btn" disabled={index >= model.ops.length - 1} title="Apply later" onClick={() => model.move(op.id, index + 1)}><ArrowDown size={14} aria-hidden /></button>
      <button type="button" className="we-btn danger" onClick={() => model.remove(op.id)}><Trash2 size={14} aria-hidden /> Delete</button>
    </div>
  </Section>
}

const LABELS: Record<string, string> = {
  falloff: 'Fade out (m)', amount: 'Amount (m)', strength: 'Strength', size: 'Size (m)', carry: 'Move what stands on it', level: 'Level', dig: 'Dig the bed (m)', fill: 'Fill the bed',
  curve: 'Corner radius (m)', w: 'Width (m)', depth: 'Depth (m)', bank: 'Bank (m)', k: 'Kind', n: 'Name', x: 'x', z: 'z', d: 'Depth (m)', h: 'Height (m)', ridge: 'Roof rise (m)', roof: 'Roof type',
  rc: 'Roof colour', density: 'Trees a hectare', seed: 'Seed', floor: 'Woods on the ground', side: 'Side', th: 'Thickness (m)', posts: 'Pillar every (m)', cap: 'Cap', closed: 'Closed loop', margin: 'Gap (m)',
  stripes: 'Stalls', dx: 'Move east (m)', dz: 'Move north (m)', fit: 'Curve',
}

function label(key: string): string {
  return LABELS[key] ?? key
}
