import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
import { AlertTriangle, CheckSquare, Download, FileArchive, ImagePlus, Pause, Play, RotateCw, Save, Square, Trash2, Upload, Wand2, X, XCircle } from 'lucide-react'
import { CLIPART_PRESETS, DEFAULT_ENGINE, DEFAULT_NEGATIVE, DEFAULT_PRESET_ID, DEFAULT_PROMPT, closestResolution, engineInfo } from '@/lib/clipart'
import type { EngineId, SavedPreset } from '@/lib/clipart'
import { ClipartError, EXPORT_FORMATS, convertBlob, deleteClipartPreset, encodeForEngine, exportName, fetchClipartStatus, fetchResult, imageSize, requestClipart, saveClipartPreset } from '@/lib/clipart-client'
import type { ClipartResult, EngineStatus, ExportType } from '@/lib/clipart-client'
import { downloadBlob } from '@/lib/image-editor-canvas'
import { zipStore } from '@/lib/zip'
import { ClipartControls } from './ClipartControls'
import type { Controls } from './ClipartControls'
import { ClipartPreview } from './ClipartPreview'

type Status = 'idle' | 'queued' | 'waiting' | 'generating' | 'done' | 'failed'
type Item = { id: string; file: File; name: string; src: string; width: number; height: number; selected: boolean; status: Status; message: string; result: ClipartResult | null; startedAt: number; attempts: number }
type Job = { engine: EngineId; preset: string; settings: Controls['settings']; prompt: string; negative: string; reference: string | null; seed: number | null }
type Entry = { id: string; job: Job }

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp']
const MAX_ATTEMPTS = 5
const ESTIMATE_SECONDS: Record<EngineId, number> = { 'flux-klein-9b': 12, 'flux-klein-4b': 6, 'sd15-img2img': 8, gemini: 18 }
const STATUS_LABEL: Record<Status, string> = { idle: 'Ready', queued: 'Queued', waiting: 'Waiting', generating: 'Generating', done: 'Done', failed: 'Failed' }

const initialControls = (): Controls => {
  const preset = CLIPART_PRESETS.find(item => item.id === DEFAULT_PRESET_ID)!
  return { engine: DEFAULT_ENGINE, presetId: preset.id, savedId: null, settings: { ...preset.settings }, prompt: DEFAULT_PROMPT, negative: DEFAULT_NEGATIVE, reference: null, lockSeed: false, seed: Math.floor(Math.random() * 2147483647) }
}

const memory: { items: Item[]; currentId: string | null; controls: Controls | null } = { items: [], currentId: null, controls: null }
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

