import { useState } from 'react'
import { LoaderCircle, Move3d, Pipette, Undo2, WandSparkles } from 'lucide-react'
import type { Object3D } from 'three'
import { LAMP_STYLE_LIMITS } from '../../../../modules-src/maplestreet/shared/Shapes'
import type { LampStyle } from '../../../../modules-src/maplestreet/shared/Shapes'
import { NumberInput } from '../../admin/NumberInput'
import { newLampStyle } from './draft'
import type { Draft, MarkerId } from './draft'
import { LampTracer } from './LampTracer'
import type { TracedLamp } from './LampTracer'
import { ShapeDesigner } from './ShapeDesigner'

type LampKey = 'head' | 'tail'
const cm = (metres: number) => `${(metres * 100).toFixed(1)} cm`

function Slider({ label, value, onChange, min, max, step, display }: { label: string; value: number; onChange: (value: number) => void; min: number; max: number; step: number; display: string }) {
  return <label className="ms-veh-slider">{label} <output>{display}</output><input type="range" min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))}/></label>
}

/** The Lights step: find the lamps automatically, make them 3D, and keep the body from showing through. */
export function LightsPanel({ draft, patch, scene, center, drop, ready, finding, onFind, selected, onSelect }: {
  draft: Draft
  patch: (changes: Partial<Draft>) => void
  scene: Object3D | null
  center: { x: number; z: number; minY: number } | null
  /** Ground frame y minus this is chassis y. */
  drop: number
  ready: boolean
  finding: boolean
  onFind: () => void
  selected: MarkerId | null
  onSelect: (id: MarkerId | null) => void
}) {
  const [tracing, setTracing] = useState<LampKey | null>(null)
  const L = LAMP_STYLE_LIMITS

  return <fieldset>
    <legend>Lights</legend>
    <button type="button" className="ms-veh-suggest" onClick={onFind} disabled={!ready || finding || (!draft.headOn && !draft.tailOn)}>{finding ? <LoaderCircle className="spin" size={14} aria-hidden/> : <WandSparkles size={14} aria-hidden/>} {finding ? 'Looking for the lights…' : 'Find the lights for me'}</button>
    <p className="ms-veh-note">Looks at the front and back of the model and outlines the headlights and taillights it sees. If it misses one, trace that one by hand.</p>

    {(['head', 'tail'] as const).map(key => {
      const on = key === 'head' ? draft.headOn : draft.tailOn
      const sizeKey = key === 'head' ? 'headSize' : 'tailSize'
      const depthKey = key === 'head' ? 'headDepth' : 'tailDepth'
      const styleKey = key === 'head' ? 'headStyle' : 'tailStyle'
      const name = key === 'head' ? 'headlight' : 'taillight'
      const shape = draft.lampShapes[key]
      const size = draft.lampShapes[sizeKey]
      const style = draft.lampShapes[styleKey]
      const solid = style?.kind === '3d'
      const setStyle = (changes: Partial<LampStyle>) => patch({ lampShapes: { ...draft.lampShapes, [styleKey]: { ...(style ?? newLampStyle()), ...changes } } })
      const summary = shape
        ? size ? `Outlined on the model: ${Math.round(size.w * 100)} × ${Math.round(size.h * 100)} cm${draft.lampShapes[depthKey] ? ', following the body’s curve' : ''}.` : 'Outline drawn by hand.'
        : `No outline yet: a small ${solid ? 'lamp' : 'glowing box'} sits at the ${name} marker.`
      return <div key={key} className="ms-veh-lamp">
        <label className="ms-veh-inline"><input type="checkbox" checked={on} onChange={event => { patch(key === 'head' ? { headOn: event.target.checked } : { tailOn: event.target.checked }); if (!event.target.checked) { if (tracing === key) setTracing(null); if (selected === key) onSelect(null) } }}/> <strong>Glowing {name}s</strong></label>
        {!on && <p className="ms-veh-note">Off: the game adds no {name}s of its own, so only the model’s painted ones show. They won’t light up at night{key === 'tail' ? ' or when braking' : ''}.</p>}
        {on && <>
          <p className="ms-veh-note">{summary}</p>
          <label className="ms-veh-inline"><input type="checkbox" checked={solid} onChange={event => setStyle({ kind: event.target.checked ? '3d' : 'flat' })}/> 3D light (a real lamp set into the body)</label>
          {solid && style && <>
            <Slider label="Lens bulge" min={0} max={L.bulgeMax} step={0.002} value={style.bulge} onChange={bulge => setStyle({ bulge })} display={cm(style.bulge)}/>
            <Slider label="Depth behind the body" min={L.recessMin} max={L.recessMax} step={0.005} value={style.recess} onChange={recess => setStyle({ recess })} display={cm(style.recess)}/>
            <Slider label="Trim ring width" min={L.rimMin} max={L.rimMax} step={0.002} value={style.rim} onChange={rim => setStyle({ rim })} display={cm(style.rim)}/>
            <label className="ms-veh-inline"><input type="checkbox" checked={style.cut} onChange={event => setStyle({ cut: event.target.checked })}/> Hide the body behind the light</label>
          </>}
          <div className="ms-veh-pair">
            <button type="button" onClick={() => setTracing(tracing === key ? null : key)} aria-pressed={tracing === key} disabled={!ready || !scene}><Pipette size={14} aria-hidden/> {tracing === key ? 'Close the tracer' : 'Trace it by hand'}</button>
            <button type="button" onClick={() => onSelect(selected === key ? null : key)} aria-pressed={selected === key} className={selected === key ? 'is-active' : ''} disabled={!ready}><Move3d size={14} aria-hidden/> {selected === key ? 'Dragging on the model' : 'Move it on the model'}</button>
          </div>
          {tracing === key && scene && center && <LampTracer kind={key} scene={scene} draft={draft} center={center} drop={drop}
            onApply={(lamp: TracedLamp) => patch({ [key]: lamp.point, lampShapes: { ...draft.lampShapes, [key]: lamp.shape, [sizeKey]: lamp.size, [depthKey]: lamp.depth } } as Partial<Draft>)}
            onClose={() => setTracing(null)}/>}
          <details className="ms-veh-more">
            <summary>More</summary>
            <div className="ms-veh-more-body">
              <div className="ms-veh-xyz">
                <strong>Position (metres from the body’s centre; forward is +)</strong>
                {(['x', 'y', 'z'] as const).map(axis => <label key={axis}>{axis.toUpperCase()}<NumberInput step={0.01} value={draft[key][axis]} onChange={v => patch({ [key]: { ...draft[key], [axis]: v } } as Partial<Draft>)}/></label>)}
              </div>
              {shape && <button type="button" onClick={() => patch({ lampShapes: { ...draft.lampShapes, [key]: undefined, [sizeKey]: undefined, [depthKey]: undefined } })}><Undo2 size={14} aria-hidden/> Forget the outline</button>}
              {tracing !== key && <ShapeDesigner title={`${key === 'head' ? 'Headlight' : 'Taillight'} shape by hand`} axis="left" hint={`Seen from the ${key === 'head' ? 'front' : 'back'}, around the ${name} marker.`} shape={shape} onChange={next => patch({ lampShapes: { ...draft.lampShapes, [key]: next, ...(next ? {} : { [sizeKey]: undefined, [depthKey]: undefined }) } })}/>}
            </div>
          </details>
        </>}
      </div>
    })}
  </fieldset>
}
