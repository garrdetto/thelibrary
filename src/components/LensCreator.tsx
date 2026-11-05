import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import { ArrowLeftRight, Camera, CameraOff, Download, Eye, FileDown, FileUp, Glasses, LoaderCircle, Palette, RotateCcw, ScanFace, Scissors, Shuffle, SlidersHorizontal, Sparkles, Square, Upload, Video } from 'lucide-react'
import { buildWarps, warpPoints } from '@/lib/lens-geometry'
import type { Point } from '@/lib/lens-geometry'
import { drawAccessories, drawFaceMask, drawHair, drawMakeup } from '@/lib/lens-overlays'
import { LensRenderer } from '@/lib/lens-renderer'
import { FaceTracker } from '@/lib/lens-tracking'
import type { HairMask } from '@/lib/lens-tracking'
import { defaultLens, effectOptions, eyewearOptions, filterOptions, hairStyles, headwearOptions, lensPresets, lensSettingsSchema, randomLens } from '@/lib/lens-types'
import type { Effect, LensSettings } from '@/lib/lens-types'

type SourceMode = 'idle' | 'camera' | 'photo'
type ModelState = 'loading' | 'ready' | 'error'
type PanelTab = 'hair' | 'face' | 'makeup' | 'extras' | 'filter'

const panelTabs: { id: PanelTab; label: string; icon: typeof Scissors }[] = [
  { id: 'hair', label: 'Hair', icon: Scissors },
  { id: 'face', label: 'Face', icon: ScanFace },
  { id: 'makeup', label: 'Makeup', icon: Palette },
  { id: 'extras', label: 'Extras', icon: Glasses },
  { id: 'filter', label: 'Filter', icon: SlidersHorizontal },
]

const hairPalette = ['#1b1512', '#3b2219', '#6b3e26', '#a0522d', '#d9a35b', '#f2d58b', '#b7410e', '#e8e8e8', '#ff8fc8', '#7e57c2', '#2e9df7', '#39ff14']
const lipPalette = ['#c2185b', '#e0607e', '#ff7aa2', '#b71c1c', '#8e1b3a', '#d2691e', '#2b0f2e', '#ff4081']
const blushPalette = ['#ff6f91', '#ff8a65', '#f06292', '#e57373', '#ba68c8']
const shadowPalette = ['#7e57c2', '#c9a227', '#8d6e63', '#1a1a1a', '#26a69a', '#ec407a', '#5c6bc0']
const irisPalette = ['#2e9df7', '#43a047', '#8d6e63', '#b06cff', '#e53935', '#f5c518', '#000000', '#e0f7fa']
const maxPhotoSide = 1280
const maxRecordingSeconds = 15

function Slider({ label, value, min = 0, max = 1, onChange, left, right }: { label: string; value: number; min?: number; max?: number; onChange: (value: number) => void; left?: string; right?: string }) {
  const display = min < 0 ? `${value > 0 ? '+' : ''}${Math.round(value * 100)}` : `${Math.round(value * 100)}%`
  return <label className="lens-slider">
    <span className="lens-slider-head"><span>{label}</span><output>{display}</output></span>
    <input type="range" min={min} max={max} step={0.01} value={value} onChange={event => onChange(Number(event.target.value))} onDoubleClick={() => onChange(0)}/>
    {(left || right) && <span className="lens-slider-ends"><span>{left}</span><span>{right}</span></span>}
  </label>
}

function Swatches({ label, value, palette, onChange }: { label: string; value: string; palette: string[]; onChange: (value: string) => void }) {
  return <div className="lens-field">
    <span className="lens-field-label">{label}</span>
    <div className="lens-swatches" role="radiogroup" aria-label={label}>
      {palette.map(color => <button key={color} type="button" role="radio" aria-checked={value.toLowerCase() === color} aria-label={color} className="lens-swatch" style={{ background: color }} onClick={() => onChange(color)}/>)}
      <label className="lens-swatch lens-swatch-custom" title="Custom colour"><input type="color" value={value} onChange={event => onChange(event.target.value)} aria-label={`Custom ${label.toLowerCase()}`}/><span style={{ background: value }}/></label>
    </div>
  </div>
}

