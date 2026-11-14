import { useEffect, useState } from 'react'
import { Bot, Check, LoaderCircle, RotateCcw } from 'lucide-react'
import { botDialGroups, botDials, defaultBotValues, normalizeBotValues, type BotDial, type BotDialValue, type BotValues } from '@/lib/axiom-bot'
import { relativeSeconds } from './format'
import { NumberField, Toggle } from './SettingsFields'
import { useBot } from './useBot'
import './axiom-bot.css'

const firstCardNumber = 5

function DialField({ dial, value, onChange }: { dial: BotDial; value: BotDialValue; onChange: (value: BotDialValue) => void }) {
  const id = `bot-${dial.key.replace('.', '-')}`
  const hint = dial.help || undefined
  if (dial.type === 'toggle') return <Toggle id={id} label={dial.label} hint={hint} checked={value === true} onChange={onChange}/>
  if (dial.type === 'choice') return <label className="radar-field" htmlFor={id}>
    <span>{dial.label}{hint && <small>{hint}</small>}</span>
    <select id={id} value={String(value)} onChange={event => onChange(event.target.value)}>
      {dial.choices.map(([choice, label]) => <option key={choice} value={choice}>{label}</option>)}
    </select>
  </label>
  const number = typeof value === 'number' ? value : dial.default
  if (dial.slider) return <label className="radar-field radar-bot-slider" htmlFor={id}>
    <span>{dial.label}<small>{hint}</small></span>
    <span className="radar-bot-slider-row">
      <input id={id} type="range" min={dial.min} max={dial.max} step={dial.step} value={number} onChange={event => onChange(Number(event.target.value))}/>
      <strong className="tabular">{number} {dial.unit}</strong>
    </span>
  </label>
  return <NumberField id={id} label={dial.unit ? `${dial.label} (${dial.unit})` : dial.label} hint={hint} value={number} min={dial.min} max={dial.max} step={dial.step} onChange={onChange}/>
}

export function BotSettings({ now }: { now: number }) {
  const { view, error, loading, saveSettings } = useBot()
  const [form, setForm] = useState<BotValues>(defaultBotValues)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const saved = view?.settings ?? null
  useEffect(() => { if (saved && !dirty) setForm(saved.values) }, [saved, dirty])
  const change = (key: string, value: BotDialValue) => { setForm(current => ({ ...current, [key]: value })); setDirty(true) }
  const save = async () => {
    setSaving(true)
    setSaveError('')
    try {
      await saveSettings(normalizeBotValues(form))
      setDirty(false)
    } catch (failure) {
      setSaveError(failure instanceof Error ? failure.message : 'The bot settings could not be saved. Try again.')
    } finally {
      setSaving(false)
    }
  }
  const applied = Boolean(view?.online && saved?.updatedAt && view.report?.settingsStamp === saved.updatedAt)

  return <form className="radar-settings radar-bot-settings" noValidate aria-busy={loading} onSubmit={event => { event.preventDefault(); void save() }}>
    <div className="radar-section-head">
      <h2><Bot size={17} aria-hidden="true"/> Paper-trading bot <span className={view?.online ? 'radar-bot-chip up' : 'radar-bot-chip'}>{view?.online ? 'Running' : 'Not running'}</span></h2>
      <p>These dials drive the Python bot on your PC, which trades the Radar with pretend money. The same dials are in its settings file, and the most recent change wins. Nothing here places a real order.</p>
    </div>
    {loading ? <p className="radar-empty-line" role="status">Loading the bot's dials…</p> : botDialGroups.map((group, index) => <section key={group.id} className="radar-card">
      <div className="panel-heading"><span className="number-tag">{String(index + firstCardNumber).padStart(2, '0')}</span><h2>{group.label}</h2><span className="panel-caption">{group.caption.toUpperCase()}</span></div>
      <div className="radar-field-grid radar-bot-dials">
        {botDials.filter(dial => dial.key.startsWith(`${group.id}.`)).map(dial => <DialField key={dial.key} dial={dial} value={form[dial.key] ?? dial.default} onChange={value => change(dial.key, value)}/>)}
      </div>
    </section>)}
    <div className="radar-settings-actions">
      <button type="submit" className="primary-button" disabled={saving || !dirty || loading}>{saving ? <LoaderCircle size={15} className="spin"/> : <Check size={15}/>}{saving ? 'Saving…' : 'Save bot settings'}</button>
      <button type="button" className="secondary-button" disabled={saving || loading} onClick={() => { setForm(defaultBotValues); setDirty(true) }}><RotateCcw size={13}/> Reset to defaults</button>
      <p role="status" className="radar-muted">
        {saveError || error ? <span className="radar-bad">{saveError || error}</span>
          : dirty ? 'Unsaved changes.'
          : !saved || saved.updatedAt === null ? 'Using the default dials.'
          : applied ? `Saved ${relativeSeconds(saved.updatedAt, now)} and active on the bot.`
          : view?.online ? 'Saved. Waiting for the bot to pick it up (a few seconds).'
          : 'Saved. The bot is not running; it uses these when it starts.'}
      </p>
    </div>
  </form>
}
