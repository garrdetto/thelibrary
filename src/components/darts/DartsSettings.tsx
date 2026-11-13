import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ExternalLink, LoaderCircle, RotateCcw, Upload } from 'lucide-react'
import { NumberInput } from '../admin/NumberInput'
import { RADII, SECTORS, SECTOR_DEGREES, SOFT_RADII } from '../../../modules-src/darts/shared/Board'
import {
  CLASSIC_METER_MODES,
  DART_COLOR_FIELDS,
  DART_FINISHES,
  DEFAULT_SETTINGS,
  METER_FIELDS,
  SPIDER_COLOR_FIELDS,
  STEEL_COLOR_FIELDS,
  changedSettings,
  sameSettings,
  sanitizeSettings,
} from '../../../modules-src/darts/shared/Settings'
import type { ClassicMeterMode, DartFinish, DartsSettings, MeterField, SpiderColors, SteelColors } from '../../../modules-src/darts/shared/Settings'

const ENDPOINT = '/api/darts-settings'

type Tab = 'meter' | 'boards' | 'darts' | 'setup'
const TABS: { id: Tab; label: string }[] = [
  { id: 'meter', label: 'Throw meter' },
  { id: 'boards', label: 'Board colours' },
  { id: 'darts', label: 'Dart colours' },
  { id: 'setup', label: 'Setup defaults' },
]

const CLASSIC_LABELS: Record<ClassicMeterMode, { label: string; help: string }> = {
  off: { label: 'Hidden', help: 'Everyone throws with the cross meter. No meter choice is shown.' },
  option: { label: 'Offered', help: 'Players can switch to the classic meter in the setup form and pause menu. Cross is the default.' },
  default: { label: 'Offered, classic first', help: 'Players can switch, and the classic meter is the default for anyone who has not picked.' },
  only: { label: 'Classic only', help: 'Everyone throws with the classic one-stage meter. No meter choice is shown.' },
}

const FINISH_LABELS: Record<DartFinish, string> = { stock: 'As modelled', polished: 'Polished', satin: 'Satin', matte: 'Matte' }
const GROUP_TITLES: Record<MeterField['group'], string> = { timing: 'Timing', zones: 'Zones (share of the ideal speed, either side of it)', misses: 'Misses (in soft-tip holes of 3.4 mm)' }

async function readError(response: Response) {
  try { return ((await response.json()) as { error?: string }).error ?? 'Something went wrong. Please try again.' } catch { return 'Something went wrong. Please try again.' }
}

const scaleOf = (field: MeterField) => field.unit === 'percent' ? 100 : 1
const unitOf = (field: MeterField) => field.unit === 'percent' ? '%' : field.unit === 'holes' ? 'holes' : field.unit === 'seconds' ? 's' : '×'
const shown = (field: MeterField, value: number) => `${Math.round(value * scaleOf(field) * 1000) / 1000} ${unitOf(field)}`

function MeterPreview({ settings }: { settings: DartsSettings }) {
  const m = settings.meter
  const low = m.chargeLow
  const high = m.chargeHigh
  const at = (fraction: number) => `${Math.max(0, Math.min(100, ((1 + fraction - low) / (high - low)) * 100)).toFixed(2)}%`
  const blend = m.fade + (m.band - m.fade) * 0.6
  const stops: [string, number][] = [
    ['#e8433a', -m.band - 0.05], ['#ffcf4a', -m.band], ['#ffcf4a', -blend], ['#90d15a', -m.fade], ['#22d36a', -m.green * 0.4],
    ['#22d36a', m.green * 0.4], ['#90d15a', m.fade], ['#ffcf4a', blend], ['#ffcf4a', m.band], ['#e8433a', m.band + 0.05],
  ]
  const gradient = `linear-gradient(to right, #e8433a 0%, ${stops.map(([color, f]) => `${color} ${at(f)}`).join(', ')}, #e8433a 100%)`
  return <figure className="dts-meter" aria-label="Height meter preview">
    <div className="dts-meter-bar" style={{ background: gradient }}>
      <span className="dts-meter-line" style={{ left: at(-m.perfectWindow) }}/>
      <span className="dts-meter-line" style={{ left: at(m.perfectWindow) }}/>
    </div>
    <figcaption>
      <span>{Math.round(low * 100)}% speed</span>
      <span>Perfect ±{(m.perfectWindow * 100).toFixed(2)}% · green ±{(m.green * 100).toFixed(2)}% · yellow to ±{(m.band * 100).toFixed(1)}% · one swing {m.chargeSeconds.toFixed(2)} s</span>
      <span>{Math.round(high * 100)}% speed</span>
    </figcaption>
  </figure>
}

