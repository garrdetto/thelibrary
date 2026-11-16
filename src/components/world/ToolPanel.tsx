import type { ComponentType } from 'react'
import {
  ArrowDownToLine, ArrowUpToLine, Building2, CircleOff, Droplets, Eraser, Fence, Footprints, Grip, Lamp, LampFloor, Landmark, Mountain, MousePointer2,
  ParkingSquare, PencilRuler, Route, Ruler, Scissors, Shovel, Sparkles, SquareDashed, TreeDeciduous, TreePine, Trash2, Waves, Waypoints, Wind,
} from 'lucide-react'
import type { RoadKind } from '../../../modules-src/tello/data/MapData'
import { BUILDING_KINDS, LIGHT_STYLES, LIGHT_STYLE_NAMES, ROAD_KIND_NAMES, WALL_STYLES, WALL_STYLE_NAMES, newOpId } from '../../../modules-src/tello/edits/WorldEdits'
import { ROOF } from '../../../modules-src/tello/data/MapData'
import type { EditorModel } from './model'
import { toLake } from './model'
import { LINE_TOOLS, SHAPED_TOOLS, TOOL_GROUPS, toolInfo, type ToolId } from './settings'
import type { ToolRunner } from './tools'
import { toolColor } from './tools'
import { Check, Colour, Num, Pick, Section, Segmented, Text } from './ui'

const ICONS: Record<ToolId, ComponentType<{ size?: number; strokeWidth?: number; 'aria-hidden'?: boolean }>> = {
  select: MousePointer2, raise: ArrowUpToLine, lower: ArrowDownToLine, flatten: Ruler, smooth: Wind, noise: Mountain, grade: PencilRuler,
  fill: Droplets, level: Waves, paint: Sparkles, drain: Shovel, river: Waypoints,
  road: Route, redraw: Grip, roadRemove: Scissors,
  building: Building2, buildingRemove: Trash2,
  lot: ParkingSquare, lotEdit: SquareDashed, lotRemove: CircleOff,
  plant: TreePine, clear: Eraser,
  rail: Footprints, railCut: Scissors, light: Lamp, lightRow: LampFloor, lightCut: Scissors, wall: Fence,
}

export const ROOF_OPTIONS = [
  { value: ROOF.flat, label: 'Flat' },
  { value: ROOF.gableFirst, label: 'Gable (ridge along width)' },
  { value: ROOF.gableSecond, label: 'Gable (ridge along depth)' },
  { value: ROOF.hip, label: 'Hip' },
  { value: ROOF.shedPlusSecond, label: 'Single slope' },
] as const

export const ROAD_KIND_OPTIONS = ([0, 1, 2, 3, 4, 5] as RoadKind[]).map((k) => ({ value: k, label: ROAD_KIND_NAMES[k] }))

export function ToolPalette({ model, onPick }: { model: EditorModel; onPick: (id: ToolId) => void }) {
  return <nav className="we-palette" aria-label="World editor tools">
    {TOOL_GROUPS.map((g) => <div key={g.name} className="we-palette-group">
      <p>{g.name}</p>
      {g.tools.map((t) => {
        const Icon = ICONS[t.id]
        return <button key={t.id} type="button" aria-pressed={model.tool === t.id} className={model.tool === t.id ? 'is-on' : ''} onClick={() => onPick(t.id)} title={`${t.label}${t.key ? ` (${t.key})` : ''}: ${t.hint}`} style={model.tool === t.id ? { ['--we-tool' as string]: toolColor(t.id) } : undefined}>
          <Icon size={16} strokeWidth={1.8} aria-hidden /><span>{t.label}</span>{t.key && <kbd>{t.key}</kbd>}
        </button>
      })}
    </div>)}
  </nav>
}

