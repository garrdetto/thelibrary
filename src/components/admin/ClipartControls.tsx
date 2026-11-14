import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Dices, ImagePlus, Lock, RotateCcw, Save, Trash2, Unlock, X } from 'lucide-react'
import { CLIPART_GROUPS, CLIPART_PRESETS, CLIPART_SLIDERS, DEFAULT_NEGATIVE, DEFAULT_PROMPT, ENGINES, NEGATIVE_LIMIT, PROMPT_LIMIT, closestResolution, engineInfo } from '@/lib/clipart'
import type { ClipartSettings, ClipartSliderKey, EngineId, SavedPreset } from '@/lib/clipart'
import type { EngineStatus } from '@/lib/clipart-client'

export type Reference = { name: string; src: string; dataUrl: string }
export type Controls = {
  engine: EngineId
  presetId: string
  savedId: string | null
  settings: ClipartSettings
  prompt: string
  negative: string
  reference: Reference | null
  lockSeed: boolean
  seed: number
}

type Props = {
  controls: Controls
  onChange: (next: Controls) => void
  engines: EngineStatus[]
  saved: SavedPreset[]
  onSavePreset: (name: string) => Promise<void>
  onDeletePreset: (id: string) => Promise<void>
  onReference: (file: File) => void
  saveOpen: boolean
  setSaveOpen: (open: boolean) => void
}

