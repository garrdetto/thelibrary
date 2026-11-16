import { useState } from 'react'
import { AlertTriangle, Eye, EyeOff, Trash2 } from 'lucide-react'
import { describeOp, type EditType } from '../../../modules-src/tello/edits/WorldEdits'
import type { EditorModel } from './model'
import { Section } from './ui'

const GROUP: Record<EditType, string> = {
  terrain: 'Land', water: 'Water', river: 'Water', road: 'Road', roadRemove: 'Road', roadSet: 'Road',
  building: 'Building', buildingRemove: 'Building', buildingSet: 'Building', lot: 'Parking', lotRemove: 'Parking', lotSet: 'Parking', lotClip: 'Parking',
  trees: 'Trees', rail: 'Street', railCut: 'Street', lights: 'Street', lightCut: 'Street', wall: 'Street',
}

const FILTERS = ['All', 'Land', 'Water', 'Road', 'Building', 'Parking', 'Trees', 'Street', 'Problems'] as const

/** Every edit, newest first: click to select (and outline it on the map), switch off, or delete. */
export function EditList({ model, onHover }: { model: EditorModel; onHover: (id: string | null) => void }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('All')
  const problems = new Map(model.report.skipped.map((s) => [s.id, s.why]))
  const rows = model.ops.map((op, i) => ({ op, i })).reverse().filter(({ op }) => filter === 'All' || (filter === 'Problems' ? problems.has(op.id) : GROUP[op.type] === filter))
  const sel = model.selection?.kind === 'op' ? model.selection.id : null
  return <Section title={`Edits (${model.ops.length})`} actions={model.ops.length ? <button type="button" className="we-btn small danger" onClick={() => { if (confirm(`Delete all ${model.ops.length} edits? You can undo this.`)) model.clearAll() }}>Clear all</button> : undefined}>
    {problems.size > 0 && <p className="we-warn"><AlertTriangle size={14} aria-hidden /> {problems.size} edit{problems.size === 1 ? '' : 's'} could not be applied (the map changed under them).</p>}
    {model.ops.length > 0 && <div className="we-filters" role="group" aria-label="Show edits">
      {FILTERS.map((f) => <button key={f} type="button" aria-pressed={filter === f} className={filter === f ? 'is-on' : ''} onClick={() => setFilter(f)}>{f}</button>)}
    </div>}
    {!model.ops.length && <p className="we-hint">No edits yet. Pick a tool on the left and change the map; every change is listed here and can be switched off, reordered or deleted.</p>}
    <ol className="we-edits" onMouseLeave={() => onHover(null)}>
      {rows.map(({ op, i }) => <li key={op.id} className={`${sel === op.id ? 'is-sel' : ''} ${op.on === false ? 'is-off' : ''} ${problems.has(op.id) ? 'is-bad' : ''}`} onMouseEnter={() => onHover(op.id)}>
        <button type="button" className="we-edit-main" onClick={() => model.select({ kind: 'op', id: op.id })} title={problems.get(op.id) ?? describeOp(op)}>
          <span className="we-edit-n">{i + 1}</span>
          <span className="we-edit-tag">{GROUP[op.type]}</span>
          <span className="we-edit-text">{describeOp(op)}</span>
          {problems.has(op.id) && <AlertTriangle size={13} aria-label="Not applied" />}
        </button>
        <button type="button" className="we-icon" aria-label={op.on === false ? 'Switch on' : 'Switch off'} onClick={() => model.toggle(op.id)}>{op.on === false ? <EyeOff size={14} /> : <Eye size={14} />}</button>
        <button type="button" className="we-icon danger" aria-label="Delete edit" onClick={() => model.remove(op.id)}><Trash2 size={14} /></button>
      </li>)}
    </ol>
  </Section>
}