export function ToolOptions({ model, runner }: { model: EditorModel; runner: ToolRunner | null }) {
  const t = model.tool
  const s = model.settings
  const info = toolInfo(t)
  const set = (patch: Partial<typeof s>) => model.patchSettings(patch)
  const shaped = SHAPED_TOOLS.has(t)
  const line = LINE_TOOLS.has(t)
  const terrain = t === 'raise' || t === 'lower' || t === 'flatten' || t === 'smooth' || t === 'noise'
  const points = runner?.line.length ?? 0
  return <Section title={info.label}>
    <p className="we-hint">{info.hint}</p>
    {shaped && <Segmented label="Shape" value={s.shape} options={[{ value: 'brush', label: 'Brush' }, { value: 'area', label: 'Outline' }, { value: 'rect', label: 'Rectangle' }]} onChange={(shape) => { runner?.reset(); set({ shape }) }} />}
    {shaped && s.shape === 'brush' && <Num label="Brush radius" value={s.radius} min={1} max={2000} step={0.5} log unit="m" onChange={(radius) => set({ radius })} hint="[ and ] change it" />}
    {shaped && s.shape === 'area' && <p className="we-hint">Click the corners, then Enter or double-click. Big outlines can cover a whole quarter of the map.</p>}
    {(terrain || t === 'grade') && <Num label="Fade out" value={s.falloff} min={0} max={500} step={0.5} log={false} unit="m" onChange={(falloff) => set({ falloff })} />}
    {(t === 'raise' || t === 'lower') && <Num label="Amount" value={s.amount} min={0.05} max={30} step={0.05} log unit="m" onChange={(amount) => set({ amount })} />}
    {t === 'noise' && <><Num label="Bump height" value={s.amount} min={0.05} max={10} step={0.05} log unit="m" onChange={(amount) => set({ amount })} /><Num label="Bump size" value={s.noiseSize} min={4} max={400} step={1} log unit="m" onChange={(noiseSize) => set({ noiseSize })} /></>}
    {t === 'flatten' && <Num label="Height" value={s.height} min={toLake(0)} max={60} step={0.05} slider={false} unit="m" hint="vs the lake; Alt-click picks it" onChange={(height) => set({ height })} />}
    {t === 'smooth' && <Num label="Blur size" value={s.smoothSize} min={4} max={200} step={1} log unit="m" onChange={(smoothSize) => set({ smoothSize })} />}
    {(t === 'flatten' || t === 'smooth' || t === 'noise' || t === 'grade') && <Num label="Strength" value={s.strength} min={0.05} max={1} step={0.05} unit="" onChange={(strength) => set({ strength })} />}
    {(terrain || t === 'grade') && <Check label="Move what stands on it" hint="buildings, lots, bridges and water rise and fall with the ground" checked={s.carry} onChange={(carry) => set({ carry })} />}
    {t === 'grade' && <GradeOptions model={model} runner={runner} />}
    {(t === 'fill' || t === 'level' || t === 'paint') && <Num label="Water level" value={s.level} min={toLake(0.2)} max={50} step={0.05} slider={false} unit="m" hint="vs Lake Montello; Alt-click picks it" onChange={(level) => set({ level })} />}
    {t === 'paint' && <Num label="Dig the bed" value={s.dig} min={0} max={10} step={0.1} unit="m" hint="0 keeps the ground" onChange={(dig) => set({ dig })} />}
    {t === 'drain' && <Check label="Fill the bed to dry ground" checked={s.drainFill} onChange={(drainFill) => set({ drainFill })} />}
    {t === 'river' && <RiverOptions model={model} />}
    {(t === 'road' || t === 'redraw') && <RoadOptions model={model} runner={runner} />}
    {t === 'building' && <BuildingOptions model={model} />}
    {(t === 'lot' || t === 'lotEdit' || t === 'lotRemove') && <LotOptions model={model} runner={runner} />}
    {t === 'plant' && <TreeOptions model={model} />}
    {t === 'rail' && <Segmented label="Beam faces" value={s.rail.side === 1 ? 'right' : 'left'} options={[{ value: 'left', label: 'Left of the line' }, { value: 'right', label: 'Right of the line' }]} onChange={(v) => model.patchGroup('rail', { side: v === 'right' ? 1 : -1 })} />}
    {(t === 'light' || t === 'lightRow') && <LightOptions model={model} />}
    {t === 'wall' && <WallOptions model={model} />}
    {line && <div className="we-row">
      <span className="we-points">{points} point{points === 1 ? '' : 's'}</span>
      <button type="button" className="we-btn" disabled={!points} onClick={() => runner?.backspace()}>Undo point</button>
      <button type="button" className="we-btn" disabled={!points && !runner?.replacing} onClick={() => runner?.reset()}>Cancel</button>
      <button type="button" className="we-btn is-primary" disabled={points < (t === 'lot' ? 3 : 2)} onClick={() => runner?.finish()}>Build (Enter)</button>
    </div>}
    {shaped && s.shape === 'area' && <div className="we-row">
      <span className="we-points">{points} corner{points === 1 ? '' : 's'}</span>
      <button type="button" className="we-btn" disabled={!points} onClick={() => runner?.reset()}>Cancel</button>
      <button type="button" className="we-btn is-primary" disabled={points < 3} onClick={() => runner?.finish()}>Apply (Enter)</button>
    </div>}
    {line && <p className="we-hint small">Drag a point to move it, Alt-click a point to delete it, Ctrl-click a line to add a point between two.</p>}
  </Section>
}