export function ClipartControls({ controls, onChange, engines, saved, onSavePreset, onDeletePreset, onReference, saveOpen, setSaveOpen }: Props) {
  const [presetName, setPresetName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const referenceInput = useRef<HTMLInputElement>(null)
  const engine = engineInfo(controls.engine)
  const set = (patch: Partial<Controls>) => onChange({ ...controls, ...patch, savedId: 'settings' in patch || 'prompt' in patch || 'negative' in patch ? null : controls.savedId })
  const setSlider = (key: ClipartSliderKey, value: number) => set({ settings: { ...controls.settings, [key]: value } })

  function pickEngine(id: EngineId) {
    const next = engineInfo(id)
    onChange({ ...controls, engine: id, settings: { ...controls.settings, resolution: closestResolution(next, controls.settings.resolution) } })
  }

  function applyPreset(id: string) {
    const preset = CLIPART_PRESETS.find(item => item.id === id)!
    onChange({ ...controls, presetId: id, savedId: null, settings: { ...preset.settings, resolution: closestResolution(engine, preset.settings.resolution) } })
  }

  function applySaved(preset: SavedPreset) {
    onChange({ ...controls, presetId: preset.basePreset, savedId: preset.id, settings: { ...preset.settings, resolution: closestResolution(engine, preset.settings.resolution) }, prompt: preset.prompt, negative: preset.negative })
  }

  async function submitPreset() {
    if (!presetName.trim()) return
    setSaving(true)
    setSaveError('')
    try {
      await onSavePreset(presetName.trim())
      setPresetName('')
      setSaveOpen(false)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not save the preset.')
    } finally {
      setSaving(false)
    }
  }

  function pickReference(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) onReference(file)
  }

  return <div className="cg-controls">
    {saveOpen && <form className="cg-card cg-save" onSubmit={event => { event.preventDefault(); void submitPreset() }}>
      <label htmlFor="cg-preset-name">Save these settings as a preset</label>
      <div className="cg-row">
        <input id="cg-preset-name" autoFocus value={presetName} maxLength={60} placeholder="Preset name" onChange={event => setPresetName(event.target.value)}/>
        <button type="submit" className="cg-btn cg-btn-primary" disabled={saving || !presetName.trim()}><Save size={14}/> {saving ? 'Saving…' : 'Save'}</button>
        <button type="button" className="cg-icon" aria-label="Close" onClick={() => setSaveOpen(false)}><X size={14}/></button>
      </div>
      <small>Saves sliders, prompt and negative prompt for everyone who uses this console. A preset with the same name is replaced.</small>
      {saveError && <p className="cg-error" role="alert">{saveError}</p>}
    </form>}

    <section className="cg-card">
      <h3>Engine</h3>
      <div className="cg-engines" role="radiogroup" aria-label="Generation engine">
        {ENGINES.map(item => {
          const status = engines.find(entry => entry.id === item.id)
          return <label key={item.id} className={`cg-engine${controls.engine === item.id ? ' is-active' : ''}${status && !status.ready ? ' is-off' : ''}`}>
            <input type="radio" name="cg-engine" checked={controls.engine === item.id} onChange={() => pickEngine(item.id)}/>
            <span><strong>{item.label}</strong> <em className={item.free ? 'cg-tag-free' : 'cg-tag-paid'}>{item.free ? 'Free' : 'Paid key'}</em></span>
            <small>{status && !status.ready ? status.reason : item.note}</small>
          </label>
        })}
      </div>
    </section>

    <section className="cg-card">
      <h3>Style presets</h3>
      <div className="cg-presets">
        {CLIPART_PRESETS.map(preset => <button key={preset.id} type="button" aria-pressed={controls.presetId === preset.id && !controls.savedId} className={controls.presetId === preset.id && !controls.savedId ? 'is-active' : ''} onClick={() => applyPreset(preset.id)}>{preset.name}</button>)}
      </div>
      {saved.length > 0 && <>
        <h4>Saved presets</h4>
        <ul className="cg-saved">
          {saved.map(preset => <li key={preset.id} className={controls.savedId === preset.id ? 'is-active' : ''}>
            <button type="button" onClick={() => applySaved(preset)}>{preset.name}</button>
            <button type="button" className="cg-icon" aria-label={`Delete preset ${preset.name}`} onClick={() => { if (window.confirm(`Delete the preset “${preset.name}”?`)) void onDeletePreset(preset.id) }}><Trash2 size={13}/></button>
          </li>)}
        </ul>
      </>}
    </section>

    {CLIPART_GROUPS.map(group => <details key={group.id} className="cg-card cg-group" open={group.id === 'detail' || group.id === 'clipart'}>
      <summary>{group.label}</summary>
      {CLIPART_SLIDERS.filter(slider => slider.group === group.id).map(slider => {
        const value = controls.settings[slider.key]
        return <div key={slider.key} className="cg-slider">
          <label htmlFor={`cg-${slider.key}`}>{slider.label}</label>
          <output htmlFor={`cg-${slider.key}`}>{slider.kind === 'balance' ? `${value - 50 > 0 ? '+' : ''}${value - 50}` : value}</output>
          <input id={`cg-${slider.key}`} type="range" min={0} max={100} value={value} onChange={event => setSlider(slider.key, Number(event.target.value))}/>
        </div>
      })}
      {group.id === 'quality' && <div className="cg-slider">
        <label htmlFor="cg-resolution">Output resolution</label>
        <output htmlFor="cg-resolution">{controls.settings.resolution}px</output>
        <input id="cg-resolution" type="range" min={0} max={engine.resolutions.length - 1} step={1} value={Math.max(0, engine.resolutions.indexOf(controls.settings.resolution))} onChange={event => set({ settings: { ...controls.settings, resolution: engine.resolutions[Number(event.target.value)] } })} aria-valuetext={`${controls.settings.resolution} pixels on the long edge`}/>
        <small className="cg-hint">Long edge requested from {engine.label}; the aspect ratio follows each photo. The size the engine actually returns is shown on every result.</small>
      </div>}
    </details>)}

    <section className="cg-card">
      <div className="cg-head-row"><h3><label htmlFor="cg-prompt">Prompt</label></h3><button type="button" className="cg-link" onClick={() => set({ prompt: DEFAULT_PROMPT })}><RotateCcw size={12}/> Default</button></div>
      <textarea id="cg-prompt" rows={5} maxLength={PROMPT_LIMIT} value={controls.prompt} onChange={event => set({ prompt: event.target.value })}/>
      <div className="cg-head-row"><h3><label htmlFor="cg-negative">Negative prompt</label></h3><button type="button" className="cg-link" onClick={() => set({ negative: DEFAULT_NEGATIVE })}><RotateCcw size={12}/> Default</button></div>
      <textarea id="cg-negative" rows={3} maxLength={NEGATIVE_LIMIT} value={controls.negative} onChange={event => set({ negative: event.target.value })}/>
      {engine.numeric && <small className="cg-hint">This engine reads about 75 words, so the strongest sliders go first; the rest steer strength, guidance and steps.</small>}
    </section>

    <section className="cg-card">
      <h3>Reference image</h3>
      {!engine.reference && <p className="cg-hint">{engine.label} can’t take a style reference. Pick a FLUX.2 or Gemini engine to use one.</p>}
      {controls.reference ? <div className="cg-reference">
        <img src={controls.reference.src} alt={`Style reference ${controls.reference.name}`}/>
        <div><strong>{controls.reference.name}</strong><small>Used for colour, illustration style, detail, lighting, realism and edges only — never its subject.</small></div>
        <button type="button" className="cg-icon" aria-label="Remove reference image" onClick={() => onChange({ ...controls, reference: null })}><X size={14}/></button>
      </div> : <button type="button" className="cg-btn" disabled={!engine.reference} onClick={() => referenceInput.current?.click()}><ImagePlus size={14}/> Add reference</button>}
      <input ref={referenceInput} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={pickReference}/>
      <h3 className="cg-spaced">Batch consistency</h3>
      <div className="cg-row">
        <button type="button" className="cg-btn" aria-pressed={controls.lockSeed} onClick={() => set({ lockSeed: !controls.lockSeed })} disabled={controls.engine.startsWith('flux')}>{controls.lockSeed ? <Lock size={14}/> : <Unlock size={14}/>} {controls.lockSeed ? 'Seed locked' : 'Random seed'}</button>
        {controls.lockSeed && !controls.engine.startsWith('flux') && <><input aria-label="Seed" className="cg-seed" type="number" min={0} max={2147483647} value={controls.seed} onChange={event => set({ seed: Math.max(0, Math.min(2147483647, Math.round(Number(event.target.value) || 0))) })}/><button type="button" className="cg-icon" aria-label="New seed" onClick={() => set({ seed: Math.floor(Math.random() * 2147483647) })}><Dices size={14}/></button></>}
      </div>
      <small className="cg-hint">Every image in a batch uses the settings, prompt and reference captured when you press Generate.{controls.engine.startsWith('flux') ? ' FLUX.2 klein has no seed control.' : ''}</small>
    </section>
  </div>
}
