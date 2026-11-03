import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, ReactNode } from 'react'
import { useGLTF } from '@react-three/drei'
import { LoaderCircle, RotateCw, Upload } from 'lucide-react'
import { CATALOG_FUNCS, CATALOG_ROOMS } from '../../../modules-src/maplestreet/shared/Catalog'
import type { CatalogFunc, CatalogRoom } from '../../../modules-src/maplestreet/shared/Catalog'
import { CUSTOM_LIMITS, footprintFromSize } from '../../../modules-src/maplestreet/shared/CustomItems'
import { fetchStoreItems, publishStoreItem, updateStoreItem } from '@/lib/maplestreet-items'
import type { AssetStatus, CustomItemRecord, Vector3Like } from '@/lib/maplestreet-items'
import { AssetStatusActions, AssetStatusBadge, DevInstanceNote, statusOf, submitStatus } from './AssetStatusActions'
import { DevModeCanvas } from './DevModeCanvas'
import type { DevModeState } from './DevModeCanvas'
import { EditableModel, clampScale } from './EditableModel'
import { MeshyPanel } from './MeshyPanel'
import type { MeshySourceOption } from './MeshyPanel'

const UNIT_SCALE: Vector3Like = { x: 1, y: 1, z: 1 }
const pretty = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)
const meters = (value: number) => `${value.toFixed(2)} m`
const money = (value: number) => `$${value.toLocaleString('en-US')}`

class ModelErrorBoundary extends Component<{ resetKey: string; onError: (message: string) => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { this.props.onError('That model could not be opened. Check that it is a valid glTF 2.0 file without Draco or Basis compression.') }
  componentDidUpdate(previous: { resetKey: string }) { if (previous.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false }) }
  render() { return this.state.failed ? null : this.props.children }
}

