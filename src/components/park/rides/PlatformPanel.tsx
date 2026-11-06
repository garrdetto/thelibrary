import { CUSTOM_PLATFORM_SHAPES, CUSTOM_PLATFORM_STEPS, CUSTOM_RIDE_LIMITS as L } from '../../../../server/park/index.mjs'
import type { CustomRideMotion, CustomRidePlatform } from '../../../../server/park/index.mjs'
import { SHAPE_LABEL, STEP_LABEL, columnSpan, stepOverhang } from '@/lib/park/ridePlatform'
import { NumberInput } from '../../admin/NumberInput'

type Props = {
  platform: CustomRidePlatform
  motion: CustomRideMotion
  size: [number, number]
  disabled: boolean
  onChange: (patch: Partial<CustomRidePlatform>) => void
}

const metres = (v: number) => `${v.toFixed(2)} m`

function Range({ label, value, min, max, step, format, onChange }: { label: string; value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void }) {
  return <label className="rc-slider">{label}<span>{format(value)}</span>
    <input type="range" value={Math.min(max, Math.max(min, value))} min={min} max={max} step={step} onChange={event => onChange(Number(event.target.value))} aria-valuetext={format(value)}/>
  </label>
}

function Colour({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <label className="rc-colour">{label}<input type="color" value={value} onChange={event => onChange(event.target.value)}/><code>{value}</code></label>
}

export function PlatformPanel({ platform: p, motion, size, disabled, onChange }: Props) {
  const span = columnSpan(p, motion)
  const overhang = stepOverhang(p, size)
  const lifts = motion.rise > 0 || motion.type === 'drop' || motion.type === 'bob'
  return <fieldset className="rc-platform" disabled={disabled}>
    <legend>Base</legend>
    <label className="rc-check"><input type="checkbox" checked={p.enabled} onChange={event => onChange({ enabled: event.target.checked })}/> Stand the ride on a base</label>
    <p className="ms-items-note">A platform under the ride, with optional tiers, trim, steps, a railing and a support column. Raising the base lifts the whole model with it, and a telescoping column stretches so a rising ride stays connected instead of floating.</p>
    {p.enabled && <>
      <div className="rc-grid2">
        <label>Shape<select value={p.shape} onChange={event => onChange({ shape: event.target.value as CustomRidePlatform['shape'] })}>
          {CUSTOM_PLATFORM_SHAPES.map(shape => <option key={shape} value={shape}>{SHAPE_LABEL[shape]}</option>)}
        </select></label>
        <label>Tiers<NumberInput value={p.tiers} min={1} max={L.platformTiersMax} integer onChange={tiers => onChange({ tiers })}/></label>
      </div>
      <Range label="Size" value={p.fill} min={0.3} max={1} step={0.01} format={v => `${Math.round(v * 100)}% of the footprint`} onChange={fill => onChange({ fill })}/>
      <Range label="Height" value={p.height} min={0} max={L.platformHeightMax} step={0.05} format={v => v < 0.005 ? 'flat on the ground' : metres(v)} onChange={height => onChange({ height })}/>
      {p.tiers > 1 && <Range label="Each tier steps in by" value={p.inset} min={0} max={0.3} step={0.01} format={v => `${Math.round(v * 100)}%`} onChange={inset => onChange({ inset })}/>}
      <div className="rc-grid3">
        <Colour label="Top" value={p.top} onChange={top => onChange({ top })}/>
        <Colour label="Sides" value={p.side} onChange={side => onChange({ side })}/>
        <Colour label="Trim" value={p.trim} onChange={trim => onChange({ trim })}/>
      </div>
      <label className="rc-check"><input type="checkbox" checked={p.edge} onChange={event => onChange({ edge: event.target.checked })}/> Trim band around each edge</label>

      <div className="rc-grid2">
        <label>Steps<select value={p.steps} onChange={event => onChange({ steps: event.target.value as CustomRidePlatform['steps'] })}>
          {CUSTOM_PLATFORM_STEPS.map(steps => <option key={steps} value={steps}>{STEP_LABEL[steps]}</option>)}
        </select></label>
        {p.steps !== 'none' && <Colour label="Step colour" value={p.stepColor} onChange={stepColor => onChange({ stepColor })}/>}
      </div>
      {p.steps !== 'none' && p.height < 0.15 && <p className="ms-items-note">Steps appear once the base is at least 0.15 m tall.</p>}
      {overhang > 0.05 && <p className="ms-items-error" role="alert">The steps reach {overhang.toFixed(1)} m past the footprint. Shrink the base or enlarge the footprint so they don't run into paths.</p>}

      <label className="rc-check"><input type="checkbox" checked={p.fence} onChange={event => onChange({ fence: event.target.checked })}/> Railing around the top</label>
      {p.fence && <div className="rc-grid2">
        <Range label="Railing height" value={p.fenceHeight} min={0.5} max={2} step={0.05} format={metres} onChange={fenceHeight => onChange({ fenceHeight })}/>
        <Colour label="Railing colour" value={p.fenceColor} onChange={fenceColor => onChange({ fenceColor })}/>
      </div>}

      <label>Support column<select value={p.column} onChange={event => onChange({ column: event.target.value as CustomRidePlatform['column'] })}>
        <option value="none">None</option>
        <option value="fixed">Fixed column</option>
        <option value="telescoping">Telescoping (stretches as the ride rises)</option>
      </select></label>
      {p.column !== 'none' && <>
        <p className="ms-items-note">The column stands under the main pivot and reaches up to {p.columnTop > 0 ? 'the height you set' : 'where the moving part starts'}{span ? ` (${span.length.toFixed(1)} m tall at rest)` : ''}.{p.column === 'telescoping' && !lifts ? ' Set a Rise under Motion, or use Drop or Bob, to see it extend.' : ''}</p>
        {!span && <p className="ms-items-error" role="alert">The column has no room: raise the moving part's start height or set a column top above the base.</p>}
        <div className="rc-grid2">
          <Range label="Thickness" value={p.columnRadius} min={0.1} max={L.columnRadiusMax} step={0.05} format={v => `${(v * 2).toFixed(1)} m across`} onChange={columnRadius => onChange({ columnRadius })}/>
          <Range label="Reaches up to" value={p.columnTop} min={0} max={Math.max(1, L.heightMax / 2)} step={0.1} format={v => v <= 0.001 ? 'the moving part' : metres(v)} onChange={columnTop => onChange({ columnTop })}/>
          {p.column === 'telescoping' && <label>Sections<NumberInput value={p.columnSections} min={1} max={L.columnSectionsMax} integer onChange={columnSections => onChange({ columnSections })}/></label>}
          <Colour label="Column colour" value={p.columnColor} onChange={columnColor => onChange({ columnColor })}/>
        </div>
      </>}
    </>}
  </fieldset>
}
