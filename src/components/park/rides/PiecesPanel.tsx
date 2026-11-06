import { useMemo } from 'react'
import { ChevronDown, ChevronUp, Crosshair, Layers, Trash2 } from 'lucide-react'
import { CUSTOM_PIECE_AXES, CUSTOM_PIECE_MOTIONS, CUSTOM_RIDE_LIMITS as L, sanitizeMotion } from '../../../../server/park/index.mjs'
import type { CustomPieceMotionType, CustomRideMotion, CustomRidePiece } from '../../../../server/park/index.mjs'
import type { RideMesh } from '@/lib/park/rideMesh'
import { AXIS_LABEL, PIECE_INFO, newPiece } from '@/lib/park/ridePieces'

type Props = {
  motion: CustomRideMotion
  mesh: RideMesh | null
  height: number
  reach: number
  focus: number | null
  onFocus: (index: number | null) => void
  onChange: (motion: CustomRideMotion) => void
}

const PRESETS: { label: string; type: CustomPieceMotionType }[] = [
  { label: 'Cages that spin on their own', type: 'spin' },
  { label: 'Seats or cages that swing freely', type: 'swing' },
  { label: 'Cars that flip', type: 'flip' },
  { label: 'Tubs that wobble', type: 'wobble' },
  { label: 'Seats that bob up and down', type: 'bob' },
  { label: 'Gondolas that stay level', type: 'level' },
]

const metres = (v: number) => `${v.toFixed(1)} m`

function Range({ label, value, min, max, step, format, onChange }: { label: string; value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void }) {
  return <label className="rc-slider">{label}<span>{format(value)}</span>
    <input type="range" value={Math.min(max, Math.max(min, value))} min={min} max={max} step={step} onChange={event => onChange(Number(event.target.value))} aria-valuetext={format(value)}/>
  </label>
}

/** Removes a piece and repoints anything that rode on it or on a later piece. */
function withoutPiece(pieces: CustomRidePiece[], index: number) {
  return pieces.filter((_, i) => i !== index).map(piece => ({ ...piece, on: piece.on === index ? -1 : piece.on > index ? piece.on - 1 : piece.on }))
}

/** Swaps two neighbouring pieces, keeping every piece's carrier earlier in the list. */
function swapPieces(pieces: CustomRidePiece[], a: number) {
  const b = a + 1
  const remap = (on: number) => on === a ? b : on === b ? a : on
  const next = pieces.map(piece => ({ ...piece, on: remap(piece.on) }))
  ;[next[a], next[b]] = [next[b], next[a]]
  return next.map((piece, i) => piece.on >= i ? { ...piece, on: -1 } : piece)
}