function Options<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly { id: T; label: string }[]; onChange: (value: T) => void }) {
  return <div className="lens-field">
    <span className="lens-field-label">{label}</span>
    <div className="lens-options" role="radiogroup" aria-label={label}>
      {options.map(option => <button key={option.id} type="button" role="radio" aria-checked={value === option.id} className={value === option.id ? 'is-active' : ''} onClick={() => onChange(option.id)}>{option.label}</button>)}
    </div>
  </div>
}

function Toggle({ label, checked, onChange, children }: { label: string; checked: boolean; onChange: (checked: boolean) => void; children?: ReactNode }) {
  return <label className="lens-toggle"><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)}/><span className="lens-toggle-track" aria-hidden="true"/><span>{label}{children}</span></label>
}

function slug(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'lens'
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function LensCreator() {
  const [settings, setSettings] = useState<LensSettings>(defaultLens)
  const [tab, setTab] = useState<PanelTab>('hair')
  const [mode, setMode] = useState<SourceMode>('idle')
  const [modelState, setModelState] = useState<ModelState>('loading')
  const [hairState, setHairState] = useState<'off' | 'loading' | 'ready' | 'error'>('off')
  const [faceFound, setFaceFound] = useState(false)
  const [mirror, setMirror] = useState(true)
  const [comparing, setComparing] = useState(false)
  const [recording, setRecording] = useState(0)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const lensInputRef = useRef<HTMLInputElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const photoRef = useRef<HTMLCanvasElement | null>(null)
  const photoPointsRef = useRef<{ version: number; points: Point[] | null; hair: HairMask | null }>({ version: -1, points: null, hair: null })
  const photoVersionRef = useRef(0)
  const trackerRef = useRef<FaceTracker | null>(null)
  const rendererRef = useRef<LensRenderer | null>(null)
  const faceMaskRef = useRef<HTMLCanvasElement | null>(null)
  const hairLayerRef = useRef<HTMLCanvasElement | null>(null)
  const hairMaskRef = useRef<HairMask | null>(null)
  const settingsRef = useRef(settings)
  const viewRef = useRef({ mode, mirror, comparing })
  const recorderRef = useRef<MediaRecorder | null>(null)
  const faceFoundRef = useRef(false)

  settingsRef.current = settings
  viewRef.current = { mode, mirror, comparing }

  useEffect(() => {
    const tracker = new FaceTracker()
    trackerRef.current = tracker
    faceMaskRef.current = document.createElement('canvas')
    hairLayerRef.current = document.createElement('canvas')
    try { rendererRef.current = new LensRenderer() } catch (cause) { setError(cause instanceof Error ? cause.message : 'WebGL is not available in this browser.') }
    let cancelled = false
    tracker.load().then(() => { if (!cancelled) setModelState('ready') }).catch(() => { if (!cancelled) setModelState('error') })
    return () => {
      cancelled = true
      tracker.close()
      rendererRef.current?.dispose()
      streamRef.current?.getTracks().forEach(track => track.stop())
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    }
  }, [])

  useEffect(() => {
    if (!settings.hair.dyeReal || hairState === 'ready' || hairState === 'loading') return
    const tracker = trackerRef.current
    if (!tracker) return
    setHairState('loading')
    tracker.loadHair().then(() => { setHairState('ready'); photoPointsRef.current.version = -1 }).catch(() => setHairState('error'))
  }, [settings.hair.dyeReal, hairState])

  useEffect(() => {
    let frameId = 0
    let frameCount = 0
    const start = performance.now()
    const tick = () => {
      frameId = requestAnimationFrame(tick)
      const canvas = canvasRef.current
      const video = videoRef.current
      const tracker = trackerRef.current
      const renderer = rendererRef.current
      const { mode: currentMode, mirror: mirrored, comparing: showOriginal } = viewRef.current
      if (!canvas || !tracker || currentMode === 'idle') return
      const source = currentMode === 'camera' ? video : photoRef.current
      if (!source) return
      const width = source instanceof HTMLVideoElement ? source.videoWidth : source.width
      const height = source instanceof HTMLVideoElement ? source.videoHeight : source.height
      if (!width || !height || source instanceof HTMLVideoElement && source.readyState < 2) return
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height }
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const lens = settingsRef.current
      const time = (performance.now() - start) / 1000
      frameCount++

      let points: Point[] | null = null
      try {
        if (currentMode === 'camera') {
          points = tracker.detect(source, width, height)
          if (lens.hair.dyeReal && tracker.hairReady && frameCount % 2 === 0) hairMaskRef.current = tracker.segmentHair(source) ?? hairMaskRef.current
        } else {
          const cache = photoPointsRef.current
          if (cache.version !== photoVersionRef.current && tracker.ready) {
            tracker.resetSmoothing()
            cache.points = tracker.detect(source, width, height, 0)
            cache.hair = tracker.hairReady ? tracker.segmentHair(source) : null
            cache.version = photoVersionRef.current
          }
          points = cache.points
          hairMaskRef.current = cache.hair
        }
      } catch {
        points = null
      }
      if (Boolean(points) !== faceFoundRef.current) { faceFoundRef.current = Boolean(points); setFaceFound(Boolean(points)) }

      ctx.save()
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      if (mirrored) { ctx.translate(width, 0); ctx.scale(-1, 1) }
      if (showOriginal || !renderer) {
        ctx.drawImage(source, 0, 0, width, height)
      } else {
        const warps = points ? buildWarps(points, lens.face) : []
        drawFaceMask(faceMaskRef.current!, points, width, height, lens.face.smooth > 0)
        const output = renderer.render({ source, width, height, warps, faceMask: faceMaskRef.current!, hairMask: lens.hair.dyeReal ? hairMaskRef.current : null, settings: lens, time })
        ctx.drawImage(output, 0, 0, width, height)
        if (points) {
          const shown = warpPoints(points, warps)
          drawMakeup(ctx, shown, lens.makeup)
          drawHair(ctx, hairLayerRef.current!, shown, lens.hair)
          drawAccessories(ctx, shown, lens.extras, time)
        }
      }
      ctx.restore()
    }
    frameId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameId)
  }, [])

  function stopCamera() {
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }

  async function startCamera() {
    setError('')
    if (!navigator.mediaDevices?.getUserMedia) { setError('This browser cannot open a camera. Try uploading a photo instead.'); return }
    try {
      stopCamera()
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      streamRef.current = stream
      const video = videoRef.current
      if (!video) return
      video.srcObject = stream
      await video.play()
      trackerRef.current?.resetSmoothing()
      setMirror(true)
      setMode('camera')
    } catch (cause) {
      const denied = cause instanceof DOMException && (cause.name === 'NotAllowedError' || cause.name === 'SecurityError')
      setError(denied ? 'Camera access was blocked. Allow the camera in your browser settings, or upload a photo.' : 'No camera could be started. Try uploading a photo instead.')
    }
  }

  function loadPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) { setError('Please choose an image file.'); return }
    setError('')
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      const scale = Math.min(1, maxPhotoSide / Math.max(image.naturalWidth, image.naturalHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(image.naturalWidth * scale)
      canvas.height = Math.round(image.naturalHeight * scale)
      canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      photoRef.current = canvas
      photoVersionRef.current++
      stopCamera()
      setMirror(false)
      setMode('photo')
    }
    image.onerror = () => { URL.revokeObjectURL(url); setError('That image could not be opened.') }
    image.src = url
  }

  function closeSource() {
    stopCamera()
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    photoRef.current = null
    setMode('idle')
    setFaceFound(false)
    faceFoundRef.current = false
  }

  function snapshot() {
    canvasRef.current?.toBlob(blob => {
      if (!blob) return
      saveBlob(blob, `${slug(settings.name)}-${Date.now()}.png`)
      flash('Snapshot saved')
    }, 'image/png')
  }

  function toggleRecording() {
    const canvas = canvasRef.current
    if (!canvas) return
    if (recorderRef.current?.state === 'recording') { recorderRef.current.stop(); return }
    if (typeof MediaRecorder === 'undefined' || typeof canvas.captureStream !== 'function') { setError('Recording is not supported in this browser.'); return }
    const type = ['video/webm;codecs=vp9', 'video/webm', 'video/mp4'].find(candidate => MediaRecorder.isTypeSupported(candidate)) ?? ''
    const recorder = new MediaRecorder(canvas.captureStream(30), type ? { mimeType: type } : undefined)
    const chunks: Blob[] = []
    const startedAt = Date.now()
    const timer = setInterval(() => {
      const seconds = Math.ceil((Date.now() - startedAt) / 1000)
      setRecording(seconds)
      if (seconds >= maxRecordingSeconds && recorder.state === 'recording') recorder.stop()
    }, 250)
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data) }
    recorder.onstop = () => {
      clearInterval(timer)
      setRecording(0)
      const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' })
      if (blob.size) { saveBlob(blob, `${slug(settings.name)}-${Date.now()}.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`); flash('Clip saved') }
    }
    recorderRef.current = recorder
    recorder.start(250)
    setRecording(1)
  }

  function flash(message: string) {
    setNotice(message)
    setTimeout(() => setNotice(current => current === message ? '' : current), 2200)
  }

  function exportLens() {
    saveBlob(new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' }), `${slug(settings.name)}.lens.json`)
    flash('Lens file saved')
  }

  async function importLens(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const parsed = lensSettingsSchema.safeParse(JSON.parse(await file.text()))
      if (!parsed.success) { setError('That file is not a valid lens.'); return }
      setError('')
      setSettings(parsed.data)
      flash(`Loaded “${parsed.data.name}”`)
    } catch {
      setError('That file could not be read as a lens.')
    }
  }

  function update<K extends Exclude<keyof LensSettings, 'name'>>(section: K, patch: Partial<LensSettings[K]>) {
    setSettings(current => ({ ...current, [section]: { ...current[section], ...patch } }))
  }

  function toggleEffect(effect: Effect) {
    const effects = settings.extras.effects.includes(effect) ? settings.extras.effects.filter(item => item !== effect) : [...settings.extras.effects, effect]
    update('extras', { effects })
  }

  const live = mode !== 'idle'
  const statusLabel = modelState === 'loading' ? 'Loading face tracking…' : modelState === 'error' ? 'Face tracking unavailable' : !live ? '' : faceFound ? 'Face locked' : 'Looking for a face…'

  return <section className="lens-app feature-page" aria-labelledby="lens-title">
    <div className="feature-heading lens-heading">
      <span className="section-eyebrow"><Sparkles size={11}/> LENS CREATOR</span>
      <h1 id="lens-title">Design a <em>face lens</em></h1>
      <p>Restyle your hair, reshape features, add makeup, props and filters — live on your camera or on a photo. Everything runs in your browser; nothing is uploaded.</p>
    </div>

    <div className="lens-layout">
      <div className="lens-stage-column">
        <div className={`lens-stage ${live ? 'is-live' : ''}`}>
          <canvas ref={canvasRef} className="lens-canvas" aria-label="Lens preview" hidden={!live}/>
          <video ref={videoRef} className="lens-video" playsInline muted aria-hidden="true"/>
          {!live && <div className="lens-empty">
            <span className="lens-empty-icon" aria-hidden="true"><ScanFace size={34} strokeWidth={1.4}/></span>
            <h2>Start with your face</h2>
            <p>Use your camera for a live lens, or upload a selfie to edit.</p>
            <div className="lens-empty-actions">
              <button type="button" className="lens-primary" onClick={startCamera}><Camera size={16}/> Open camera</button>
              <button type="button" className="lens-secondary" onClick={() => photoInputRef.current?.click()}><Upload size={16}/> Upload photo</button>
            </div>
          </div>}
          {statusLabel && <span className={`lens-status ${faceFound && live ? 'is-locked' : ''} ${modelState === 'error' ? 'is-error' : ''}`} role="status">{modelState === 'loading' && <LoaderCircle className="spin" size={13}/>}{statusLabel}</span>}
          {recording > 0 && <span className="lens-recording" role="status"><span aria-hidden="true"/> REC {recording}s / {maxRecordingSeconds}s</span>}
          {notice && <span className="lens-notice" role="status">{notice}</span>}
        </div>
        {error && <p className="lens-error" role="alert">{error}</p>}
        {hairState === 'error' && settings.hair.dyeReal && <p className="lens-error" role="alert">The hair colour model could not load. Drawn hairstyles still work.</p>}

        <div className="lens-toolbar">
          {mode === 'camera' ? <button type="button" onClick={closeSource}><CameraOff size={16}/> Stop camera</button> : <button type="button" onClick={startCamera}><Camera size={16}/> Camera</button>}
          <button type="button" onClick={() => photoInputRef.current?.click()}><Upload size={16}/> Photo</button>
          <button type="button" onClick={() => setMirror(value => !value)} disabled={!live} aria-pressed={mirror}><ArrowLeftRight size={16}/> Mirror</button>
          <button type="button" disabled={!live} aria-pressed={comparing} onPointerDown={() => setComparing(true)} onPointerUp={() => setComparing(false)} onPointerLeave={() => setComparing(false)} onKeyDown={event => { if (event.key === ' ' || event.key === 'Enter') setComparing(true) }} onKeyUp={() => setComparing(false)}><Eye size={16}/> Hold to compare</button>
          <span className="lens-toolbar-spacer"/>
          <button type="button" onClick={toggleRecording} disabled={!live} className={recording ? 'is-recording' : ''}>{recording ? <Square size={14}/> : <Video size={16}/>} {recording ? 'Stop' : 'Record'}</button>
          <button type="button" className="lens-primary" onClick={snapshot} disabled={!live}><Download size={16}/> Snapshot</button>
        </div>
        <input ref={photoInputRef} type="file" accept="image/*" hidden onChange={loadPhoto}/>

        <div className="lens-presets">
          <span className="lens-field-label">Starter lenses</span>
          <div className="lens-preset-row">
            {lensPresets.map(preset => <button key={preset.name} type="button" className={settings.name === preset.name ? 'is-active' : ''} onClick={() => setSettings(preset)}>{preset.name}</button>)}
          </div>
        </div>
      </div>

      <aside className="lens-panel" aria-label="Lens controls">
        <label className="lens-name"><span className="lens-field-label">Lens name</span><input value={settings.name} maxLength={40} onChange={event => setSettings(current => ({ ...current, name: event.target.value }))} onBlur={() => setSettings(current => ({ ...current, name: current.name.trim() || 'My lens' }))}/></label>

        <div className="lens-tabs" role="tablist" aria-label="Lens sections">
          {panelTabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" role="tab" id={`lens-tab-${id}`} aria-controls={`lens-panel-${id}`} aria-selected={tab === id} className={tab === id ? 'is-active' : ''} onClick={() => setTab(id)}><Icon size={15}/><span>{label}</span></button>)}
        </div>

        <div className="lens-tab-body" role="tabpanel" id={`lens-panel-${tab}`} aria-labelledby={`lens-tab-${tab}`}>
          {tab === 'hair' && <>
            <Options label="Hairstyle" value={settings.hair.style} options={hairStyles} onChange={style => update('hair', { style })}/>
            <Swatches label="Hair colour" value={settings.hair.color} palette={hairPalette} onChange={color => update('hair', { color })}/>
            <Toggle label="Ombré tips" checked={settings.hair.ombre} onChange={ombre => update('hair', { ombre })}/>
            {settings.hair.ombre && <Swatches label="Tip colour" value={settings.hair.tipColor} palette={hairPalette} onChange={tipColor => update('hair', { tipColor })}/>}
            <div className="lens-divider"/>
            <Toggle label="Dye my real hair" checked={settings.hair.dyeReal} onChange={dyeReal => update('hair', { dyeReal })}>
              <small>{hairState === 'loading' ? ' · loading hair model…' : ' · uses an AI hair mask with the colour above'}</small>
            </Toggle>
            {settings.hair.dyeReal && <Slider label="Dye strength" value={settings.hair.dyeStrength} onChange={dyeStrength => update('hair', { dyeStrength })}/>}
          </>}

          {tab === 'face' && <>
            <Slider label="Eye size" min={-1} max={1} value={settings.face.eyes} left="Smaller" right="Bigger" onChange={eyes => update('face', { eyes })}/>
            <Slider label="Nose" min={-1} max={1} value={settings.face.nose} left="Narrow" right="Wide" onChange={nose => update('face', { nose })}/>
            <Slider label="Mouth size" min={-1} max={1} value={settings.face.mouth} left="Smaller" right="Bigger" onChange={mouth => update('face', { mouth })}/>
            <Slider label="Smile lift" min={-1} max={1} value={settings.face.smile} left="Frown" right="Smile" onChange={smile => update('face', { smile })}/>
            <Slider label="Face shape" min={-1} max={1} value={settings.face.slim} left="Wider" right="Slimmer" onChange={slim => update('face', { slim })}/>
            <Slider label="Chin" min={-1} max={1} value={settings.face.chin} left="Shorter" right="Longer" onChange={chin => update('face', { chin })}/>
            <Slider label="Head size" min={-1} max={1} value={settings.face.head} left="Tiny" right="Huge" onChange={head => update('face', { head })}/>
            <Slider label="Skin smoothing" value={settings.face.smooth} onChange={smooth => update('face', { smooth })}/>
            <p className="lens-hint">Double-click a slider to reset it.</p>
          </>}

          {tab === 'makeup' && <>
            <Swatches label="Lipstick" value={settings.makeup.lipColor} palette={lipPalette} onChange={lipColor => update('makeup', { lipColor, lip: settings.makeup.lip || 0.6 })}/>
            <Slider label="Lipstick amount" value={settings.makeup.lip} onChange={lip => update('makeup', { lip })}/>
            <Swatches label="Blush" value={settings.makeup.blushColor} palette={blushPalette} onChange={blushColor => update('makeup', { blushColor, blush: settings.makeup.blush || 0.5 })}/>
            <Slider label="Blush amount" value={settings.makeup.blush} onChange={blush => update('makeup', { blush })}/>
            <Swatches label="Eyeshadow" value={settings.makeup.shadowColor} palette={shadowPalette} onChange={shadowColor => update('makeup', { shadowColor, shadow: settings.makeup.shadow || 0.5 })}/>
            <Slider label="Eyeshadow amount" value={settings.makeup.shadow} onChange={shadow => update('makeup', { shadow })}/>
            <Slider label="Eyeliner + wing" value={settings.makeup.liner} onChange={liner => update('makeup', { liner })}/>
            <Slider label="Brow definition" value={settings.makeup.brows} onChange={brows => update('makeup', { brows })}/>
            <Swatches label="Eye colour" value={settings.makeup.irisColor} palette={irisPalette} onChange={irisColor => update('makeup', { irisColor, iris: settings.makeup.iris || 0.6 })}/>
            <Slider label="Eye colour amount" value={settings.makeup.iris} onChange={iris => update('makeup', { iris })}/>
          </>}

          {tab === 'extras' && <>
            <Options label="Eyewear" value={settings.extras.eyewear} options={eyewearOptions} onChange={eyewear => update('extras', { eyewear })}/>
            <Options label="Headwear" value={settings.extras.headwear} options={headwearOptions} onChange={headwear => update('extras', { headwear })}/>
            <div className="lens-field">
              <span className="lens-field-label">Face effects</span>
              <div className="lens-options">
                {effectOptions.map(option => <button key={option.id} type="button" aria-pressed={settings.extras.effects.includes(option.id)} className={settings.extras.effects.includes(option.id) ? 'is-active' : ''} onClick={() => toggleEffect(option.id)}>{option.label}</button>)}
              </div>
            </div>
            <p className="lens-hint">Puppy tongue appears when you open your mouth.</p>
          </>}

          {tab === 'filter' && <>
            <Options label="Colour filter" value={settings.filter.preset} options={filterOptions} onChange={preset => update('filter', { preset })}/>
            <Slider label="Filter strength" value={settings.filter.strength} onChange={strength => update('filter', { strength })}/>
            <Slider label="Vignette" value={settings.filter.vignette} onChange={vignette => update('filter', { vignette })}/>
            <Slider label="Film grain" value={settings.filter.grain} onChange={grain => update('filter', { grain })}/>
          </>}
        </div>

        <div className="lens-panel-footer">
          <button type="button" onClick={() => setSettings(randomLens())}><Shuffle size={15}/> Surprise me</button>
          <button type="button" onClick={() => setSettings(defaultLens)}><RotateCcw size={15}/> Reset</button>
          <button type="button" onClick={exportLens}><FileDown size={15}/> Save lens</button>
          <button type="button" onClick={() => lensInputRef.current?.click()}><FileUp size={15}/> Open lens</button>
          <input ref={lensInputRef} type="file" accept="application/json,.json" hidden onChange={importLens}/>
        </div>
      </aside>
    </div>
  </section>
}