function drawBoard(canvas: HTMLCanvasElement, kind: 'steel' | 'spider', steel: SteelColors, spider: SpiderColors) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const size = canvas.width
  const scale = size / (RADII.board * 2)
  const c = size / 2
  const rad = (deg: number) => ((deg - 90) * Math.PI) / 180
  const radii = kind === 'spider' ? SOFT_RADII : RADII
  ctx.clearRect(0, 0, size, size)
  const disc = (r: number, fill: string) => { ctx.beginPath(); ctx.arc(c, c, r * scale, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill() }
  const wedge = (inner: number, outer: number, from: number, to: number, fill: string) => {
    ctx.beginPath()
    ctx.arc(c, c, outer * scale, rad(from), rad(to))
    ctx.arc(c, c, inner * scale, rad(to), rad(from), true)
    ctx.closePath()
    ctx.fillStyle = fill
    ctx.fill()
  }
  disc(RADII.board, kind === 'spider' ? spider.catch : steel.black)
  for (let i = 0; i < SECTORS.length; i++) {
    const from = i * SECTOR_DEGREES - SECTOR_DEGREES / 2
    const to = from + SECTOR_DEGREES
    const even = i % 2 === 0
    const single = kind === 'spider' ? (even ? spider.black : spider.red) : even ? steel.black : steel.cream
    const bed = kind === 'spider' ? (even ? spider.red : spider.black) : even ? steel.red : steel.green
    wedge(radii.outerBull, radii.tripleInner, from, to, single)
    wedge(radii.tripleInner, radii.tripleOuter, from, to, bed)
    wedge(radii.tripleOuter, radii.doubleInner, from, to, single)
    wedge(radii.doubleInner, radii.doubleOuter, from, to, bed)
  }
  disc(RADII.outerBull, kind === 'spider' ? spider.red : steel.green)
  disc(RADII.innerBull, kind === 'spider' ? spider.black : steel.red)
  const wire = kind === 'spider' ? spider.spider : steel.wire
  ctx.strokeStyle = wire
  ctx.lineWidth = Math.max(1, (kind === 'spider' ? 1.7 : 1.15) * scale)
  for (const r of [radii.outerBull, radii.tripleInner, radii.tripleOuter, radii.doubleInner, radii.doubleOuter]) { ctx.beginPath(); ctx.arc(c, c, r * scale, 0, Math.PI * 2); ctx.stroke() }
  for (let i = 0; i < SECTORS.length; i++) {
    const a = rad(i * SECTOR_DEGREES + SECTOR_DEGREES / 2)
    ctx.beginPath()
    ctx.moveTo(c + Math.cos(a) * radii.outerBull * scale, c + Math.sin(a) * radii.outerBull * scale)
    ctx.lineTo(c + Math.cos(a) * radii.doubleOuter * scale, c + Math.sin(a) * radii.doubleOuter * scale)
    ctx.stroke()
  }
  if (kind === 'spider') {
    ctx.strokeStyle = spider.trim
    ctx.lineWidth = 2.4 * scale
    ctx.beginPath(); ctx.arc(c, c, (RADII.numberRing + 4) * scale, 0, Math.PI * 2); ctx.stroke()
    ctx.lineWidth = 4 * scale
    ctx.beginPath(); ctx.arc(c, c, (RADII.board - 2.5) * scale, 0, Math.PI * 2); ctx.stroke()
  }
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `800 ${Math.round(23 * scale)}px "Arial Black", Arial, sans-serif`
  ctx.lineJoin = 'round'
  const numberRadius = (RADII.doubleOuter + RADII.numberRing) / 2 + (kind === 'spider' ? 2 : 0.5)
  SECTORS.forEach((value, i) => {
    const a = rad(i * SECTOR_DEGREES)
    const x = c + Math.cos(a) * numberRadius * scale
    const y = c + Math.sin(a) * numberRadius * scale
    if (kind === 'steel') { ctx.strokeStyle = steel.numberEdge; ctx.lineWidth = 2.6 * scale; ctx.strokeText(String(value), x, y) }
    ctx.fillStyle = kind === 'spider' ? spider.number : steel.number
    ctx.fillText(String(value), x, y)
  })
}