function GradeOptions({ model, runner }: { model: EditorModel; runner: ToolRunner | null }) {
  const s = model.settings
  const pts = runner?.line ?? []
  return <>
    <Num label="Half width" value={s.gradeHalf} min={0.5} max={200} step={0.5} log unit="m" onChange={(gradeHalf) => model.patchSettings({ gradeHalf })} />
    {pts.length > 0 && <div className="we-heights">
      <span className="we-label">Height at each point (vs the lake)</span>
      {pts.map((p, i) => <label key={i}><span>{i + 1}</span><input type="number" step={0.05} value={Number(toLake(p.h).toFixed(2))} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) { p.h = v + (p.h - toLake(p.h)); model.emit() } }} /></label>)}
      <button type="button" className="we-btn" onClick={() => {
        if (pts.length < 2) return
        const a = pts[0].h, b = pts[pts.length - 1].h
        let total = 0
        const cum = [0]
        for (let i = 1; i < pts.length; i++) { total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z); cum.push(total) }
        pts.forEach((p, i) => { p.h = a + (b - a) * (cum[i] / (total || 1)) })
        model.emit()
      }}>Even slope from first to last</button>
    </div>}
  </>
}

function RiverOptions({ model }: { model: EditorModel }) {
  const r = model.settings.river
  const set = (patch: Partial<typeof r>) => model.patchGroup('river', patch)
  return <>
    <Num label="Water width" value={r.w} min={2} max={80} step={0.5} unit="m" onChange={(w) => set({ w })} />
    <Num label="Depth" value={r.depth} min={0.3} max={8} step={0.1} unit="m" onChange={(depth) => set({ depth })} />
    <Num label="Bank width" value={r.bank} min={0} max={60} step={0.5} unit="m" onChange={(bank) => set({ bank })} />
    <Segmented label="Curve" value={r.fit} options={[{ value: 'spline', label: 'Through the points' }, { value: 'arcs', label: 'Rounded corners' }]} onChange={(fit) => set({ fit })} />
    {r.fit === 'arcs' && <Num label="Corner radius" value={r.curve} min={0} max={400} step={1} unit="m" onChange={(curve) => set({ curve })} />}
    <Check label="Levels from the water or ground at the ends" checked={r.auto} onChange={(auto) => set({ auto })} />
    {!r.auto && <>
      <Num label="Level at the first point" value={r.start} min={toLake(0.2)} max={50} step={0.05} slider={false} unit="m" onChange={(start) => set({ start })} />
      <Num label="Level at the last point" value={r.end} min={toLake(0.2)} max={50} step={0.05} slider={false} unit="m" onChange={(end) => set({ end })} />
    </>}
  </>
}

