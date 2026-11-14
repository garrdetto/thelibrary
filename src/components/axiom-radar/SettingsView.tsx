import { useEffect, useState } from 'react'
import { Check, LoaderCircle, RotateCcw } from 'lucide-react'
import { defaultRadarSettings, radarRequirementInfo, radarThemeColorInfo, radarThemeColors, radarThemePresets, type RadarSettings, type RadarTheme, type RadarThemeColors, type RadarThemePreset } from '@/lib/axiom-radar-settings'
import { relativeSeconds } from './format'

type SettingsViewProps = {
  settings: RadarSettings
  activeUpdatedAt: number | null
  saving: boolean
  error: string
  now: number
  onSave: (settings: RadarSettings) => void
  onPreviewTheme: (theme: RadarTheme | null) => void
}

function NumberField({ id, label, hint, value, step = 1, min = 0, max, disabled, onChange }: { id: string; label: string; hint?: string; value: number; step?: number; min?: number; max?: number; disabled?: boolean; onChange: (value: number) => void }) {
  return <label className="radar-field" htmlFor={id}>
    <span>{label}{hint && <small>{hint}</small>}</span>
    <input id={id} type="number" inputMode="decimal" value={Number.isFinite(value) ? value : 0} step={step} min={min} max={max} disabled={disabled} onChange={event => onChange(event.target.value === '' ? 0 : Number(event.target.value))}/>
  </label>
}

function Toggle({ id, label, hint, checked, onChange }: { id: string; label: string; hint?: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="radar-toggle-row" htmlFor={id}>
    <input id={id} type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)}/>
    <span>{label}{hint && <small>{hint}</small>}</span>
  </label>
}