function nameFromFile(file: File) {
  const base = file.name.replace(/\.(glb|gltf)$/i, '').replace(/[_-]+/g, ' ').replace(/[^\p{L}\p{N} .,'&()+#/-]/gu, '').trim()
  return (base.charAt(0).toUpperCase() + base.slice(1)).slice(0, CUSTOM_LIMITS.nameMax)
}

export default function MapleStreetItemEditor() {
  const [file, setFile] = useState<File | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [scale, setScaleState] = useState<Vector3Like>(UNIT_SCALE)
  const [rawSize, setRawSize] = useState<Vector3Like | null>(null)
  const [yaw, setYaw] = useState(0)
  const [name, setName] = useState('')
  const [price, setPrice] = useState('250')
  const [room, setRoom] = useState<CatalogRoom>('living')
  const [func, setFunc] = useState<CatalogFunc>('decor')
  const [indoor, setIndoor] = useState(false)
  const [solid, setSolid] = useState(true)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [items, setItems] = useState<CustomItemRecord[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const setScale = useCallback((next: Vector3Like) => setScaleState(next), [])
  const scaledSize = useMemo(() => rawSize ? { x: rawSize.x * scale.x, y: rawSize.y * scale.y, z: rawSize.z * scale.z } : null, [rawSize, scale])
  const footprint = useMemo(() => scaledSize ? footprintFromSize(scaledSize, yaw) : null, [scaledSize, yaw])
  const oversize = !!scaledSize && (Math.max(scaledSize.x, scaledSize.z) > CUSTOM_LIMITS.footprintMax + 0.05 || scaledSize.y > CUSTOM_LIMITS.heightMax)
  const devMode: DevModeState = useMemo(() => ({ scale, setScale, yaw, rawSize, setRawSize, footprint }), [scale, setScale, yaw, rawSize, footprint])

  const loadItems = useCallback(async () => {
    setListError(null)
    try { setItems(await fetchStoreItems()) } catch (error) { setListError((error as Error).message) }
  }, [])
  useEffect(() => { void loadItems() }, [loadItems])

  useEffect(() => () => {
    if (!url) return
    useGLTF.clear(url)
    URL.revokeObjectURL(url)
  }, [url])

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0] ?? null
    if (chosen) openFile(chosen)
  }

  function openFile(chosen: File) {
    setStatus(null)
    if (!/\.(glb|gltf)$/i.test(chosen.name)) { setStatus({ tone: 'error', text: 'Choose a .glb or .gltf file.' }); return }
    if (chosen.size > CUSTOM_LIMITS.modelBytes) { setStatus({ tone: 'error', text: 'Models must be smaller than 15 MB.' }); return }
    setFile(chosen)
    setRawSize(null)
    setScaleState(UNIT_SCALE)
    setYaw(0)
    setUrl(URL.createObjectURL(chosen))
    if (!name.trim()) setName(nameFromFile(chosen))
  }

  function setAxis(axis: keyof Vector3Like, value: string) {
    const number = Number(value)
    if (!Number.isFinite(number) || number <= 0) return
    setScaleState(current => ({ ...current, [axis]: clampScale(number) }))
  }

  function setUniform(value: string) {
    const number = Number(value)
    if (!Number.isFinite(number) || number <= 0) return
    const next = clampScale(number)
    setScaleState({ x: next, y: next, z: next })
  }

  function fitToHeight(target: number) {
    if (!rawSize?.y) return
    const next = clampScale(target / rawSize.y)
    setScaleState({ x: next, y: next, z: next })
  }

  async function publish(event: FormEvent) {
    event.preventDefault()
    if (!file || !footprint || busy) return
    const target = submitStatus(event)
    const priceValue = Number(price)
    if (!Number.isInteger(priceValue) || priceValue < CUSTOM_LIMITS.priceMin || priceValue > CUSTOM_LIMITS.priceMax) {
      setStatus({ tone: 'error', text: `Price must be a whole number from ${money(CUSTOM_LIMITS.priceMin)} to ${money(CUSTOM_LIMITS.priceMax)}.` })
      return
    }
    setBusy(true)
    setStatus(null)
    try {
      const item = await publishStoreItem({ model: file, name: name.trim(), price: priceValue, scale, room, func, indoor, solid, yaw, ...footprint, status: target })
      setItems(current => [...(current ?? []), item])
      setStatus({ tone: 'ok', text: target === 'draft'
        ? `Saved “${item.name}” as a draft. Try it in the developer instance, then publish it from the list below.`
        : `Published “${item.name}”. It appears in Maple Street's Buy catalog the next time players load the module.` })
    } catch (error) {
      setStatus({ tone: 'error', text: (error as Error).message })
    } finally {
      setBusy(false)
    }
  }

  async function setItemStatus(item: CustomItemRecord, next: AssetStatus) {
    try {
      const updated = await updateStoreItem(item.id, { status: next })
      setItems(current => current?.map(entry => entry.id === updated.id ? updated : entry) ?? null)
    } catch (error) {
      setListError((error as Error).message)
    }
  }

  const meshySources: MeshySourceOption[] = (items ?? []).map(item => ({ label: item.name, source: { itemId: item.id } }))

  const ready = !!file && !!footprint && !oversize && name.trim().length >= CUSTOM_LIMITS.nameMin

  return <section className="account-home ms-items">
    <span className="section-eyebrow">MAPLE STREET · DEV MODE</span>
    <h1>Publish Buy-mode items</h1>
    <p>Load a .glb or .gltf model, drag the scale handles until it's the right size against the 1 m grid, then publish. Each grid square is one Buy-mode cell. Published items go into the shared world's catalog, and placed copies keep the exact scale.</p>

    <form className="ms-items-editor" onSubmit={publish}>
      <div className="ms-items-stage">
        {url
          ? <DevModeCanvas state={devMode}>
              <ModelErrorBoundary resetKey={url} onError={text => { setStatus({ tone: 'error', text }); setFile(null) }}>
                <Suspense fallback={null}><EditableModel url={url}/></Suspense>
              </ModelErrorBoundary>
            </DevModeCanvas>
          : <button type="button" className="ms-items-drop" onClick={() => fileInput.current?.click()}><Upload size={22} aria-hidden/> Choose a model to preview</button>}
        {url && !rawSize && !status && <p className="ms-items-loading" role="status"><LoaderCircle className="spin" size={16}/> Opening model…</p>}
      </div>

      <div className="ms-items-fields">
        <label className="ms-items-file">Model file
          <input ref={fileInput} type="file" accept=".glb,.gltf" onChange={onFile}/>
        </label>
        <label>Item name<input value={name} maxLength={CUSTOM_LIMITS.nameMax} onChange={event => setName(event.target.value)} required/></label>
        <label>Price ($)<input type="number" inputMode="numeric" min={CUSTOM_LIMITS.priceMin} max={CUSTOM_LIMITS.priceMax} step={1} value={price} onChange={event => setPrice(event.target.value)} required/></label>
        <label>Room<select value={room} onChange={event => setRoom(event.target.value as CatalogRoom)}>{CATALOG_ROOMS.map(value => <option key={value} value={value}>{pretty(value)}</option>)}</select></label>
        <label>Function<select value={func} onChange={event => setFunc(event.target.value as CatalogFunc)}>{CATALOG_FUNCS.map(value => <option key={value} value={value}>{pretty(value)}</option>)}</select></label>

        <fieldset className="ms-items-scale">
          <legend>Scale</legend>
          {(['x', 'y', 'z'] as const).map(axis => <label key={axis}>{axis.toUpperCase()}<input type="number" step="any" min={CUSTOM_LIMITS.scaleMin} value={scale[axis]} onChange={event => setAxis(axis, event.target.value)} disabled={!rawSize}/></label>)}
          <label>All<input type="number" step="any" min={CUSTOM_LIMITS.scaleMin} placeholder="—" onChange={event => setUniform(event.target.value)} disabled={!rawSize}/></label>
          <div className="ms-items-scale-actions">
            <button type="button" onClick={() => setScaleState(UNIT_SCALE)} disabled={!rawSize}>Reset</button>
            <button type="button" onClick={() => fitToHeight(1)} disabled={!rawSize}>Fit 1 m tall</button>
            <button type="button" onClick={() => setYaw(value => (value + 1) % 4)} disabled={!rawSize}><RotateCw size={14} aria-hidden/> Turn 90°</button>
          </div>
        </fieldset>

        <fieldset className="ms-items-flags">
          <legend>Placement</legend>
          <label><input type="checkbox" checked={indoor} onChange={event => setIndoor(event.target.checked)}/> Indoors only (needs a floor)</label>
          <label><input type="checkbox" checked={solid} onChange={event => setSolid(event.target.checked)}/> Solid (players can't walk through)</label>
        </fieldset>

        <dl className="ms-items-readout" aria-live="polite">
          <div><dt>Size</dt><dd>{scaledSize ? `${meters(scaledSize.x)} × ${meters(scaledSize.y)} × ${meters(scaledSize.z)}` : '—'}</dd></div>
          <div><dt>Footprint</dt><dd>{footprint ? `${footprint.w} × ${footprint.d} cells, ${meters(footprint.h)} tall` : '—'}</dd></div>
          <div><dt>Facing</dt><dd>{['Front (+Z)', 'Turned 90°', 'Turned 180°', 'Turned 270°'][yaw]}</dd></div>
        </dl>
        {oversize && <p role="alert" className="ms-items-error">Scale the model down to fit within {CUSTOM_LIMITS.footprintMax} × {CUSTOM_LIMITS.footprintMax} m and {CUSTOM_LIMITS.heightMax} m tall.</p>}

        <div className="ms-items-submit">
          <button type="submit" value="draft" className="ms-items-draft" disabled={!ready || busy}>Save as draft</button>
          <button type="submit" value="published" className="ms-items-publish" disabled={!ready || busy}>{busy ? <><LoaderCircle className="spin" size={16}/> Saving…</> : 'Publish Update'}</button>
        </div>
        {status && <p role={status.tone === 'error' ? 'alert' : 'status'} className={status.tone === 'error' ? 'ms-items-error' : 'ms-items-ok'}>{status.text}</p>}
      </div>
    </form>

    <MeshyPanel target="furniture" sources={meshySources} onOpen={opened => openFile(opened)}/>

    <h2>Your items</h2>
    <p>Retiring takes an item out of the Buy catalog. Houses that already own it keep it.</p>
    <DevInstanceNote/>
    {listError && <p role="alert" className="ms-items-error">{listError} <button type="button" onClick={() => void loadItems()}>Retry</button></p>}
    {items === null && !listError && <p role="status"><LoaderCircle className="spin" size={16}/> Loading items…</p>}
    {items?.length === 0 && <p>Nothing published yet.</p>}
    {!!items?.length && <ul className="ms-items-list">
      {items.map(item => <li key={item.id} className={statusOf(item) === 'retired' ? 'is-retired' : statusOf(item) === 'draft' ? 'is-draft' : ''}>
        <div>
          <strong>{item.name}</strong>
          <span>{money(item.price)} · {pretty(item.room)} / {pretty(item.func)} · {item.w} × {item.d} cells · scale {item.scale.x} × {item.scale.y} × {item.scale.z}</span>
        </div>
        <AssetStatusBadge status={statusOf(item)}/>
        <a href={item.modelUrl} download>Model</a>
        <AssetStatusActions status={statusOf(item)} onChange={next => void setItemStatus(item, next)}/>
      </li>)}
    </ul>}
  </section>
}