function BoardPreview({ kind, settings }: { kind: 'steel' | 'spider'; settings: DartsSettings }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => { if (ref.current) drawBoard(ref.current, kind, settings.steel, settings.spider) }, [kind, settings.steel, settings.spider])
  const board = <canvas ref={ref} width={320} height={320} role="img" aria-label={`${kind === 'spider' ? 'Soft-tip' : 'Steel-tip'} board preview`}/>
  if (kind === 'steel') return <div className="dts-board">{board}</div>
  return <div className="dts-board dts-housing" style={{ background: settings.spider.housing, borderColor: settings.spider.housingTrim }}>{board}</div>
}

function DartPreview({ steel, settings, flight }: { steel: boolean; settings: DartsSettings; flight: string }) {
  const d = settings.darts
  const barrel = steel ? (d.steelTint === '#ffffff' ? '#9aa0a8' : d.steelTint) : d.softBarrel
  const shaft = steel ? '#1c1f26' : d.softShaft
  const tip = steel ? '#c9ced6' : d.softTip
  const fins = steel || d.softPlayerFlights ? flight : d.softFlight
  return <svg className="dts-dart" viewBox="0 0 200 40" role="img" aria-label={`${steel ? 'Steel-tip' : 'Soft-tip'} dart preview`}>
    <polygon points="2,20 30,18 30,22" fill={tip}/>
    <rect x="30" y="14" width="56" height="12" rx="4" fill={barrel}/>
    {[38, 46, 54, 62, 70, 78].map(x => <rect key={x} x={x} y="14" width="2" height="12" fill="rgba(0,0,0,.25)"/>)}
    <rect x="86" y="17" width="52" height="6" rx="2" fill={shaft}/>
    <path d="M130 20 L150 4 L196 2 L196 20 Z" fill={fins}/>
    <path d="M130 20 L150 36 L196 38 L196 20 Z" fill={fins} opacity=".82"/>
  </svg>
}

function ColorRow({ id, label, value, fallback, onChange }: { id: string; label: string; value: string; fallback: string; onChange: (value: string) => void }) {
  return <li className={`dts-color${value !== fallback ? ' is-changed' : ''}`}>
    <input id={id} type="color" value={value} onChange={event => onChange(event.target.value.toLowerCase())}/>
    <label htmlFor={id}>{label}</label>
    <code>{value}</code>
    <button type="button" className="adm-btn adm-btn-ghost dts-mini" disabled={value === fallback} onClick={() => onChange(fallback)} aria-label={`Reset ${label} to ${fallback}`}>Default</button>
  </li>
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="dts-section"><h3>{title}</h3>{children}</section>
}

