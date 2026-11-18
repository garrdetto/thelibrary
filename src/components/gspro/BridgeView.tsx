import { useEffect, useState } from 'react'
import { Check, Copy, Download, FileUp, KeyRound, LoaderCircle, Pencil, Trash2 } from 'lucide-react'
import { importCsv, type CsvImport } from '@/lib/gspro/csv'
import type { BridgeStatus, GsproSession, Handed } from '@/lib/gspro/types'
import { gsproApi } from './api'

function ago(at: number | null) {
  if (!at) return 'never'
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`
  return new Date(at).toLocaleDateString()
}

function CopyBlock({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return <div className="gs-code">
    <code aria-label={label}>{text}</code>
    <button type="button" className="gs-icon-button" aria-label={`Copy ${label}`} onClick={() => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })}>
      {copied ? <Check size={15} aria-hidden/> : <Copy size={15} aria-hidden/>}
    </button>
  </div>
}

function Bag() {
  const [bag, setBag] = useState<{ name: string; loft: number }[] | null>(null)
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  useEffect(() => { gsproApi.bag().then(result => { setBag(result.bag); setUpdatedAt(result.updatedAt) }).catch(() => setBag([])) }, [])
  if (!bag?.length) return null
  return <section className="gs-panel">
    <header className="gs-panel-head"><div><h2>Your ProTee bag</h2><p>Static lofts read from ProTee Labs by the bridge{updatedAt ? ` on ${new Date(updatedAt).toLocaleDateString()}` : ''}. Tips compare them with the loft you deliver at impact when club data comes through the relay.</p></div></header>
    <div className="gs-chips">{bag.map(club => <span key={club.name} className="gs-chip"><b>{club.name}</b> {club.loft}°</span>)}</div>
  </section>
}

function Importer({ onImported }: { onImported: (id: string) => void }) {
  const [file, setFile] = useState<string | null>(null)
  const [parsed, setParsed] = useState<CsvImport | null>(null)
  const [label, setLabel] = useState('')
  const [handed, setHanded] = useState<Handed>('RH')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function pick(input: HTMLInputElement) {
    const chosen = input.files?.[0]
    if (!chosen) return
    const content = await chosen.text()
    setText(content)
    setFile(chosen.name)
    setLabel(chosen.name.replace(/\.[^.]+$/, '').slice(0, 80))
    setParsed(importCsv(content, handed))
    setMessage(null)
  }

  async function save() {
    if (!parsed?.shots.length) return
    setBusy(true)
    setMessage(null)
    try {
      let session: string | undefined
      let added = 0
      for (let index = 0; index < parsed.shots.length; index += 500) {
        const result = await gsproApi.importShots(label.trim() || 'Imported session', parsed.shots.slice(index, index + 500), session)
        session = result.sessionId
        added += result.added
      }
      setMessage(`Imported ${added} shot${added === 1 ? '' : 's'}.`)
      setParsed(null)
      setFile(null)
      if (session) onImported(session)
    } catch (failure) {
      setMessage(failure instanceof Error ? failure.message : 'The import failed.')
    } finally {
      setBusy(false)
    }
  }

  return <section className="gs-panel">
    <header className="gs-panel-head"><div><h2><FileUp size={18} aria-hidden/> Import a CSV</h2><p>Session exports from ProTee Labs, GSPro or most launch-monitor apps. Columns are matched by name (Ball Speed, VLA or Launch Angle, Spin, Carry, Club…).</p></div></header>
    <div className="gs-form-row">
      <label className="gs-file"><input type="file" accept=".csv,text/csv,text/plain" onChange={event => pick(event.currentTarget)}/><span>{file ?? 'Choose a CSV file'}</span></label>
      <label className="gs-field"><span>Handed</span><select value={handed} onChange={event => { const next = event.target.value as Handed; setHanded(next); if (text) setParsed(importCsv(text, next)) }}><option value="RH">Right-handed</option><option value="LH">Left-handed</option></select></label>
    </div>
    {parsed && <div className="gs-import-preview">
      <p>{parsed.shots.length ? <><b>{parsed.shots.length}</b> shots found{parsed.skipped ? `, ${parsed.skipped} rows skipped` : ''}{parsed.metric ? ', converted from metric' : ''}. Matched columns: {Object.entries(parsed.columns).map(([field, header]) => `${header} → ${field}`).join(', ')}.</> : 'No shots found. The file needs at least a ball speed and a launch angle column.'}</p>
      {parsed.shots.length > 0 && <div className="gs-form-row">
        <label className="gs-field grow"><span>Session name</span><input value={label} maxLength={80} onChange={event => setLabel(event.target.value)}/></label>
        <button type="button" className="gs-button" disabled={busy} onClick={save}>{busy ? <LoaderCircle size={15} className="spin" aria-hidden/> : <FileUp size={15} aria-hidden/>}Import {parsed.shots.length} shots</button>
      </div>}
    </div>}
    {message && <p className="gs-muted" role="status">{message}</p>}
  </section>
}

function Sessions({ sessions, onChanged, onDeleted }: { sessions: GsproSession[]; onChanged: () => void; onDeleted: (id: string) => void }) {
  const [editing, setEditing] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [confirm, setConfirm] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!sessions.length) return null
  return <section className="gs-panel">
    <header className="gs-panel-head"><div><h2>Sessions</h2><p>Rename or delete sessions. Deleting removes every shot in it for good.</p></div></header>
    <ul className="gs-sessions">
      {sessions.map(session => <li key={session.id}>
        {editing === session.id
          ? <form className="gs-form-row" onSubmit={event => { event.preventDefault(); setBusy(true); gsproApi.renameSession(session.id, name.trim() || session.label).then(onChanged).finally(() => { setBusy(false); setEditing(null) }) }}>
              <label className="gs-field grow"><span className="sr-only">Session name</span><input autoFocus value={name} maxLength={80} onChange={event => setName(event.target.value)}/></label>
              <button type="submit" className="gs-button" disabled={busy}>Save</button>
              <button type="button" className="gs-button ghost" onClick={() => setEditing(null)}>Cancel</button>
            </form>
          : <>
              <div><b>{session.label}</b><small>{session.shotCount} shots · {session.source === 'csv' ? 'imported' : session.source === 'test' ? 'test' : 'streamed'} · {new Date(session.startedAt).toLocaleDateString()}{session.open ? ' · open' : ''}</small></div>
              <div className="gs-row-actions">
                <button type="button" className="gs-icon-button" aria-label={`Rename ${session.label}`} onClick={() => { setEditing(session.id); setName(session.label) }}><Pencil size={15} aria-hidden/></button>
                {confirm === session.id
                  ? <><button type="button" className="gs-button danger" disabled={busy} onClick={() => { setBusy(true); gsproApi.deleteSession(session.id).then(() => onDeleted(session.id)).finally(() => { setBusy(false); setConfirm(null) }) }}>Delete {session.shotCount} shots</button><button type="button" className="gs-button ghost" onClick={() => setConfirm(null)}>Keep</button></>
                  : <button type="button" className="gs-icon-button" aria-label={`Delete ${session.label}`} onClick={() => setConfirm(session.id)}><Trash2 size={15} aria-hidden/></button>}
              </div>
            </>}
      </li>)}
    </ul>
  </section>
}

export function BridgeView({ bridge, online, sessions, onBridge, onSessions, onImported, onDeleted }: {
  bridge: BridgeStatus | null
  online: boolean
  sessions: GsproSession[]
  onBridge: (bridge: BridgeStatus) => void
  onSessions: () => void
  onImported: (sessionId: string) => void
  onDeleted: (sessionId: string) => void
}) {
  const [key, setKey] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmRevoke, setConfirmRevoke] = useState(false)
  const site = typeof window === 'undefined' ? '' : window.location.origin
  const firstRun = `node gspro-bridge.mjs --site ${site} --key ${key ?? '<your bridge key>'} --save`

  async function run(task: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try { await task() } catch (failure) { setError(failure instanceof Error ? failure.message : 'That did not work. Please try again.') } finally { setBusy(false) }
  }

  return <div className="gs-stack">
    <section className="gs-panel">
      <header className="gs-panel-head">
        <div><h2>Bridge</h2><p>A small program on your simulator PC. It uploads every shot you play on a GSPro course (from GSPro’s own round file, nothing to change in GSPro or ProTee Labs), reads your club lofts from ProTee Labs, and can also relay live launch-monitor data for connectors that let you choose a port.</p></div>
      </header>
      <dl className="gs-kpis">
        <div><dt>Status</dt><dd className={online ? 'gs-up' : ''}>{online ? 'Online' : bridge?.hasKey ? 'Offline' : 'Not set up'}</dd></div>
        <div><dt>Last heard</dt><dd>{ago(bridge?.lastSeenAt ?? null)}</dd></div>
        <div><dt>GSPro rounds</dt><dd>{online ? (bridge?.roundFile ? 'Watching' : 'No round yet') : '—'}</dd></div>
        <div><dt>Live relay</dt><dd>{online ? (bridge?.listen === 'off' ? 'Off' : bridge?.monitorConnected ? 'Receiving' : 'Waiting') : '—'}</dd></div>
      </dl>
      {online && bridge?.queued ? <p className="gs-notice">{bridge.queued} shots are waiting on the PC to upload.</p> : null}
      {error && <p className="gs-notice" role="alert">{error}</p>}

      <ol className="gs-steps">
        <li>
          <h3>Create a bridge key</h3>
          <p>The key lets the bridge save shots to your account and nothing else. {bridge?.hasKey ? `Current key ends ${bridge.keyHint}, made ${new Date(bridge.createdAt ?? 0).toLocaleDateString()}. Making a new one stops the old one.` : ''}</p>
          {key && <><p className="gs-warn">Copy it now. It will not be shown again.</p><CopyBlock text={key} label="bridge key"/></>}
          <div className="gs-form-row">
            <button type="button" className="gs-button" disabled={busy} onClick={() => run(async () => { const result = await gsproApi.createKey(); setKey(result.key); onBridge(result.bridge) })}><KeyRound size={15} aria-hidden/>{bridge?.hasKey ? 'Make a new key' : 'Create key'}</button>
            {bridge?.hasKey && (confirmRevoke
              ? <><button type="button" className="gs-button danger" disabled={busy} onClick={() => run(async () => { const result = await gsproApi.revokeKey(); setKey(null); setConfirmRevoke(false); onBridge(result.bridge) })}>Turn off the bridge key</button><button type="button" className="gs-button ghost" onClick={() => setConfirmRevoke(false)}>Keep it</button></>
              : <button type="button" className="gs-button ghost" onClick={() => setConfirmRevoke(true)}>Revoke</button>)}
          </div>
        </li>
        <li>
          <h3>Download the bridge</h3>
          <p>It needs <a href="https://nodejs.org" target="_blank" rel="noreferrer">Node.js</a> 18 or newer and nothing else. Save it anywhere, for example your Documents folder.</p>
          <a className="gs-button ghost" href="/gspro/gspro-bridge.mjs" download="gspro-bridge.mjs"><Download size={15} aria-hidden/>gspro-bridge.mjs</a>
        </li>
        <li>
          <h3>Start it</h3>
          <p>In a terminal in that folder, run this once. <code>--save</code> remembers the site and key, so afterwards <code>node gspro-bridge.mjs</code> is enough.</p>
          <CopyBlock text={firstRun} label="first run command"/>
          <p>To check the connection without GSPro, add <code>--test</code>: a sample drive should appear on the Live tab.</p>
        </li>
        <li>
          <h3>Play</h3>
          <p>Leave the bridge running and play a round in GSPro. Each shot appears on the On course tab a few seconds after the ball stops, and the round already saved in GSPro uploads the first time the bridge starts. GSPro and ProTee Labs need no changes.</p>
          <p className="gs-muted">Range sessions and club data (path, face, attack angle) only reach the page through the live relay. ProTee Labs connects straight to GSPro’s port 921 and has no port setting, so with ProTee the relay stays idle; other connectors can point at 127.0.0.1 port 9211 and the bridge forwards everything to GSPro unchanged. Add <code>--no-relay</code> to turn it off. Shots wait in a <code>.gspro-bridge</code> folder in your user profile if the internet drops.</p>
        </li>
      </ol>
    </section>
    <Bag/>
    <Importer onImported={onImported}/>
    <Sessions sessions={sessions} onChanged={onSessions} onDeleted={onDeleted}/>
  </div>
}