export default function ClipartGenerator() {
  const [items, setItemsState] = useState<Item[]>(memory.items)
  const [currentId, setCurrentId] = useState<string | null>(memory.currentId)
  const [controls, setControls] = useState<Controls>(memory.controls ?? initialControls())
  const [engines, setEngines] = useState<EngineStatus[]>([])
  const [saved, setSaved] = useState<SavedPreset[]>([])
  const [retention, setRetention] = useState(30)
  const [statusError, setStatusError] = useState('')
  const [banner, setBanner] = useState('')
  const [paused, setPaused] = useState(false)
  const [batch, setBatch] = useState<string[]>([])
  const [dragging, setDragging] = useState(false)
  const [saveOpen, setSaveOpen] = useState(false)
  const [format, setFormat] = useState<ExportType>('image/png')
  const [exporting, setExporting] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const itemsRef = useRef(items)
  const queue = useRef<Entry[]>([])
  const running = useRef(new Map<string, AbortController>())
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const pausedRef = useRef(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const setItems = useCallback((update: (list: Item[]) => Item[]) => {
    setItemsState(list => {
      const next = update(list)
      itemsRef.current = next
      memory.items = next
      return next
    })
  }, [])
  const patch = useCallback((id: string, change: Partial<Item>) => setItems(list => list.map(item => item.id === id ? { ...item, ...change } : item)), [setItems])

  useEffect(() => { memory.controls = controls }, [controls])
  useEffect(() => { memory.currentId = currentId }, [currentId])
  useEffect(() => {
    fetchClipartStatus().then(status => { setEngines(status.engines); setSaved(status.presets); setRetention(status.retentionDays) }).catch(error => setStatusError(error instanceof Error ? error.message : 'Could not reach the generator.'))
  }, [])
  const active = items.some(item => item.status === 'generating')
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer)
  }, [active])
  useEffect(() => () => {
    for (const controller of running.current.values()) controller.abort()
    for (const timer of timers.current.values()) clearTimeout(timer)
    queue.current = []
    memory.items = memory.items.map(item => ['queued', 'waiting', 'generating'].includes(item.status) ? { ...item, status: 'idle', message: 'Stopped when you left the page.' } : item)
  }, [])

  const engineReady = (id: EngineId) => engines.find(entry => entry.id === id)?.ready ?? false
  const current = items.find(item => item.id === currentId) ?? items[0] ?? null
  const currentIndex = current ? items.indexOf(current) : -1

  const pump = useCallback(() => {
    while (!pausedRef.current && queue.current.length) {
      const next = queue.current[0]
      if (running.current.size >= engineInfo(next.job.engine).concurrency) return
      queue.current.shift()
      void run(next)
    }
  }, [])

  async function run(entry: Entry) {
    const item = itemsRef.current.find(candidate => candidate.id === entry.id)
    if (!item) return pump()
    const controller = new AbortController()
    running.current.set(entry.id, controller)
    const attempts = item.attempts + 1
    patch(entry.id, { status: 'generating', message: '', startedAt: Date.now(), attempts })
    try {
      const engine = engineInfo(entry.job.engine)
      const image = await encodeForEngine(item.file, engine.inputEdge)
      const result = await requestClipart({ ...entry.job, image, reference: engine.reference ? entry.job.reference : null, sourceWidth: item.width, sourceHeight: item.height, sourceName: item.name }, controller.signal)
      patch(entry.id, { status: 'done', result, message: '', attempts: 0 })
    } catch (error) {
      if (controller.signal.aborted) {
        patch(entry.id, { status: 'idle', message: 'Canceled' })
      } else if (error instanceof ClipartError && error.limit === 'quota') {
        queue.current.unshift(entry)
        pausedRef.current = true
        setPaused(true)
        setBanner(error.message)
        patch(entry.id, { status: 'queued', message: 'Waiting for the free allowance', attempts: 0 })
      } else if (error instanceof ClipartError && error.limit === 'busy' && attempts < MAX_ATTEMPTS) {
        const delay = Math.max(error.retryAfter, 2 ** attempts) * 1000
        patch(entry.id, { status: 'waiting', message: `Rate limited — retrying in ${Math.round(delay / 1000)}s` })
        timers.current.set(entry.id, setTimeout(() => {
          timers.current.delete(entry.id)
          if (itemsRef.current.find(candidate => candidate.id === entry.id)?.status !== 'waiting') return
          patch(entry.id, { status: 'queued', message: '' })
          queue.current.unshift(entry)
          pump()
        }, delay))
      } else {
        if (error instanceof ClipartError && error.notConfigured) setBanner(error.message)
        patch(entry.id, { status: 'failed', message: error instanceof Error ? error.message : 'Generation failed.', attempts: 0 })
      }
    } finally {
      running.current.delete(entry.id)
      pump()
    }
  }

  function snapshot(): Job {
    const preset = controls.savedId ? CLIPART_PRESETS.find(item => item.id === controls.presetId)?.id ?? DEFAULT_PRESET_ID : controls.presetId
    return { engine: controls.engine, preset, settings: { ...controls.settings }, prompt: controls.prompt, negative: controls.negative, reference: controls.reference?.dataUrl ?? null, seed: controls.lockSeed && !controls.engine.startsWith('flux') ? controls.seed : null }
  }

  function enqueue(ids: string[], front = false) {
    if (!engineReady(controls.engine)) {
      setBanner(engines.find(entry => entry.id === controls.engine)?.reason || 'This engine is not available.')
      return
    }
    const busy = new Set([...queue.current.map(entry => entry.id), ...running.current.keys(), ...timers.current.keys()])
    const fresh = ids.filter(id => !busy.has(id))
    if (!fresh.length) return
    const job = snapshot()
    const entries = fresh.map(id => ({ id, job }))
    queue.current = front ? [...entries, ...queue.current] : [...queue.current, ...entries]
    setItems(list => list.map(item => fresh.includes(item.id) ? { ...item, status: 'queued', message: '', attempts: 0 } : item))
    setBatch(previous => {
      const live = previous.filter(id => itemsRef.current.find(item => item.id === id && ['queued', 'waiting', 'generating'].includes(item.status)))
      return live.length ? [...new Set([...previous, ...fresh])] : fresh
    })
    setBanner('')
    pump()
  }

  function pause() { pausedRef.current = true; setPaused(true) }
  function resume() { pausedRef.current = false; setPaused(false); setBanner(''); pump() }
  function cancel() {
    const ids = new Set([...queue.current.map(entry => entry.id), ...timers.current.keys()])
    queue.current = []
    for (const timer of timers.current.values()) clearTimeout(timer)
    timers.current.clear()
    for (const controller of running.current.values()) controller.abort()
    setItems(list => list.map(item => ids.has(item.id) ? { ...item, status: 'idle', message: 'Canceled' } : item))
    pausedRef.current = false
    setPaused(false)
  }

  async function addFiles(files: FileList | File[]) {
    const list = [...files]
    const accepted = list.filter(file => ACCEPTED.includes(file.type))
    const added: Item[] = []
    for (const file of accepted) {
      try {
        const size = await imageSize(file)
        added.push({ id: crypto.randomUUID(), file, name: file.name, src: URL.createObjectURL(file), width: size.width, height: size.height, selected: true, status: 'idle', message: '', result: null, startedAt: 0, attempts: 0 })
      } catch { /* unreadable image */ }
    }
    if (added.length) {
      setItems(previous => [...previous, ...added])
      setCurrentId(id => id ?? added[0].id)
    }
    const skipped = list.length - added.length
    setBanner(skipped ? `${plural(skipped, 'file')} skipped: only readable JPG, PNG and WebP images can be added.` : '')
  }

  function onFiles(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) void addFiles(event.target.files)
    event.target.value = ''
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    setDragging(false)
    if (event.dataTransfer.files.length) void addFiles(event.dataTransfer.files)
  }

  function remove(id: string) {
    queue.current = queue.current.filter(entry => entry.id !== id)
    running.current.get(id)?.abort()
    const timer = timers.current.get(id)
    if (timer) { clearTimeout(timer); timers.current.delete(id) }
    const item = itemsRef.current.find(candidate => candidate.id === id)
    if (item) URL.revokeObjectURL(item.src)
    setItems(list => list.filter(candidate => candidate.id !== id))
    if (currentId === id) setCurrentId(itemsRef.current.find(candidate => candidate.id !== id)?.id ?? null)
  }

  function clearAll() {
    if (items.some(item => item.result) && !window.confirm('Clear the whole batch? Generated results stay on the server for the retention period, but this list will be emptied.')) return
    cancel()
    for (const item of itemsRef.current) URL.revokeObjectURL(item.src)
    setItems(() => [])
    setCurrentId(null)
    setBatch([])
  }

  function onReference(file: File) {
    if (!ACCEPTED.includes(file.type)) { setBanner('The reference must be a JPG, PNG or WebP image.'); return }
    void encodeForEngine(file, 496).then(dataUrl => {
      if (controls.reference) URL.revokeObjectURL(controls.reference.src)
      setControls(previous => ({ ...previous, reference: { name: file.name, src: URL.createObjectURL(file), dataUrl } }))
    }).catch(() => setBanner('That reference image could not be read.'))
  }

  async function onSavePreset(name: string) {
    const response = await saveClipartPreset({ name, basePreset: controls.presetId, settings: controls.settings, prompt: controls.prompt, negative: controls.negative })
    setSaved(response.presets)
    setControls(previous => ({ ...previous, savedId: response.saved.id }))
  }

  async function onDeletePreset(id: string) {
    const response = await deleteClipartPreset(id)
    setSaved(response.presets)
    if (controls.savedId === id) setControls(previous => ({ ...previous, savedId: null }))
  }

  const ext = EXPORT_FORMATS.find(entry => entry.type === format)!.ext
  async function exportOne(item: Item | null) {
    if (!item?.result) return
    setExporting('Preparing download…')
    try {
      downloadBlob(await convertBlob(await fetchResult(item.result.url), format), exportName(item.name, ext))
      setExporting('')
    } catch (error) {
      setExporting(error instanceof Error ? error.message : 'Export failed.')
    }
  }

  async function exportZip() {
    const done = items.filter(item => item.result)
    if (!done.length) return
    const used = new Map<string, number>()
    const entries = []
    try {
      for (const [index, item] of done.entries()) {
        setExporting(`Packing ${index + 1} of ${done.length}…`)
        const blob = await convertBlob(await fetchResult(item.result!.url), format)
        let name = exportName(item.name, ext)
        const count = used.get(name) ?? 0
        used.set(name, count + 1)
        if (count) name = name.replace(/(\.[a-z]+)$/, `-${count + 1}$1`)
        entries.push({ name, data: new Uint8Array(await blob.arrayBuffer()) })
      }
      downloadBlob(zipStore(entries), `clipart-${new Date().toISOString().slice(0, 10)}.zip`)
      setExporting('')
    } catch (error) {
      setExporting(error instanceof Error ? error.message : 'The ZIP could not be built.')
    }
  }

  const counts = useMemo(() => {
    const inBatch = items.filter(item => batch.includes(item.id))
    return {
      selected: items.filter(item => item.selected).length,
      failed: items.filter(item => item.status === 'failed').length,
      done: items.filter(item => item.status === 'done').length,
      queued: items.filter(item => item.status === 'queued' || item.status === 'waiting').length,
      generating: items.filter(item => item.status === 'generating').length,
      batchTotal: inBatch.length,
      batchFinished: inBatch.filter(item => item.status === 'done' || item.status === 'failed' || item.status === 'idle').length,
    }
  }, [items, batch])
  const working = counts.queued + counts.generating > 0
  const engine = engineInfo(controls.engine)
  const ready = engineReady(controls.engine)
  const allSelected = items.length > 0 && counts.selected === items.length
  const progress = counts.batchTotal ? Math.round(counts.batchFinished / counts.batchTotal * 100) : 0
  const itemProgress = (item: Item) => item.status === 'done' ? 100 : item.status === 'generating' ? Math.min(95, Math.round((now - item.startedAt) / 1000 / ESTIMATE_SECONDS[controls.engine] * 100)) : 0

  return <div className="cg" onDragOver={event => { event.preventDefault(); setDragging(true) }} onDragLeave={event => { if (event.currentTarget === event.target) setDragging(false) }} onDrop={onDrop}>
    <div className="cg-toolbar" role="toolbar" aria-label="Clipart generator">
      <button type="button" className="cg-btn" onClick={() => fileInput.current?.click()}><Upload size={15}/> Upload</button>
      <button type="button" className="cg-btn cg-btn-primary" disabled={!ready || !counts.selected} onClick={() => enqueue(items.filter(item => item.selected).map(item => item.id))}><Wand2 size={15}/> Generate selected{counts.selected ? ` (${counts.selected})` : ''}</button>
      <button type="button" className="cg-btn cg-btn-primary" disabled={!ready || !items.length} onClick={() => enqueue(items.map(item => item.id))}><Wand2 size={15}/> Generate all</button>
      {paused ? <button type="button" className="cg-btn" onClick={resume}><Play size={15}/> Resume</button> : <button type="button" className="cg-btn" disabled={!working} onClick={pause}><Pause size={15}/> Pause</button>}
      <button type="button" className="cg-btn" disabled={!working} onClick={cancel}><XCircle size={15}/> Cancel</button>
      <button type="button" className="cg-btn" disabled={!ready || !counts.failed} onClick={() => enqueue(items.filter(item => item.status === 'failed').map(item => item.id))}><RotateCw size={15}/> Retry failed{counts.failed ? ` (${counts.failed})` : ''}</button>
      <span className="cg-grow"/>
      <button type="button" className="cg-btn" onClick={() => setSaveOpen(true)}><Save size={15}/> Save preset</button>
      <div className="cg-export" role="group" aria-label="Export">
        <select aria-label="Export format" value={format} onChange={event => setFormat(event.target.value as ExportType)}>{EXPORT_FORMATS.map(entry => <option key={entry.type} value={entry.type}>{entry.label}</option>)}</select>
        <button type="button" className="cg-btn" disabled={!current?.result} onClick={() => void exportOne(current)}><Download size={15}/> Export</button>
        <button type="button" className="cg-btn" disabled={!counts.done} onClick={() => void exportZip()}><FileArchive size={15}/> ZIP all ({counts.done})</button>
        <label className="cg-check is-disabled" title="None of the connected engines return a transparent background."><input type="checkbox" disabled/> Transparent</label>
      </div>
      <input ref={fileInput} type="file" hidden multiple accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" onChange={onFiles}/>
    </div>

    {statusError && <p className="cg-banner is-error" role="alert"><AlertTriangle size={15}/> {statusError}</p>}
    {!statusError && engines.length > 0 && !ready && <p className="cg-banner is-error" role="alert"><AlertTriangle size={15}/> {engine.label} isn’t connected: {engines.find(entry => entry.id === controls.engine)?.reason}</p>}
    {banner && <p className="cg-banner" role="status"><AlertTriangle size={15}/> {banner} <button type="button" className="cg-icon" aria-label="Dismiss" onClick={() => setBanner('')}><X size={13}/></button></p>}
    {exporting && <p className="cg-banner" role="status">{exporting}</p>}

    <div className="cg-layout">
      <aside className={`cg-gallery${dragging ? ' is-drop' : ''}`} aria-label="Uploaded photographs">
        <button type="button" className="cg-drop" onClick={() => fileInput.current?.click()}><ImagePlus size={22}/><span>Drop photos here or click to upload</span><small>JPG, JPEG, PNG, WebP · any number</small></button>
        {items.length > 0 && <div className="cg-gallery-bar">
          <button type="button" className="cg-link" onClick={() => setItems(list => list.map(item => ({ ...item, selected: !allSelected })))}>{allSelected ? <CheckSquare size={13}/> : <Square size={13}/>} {allSelected ? 'Select none' : 'Select all'}</button>
          <span>{counts.selected}/{items.length}</span>
          <button type="button" className="cg-link is-danger" onClick={clearAll}><Trash2 size={13}/> Clear</button>
        </div>}
        <ul className="cg-thumbs">
          {items.map(item => <li key={item.id} className={`cg-thumb is-${item.status}${current?.id === item.id ? ' is-current' : ''}`}>
            <input type="checkbox" checked={item.selected} aria-label={`Select ${item.name}`} onChange={() => patch(item.id, { selected: !item.selected })}/>
            <button type="button" className="cg-thumb-open" onClick={() => setCurrentId(item.id)} aria-current={current?.id === item.id}>
              <img src={item.result?.url ?? item.src} alt="" loading="lazy"/>
              <span className="cg-thumb-text"><strong title={item.name}>{item.name}</strong><small title={item.message}>{STATUS_LABEL[item.status]}{item.status === 'generating' ? ` · ${Math.round((now - item.startedAt) / 1000)}s` : ''}{item.message ? ` · ${item.message}` : ''}</small></span>
              {(item.status === 'generating' || item.status === 'done') && <span className="cg-thumb-bar" aria-hidden><i style={{ width: `${itemProgress(item)}%` }}/></span>}
            </button>
            <button type="button" className="cg-icon" aria-label={`Remove ${item.name}`} onClick={() => remove(item.id)}><X size={13}/></button>
          </li>)}
        </ul>
      </aside>

      <main className="cg-center">
        <ClipartPreview
          item={current}
          index={currentIndex}
          total={items.length}
          onStep={delta => { if (items.length) setCurrentId(items[(currentIndex + delta + items.length) % items.length].id) }}
          onRegenerate={() => { if (current) enqueue([current.id], true) }}
          canRegenerate={Boolean(current) && ready && !['queued', 'waiting', 'generating'].includes(current?.status ?? '')}
        />
      </main>

      <aside className="cg-side" aria-label="Generation settings">
        <ClipartControls controls={controls} onChange={next => setControls({ ...next, settings: { ...next.settings, resolution: closestResolution(engineInfo(next.engine), next.settings.resolution) } })} engines={engines} saved={saved} onSavePreset={onSavePreset} onDeletePreset={onDeletePreset} onReference={onReference} saveOpen={saveOpen} setSaveOpen={setSaveOpen}/>
      </aside>
    </div>

    <footer className="cg-footer">
      <div className="cg-progress" role="progressbar" aria-label="Batch progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><i style={{ width: `${progress}%` }}/></div>
      <div className="cg-stats">
        <span><b>{counts.batchFinished}/{counts.batchTotal}</b> batch</span>
        <span className="is-done"><b>{counts.done}</b> completed</span>
        <span className="is-failed"><b>{counts.failed}</b> failed</span>
        <span><b>{counts.generating}</b> generating</span>
        <span><b>{counts.queued}</b> in queue{paused ? ' (paused)' : ''}</span>
        <span className="cg-grow"/>
        <small>{engine.label} · up to {engine.concurrency} at a time · results kept {retention} days</small>
      </div>
      {counts.queued > 0 && <ol className="cg-queue" aria-label="Processing queue">
        {items.filter(item => item.status === 'queued' || item.status === 'waiting').slice(0, 30).map(item => <li key={item.id}>{item.name}{item.status === 'waiting' ? ' (retrying)' : ''}</li>)}
        {counts.queued > 30 && <li>+{counts.queued - 30} more</li>}
      </ol>}
    </footer>
  </div>
}
