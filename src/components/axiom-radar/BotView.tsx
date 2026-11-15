import { useEffect, useState } from 'react'
import { ArrowRight, Bot, Check, LoaderCircle, RotateCcw, Undo2 } from 'lucide-react'
import { botDialGroups, botDials, botPresets, defaultBotValues, normalizeBotValues, type BotDial, type BotDialValue, type BotValues } from '@/lib/axiom-bot'
import { BotControls, botStatus, bracket, feeLine, headline, signedHeadline, signedPercent, toneOf } from './BotControls'
import { BotLearningCard } from './BotLearning'
import { relativeSeconds } from './format'
import { NumberField, Toggle } from './SettingsFields'
import { useBot } from './useBot'
import { useRadarAccess } from './access'
import './axiom-bot.css'

const pauseKey = 'bot.enabled'
const shownDials = botDials.filter(dial => dial.key !== pauseKey)
const shownGroups = botDialGroups.map(group => ({ ...group, dials: shownDials.filter(dial => dial.key.startsWith(`${group.id}.`)) })).filter(group => group.dials.length > 0)
const rideOnly = new Set(['sell.ride_trail_pct'])
const autoFeeOnly = new Set(['costs.auto_fee_level', 'costs.max_fee_sol'])

function DialField({ dial, prefix, value, onChange }: { dial: BotDial; prefix: string; value: BotDialValue; onChange: (value: BotDialValue) => void }) {
  const id = `${prefix}-${dial.key.replace('.', '-')}`
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

/** The bot's control screen: its terminal actions as buttons, quick setup, every dial, and a Save bar that says when the bot has the change. */
export function BotView({ now, onOpenTrades }: { now: number; onOpenTrades: () => void }) {
  const bot = useBot()
  const { view, error, loading, saveSettings } = bot
  const { canEdit } = useRadarAccess()
  const [form, setForm] = useState<BotValues>(defaultBotValues)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const saved = view?.settings ?? null
  const report = view?.report ?? null
  const sol = report?.accountSol
  useEffect(() => { if (saved && !dirty) setForm(saved.values) }, [saved, dirty])

  const change = (key: string, value: BotDialValue) => { setForm(current => ({ ...current, [key]: value })); setDirty(true) }
  const changedIn = (dials: BotDial[]) => saved ? dials.filter(dial => form[dial.key] !== saved.values[dial.key]).length : 0
  const changed = changedIn(shownDials)
  const preset = botPresets.find(option => Object.entries(option.values).every(([key, value]) => form[key] === value))?.id ?? 'custom'
  const status = botStatus(bot, now)
  const applied = Boolean(view?.online && saved?.updatedAt && report?.settingsStamp === saved.updatedAt)

  const save = async () => {
    setSaving(true)
    setSaveError('')
    try {
      await saveSettings(Object.fromEntries(Object.entries(normalizeBotValues(form)).filter(([key]) => key !== pauseKey)))
      setDirty(false)
    } catch (failure) {
      setSaveError(failure instanceof Error ? failure.message : 'The bot settings could not be saved. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return <div className="radar-bot-view">
    <div className="radar-section-head radar-bot-head">
      <h2><Bot size={17} aria-hidden="true"/> Trading bot <span className={`radar-bot-chip ${status.tone}`}>{status.label}</span></h2>
      <p>Set the bot up here. Save sends your dials to the Python bot on your PC, which applies them on its next pull (about 10 seconds) and rewrites its settings file to match. It trades with pretend SOL and never places a real order.</p>
      <BotControls bot={bot}/>
    </div>

    {loading ? <p className="radar-empty-line" role="status">Loading the bot…</p>
      : error && !view ? <p className="radar-empty-line radar-bad" role="alert">{error}</p>
      : !report ? <div className="radar-empty">
        <h3>The bot has not reported yet</h3>
        <p>Start it on the PC that runs the tracker. It finds the site and its key in the tracker's <span className="mono">.env</span> file. You can set its dials below first.</p>
        <code className="radar-bot-code">python scripts/axiom-paper-bot/run.py</code>
      </div>
      : <div className="radar-kpis radar-bot-strip">
        <div className="radar-kpi"><span>Account value</span><strong className="tabular">{headline(sol?.equity, report.account.equity)}</strong><small className={`radar-delta ${toneOf(report.account.totalPnl)}`}>{bracket(sol?.equity, report.account.equity)}{signedHeadline(sol?.totalPnl, report.account.totalPnl)} ({signedPercent(report.account.totalPnlPct)})</small></div>
        <div className="radar-kpi"><span>Today</span><strong className={`tabular radar-delta ${toneOf(report.account.dayPnl)}`}>{signedHeadline(sol?.dayPnl, report.account.dayPnl)}</strong><small>{bracket(sol?.dayPnl, Math.abs(report.account.dayPnl))}{signedPercent(report.account.dayPnlPct)} · {report.stats.trades} closed trades</small></div>
        <div className="radar-kpi"><span>Coins held</span><strong className="tabular">{report.positions.length}</strong><small>{headline(sol?.exposure, report.account.exposure)} of {headline(sol?.exposureLimit, report.account.exposureLimit)} allowed</small></div>
        <div className="radar-kpi"><span>Radar feed</span><strong className="tabular">{report.feed.ageSeconds === null ? '—' : `${report.feed.ageSeconds}s old`}</strong><small>{report.feed.live ? 'Live' : 'Not live'} · {report.feed.coins} coins</small></div>
        <button type="button" className="secondary-button radar-bot-more" onClick={onOpenTrades}>Positions, trades and activity <ArrowRight size={13}/></button>
        {report.fees && <p className="radar-note radar-bot-fee">{feeLine(report)}</p>}
      </div>}

    {view && <form className={`radar-settings radar-bot-settings ${canEdit ? '' : 'radar-readonly'}`} noValidate inert={!canEdit} onSubmit={event => { event.preventDefault(); if (canEdit) void save() }}>
      {!canEdit && <p className="radar-note radar-readonly-note" role="note">These are the dials the bot is using. Only the administrator can change them.</p>}
      <section className="radar-card">
        <div className="panel-heading"><span className="number-tag">01</span><h2>Trading style</h2><span className="panel-caption">A STARTING POINT FOR THE DIALS BELOW</span></div>
        <div className="radar-bot-presets" role="radiogroup" aria-label="Trading style">
          {botPresets.map(option => <button key={option.id} type="button" role="radio" aria-checked={preset === option.id} className={preset === option.id ? 'active' : ''} onClick={() => { setForm(current => ({ ...current, ...option.values })); setDirty(true) }}>
            <strong>{option.label}</strong><small>{option.summary}</small>
          </button>)}
        </div>
        <p className="radar-note">{preset === 'custom' ? 'Your dials do not match a style exactly. That is fine: a style only fills in a starting point.' : `Using the ${botPresets.find(option => option.id === preset)?.label} style.`}</p>
      </section>

      {shownGroups.map((group, index) => {
        const edits = changedIn(group.dials)
        const dials = group.dials.filter(dial => (!rideOnly.has(dial.key) || form['sell.ride_momentum'] === true) && (!autoFeeOnly.has(dial.key) || form['costs.fee_mode'] === 'auto'))
        return <section key={group.id} className="radar-card radar-bot-group" aria-labelledby={`bot-group-${group.id}`}>
          <div className="panel-heading">
            <span className="number-tag">{String(index + 2).padStart(2, '0')}</span>
            <h2 id={`bot-group-${group.id}`}>{group.label}</h2>
            <span className="radar-bot-caption">{group.caption}</span>
            {edits > 0 && <span className="radar-bot-count changed">{edits} changed</span>}
          </div>
          <div className="radar-field-grid radar-bot-dials">
            {dials.map(dial => <DialField key={dial.key} dial={dial} prefix="bot" value={form[dial.key] ?? dial.default} onChange={value => change(dial.key, value)}/>)}
          </div>
          {group.id === 'learn' && <BotLearningCard learning={report?.learning ?? null}/>}
        </section>
      })}

      <div className="radar-settings-actions radar-bot-savebar">
        <button type="submit" className="primary-button" disabled={saving || !dirty}>{saving ? <LoaderCircle size={15} className="spin"/> : <Check size={15}/>}{saving ? 'Saving…' : 'Save and send to the bot'}</button>
        <button type="button" className="secondary-button" disabled={saving || !dirty} onClick={() => { if (saved) setForm(saved.values); setDirty(false); setSaveError('') }}><Undo2 size={13}/> Undo changes</button>
        <button type="button" className="secondary-button" disabled={saving} onClick={() => { setForm(defaultBotValues); setDirty(true) }}><RotateCcw size={13}/> All defaults</button>
        <p role="status" className="radar-muted">
          {saveError || error ? <span className="radar-bad">{saveError || error}</span>
            : dirty ? `Unsaved changes${changed ? ` to ${changed} dial${changed === 1 ? '' : 's'}` : ''}.`
            : !saved || saved.updatedAt === null ? 'Using the default dials.'
            : applied ? `Saved ${relativeSeconds(saved.updatedAt, now)} and active on the bot.`
            : view.online ? 'Saved. Waiting for the bot to pick it up (a few seconds).'
            : 'Saved. The bot is not running; it uses these when it starts.'}
        </p>
      </div>
    </form>}
  </div>
}