export default function DartsSettingsPanel() {
  const [live, setLive] = useState<{ settings: DartsSettings; updatedAt: number | null } | null>(null)
  const [loadError, setLoadError] = useState('')
  const [draft, setDraft] = useState<DartsSettings>(DEFAULT_SETTINGS)
  const [tab, setTab] = useState<Tab>('meter')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoadError('')
    try {
      const response = await fetch(ENDPOINT, { credentials: 'same-origin', cache: 'no-store' })
      if (!response.ok) throw new Error(await readError(response))
      const data = await response.json() as { settings: unknown; updatedAt: number | null }
      const settings = sanitizeSettings(data.settings)
      setLive({ settings, updatedAt: data.updatedAt ?? null })
      setDraft(settings)
    } catch (reason) {
      setLoadError(reason instanceof Error ? reason.message : 'The Darts settings could not load.')
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const edit = (change: (current: DartsSettings) => DartsSettings) => { setStatus(''); setDraft(current => change(current)) }
  const setMeter = (key: MeterField['key'], value: number) => edit(current => ({ ...current, meter: { ...current.meter, [key]: value } }))

  async function publish() {
    setBusy(true)
    setError('')
    setStatus('')
    try {
      const clean = sanitizeSettings(draft)
      const body = changedSettings(clean).length ? { action: 'save', settings: clean } : { action: 'reset' }
      const response = await fetch(ENDPOINT, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!response.ok) throw new Error(await readError(response))
      const data = await response.json() as { settings: unknown; updatedAt: number | null }
      const settings = sanitizeSettings(data.settings)
      setLive({ settings, updatedAt: data.updatedAt ?? null })
      setDraft(settings)
      setStatus(sameSettings(settings, clean) ? 'Published. Players get the new settings the next time the Darts page loads.' : 'Published. Some values were adjusted to keep the meter zones in order.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (loadError) return <div><p className="adm-error" role="alert">{loadError}</p><button type="button" className="adm-btn" onClick={() => void load()}>Try again</button></div>
  if (!live) return <p className="race-loading" role="status"><LoaderCircle className="spin" size={18}/> Loading the Darts settings…</p>

  const dirty = !sameSettings(draft, live.settings)
  const changed = changedSettings(draft).length
  const m = draft.meter

  return <div className="dts">
    <p className="adm-help">These settings apply to everyone who opens Darts, including online rooms (which read the meter settings when a room opens). The defaults are the module as built. Records already set stay on the record book, so big meter changes make old and new results hard to compare.</p>
    <div className="sth-tracks" role="tablist" aria-label="Darts settings">
      {TABS.map(item => <button key={item.id} type="button" role="tab" id={`dts-tab-${item.id}`} aria-selected={tab === item.id} aria-controls="dts-pane" onClick={() => setTab(item.id)}>{item.label}</button>)}
    </div>
    <div id="dts-pane" role="tabpanel" aria-labelledby={`dts-tab-${tab}`}>
      {tab === 'meter' && <>
        <MeterPreview settings={draft}/>
        <Section title="Classic one-stage meter">
          <div className="dts-modes" role="radiogroup" aria-label="Classic meter">
            {CLASSIC_METER_MODES.map(mode => <label key={mode} className={m.classic === mode ? 'is-active' : ''}>
              <input type="radio" name="dts-classic" value={mode} checked={m.classic === mode} onChange={() => edit(current => ({ ...current, meter: { ...current.meter, classic: mode } }))}/>
              <span><strong>{CLASSIC_LABELS[mode].label}</strong><small>{CLASSIC_LABELS[mode].help}</small></span>
            </label>)}
          </div>
        </Section>
        {(['timing', 'zones', 'misses'] as const).map(group => <Section key={group} title={GROUP_TITLES[group]}>
          <ul className="sth-list">
            {METER_FIELDS.filter(field => field.group === group).map(field => {
              const id = `dts-${field.key}`
              const value = m[field.key]
              const scale = scaleOf(field)
              const fallback = DEFAULT_SETTINGS.meter[field.key]
              return <li key={field.key} className={`sth-row${value !== fallback ? ' is-changed' : ''}`}>
                <label htmlFor={id}>{field.label}</label>
                <span className="dts-num">
                  <NumberInput id={id} value={Math.round(value * scale * 1e6) / 1e6} min={field.min * scale} max={field.max * scale} step="any" aria-describedby={`${id}-help`} onChange={next => setMeter(field.key, next / scale)}/>
                  <span aria-hidden>{unitOf(field)}</span>
                </span>
                <p id={`${id}-help`}>{field.help} Default {shown(field, fallback)}; range {shown(field, field.min)} to {shown(field, field.max)}.</p>
              </li>
            })}
          </ul>
        </Section>)}
      </>}
      {tab === 'boards' && <div className="dts-cols">
        <Section title="Steel Tip (bristle)">
          <BoardPreview kind="steel" settings={draft}/>
          <ul className="dts-colors">
            {STEEL_COLOR_FIELDS.map(field => <ColorRow key={field.key} id={`dts-steel-${field.key}`} label={field.label} value={draft.steel[field.key]} fallback={DEFAULT_SETTINGS.steel[field.key]}
              onChange={value => edit(current => ({ ...current, steel: { ...current.steel, [field.key]: value } }))}/>)}
          </ul>
        </Section>
        <Section title="Soft Tip (Spider 360)">
          <BoardPreview kind="spider" settings={draft}/>
          <ul className="dts-colors">
            {SPIDER_COLOR_FIELDS.map(field => <ColorRow key={field.key} id={`dts-spider-${field.key}`} label={field.label} value={draft.spider[field.key]} fallback={DEFAULT_SETTINGS.spider[field.key]}
              onChange={value => edit(current => ({ ...current, spider: { ...current.spider, [field.key]: value } }))}/>)}
          </ul>
        </Section>
      </div>}
      {tab === 'darts' && <div className="dts-cols">
        <Section title="Flights (one colour per player or team)">
          <ul className="dts-colors">
            {draft.darts.flightColors.map((value, i) => <ColorRow key={i} id={`dts-flight-${i}`} label={`Player ${i + 1}`} value={value} fallback={DEFAULT_SETTINGS.darts.flightColors[i]}
              onChange={next => edit(current => ({ ...current, darts: { ...current.darts, flightColors: current.darts.flightColors.map((item, k) => k === i ? next : item) } }))}/>)}
          </ul>
          <label className="dts-check"><input type="checkbox" checked={draft.darts.softPlayerFlights} onChange={event => { const on = event.target.checked; edit(current => ({ ...current, darts: { ...current.darts, softPlayerFlights: on } })) }}/> Soft-tip flights take the player colours too (otherwise they use the soft-tip flight colour below)</label>
          <div className="dts-darts">
            <DartPreview steel settings={draft} flight={draft.darts.flightColors[0]}/>
            <DartPreview steel={false} settings={draft} flight={draft.darts.flightColors[1]}/>
          </div>
        </Section>
        <Section title="Barrels, shafts and points">
          <ul className="dts-colors">
            {DART_COLOR_FIELDS.map(field => <ColorRow key={field.key} id={`dts-dart-${field.key}`} label={field.label} value={draft.darts[field.key]} fallback={DEFAULT_SETTINGS.darts[field.key]}
              onChange={value => edit(current => ({ ...current, darts: { ...current.darts, [field.key]: value } }))}/>)}
          </ul>
          {(['steelFinish', 'softFinish'] as const).map(key => <label key={key} className="dts-select">{key === 'steelFinish' ? 'Steel-tip barrel finish' : 'Soft-tip barrel finish'}
            <select value={draft.darts[key]} onChange={event => { const value = event.target.value as DartFinish; edit(current => ({ ...current, darts: { ...current.darts, [key]: value } })) }}>
              {DART_FINISHES.map(finish => <option key={finish} value={finish}>{FINISH_LABELS[finish]}</option>)}
            </select>
          </label>)}
          <p className="adm-help">The steel-tip model's barrel and shaft share one painted texture, so the tint colours both. Until the models load (or on devices that can't load them) a simple built-in dart is shown.</p>
        </Section>
      </div>}
      {tab === 'setup' && <Section title="What the setup form starts with">
        <div className="dts-setup">
          <label className="dts-select">Board for new visitors
            <select value={draft.defaults.board} onChange={event => { const value = event.target.value === 'steel' ? 'steel' : 'spider'; edit(current => ({ ...current, defaults: { ...current.defaults, board: value } })) }}>
              <option value="spider">Soft Tip</option><option value="steel">Steel Tip</option>
            </select>
          </label>
          <label className="dts-select">Computer level
            <select value={draft.defaults.cpuLevel} onChange={event => { const value = event.target.value as DartsSettings['defaults']['cpuLevel']; edit(current => ({ ...current, defaults: { ...current.defaults, cpuLevel: value } })) }}>
              <option value="pub">Pub</option><option value="league">League</option><option value="county">County</option><option value="pro">Pro</option>
            </select>
          </label>
          {([['doubleOutSteel', 'Double out on, Steel Tip'], ['doubleOutSoft', 'Double out on, Soft Tip'], ['doubleBull', 'Double Bull on (Soft Tip)']] as const).map(([key, label]) =>
            <label key={key} className="dts-check"><input type="checkbox" checked={draft.defaults[key]} onChange={event => { const on = event.target.checked; edit(current => ({ ...current, defaults: { ...current.defaults, [key]: on } })) }}/> {label}</label>)}
          <p className="adm-help">A visitor's own board choice is kept on their device and wins over the board default.</p>
        </div>
      </Section>}
    </div>
    <div className="sth-actions">
      <button type="button" className="adm-btn adm-btn-primary" disabled={busy || !dirty} onClick={() => void publish()}>
        {busy ? <LoaderCircle className="spin" size={16} aria-hidden/> : <Upload size={16} aria-hidden/>} Publish
      </button>
      <button type="button" className="adm-btn" disabled={busy || !dirty} onClick={() => { setDraft(live.settings); setStatus('') }}>Undo edits</button>
      <button type="button" className="adm-btn adm-btn-ghost" disabled={busy || changed === 0} onClick={() => edit(() => sanitizeSettings(DEFAULT_SETTINGS))}><RotateCcw size={16} aria-hidden/> All to defaults</button>
      <a className="adm-btn adm-btn-ghost" href="/modules/darts.html" target="_blank" rel="noopener">Open Darts <ExternalLink size={15} aria-hidden/></a>
    </div>
    <p className="sth-status" role="status" aria-live="polite">{status || (dirty ? `Unpublished changes${changed ? ` (${changed} setting${changed === 1 ? '' : 's'} off the defaults)` : ' (back to the defaults)'}.` : live.updatedAt ? `Live since ${new Date(live.updatedAt).toLocaleString()}.` : 'Darts runs the default settings.')}</p>
    {error && <p className="adm-error" role="alert">{error}</p>}
  </div>
}