export function SettingsView({ settings, activeUpdatedAt, saving, error, now, onSave, onPreviewTheme }: SettingsViewProps) {
  const [form, setForm] = useState(settings)
  const [dirty, setDirty] = useState(false)
  useEffect(() => { if (!dirty) setForm(settings) }, [settings, dirty])
  const change = (next: RadarSettings) => { setForm(next); setDirty(true) }
  const changeTheme = (theme: RadarTheme) => { change({ ...form, theme }); onPreviewTheme(theme) }
  useEffect(() => () => onPreviewTheme(null), [onPreviewTheme])
  const themeColors: RadarThemeColors = radarThemeColors(form.theme) ?? form.theme.custom
  const themeOptions: Array<{ id: RadarThemePreset; label: string; colors: RadarThemeColors | null }> = [
    { id: 'site', label: 'Match the site theme', colors: null },
    ...radarThemePresets,
    { id: 'custom', label: 'Custom colours', colors: form.theme.custom },
  ]
  const applied = settings.updatedAt !== null && activeUpdatedAt === settings.updatedAt

  return <form className="radar-settings" onSubmit={event => { event.preventDefault(); onSave(form); setDirty(false); onPreviewTheme(null) }}>
    <section className="radar-card">
      <div className="panel-heading"><span className="number-tag">01</span><h2>Which coins are tracked</h2><span className="panel-caption">TURN A REQUIREMENT OFF TO IGNORE IT</span></div>
      <div className="radar-requirements">
        {radarRequirementInfo.map(info => <div key={info.key} className={`radar-requirement ${form[info.key].enabled ? '' : 'off'}`}>
          <Toggle id={`req-${info.key}`} label={info.label} checked={form[info.key].enabled} onChange={enabled => change({ ...form, [info.key]: { ...form[info.key], enabled } })}/>
          <label className="radar-requirement-value" htmlFor={`req-value-${info.key}`}>
            <span className="sr-only">{info.label} value</span>
            <input id={`req-value-${info.key}`} type="number" inputMode="decimal" min={0} max={info.max} step={info.step} value={form[info.key].value} disabled={!form[info.key].enabled} onChange={event => change({ ...form, [info.key]: { ...form[info.key], value: Number(event.target.value) || 0 } })}/>
            <span>{info.unit}</span>
          </label>
        </div>)}
      </div>
      <Toggle id="set-pulse" label="Always track coins on my Axiom Pulse" hint="Coins the bridge sees on Pulse skip the volume, trades, liquidity and buy-share requirements." checked={form.pulseBypassesMarket} onChange={pulseBypassesMarket => change({ ...form, pulseBypassesMarket })}/>
      <Toggle id="set-safe" label="Hide coins RugCheck rates caution or risky" checked={form.safeOnly} onChange={safeOnly => change({ ...form, safeOnly })}/>
      <NumberField id="set-max" label="Coins tracked at once" hint="Ranked by live viewers. More coins means slower price refreshes above 60." value={form.maxCoins} min={5} max={150} step={5} onChange={maxCoins => change({ ...form, maxCoins })}/>
    </section>

    <section className="radar-card">
      <div className="panel-heading"><span className="number-tag">02</span><h2>Recommended buy rules</h2><span className="panel-caption">A COIN MUST PASS ALL OF THESE</span></div>
      <div className="radar-field-grid">
        <NumberField id="buy-score" label="Minimum setup score" value={form.buy.minScore} max={100} onChange={minScore => change({ ...form, buy: { ...form.buy, minScore } })}/>
        <NumberField id="buy-1m" label="Minimum price gain, 1 minute (%)" value={form.buy.minGain1mPercent} min={-100} step={0.5} onChange={minGain1mPercent => change({ ...form, buy: { ...form.buy, minGain1mPercent } })}/>
        <NumberField id="buy-5m" label="Minimum price gain, 5 minutes (%)" value={form.buy.minGain5mPercent} min={-100} step={0.5} onChange={minGain5mPercent => change({ ...form, buy: { ...form.buy, minGain5mPercent } })}/>
        <NumberField id="buy-viewers" label="Minimum Axiom viewers" value={form.buy.minViewers} step={5} onChange={minViewers => change({ ...form, buy: { ...form.buy, minViewers } })}/>
      </div>
      <Toggle id="buy-safe" label="Require no red flags" hint="Blocks coins failing any quality check (holders, bundlers, fees, dev record, authorities)." checked={form.buy.requireSafe} onChange={requireSafe => change({ ...form, buy: { ...form.buy, requireSafe } })}/>
    </section>

    <section className="radar-card">
      <div className="panel-heading"><span className="number-tag">03</span><h2>Coins to watch and alerts</h2><span className="panel-caption">ANY ONE OF THESE</span></div>
      <div className="radar-field-grid">
        <NumberField id="watch-score" label="Minimum setup score" value={form.watch.minScore} max={100} onChange={minScore => change({ ...form, watch: { ...form.watch, minScore } })}/>
        <NumberField id="watch-5m" label="Price gain, 5 minutes (%)" value={form.watch.minGain5mPercent} min={-100} step={0.5} onChange={minGain5mPercent => change({ ...form, watch: { ...form.watch, minGain5mPercent } })}/>
        <label className="radar-field" htmlFor="surge-level">
          <span>Viewer surge sensitivity<small>How quickly viewers must climb for "gaining viewers quickly". It adapts to each coin's size and to the other coins.</small></span>
          <select id="surge-level" value={form.surgeSensitivity} onChange={event => change({ ...form, surgeSensitivity: Number(event.target.value) as 1 | 2 | 3 })}>
            <option value={1}>Strict: only strong surges</option>
            <option value={2}>Normal</option>
            <option value={3}>Sensitive: early, more alerts</option>
          </select>
        </label>
        <NumberField id="wallet-hits" label="Smart holder: good coins held" hint="A wallet counts once it is a top holder of this many good coins." value={form.wallets.minRunnerHits} min={1} max={20} onChange={minRunnerHits => change({ ...form, wallets: { minRunnerHits } })}/>
      </div>
    </section>

    <section className="radar-card">
      <div className="panel-heading"><span className="number-tag">04</span><h2>Appearance</h2><span className="panel-caption">COLOURS FOR THIS PAGE ONLY</span></div>
      <div className="radar-theme-presets" role="radiogroup" aria-label="Colour theme">
        {themeOptions.map(option => <button key={option.id} type="button" role="radio" aria-checked={form.theme.preset === option.id} className={form.theme.preset === option.id ? 'active' : ''} onClick={() => changeTheme({ ...form.theme, preset: option.id })}>
          <span className="radar-theme-swatch" aria-hidden="true">{option.colors ? [option.colors.background, option.colors.panel, option.colors.accent, option.colors.up].map((color, index) => <i key={index} style={{ background: color }}/>) : <i className="site"/>}</span>
          {option.label}
        </button>)}
      </div>
      <p className="radar-note">Change any colour below to build your own theme. It starts from the theme selected above and switches to Custom colours.</p>
      <div className="radar-theme-colors">
        {radarThemeColorInfo.map(info => <label key={info.key} htmlFor={`theme-${info.key}`}>
          <input id={`theme-${info.key}`} type="color" value={themeColors[info.key]} onChange={event => changeTheme({ preset: 'custom', custom: { ...themeColors, [info.key]: event.target.value } })}/>
          <span>{info.label}<small className="mono">{themeColors[info.key]}</small></span>
        </label>)}
      </div>
    </section>

    <div className="radar-settings-actions">
      <button type="submit" className="primary-button" disabled={saving || !dirty}>{saving ? <LoaderCircle size={15} className="spin"/> : <Check size={15}/>}{saving ? 'Saving…' : 'Save settings'}</button>
      <button type="button" className="secondary-button" disabled={saving} onClick={() => { change({ ...defaultRadarSettings, pinned: form.pinned, updatedAt: form.updatedAt }); onPreviewTheme(defaultRadarSettings.theme) }}><RotateCcw size={13}/> Reset to defaults</button>
      <p role="status" className="radar-muted">
        {error ? <span className="radar-bad">{error}</span>
          : dirty ? 'Unsaved changes.'
          : settings.updatedAt === null ? 'Using the default settings.'
          : applied ? `Saved ${relativeSeconds(settings.updatedAt, now)} and active on the tracker.`
          : 'Saved. Waiting for the tracker to pick it up (a few seconds while this page is open).'}
      </p>
    </div>
  </form>
}
