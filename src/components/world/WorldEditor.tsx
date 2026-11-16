import { Suspense, lazy, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ComponentType } from 'react'
import { Box as BoxIcon, CloudUpload, ExternalLink, History, Layers, LoaderCircle, Maximize2, Minimize2, Mountain, Redo2, Save, Undo2 } from 'lucide-react'
import type { TelloLand } from '../../../modules-src/tello/region'
import type { Box } from '../../../modules-src/tello/edits/Geom'
import type { WorldEditState } from '../../lib/world-edits-client'
import { fetchDraftState, publishDraft, saveDraft } from '../../lib/world-edits-client'
import { EditorModel } from './model'
import type { ToolRunner } from './tools'
import { MapView, isTyping, type MapViewHandle } from './MapView'
import { ToolOptions, ToolPalette } from './ToolPanel'
import { Inspector } from './Inspector'
import { EditList } from './EditList'
import { Revisions } from './Revisions'
import { TOOL_GROUPS, SHAPED_TOOLS, type ToolId } from './settings'
import type { DrawLayers } from './draw'
import type { BaseMode } from './tiles'

type PreviewProps = { land: TelloLand; center: { x: number; z: number }; size: number; version: number; model?: EditorModel; runner?: ToolRunner | null; onCentre?: (x: number, z: number) => void; onClose?: () => void }
type ViewMode = 'map' | '3d' | 'split'
const WorldPreview3D = lazy<ComponentType<PreviewProps>>(() => import('./WorldPreview3D'))

type SaveState = 'saved' | 'unsaved' | 'saving' | 'error'

const KEYS = new Map<string, ToolId>()
for (const g of TOOL_GROUPS) for (const t of g.tools) if (t.key) KEYS.set(t.key.toLowerCase(), t.id)

