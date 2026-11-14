import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
import { ChevronLeft, ChevronRight, Eraser, Eye, FolderOpen, ImagePlus, Images, PaintBucket, Redo2, RotateCcw, Save, SaveAll, Square, Trash2, Type, Undo2, Upload, WandSparkles, X } from 'lucide-react'
import { EDIT_PROMPT_LIMIT, SAVE_FORMATS, cleanBaseName, nameKey, saveFileName, saveFormatFor, scaleRect } from '@/lib/image-editor'
import type { EditMode, Rect, SaveFormat } from '@/lib/image-editor'
import { canPickFolder, canvasBlob, downloadBlob, fileExists, loadImageFile, pickFolder, requestEdit, thumbnail, writeToFolder } from '@/lib/image-editor-canvas'
import type { SaveFolder } from '@/lib/image-editor-canvas'
import { ImageEditorStage } from './ImageEditorStage'

type Version = { canvas: HTMLCanvasElement; thumb: string; label: string }
type Item = { id: string; fileName: string; mime: string; versions: Version[]; at: number; selection: Rect | null; saved: string[]; savedCanvas: HTMLCanvasElement | null; error: string }

const MODES = [
  { id: 'remove', label: 'Remove text', icon: Eraser, field: 'Notes (optional)', placeholder: 'e.g. the sign is painted on a brick wall', busy: 'Removing the text', action: 'Remove text' },
  { id: 'edit', label: 'Smart edit', icon: Type, field: 'What should the text say?', placeholder: 'e.g. change “OPEN” to “CLOSED”', busy: 'Rewriting the text', action: 'Change the text' },
  { id: 'fill', label: 'AI fill', icon: PaintBucket, field: 'Fill the area with', placeholder: 'e.g. clear blue sky', busy: 'Filling the area', action: 'Fill the area' },
] as const satisfies readonly { id: EditMode; [key: string]: unknown }[]

const HISTORY_LIMIT = 20
const STORAGE_KEY = 'tl-image-editor-names'
const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/avif,image/bmp'
const FORMAT_LABELS: Record<SaveFormat, string> = { 'image/png': 'PNG', 'image/jpeg': 'JPEG', 'image/webp': 'WebP' }

const memory: { items: Item[]; currentId: string | null } = { items: [], currentId: null }

function readNames(): { name: string; counters: Record<string, number> } {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') as { name?: unknown; counters?: unknown } | null
    const counters: Record<string, number> = {}
    if (stored?.counters && typeof stored.counters === 'object') {
      for (const [key, value] of Object.entries(stored.counters)) if (Number.isInteger(value) && Number(value) > 0) counters[key] = Number(value)
    }
    return { name: typeof stored?.name === 'string' && stored.name ? stored.name.slice(0, 80) : 'image', counters }
  } catch {
    return { name: 'image', counters: {} }
  }
}

function writeNames(name: string, counters: Record<string, number>) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ name, counters })) } catch { /* storage unavailable */ }
}

function pushVersion(item: Item, version: Version): Item {
  const kept = item.versions.slice(0, item.at + 1)
  const versions = kept.length >= HISTORY_LIMIT ? [kept[0], ...kept.slice(kept.length - HISTORY_LIMIT + 2), version] : [...kept, version]
  return { ...item, versions, at: versions.length - 1, error: '' }
}

const unsaved = (item: Item) => item.at > 0 && item.versions[item.at].canvas !== item.savedCanvas
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