export function PiecesPanel({ motion, mesh, height, reach, focus, onFocus, onChange }: Props) {
  const pieces = motion.pieces
  const found = useMemo(() => {
    const out = pieces.map(() => ({ copies: 0, triangles: 0 }))
    if (!mesh) return out
    for (const instance of mesh.instances) if (out[instance.group]) out[instance.group].copies++
    for (let t = 0; t < mesh.triangles; t++) { const part = mesh.parts[t * 3]; if (part > 1) { const g = mesh.instances[part - 2]?.group; if (g !== undefined && out[g]) out[g].triangles++ } }
    return out
  }, [mesh, pieces])
  const used = mesh?.instances.length ?? 0

  const commit = (next: CustomRidePiece[]) => onChange(sanitizeMotion({ ...motion, pieces: next }))
  const update = (index: number, patch: Partial<CustomRidePiece>) => commit(pieces.map((piece, i) => i === index ? { ...piece, ...patch } : piece))
  const add = (type: CustomPieceMotionType) => {
    const next = [...pieces, newPiece(type, height || 6)]
    commit(next)
    onFocus(next.length - 1)
  }
  const top = Math.max(0.5, height)
  const far = Math.max(1, Math.ceil(reach))

  return <fieldset className="rc-pieces" disabled={!mesh}>
    <legend>Extra moving pieces</legend>
    <p className="ms-items-note">Give parts of the ride their own motion on top of the main one: cages that spin on their own, seats that swing out, cars that flip. Pick the triangles by height and distance from the main pivot; each separate piece found there moves on its own pivot and rides along with whatever carries it. Later pieces take triangles from earlier ones, so list an arm before the cage hanging from it.</p>
    {pieces.length < L.piecesMax && <label>Add a moving piece<select value="" onChange={event => { if (event.target.value) add(event.target.value as CustomPieceMotionType) }}>
      <option value="">Choose what it does…</option>
      {PRESETS.map(preset => <option key={preset.type} value={preset.type}>{preset.label}</option>)}
    </select></label>}
    {pieces.length === 0 && <p className="ms-items-note">No extra pieces yet.</p>}
    <ol className="rc-piece-list">
      {pieces.map((piece, index) => {
        const open = focus === index, info = PIECE_INFO[piece.type], count = found[index]
        return <li key={index} className={open ? 'is-open' : undefined}>
          <div className="rc-piece-head">
            <button type="button" className="rc-piece-title" onClick={() => onFocus(open ? null : index)} aria-expanded={open}>
              <Layers size={14} aria-hidden/> <strong>Piece {index + 1}</strong> <span>{info.label}</span>
              <small>{count.copies ? `${count.copies} found · ${count.triangles.toLocaleString()} triangles` : 'nothing selected yet'}</small>
            </button>
            <button type="button" onClick={() => onFocus(open ? null : index)} aria-label={open ? 'Stop highlighting' : 'Highlight on the stage'} aria-pressed={open}><Crosshair size={14} aria-hidden/></button>
            <button type="button" onClick={() => { commit(swapPieces(pieces, index - 1)); onFocus(index - 1) }} disabled={index === 0} aria-label={`Move piece ${index + 1} up`}><ChevronUp size={14} aria-hidden/></button>
            <button type="button" onClick={() => { commit(swapPieces(pieces, index)); onFocus(index + 1) }} disabled={index === pieces.length - 1} aria-label={`Move piece ${index + 1} down`}><ChevronDown size={14} aria-hidden/></button>
            <button type="button" onClick={() => { commit(withoutPiece(pieces, index)); onFocus(null) }} aria-label={`Remove piece ${index + 1}`}><Trash2 size={14} aria-hidden/></button>
          </div>
          {open && <div className="rc-piece-body">
            <label>How it moves<select value={piece.type} onChange={event => { const type = event.target.value as CustomPieceMotionType; update(index, { type, hang: PIECE_INFO[type].hang, amount: type === 'flip' ? 1 : piece.amount }) }}>
              {CUSTOM_PIECE_MOTIONS.map(type => <option key={type} value={type}>{PIECE_INFO[type].label}</option>)}
            </select></label>
            <p className="ms-items-note">{info.hint}</p>
            <div className="rc-grid2">
              <Range label="From height" value={piece.from} min={0} max={top} step={0.05} format={metres} onChange={from => update(index, { from, to: Math.max(from, piece.to) })}/>
              <Range label="Up to height" value={piece.to} min={0} max={top} step={0.05} format={metres} onChange={to => update(index, { to, from: Math.min(to, piece.from) })}/>
              <Range label="Nearest to the centre" value={piece.inner} min={0} max={far} step={0.1} format={metres} onChange={inner => update(index, { inner, outer: Math.max(inner, piece.outer) })}/>
              <Range label="Farthest from the centre" value={Math.min(piece.outer, far)} min={0} max={far} step={0.1} format={v => v >= far ? 'the edge' : metres(v)} onChange={outer => update(index, { outer: outer >= far ? L.reachMax : outer, inner: Math.min(outer, piece.inner) })}/>
            </div>
            <div className="rc-grid2">
              <label>Split into<select value={piece.split} onChange={event => update(index, { split: event.target.value as CustomRidePiece['split'] })}>
                <option value="pieces">Each separate piece (automatic)</option>
                <option value="sectors">Equal slices around the centre</option>
              </select></label>
              {piece.split === 'sectors' && <label>Slices<input type="number" value={piece.count} min={1} max={L.pieceCountMax} onChange={event => { const n = Number(event.target.value); if (Number.isFinite(n)) update(index, { count: Math.round(Math.min(L.pieceCountMax, Math.max(1, n))) }) }}/></label>}
              <label>Pivot at each piece's<select value={piece.hang} onChange={event => update(index, { hang: event.target.value as CustomRidePiece['hang'] })}>
                <option value="top">Top (hanging point)</option>
                <option value="centre">Centre</option>
                <option value="bottom">Bottom</option>
              </select></label>
              {piece.type === 'flip' && <label>Flip axle<select value={piece.axis} onChange={event => update(index, { axis: event.target.value as CustomRidePiece['axis'] })}>
                {CUSTOM_PIECE_AXES.map(axis => <option key={axis} value={axis}>{AXIS_LABEL[axis]}</option>)}
              </select></label>}
              <label>Carried by<select value={piece.on} onChange={event => update(index, { on: Number(event.target.value) })}>
                <option value={-1}>{motion.type === 'none' ? 'The ride' : 'The main moving part'}</option>
                <option value={-2}>The base (stays in place)</option>
                {pieces.slice(0, index).map((other, i) => <option key={i} value={i}>Piece {i + 1}: {PIECE_INFO[other.type].label}</option>)}
              </select></label>
            </div>
            <Range label="Speed" value={piece.speed} min={L.speedMin} max={L.speedMax} step={0.05} format={v => `${v.toFixed(2)}×`} onChange={speed => update(index, { speed })}/>
            {info.amount && <Range label={info.amount} value={piece.amount} min={0} max={1} step={0.01} format={v => piece.type === 'flip' ? (v >= 0.98 ? 'full loops' : `rocks ${Math.round(v * 180)}°`) : piece.type === 'bob' ? metres(v * 2) : `${Math.round(v * 100)}%`} onChange={amount => update(index, { amount })}/>}
            <Range label="Stagger between pieces" value={piece.stagger} min={0} max={1} step={0.01} format={v => v < 0.01 ? 'all together' : `${Math.round(v * 100)}%`} onChange={stagger => update(index, { stagger })}/>
            {(piece.type === 'spin' || piece.type === 'flip') && <label className="rc-check"><input type="checkbox" checked={piece.alternate} onChange={event => update(index, { alternate: event.target.checked })}/> Every other piece turns the opposite way</label>}
          </div>}
        </li>
      })}
    </ol>
    {used >= L.instancesMax && <p className="ms-items-error" role="alert">That's the most moving pieces one ride can have ({L.instancesMax}). Narrow a selection or use fewer slices.</p>}
  </fieldset>
}