function RoadOptions({ model, runner }: { model: EditorModel; runner: ToolRunner | null }) {
  const r = model.settings.road
  const set = (patch: Partial<typeof r>) => { model.patchGroup('road', patch); runner && model.emit() }
  return <>
    {runner?.replacing && <p className="we-note">Redrawing <strong>{runner.replacing.n || ROAD_KIND_NAMES[runner.replacing.k]}</strong>: building it replaces the old line.</p>}
    <Pick label="Kind" value={r.k} options={ROAD_KIND_OPTIONS} onChange={(k) => set({ k, w: k === 0 ? 9 : k === 1 ? 7.4 : k === 2 ? 4 : k === 3 ? 4 : k === 4 ? 1.8 : 1.5 })} />
    <Num label="Width" value={r.w} min={0.8} max={40} step={0.1} unit="m" onChange={(w) => set({ w })} />
    <Text label="Name" value={r.n} placeholder="Leave empty for none" onChange={(n) => set({ n })} />
    <Segmented label="Curve" value={r.fit} options={[{ value: 'arcs', label: 'Rounded corners' }, { value: 'spline', label: 'Through the points' }]} onChange={(fit) => set({ fit })} />
    {r.fit === 'arcs' && <Num label="Corner radius" value={r.curve} min={0} max={400} step={1} unit="m" onChange={(curve) => set({ curve })} />}
    <div className="we-pair">
      <Check label="Sidewalk left" checked={r.walkLeft} onChange={(walkLeft) => set({ walkLeft })} />
      <Check label="Sidewalk right" checked={r.walkRight} onChange={(walkRight) => set({ walkRight })} />
    </div>
    {(r.walkLeft || r.walkRight) && <>
      <Num label="Sidewalk width" value={r.walkW} min={0.8} max={6} step={0.1} unit="m" onChange={(walkW) => set({ walkW })} />
      <Num label="Grass strip" value={r.walkGap} min={0} max={6} step={0.1} unit="m" onChange={(walkGap) => set({ walkGap })} />
    </>}
    <Check label="Level the ground under it" hint="flat across, smooth along; fills across water" checked={r.grade} onChange={(grade) => set({ grade })} />
    {r.grade && <>
      <Num label="Shoulder" value={r.shoulder} min={0} max={20} step={0.5} unit="m" onChange={(shoulder) => set({ shoulder })} />
      <Num label="Blend out" value={r.gradeFalloff} min={0} max={80} step={1} unit="m" onChange={(gradeFalloff) => set({ gradeFalloff })} />
      <Num label="Smooth along" value={r.smooth} min={4} max={300} step={2} log unit="m" onChange={(smooth) => set({ smooth })} />
    </>}
    <Check label="Snap to roads" hint="ends and corners first; hold Alt to place freely" checked={r.snap} onChange={(snap) => set({ snap })} />
  </>
}

function BuildingOptions({ model }: { model: EditorModel }) {
  const b = model.settings.building
  const set = (patch: Partial<typeof b>) => model.patchGroup('building', patch)
  return <>
    <Pick label="Kind" value={b.k} options={BUILDING_KINDS.map((k) => ({ value: k, label: k[0].toUpperCase() + k.slice(1) }))} onChange={(k) => set({ k })} />
    <Num label="Wall height" value={b.h} min={2} max={60} step={0.1} unit="m" onChange={(h) => set({ h })} />
    <Pick label="Roof" value={b.roof} options={ROOF_OPTIONS} onChange={(roof) => set({ roof })} />
    {b.roof !== ROOF.flat && <Num label="Roof rise" value={b.ridge} min={0} max={20} step={0.1} unit="m" onChange={(ridge) => set({ ridge })} />}
    <Colour label="Roof colour" value={b.rc} onChange={(rc) => set({ rc })} />
    <Text label="Name" value={b.n} placeholder="Optional (shows on the map)" onChange={(n) => set({ n })} />
    <Num label="Turn" value={b.yaw} min={-180} max={180} step={1} unit="°" onChange={(yaw) => set({ yaw })} />
    <Check label="Level the yard under it" checked={b.level} onChange={(level) => set({ level })} />
  </>
}