export default function ImageEditor() {
  const [items, setItems] = useState<Item[]>(memory.items)
  const [currentId, setCurrentId] = useState<string | null>(memory.currentId)
  const [mode, setMode] = useState<EditMode>('remove')
  const [prompts, setPrompts] = useState<Record<EditMode, string>>({ remove: '', edit: '', fill: '' })
  const [baseName, setBaseName] = useState('image')
  const [nextNumber, setNextNumber] = useState(1)
  const [format, setFormat] = useState<'original' | SaveFormat>('original')
  const [advance, setAdvance] = useState(true)
  const [folder, setFolder] = useState<SaveFolder | null>(null)
  const [folderSupported, setFolderSupported] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [original, setOriginal] = useState(false)
  const [dropping, setDropping] = useState(false)
  const counters = useRef<Record<string, number>>({})
  const nameRef = useRef(baseName)
  nameRef.current = baseName
  const abort = useRef<AbortController | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const itemsRef = useRef(items)
  itemsRef.current = items

  useEffect(() => {
    const stored = readNames()
    counters.current = stored.counters
    setBaseName(stored.name)
    setNextNumber(stored.counters[nameKey(stored.name)] ?? 1)
    setFolderSupported(canPickFolder())
  }, [])

  useEffect(() => { memory.items = items; memory.currentId = currentId }, [items, currentId])

  useEffect(() => {
    if (!items.some(unsaved)) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [items])

  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      const files = [...(event.clipboardData?.files ?? [])].filter(file => file.type.startsWith('image/'))
      if (!files.length) return
      event.preventDefault()
      void addFiles(files)
    }
    window.addEventListener('paste', paste)
    return () => window.removeEventListener('paste', paste)
  })

  const current = items.find(item => item.id === currentId) ?? items[0] ?? null
  const index = current ? items.indexOf(current) : -1
  const canvas = current ? (original ? current.versions[0].canvas : current.versions[current.at].canvas) : null
  const modeInfo = MODES.find(item => item.id === mode)!
  const prompt = prompts[mode].trim()
  const needsPrompt = mode !== 'remove' && !prompt
  const editedCount = items.filter(item => item.at > 0).length
  const savedCount = items.filter(item => item.saved.length > 0).length
  const formatFor = (item: Item) => format === 'original' ? saveFormatFor(item.mime) : format
  const nextFile = current ? saveFileName(baseName, nextNumber, formatFor(current)) : ''

  function update(id: string, change: (item: Item) => Item) {
    setItems(list => list.map(item => item.id === id ? change(item) : item))
  }

  async function addFiles(files: File[]) {
    const images = files.filter(file => file.type.startsWith('image/'))
    if (!images.length) { setError('Choose PNG, JPEG or WebP images.'); return }
    setBusy(`Opening ${plural(images.length, 'image')}…`)
    setError('')
    const added: Item[] = []
    const problems: string[] = []
    for (const file of images) {
      try {
        const loaded = await loadImageFile(file)
        added.push({ id: crypto.randomUUID(), fileName: file.name || 'Pasted image', mime: file.type, versions: [{ canvas: loaded, thumb: thumbnail(loaded), label: 'Original' }], at: 0, selection: null, saved: [], savedCanvas: null, error: '' })
      } catch (problem) {
        problems.push(problem instanceof Error ? problem.message : `${file.name} couldn’t be opened.`)
      }
    }
    setItems(list => [...list, ...added])
    if (added.length) setCurrentId(id => id && itemsRef.current.some(item => item.id === id) ? id : added[0].id)
    setBusy(null)
    if (problems.length) setError(problems.join(' '))
    if (added.length) setStatus(`Added ${plural(added.length, 'image')}.`)
  }

  function onFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])]
    event.target.value = ''
    if (files.length) void addFiles(files)
  }

  function onDragOver(event: DragEvent<HTMLDivElement>) {
    if (![...event.dataTransfer.types].includes('Files')) return
    event.preventDefault()
    setDropping(true)
  }

  function onDragLeave(event: DragEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false)
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDropping(false)
    const files = [...event.dataTransfer.files]
    if (files.length && !busy) void addFiles(files)
  }

  function choose(id: string) {
    if (busy) return
    const from = current
    setItems(list => list.map(item => {
      if (item.id !== id || item.selection || !from?.selection || from.id === id) return item
      const source = from.versions[from.at].canvas
      const target = item.versions[item.at].canvas
      return { ...item, selection: scaleRect(from.selection, source.width, source.height, target.width, target.height) }
    }))
    setCurrentId(id)
    setOriginal(false)
  }

  function step(offset: number) {
    const next = items[index + offset]
    if (next) choose(next.id)
  }

  function remove(item: Item) {
    if (busy) return
    if (unsaved(item) && !window.confirm(`Remove ${item.fileName}? Its edits haven’t been saved.`)) return
    const at = items.indexOf(item)
    const rest = items.filter(entry => entry.id !== item.id)
    setItems(rest)
    if (current?.id === item.id) setCurrentId(rest[Math.min(at, rest.length - 1)]?.id ?? null)
    setStatus(`Removed ${item.fileName}.`)
  }

  function clearAll() {
    if (busy) return
    if (items.some(unsaved) && !window.confirm('Remove every image? Some edits haven’t been saved.')) return
    setItems([])
    setCurrentId(null)
    setError('')
    setStatus('Cleared the list.')
  }

  async function edit(id: string, selection: Rect, signal: AbortSignal) {
    const item = itemsRef.current.find(entry => entry.id === id)
    if (!item) return
    const result = await requestEdit(item.versions[item.at].canvas, selection, mode, prompt, signal)
    if (signal.aborted) return
    update(id, entry => pushVersion(entry, { canvas: result, thumb: thumbnail(result), label: modeInfo.label }))
  }

  async function apply() {
    if (!current?.selection || busy) return
    if (needsPrompt) { setError(mode === 'edit' ? 'Type what the text should say first.' : 'Describe what should fill the area first.'); return }
    const controller = new AbortController()
    abort.current = controller
    setBusy(`${modeInfo.busy}…`)
    setError('')
    setOriginal(false)
    try {
      await edit(current.id, current.selection, controller.signal)
      if (!controller.signal.aborted) setStatus(`${modeInfo.label} done on ${current.fileName}. Undo if it isn’t right, or run it again.`)
    } catch (problem) {
      if (!controller.signal.aborted) setError(problem instanceof Error ? problem.message : 'The edit didn’t work. Please try again.')
    } finally {
      abort.current = null
      setBusy(null)
    }
  }

  async function applyAll() {
    if (busy || !items.length) return
    if (needsPrompt) { setError(mode === 'edit' ? 'Type what the text should say first.' : 'Describe what should fill the area first.'); return }
    const template = current?.selection ? { rect: current.selection, canvas: current.versions[current.at].canvas } : null
    const targets = itemsRef.current.flatMap(item => {
      const target = item.versions[item.at].canvas
      const selection = item.selection ?? (template ? scaleRect(template.rect, template.canvas.width, template.canvas.height, target.width, target.height) : null)
      return selection && selection.w > 0 && selection.h > 0 ? [{ id: item.id, name: item.fileName, selection }] : []
    })
    if (!targets.length) { setError('Select an area on an image first.'); return }
    setItems(list => list.map(item => item.selection ? item : { ...item, selection: targets.find(target => target.id === item.id)?.selection ?? null }))
    const controller = new AbortController()
    abort.current = controller
    setError('')
    setOriginal(false)
    let done = 0
    const failed: string[] = []
    for (const [position, target] of targets.entries()) {
      if (controller.signal.aborted) break
      setCurrentId(target.id)
      setBusy(`${modeInfo.busy}… ${position + 1} of ${targets.length}`)
      try {
        await edit(target.id, target.selection, controller.signal)
        if (!controller.signal.aborted) done++
      } catch (problem) {
        if (controller.signal.aborted) break
        const message = problem instanceof Error ? problem.message : 'The edit didn’t work.'
        failed.push(target.name)
        update(target.id, item => ({ ...item, error: message }))
      }
    }
    abort.current = null
    setBusy(null)
    const stopped = controller.signal.aborted ? ' Stopped early.' : ''
    setStatus(`${modeInfo.label} done on ${plural(done, 'image')}.${stopped}`)
    if (failed.length) setError(`${plural(failed.length, 'image')} didn’t work: ${failed.join(', ')}. Open each one to try again.`)
  }

  function cancel() {
    abort.current?.abort()
    setStatus('Stopped.')
  }

  function setVersion(at: number) {
    if (!current || busy) return
    update(current.id, item => ({ ...item, at: Math.max(0, Math.min(item.versions.length - 1, at)) }))
    setOriginal(false)
  }

  function changeName(value: string) {
    setBaseName(value)
    setNextNumber(counters.current[nameKey(value)] ?? 1)
    writeNames(value, counters.current)
  }

  function changeNumber(value: string) {
    const number = Math.max(1, Math.min(999999, Math.floor(Number(value)) || 1))
    setNextNumber(number)
    counters.current[nameKey(baseName)] = number
    writeNames(baseName, counters.current)
  }

  async function chooseFolder() {
    const picked = await pickFolder()
    if (picked) { setFolder(picked); setStatus(`Saving into the “${picked.name}” folder. Existing files are never overwritten.`) }
  }

  async function save(targets: Item[]) {
    if (!targets.length || busy) return
    const base = cleanBaseName(baseName) || 'image'
    let number = nextNumber
    const names: string[] = []
    setBusy(targets.length > 1 ? `Saving ${plural(targets.length, 'image')}…` : 'Saving…')
    setError('')
    try {
      for (const item of targets) {
        const type = formatFor(item)
        let fileName = saveFileName(base, number, type)
        if (folder) while (await fileExists(folder, fileName)) fileName = saveFileName(base, ++number, type)
        const version = item.versions[item.at].canvas
        const blob = await canvasBlob(version, type)
        if (folder) await writeToFolder(folder, fileName, blob)
        else downloadBlob(blob, fileName)
        names.push(fileName)
        number++
        update(item.id, entry => ({ ...entry, saved: [...entry.saved, fileName], savedCanvas: version }))
        if (!folder && targets.length > 1) await new Promise(resolve => window.setTimeout(resolve, 300))
      }
    } catch {
      setError(folder ? `Saving into “${folder.name}” failed. Choose the folder again or save as downloads.` : 'The image couldn’t be saved. Please try again.')
    } finally {
      counters.current[nameKey(base)] = number
      writeNames(nameRef.current, counters.current)
      if (nameKey(nameRef.current) === nameKey(base)) setNextNumber(number)
      setBusy(null)
    }
    if (!names.length) return
    const where = folder ? ` to “${folder.name}”` : ''
    setStatus(names.length === 1 ? `Saved ${names[0]}${where}.` : `Saved ${names.length} images${where}: ${names[0]} to ${names[names.length - 1]}.`)
    return names
  }

  async function saveCurrent() {
    if (!current) return
    const names = await save([current])
    if (names?.length && advance && items[index + 1]) choose(items[index + 1].id)
  }

  const hidden = <input ref={fileInput} type="file" accept={ACCEPT} multiple className="adm-sr" tabIndex={-1} aria-hidden onChange={onFiles}/>
  const dropProps = { onDragOver, onDragLeave, onDrop }

  if (!current || !canvas) {
    return <div className={`ie is-empty${dropping ? ' is-dropping' : ''}`} {...dropProps}>
      {hidden}
      <div className="ie-drop">
        <span className="ie-drop-icon" aria-hidden><Images size={28}/></span>
        <h3>Add the images to clean up</h3>
        <p>Drop images here, paste them, or choose files. You can add as many as you like and work through them one by one.</p>
        <button type="button" className="adm-btn adm-btn-primary" disabled={Boolean(busy)} onClick={() => fileInput.current?.click()}><Upload size={16} aria-hidden/> Choose images</button>
        <small>PNG, JPEG or WebP. Images stay in this browser; only the area around a selection is sent to Gemini when you run a tool.</small>
      </div>
      {busy && <p className="ie-status" role="status">{busy}</p>}
      {error && <p className="adm-error" role="alert">{error}</p>}
    </div>
  }

  const selection = current.selection
  return <div className={`ie${dropping ? ' is-dropping' : ''}`} {...dropProps}>
    {hidden}
    <div className="ie-work">
      <div className="ie-toolbar">
        <div className="adm-toolbar-stats">
          <span><b>{items.length}</b> {items.length === 1 ? 'image' : 'images'}</span>
          <span><b>{editedCount}</b> edited</span>
          <span><b>{savedCount}</b> saved</span>
        </div>
        <div className="ie-toolbar-actions">
          <button type="button" className="adm-btn" disabled={Boolean(busy)} onClick={() => fileInput.current?.click()}><ImagePlus size={16} aria-hidden/> Add images</button>
          <button type="button" className="adm-btn adm-btn-ghost" disabled={Boolean(busy)} onClick={clearAll}><Trash2 size={16} aria-hidden/> Clear all</button>
        </div>
      </div>
      <p className="ie-status" role="status" aria-live="polite">{status}</p>
      {error && <p className="adm-error" role="alert">{error}</p>}

      <section className="adm-card ie-canvas-card" aria-label="Current image">
        <header className="ie-canvas-head">
          <div>
            <strong title={current.fileName}>{current.fileName}</strong>
            <small>{canvas.width} × {canvas.height} · {index + 1} of {items.length}{current.at > 0 ? ` · ${plural(current.at, 'edit')}` : ''}</small>
          </div>
          <div className="ie-nav">
            <button type="button" className="adm-icon" aria-label="Previous image" disabled={index <= 0 || Boolean(busy)} onClick={() => step(-1)}><ChevronLeft size={18}/></button>
            <button type="button" className="adm-icon" aria-label="Next image" disabled={index >= items.length - 1 || Boolean(busy)} onClick={() => step(1)}><ChevronRight size={18}/></button>
          </div>
        </header>
        {current.error && <p className="adm-error ie-item-error">{current.error}</p>}
        <ImageEditorStage canvas={canvas} selection={selection} onSelect={rect => update(current.id, item => ({ ...item, selection: rect }))} onApply={() => void apply()} busy={Boolean(busy)} busyText={busy ?? ''} original={original}/>
        <p className="ie-hint">{selection
          ? <>Selected <b>{selection.w} × {selection.h}</b> px. Drag inside it to move, drag a corner to resize, or drag somewhere else to start over. Only this area changes.</>
          : <>Drag over the text you want to change, leaving a little room around it.</>}</p>
      </section>

      <ul className="ie-strip" aria-label="Images">
        {items.map((item, position) => <li key={item.id}>
          <button type="button" className={`ie-strip-item${item.id === current.id ? ' is-active' : ''}`} aria-current={item.id === current.id ? 'true' : undefined} disabled={Boolean(busy) && item.id !== current.id} onClick={() => choose(item.id)}>
            <img src={item.versions[item.at].thumb} alt=""/>
            <span title={item.fileName}><b>{position + 1}</b> {item.fileName}</span>
            <span className="ie-strip-tags">
              {item.error ? <em className="ie-tag ie-tag-error">Failed</em> : null}
              {unsaved(item) ? <em className="ie-tag ie-tag-edit">Edited</em> : null}
              {item.saved.length ? <em className="ie-tag ie-tag-saved" title={item.saved.join(', ')}>{item.saved[item.saved.length - 1]}</em> : null}
            </span>
          </button>
          <button type="button" className="ie-strip-remove" aria-label={`Remove ${item.fileName}`} disabled={Boolean(busy)} onClick={() => remove(item)}><X size={14}/></button>
        </li>)}
      </ul>
    </div>

    <aside className="ie-side" aria-label="Image tools">
      <section className="adm-card">
        <h3><WandSparkles size={16} aria-hidden/> Area tool</h3>
        <div className="ie-modes" role="group" aria-label="Tool">
          {MODES.map(item => <button key={item.id} type="button" aria-pressed={mode === item.id} className={mode === item.id ? 'is-active' : ''} disabled={Boolean(busy)} onClick={() => { setMode(item.id); setError('') }}>
            <item.icon size={17} aria-hidden/><span>{item.label}</span>
          </button>)}
        </div>
        <label className="ie-field">
          <span>{modeInfo.field}</span>
          <textarea value={prompts[mode]} maxLength={EDIT_PROMPT_LIMIT} placeholder={modeInfo.placeholder} disabled={Boolean(busy)} onChange={event => setPrompts(all => ({ ...all, [mode]: event.target.value }))}/>
        </label>
        <div className="ie-actions">
          {busy && abort.current
            ? <button type="button" className="adm-btn" onClick={cancel}><Square size={15} aria-hidden/> Stop</button>
            : <button type="button" className="adm-btn adm-btn-primary" disabled={!selection || Boolean(busy) || needsPrompt} onClick={() => void apply()}><modeInfo.icon size={16} aria-hidden/> {modeInfo.action}</button>}
          {items.length > 1 && <button type="button" className="adm-btn" disabled={Boolean(busy) || needsPrompt || !items.some(item => item.selection) } onClick={() => void applyAll()}><Images size={16} aria-hidden/> Run on all {items.length} images</button>}
        </div>
        <p className="ie-note">{selection ? 'Gemini sees the area around your selection, and only the pixels inside it are replaced.' : 'Select an area on the image to use the tool.'}{items.length > 1 ? ' Your selection carries over to the next image, so text in the same spot is quick to clear; “Run on all” uses it on every image without its own selection.' : ''}</p>
      </section>

      <section className="adm-card">
        <h3><Undo2 size={16} aria-hidden/> History</h3>
        <div className="ie-actions-row">
          <button type="button" className="adm-btn" disabled={current.at === 0 || Boolean(busy)} onClick={() => setVersion(current.at - 1)}><Undo2 size={16} aria-hidden/> Undo</button>
          <button type="button" className="adm-btn" disabled={current.at >= current.versions.length - 1 || Boolean(busy)} onClick={() => setVersion(current.at + 1)}><Redo2 size={16} aria-hidden/> Redo</button>
          <button type="button" className="adm-btn" aria-pressed={original} disabled={current.versions.length < 2 || Boolean(busy)} onClick={() => setOriginal(value => !value)}><Eye size={16} aria-hidden/> {original ? 'Show edit' : 'Original'}</button>
          <button type="button" className="adm-btn" disabled={current.at === 0 || Boolean(busy)} onClick={() => setVersion(0)}><RotateCcw size={16} aria-hidden/> Start over</button>
        </div>
        <p className="ie-note">{current.at > 0 ? `Showing edit ${current.at} of ${current.versions.length - 1}: ${current.versions[current.at].label}.` : 'No edits yet.'}</p>
      </section>

      <section className="adm-card">
        <h3><Save size={16} aria-hidden/> Save</h3>
        <div className="ie-row">
          <label className="ie-field"><span>Name</span><input value={baseName} maxLength={80} spellCheck={false} disabled={Boolean(busy)} onChange={event => changeName(event.target.value)}/></label>
          <label className="ie-field"><span>Next #</span><input type="number" min={1} max={999999} inputMode="numeric" value={nextNumber} disabled={Boolean(busy)} onChange={event => changeNumber(event.target.value)}/></label>
        </div>
        <p className="ie-next">Next file: <b>{nextFile}</b><br/><small>The number goes up with every save and starts again at 1 when you change the name.</small></p>
        <label className="ie-field">
          <span>Format</span>
          <select value={format} disabled={Boolean(busy)} onChange={event => setFormat(event.target.value as 'original' | SaveFormat)}>
            <option value="original">Same as the original</option>
            {SAVE_FORMATS.map(type => <option key={type} value={type}>{FORMAT_LABELS[type]}</option>)}
          </select>
        </label>
        {folderSupported && <div className="ie-folder">
          <span><FolderOpen size={15} aria-hidden/> {folder ? <>Saving into <b>{folder.name}</b></> : 'Saving to your downloads'}</span>
          {folder
            ? <button type="button" className="adm-link" disabled={Boolean(busy)} onClick={() => setFolder(null)}>Use downloads</button>
            : <button type="button" className="adm-link" disabled={Boolean(busy)} onClick={() => void chooseFolder()}>Choose a folder</button>}
        </div>}
        <label className="ie-check"><input type="checkbox" checked={advance} onChange={event => setAdvance(event.target.checked)}/> Go to the next image after saving</label>
        <div className="ie-actions">
          <button type="button" className="adm-btn adm-btn-primary" disabled={Boolean(busy)} onClick={() => void saveCurrent()}><Save size={16} aria-hidden/> Save as {nextFile}</button>
          {items.length > 1 && <button type="button" className="adm-btn" disabled={Boolean(busy)} onClick={() => void save(items)}><SaveAll size={16} aria-hidden/> Save all {items.length}</button>}
        </div>
      </section>
    </aside>
  </div>
}