/** Life Sim's World Editor: change Montello's land, water, roads, buildings, lots, trees, rails, lights and walls. */
export default function WorldEditor() {
  const modelRef = useRef<EditorModel | null>(null)
  if (!modelRef.current) modelRef.current = new EditorModel()
  const model = modelRef.current
  useEffect(() => { (window as unknown as { __worldEditor?: EditorModel }).__worldEditor = model }, [model])
  useSyncExternalStore(model.subscribe, model.snapshot, model.snapshot)
  const map = useRef<MapViewHandle>(null)
  const [server, setServer] = useState<WorldEditState | null>(null)
  const [save, setSave] = useState<SaveState>('saved')
  const [saveError, setSaveError] = useState('')
  const [toast, setToast] = useState('')
  const [hoverOp, setHoverOp] = useState<string | null>(null)
  const [base, setBase] = useState<BaseMode>('map')
  const [layers, setLayers] = useState<DrawLayers>({ roads: true, buildings: true, lots: true, trees: true, extras: true, labels: true })
  const [showLayers, setShowLayers] = useState(false)
  const [full, setFull] = useState(true)
  const [revisions, setRevisions] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('map')
  const [focus3d, setFocus3d] = useState<{ x: number; z: number }>({ x: 110, z: -40 })
  const [warning, setWarning] = useState('')
  const savedJson = useRef('[]')
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const notify = useCallback((text: string) => {
    setToast(text)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 3800)
  }, [])

  useEffect(() => {
    let live = true
    ;(async () => {
      await model.load()
      if (!live || model.status !== 'ready') return
      try {
        const state = await fetchDraftState()
        if (!live) return
        setServer(state)
        model.setDocument(state.edits)
        savedJson.current = JSON.stringify(model.ops)
        if (state.edits?.base && state.edits.base !== model.base) setWarning('These edits were made on an older bake of the Montello map. Check the edits marked with a warning; anything that no longer matches is skipped.')
      } catch (e) {
        if (live) setSaveError(e instanceof Error ? e.message : 'The saved edits could not be loaded.')
      }
    })()
    return () => { live = false }
  }, [model])

  const doSave = useCallback(async (): Promise<boolean> => {
    const json = JSON.stringify(model.ops)
    if (json === savedJson.current) { setSave('saved'); return true }
    setSave('saving')
    try {
      const state = await saveDraft(model.document())
      savedJson.current = json
      setServer(state)
      setSave(JSON.stringify(model.ops) === json ? 'saved' : 'unsaved')
      setSaveError('')
      return true
    } catch (e) {
      setSave('error')
      setSaveError(e instanceof Error ? e.message : 'Saving failed.')
      return false
    }
  }, [model])

  const opsJson = model.status === 'ready' ? JSON.stringify(model.ops) : '[]'
  useEffect(() => {
    if (model.status !== 'ready' || opsJson === savedJson.current) return
    setSave('unsaved')
    const t = setTimeout(() => { void doSave() }, 2500)
    return () => clearTimeout(t)
  }, [opsJson, doSave, model.status])

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (JSON.stringify(model.ops) !== savedJson.current) e.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [model])

  const pickTool = useCallback((id: ToolId) => {
    map.current?.runner().reset()
    model.setTool(id)
  }, [model])

  async function publish() {
    if (!model.ops.length && !server?.publishedRev) { notify('Nothing to publish yet'); return }
    const problems = model.report.skipped.length
    if (!confirm(`Publish ${model.ops.length} edit${model.ops.length === 1 ? '' : 's'} to Life Sim?${problems ? ` ${problems} of them cannot be applied and will be skipped.` : ''} Everyone gets the edited world the next time they open it.`)) return
    if (!(await doSave())) return
    try {
      const state = await publishDraft()
      setServer(state)
      notify('Published. Life Sim loads the edited world from now on.')
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Publishing failed.')
    }
  }

  async function openInGame() {
    const at = map.current?.centre()
    if (!(await doSave())) return
    const q = at ? `&at=${at.x.toFixed(1)},${at.z.toFixed(1)}` : ''
    window.open(`/modules/foxlake.html?solo=1&edits=draft${q}`, '_blank', 'noopener')
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isTyping(e) || model.status !== 'ready' || revisions) return
      const runner = map.current?.runner()
      const ctrl = e.ctrlKey || e.metaKey
      if (ctrl && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) model.redo(); else model.undo(); return }
      if (ctrl && e.key.toLowerCase() === 'y') { e.preventDefault(); model.redo(); return }
      if (ctrl && e.key.toLowerCase() === 's') { e.preventDefault(); void doSave(); return }
      if (ctrl) return
      if (e.key === 'Enter') { runner?.finish(); e.preventDefault(); return }
      if (e.key === 'Escape') { runner?.cancel(); return }
      if (e.key === 'Backspace' && runner?.backspace()) { e.preventDefault(); return }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const sel = model.selection
        if (!sel) return
        e.preventDefault()
        const ts = Date.now(), id = `e${ts.toString(36)}dl`
        if (sel.kind === 'op') model.remove(sel.id)
        else if (sel.kind === 'road') model.add({ id, ts, type: 'roadRemove', ids: [sel.id] })
        else if (sel.kind === 'building') model.add({ id, ts, type: 'buildingRemove', ids: [sel.id] })
        else if (sel.kind === 'lot') model.add({ id, ts, type: 'lotRemove', ids: [sel.id] })
        model.select(null)
        return
      }
      if (e.key === '[' || e.key === ']') {
        const r = model.settings.radius
        model.patchSettings({ radius: Math.max(1, Math.min(2000, e.key === ']' ? r * 1.25 : r / 1.25)) })
        map.current?.redraw()
        return
      }
      if ((e.key === 'q' || e.key === 'e') && model.selection?.kind === 'building') { runner?.rotateSelected(e.key === 'q' ? 15 : -15); return }
      const tool = KEYS.get(e.key.toLowerCase())
      if (tool) pickTool(tool)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [model, doSave, pickTool, revisions])

  const zoomTo = useCallback((box: Box) => {
    map.current?.zoomTo(box)
    if (viewMode !== 'map') setFocus3d({ x: (box.x0 + box.x1) / 2, z: (box.z0 + box.z1) / 2 })
  }, [viewMode])

  function switchView(mode: ViewMode) {
    if (mode !== 'map' && viewMode === 'map') {
      const c = map.current?.centre()
      if (c) setFocus3d({ x: c.x, z: c.z })
    }
    setViewMode(mode)
  }

  if (model.status !== 'ready') {
    return <div className="we we-loading">
      {model.status === 'error'
        ? <p className="we-warn" role="alert">{model.error}</p>
        : <div className="we-progress" role="status"><LoaderCircle className="spin" size={18} aria-hidden /> {model.progress.text || 'Opening the World Editor…'}<progress max={1} value={model.progress.share} /></div>}
    </div>
  }

  const runner = map.current?.runner() ?? null
  const saveText = save === 'saving' ? 'Saving…' : save === 'unsaved' ? 'Unsaved changes' : save === 'error' ? 'Not saved' : 'Draft saved'
  const live = server?.publishedRev ? (server.publishedRev === server.draftRev && save === 'saved' ? 'Live = draft' : 'Draft differs from live') : 'Nothing published'
  return <div className={`we${full ? ' is-full' : ''}`}>
    <header className="we-bar">
      <div className="we-title"><Mountain size={18} aria-hidden /><div><strong>World Editor</strong><small>Life Sim · Montello</small></div></div>
      <div className="we-actions">
        <button type="button" className="we-btn" onClick={() => model.undo()} disabled={!model.canUndo} title="Undo (Ctrl+Z)"><Undo2 size={15} aria-hidden /><span className="visually-hidden">Undo</span></button>
        <button type="button" className="we-btn" onClick={() => model.redo()} disabled={!model.canRedo} title="Redo (Ctrl+Shift+Z)"><Redo2 size={15} aria-hidden /><span className="visually-hidden">Redo</span></button>
        <span className={`we-save is-${save}`} title={saveError || undefined}>{saveText}</span>
        <button type="button" className="we-btn" onClick={() => void doSave()} disabled={save === 'saving'} title="Save now (Ctrl+S)"><Save size={15} aria-hidden /> Save</button>
        <button type="button" className="we-btn" onClick={() => setRevisions(true)}><History size={15} aria-hidden /> Versions</button>
        <span className="we-sep" />
        <div className="we-seg small" role="radiogroup" aria-label="Map shading">
          <button type="button" role="radio" aria-checked={base === 'map'} className={base === 'map' ? 'is-on' : ''} onClick={() => setBase('map')}>Map</button>
          <button type="button" role="radio" aria-checked={base === 'height'} className={base === 'height' ? 'is-on' : ''} onClick={() => setBase('height')}>Heights</button>
        </div>
        <div className="we-pop">
          <button type="button" className="we-btn" aria-expanded={showLayers} onClick={() => setShowLayers((v) => !v)}><Layers size={15} aria-hidden /> Layers</button>
          {showLayers && <div className="we-pop-menu">
            {(Object.keys(layers) as (keyof DrawLayers)[]).map((k) => <label key={k} className="we-check"><input type="checkbox" checked={layers[k]} onChange={(e) => setLayers({ ...layers, [k]: e.target.checked })} /><span>{k[0].toUpperCase() + k.slice(1)}</span></label>)}
          </div>}
        </div>
        <div className="we-seg small" role="radiogroup" aria-label="View">
          {(['map', '3d', 'split'] as const).map((mode) => <button key={mode} type="button" role="radio" aria-checked={viewMode === mode} className={viewMode === mode ? 'is-on' : ''} onClick={() => switchView(mode)}>
            {mode === 'map' ? 'Map' : mode === '3d' ? <><BoxIcon size={13} aria-hidden /> 3D</> : 'Map + 3D'}
          </button>)}
        </div>
        <button type="button" className="we-btn" onClick={() => void openInGame()} title="Saves the draft, then opens Life Sim on its own (solo) with the draft edits, standing where the map is centred"><ExternalLink size={15} aria-hidden /> Open in Life Sim</button>
        <button type="button" className="we-btn" onClick={() => setFull((v) => !v)} title={full ? 'Show the admin console round the editor' : 'Fill the window'}>{full ? <><Minimize2 size={15} aria-hidden /> Back to admin</> : <><Maximize2 size={15} aria-hidden /> Fill the window</>}</button>
        <span className="we-live">{live}</span>
        <button type="button" className="we-btn is-primary" onClick={() => void publish()}><CloudUpload size={15} aria-hidden /> Publish</button>
      </div>
    </header>
    {(warning || saveError) && <p className="we-warn we-banner" role="alert">{saveError || warning}</p>}
    <div className="we-body">
      <ToolPalette model={model} onPick={pickTool} />
      <div className="we-centre">
        <MapView ref={map} model={model} layers={layers} base={base} hoverOp={hoverOp} hidden={viewMode === '3d'} onNotify={notify} />
        {viewMode !== 'map' && model.land && <div className="we-3dpane">
          <Suspense fallback={<p className="race-loading"><LoaderCircle className="spin" size={16} aria-hidden /> Opening the 3D world…</p>}>
            <WorldPreview3D land={model.land} center={focus3d} size={800} version={model.version} model={model} runner={runner} onCentre={(x, z) => { if (viewMode === 'split') map.current?.panTo(x, z) }} onClose={() => setViewMode('map')} />
          </Suspense>
          {viewMode === 'split' && <button type="button" className="we-btn small we-sync" onClick={() => { const c = map.current?.centre(); if (c) setFocus3d({ x: c.x, z: c.z }) }}>Show the map’s centre in 3D</button>}
        </div>}
        {toast && <div className="we-toast" role="status">{toast}</div>}
        {model.busy && <div className="we-busy" role="status"><LoaderCircle className="spin" size={14} aria-hidden /> Rebuilding…</div>}
      </div>
      <aside className="we-side">
        <ToolOptions model={model} runner={runner} />
        <Inspector model={model} runner={runner} zoomTo={zoomTo} />
        <EditList model={model} onHover={setHoverOp} />
        <p className="we-hint small we-keys">Wheel zooms, right-drag or Space-drag pans. {SHAPED_TOOLS.has(model.tool) ? '[ and ] size the brush. ' : ''}Enter builds, Esc cancels, Delete removes the selection, Ctrl+Z undoes.</p>
      </aside>
    </div>
    {revisions && <Revisions state={server} unsaved={save !== 'saved'} onClose={() => setRevisions(false)} onState={(state, load) => {
      setServer(state)
      if (load) {
        model.setDocument(state.edits)
        savedJson.current = JSON.stringify(model.ops)
        setSave('saved')
        notify('Restored into the draft')
      }
    }} />}
  </div>
}