function LotOptions({ model, runner }: { model: EditorModel; runner: ToolRunner | null }) {
  const l = model.settings.lot
  const t = model.tool
  return <>
    {t === 'lot' && <Check label="Paint parking stalls" checked={l.stripes} onChange={(stripes) => model.patchGroup('lot', { stripes })} />}
    {t === 'lotEdit' && runner?.lotEdit && <div className="we-row">
      <button type="button" className="we-btn" onClick={() => runner.reset()}>Cancel</button>
      <button type="button" className="we-btn is-primary" onClick={() => runner.applyLotEdit()}>Apply shape</button>
    </div>}
    <div className="we-callout">
      <strong>Lots over roads</strong>
      <p>Trim every parking lot back off the streets and highways that run over it.</p>
      <Num label="Gap to the pavement" value={l.margin} min={0} max={3} step={0.1} unit="m" onChange={(margin) => model.patchGroup('lot', { margin })} />
      <button type="button" className="we-btn" onClick={() => model.add({ id: newOpId(), ts: Date.now(), type: 'lotClip', ids: 'all', margin: l.margin })}>Trim all lots off the roads</button>
    </div>
  </>
}

function TreeOptions({ model }: { model: EditorModel }) {
  const t = model.settings.trees
  const set = (patch: Partial<typeof t>) => model.patchGroup('trees', patch)
  return <>
    <Num label="Trees a hectare" value={t.density} min={5} max={1200} step={5} log unit="/ha" onChange={(density) => set({ density })} hint={`about one every ${Math.sqrt(10000 / t.density).toFixed(1)} m`} />
    <Num label="Pine" value={t.pine} min={0} max={1} step={0.05} onChange={(pine) => set({ pine })} />
    <Num label="Hardwood" value={t.hardwood} min={0} max={1} step={0.05} onChange={(hardwood) => set({ hardwood })} />
    <Num label="Birch" value={t.birch} min={0} max={1} step={0.05} onChange={(birch) => set({ birch })} />
    <Num label="Shortest" value={t.hMin} min={3} max={40} step={0.5} unit="m" onChange={(hMin) => set({ hMin })} />
    <Num label="Tallest" value={t.hMax} min={3} max={40} step={0.5} unit="m" onChange={(hMax) => set({ hMax })} />
    <Check label="Woods on the ground" hint="forest floor under the stand" checked={t.floor} onChange={(floor) => set({ floor })} />
    <p className="we-hint small"><TreeDeciduous size={12} aria-hidden /> Trees keep off roads, lots, buildings and water.</p>
  </>
}

function LightOptions({ model }: { model: EditorModel }) {
  const l = model.settings.light
  const set = (patch: Partial<typeof l>) => model.patchGroup('light', patch)
  return <>
    <Pick label="Style" value={l.style} options={LIGHT_STYLES.map((s) => ({ value: s, label: LIGHT_STYLE_NAMES[s] }))} onChange={(style) => set({ style, h: style === 'acorn' ? 4.3 : 9 })} />
    <Num label="Pole height" value={l.h} min={2.5} max={16} step={0.1} unit="m" onChange={(h) => set({ h })} />
    {model.tool === 'lightRow' && <>
      <Num label="Spacing" value={l.spacing} min={6} max={200} step={1} unit="m" onChange={(spacing) => set({ spacing })} />
      <Num label="Set back from the line" value={l.offset} min={0} max={30} step={0.1} unit="m" onChange={(offset) => set({ offset })} />
      <Segmented label="Side" value={l.sides} options={[{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }, { value: 'both', label: 'Both' }]} onChange={(sides) => set({ sides })} />
    </>}
  </>
}

function WallOptions({ model }: { model: EditorModel }) {
  const w = model.settings.wall
  const set = (patch: Partial<typeof w>) => model.patchGroup('wall', patch)
  return <>
    <Pick label="Style" value={w.style} options={WALL_STYLES.map((s) => ({ value: s, label: WALL_STYLE_NAMES[s] }))} onChange={(style) => set({ style })} />
    <Num label="Height" value={w.h} min={0.3} max={8} step={0.05} unit="m" onChange={(h) => set({ h })} />
    <Num label="Thickness" value={w.th} min={0.08} max={1.2} step={0.01} unit="m" onChange={(th) => set({ th })} />
    <Num label="Pillar every" value={w.posts} min={0} max={20} step={0.5} unit="m" hint="0: ends and corners only" onChange={(posts) => set({ posts })} />
    <Check label="Cap along the top" checked={w.cap} onChange={(cap) => set({ cap })} />
    <Check label="Close the loop" checked={w.closed} onChange={(closed) => set({ closed })} />
  </>
}

export { ICONS, Landmark }
