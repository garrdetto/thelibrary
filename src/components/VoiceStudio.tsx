import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowDown, AudioLines, Check, LoaderCircle, Pencil, Play, Shuffle, Trash2, WandSparkles, X } from 'lucide-react'

type SavedVoice = { voiceId: string; name: string; description: string; createdAt?: string }
type AccountVoice = { voiceId: string; name: string; description: string; category: string; previewUrl: string | null }
type Preview = { generatedVoiceId: string; audio: string; mediaType: string; duration: number }
type PreviewSet = { previews: Preview[]; text: string; description: string; remixOf: SavedVoice | null }
type VoiceList = { configured: boolean; voices: SavedVoice[]; account: AccountVoice[] | null; canManageAccount: boolean }

const designModels = [{ id: 'eleven_multilingual_ttv_v2', label: 'Multilingual v2 · steady, many languages' }, { id: 'eleven_ttv_v3', label: 'Eleven v3 · most expressive' }]
const speechModels = [{ id: 'eleven_multilingual_v2', label: 'Multilingual v2 · natural, reliable' }, { id: 'eleven_v4', label: 'Eleven v4 · expressive, reads [audio tags]' }, { id: 'eleven_flash_v2_5', label: 'Flash v2.5 · fastest, cheapest' }]
const examples = ['A warm, gravelly older man with a slow Southern drawl, like a storyteller on a porch at dusk.', 'A bright, upbeat young woman with a crisp British accent, fast and friendly, like a podcast host.', 'A deep, calm narrator with a smooth American accent and a hint of a smile, perfect for documentaries.']

async function voiceApi<T>(body?: unknown): Promise<T> {
  const response = await fetch('/api/voice', body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
  const result = await response.json().catch(() => ({ error: response.status === 429 ? 'Please slow down and try again in a moment.' : 'The Voice Generator could not be reached. Please try again shortly.' }))
  if (!response.ok) throw new Error(result.error || 'Something went wrong. Please try again.')
  return result as T
}

function audioUrl(preview: Preview) {
  const binary = atob(preview.audio)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return URL.createObjectURL(new Blob([bytes], { type: preview.mediaType }))
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function Counter({ value, min, max }: { value: string; min?: number; max: number }) {
  const length = value.trim().length
  const short = min !== undefined && length > 0 && length < min
  return <span className={`voice-counter ${short ? 'is-short' : ''}`} aria-live="polite">{length}/{max}{short ? ` · at least ${min}` : ''}</span>
}

export function VoiceStudio() {
  const [list, setList] = useState<VoiceList | null>(null)
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState('')
  const [description, setDescription] = useState('')
  const [previewText, setPreviewText] = useState('')
  const [designModel, setDesignModel] = useState(designModels[0].id)
  const [loudness, setLoudness] = useState(0.5)
  const [guidance, setGuidance] = useState(5)
  const [enhance, setEnhance] = useState(false)
  const [previewSet, setPreviewSet] = useState<PreviewSet | null>(null)
  const [saveName, setSaveName] = useState('')
  const [remixing, setRemixing] = useState<SavedVoice | null>(null)
  const [remixNote, setRemixNote] = useState('')
  const [editing, setEditing] = useState<SavedVoice | null>(null)
  const [speakVoice, setSpeakVoice] = useState('')
  const [speakText, setSpeakText] = useState('')
  const [speechModel, setSpeechModel] = useState(speechModels[0].id)
  const [stability, setStability] = useState(0.5)
  const [similarity, setSimilarity] = useState(0.75)
  const [style, setStyle] = useState(0)
  const [speed, setSpeed] = useState(1)
  const [spoken, setSpoken] = useState<{ url: string; blob: Blob; name: string } | null>(null)
  const speakRef = useRef<HTMLTextAreaElement>(null)

  const previewUrls = useMemo(() => previewSet?.previews.map(audioUrl) ?? [], [previewSet])
  useEffect(() => () => previewUrls.forEach(url => URL.revokeObjectURL(url)), [previewUrls])
  useEffect(() => () => { if (spoken) URL.revokeObjectURL(spoken.url) }, [spoken])

  async function load() {
    setLoadError('')
    try {
      const result = await voiceApi<VoiceList>()
      setList(result)
      setSpeakVoice(current => current || result.voices[0]?.voiceId || '')
    } catch (failure) { setLoadError(failure instanceof Error ? failure.message : 'Your voices could not be loaded.') }
  }
  useEffect(() => { void load() }, [])

  const allVoices: SavedVoice[] = [...(list?.voices ?? []), ...(list?.account ?? []).map(item => ({ voiceId: item.voiceId, name: item.name, description: item.description }))]

  async function run<T>(label: string, task: () => Promise<T>, done?: string) {
    setBusy(label); setError(''); setNotice('')
    try {
      const result = await task()
      if (done) setNotice(done)
      return result
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Something went wrong. Please try again.') }
    finally { setBusy('') }
  }

  async function design(event: FormEvent) {
    event.preventDefault()
    if (busy || description.trim().length < 20) return
    const text = previewText.trim()
    const result = await run('design', () => voiceApi<{ previews: Preview[]; text: string }>({ action: 'design', description: description.trim(), model: designModel, loudness, guidance, enhance, ...(text ? { text } : {}) }))
    if (result) { setPreviewSet({ ...result, description: description.trim(), remixOf: null }); setSaveName('') }
  }

  async function remix(event: FormEvent) {
    event.preventDefault()
    if (busy || !remixing || remixNote.trim().length < 20) return
    const text = previewText.trim()
    const result = await run('remix', () => voiceApi<{ previews: Preview[]; text: string }>({ action: 'remix', voiceId: remixing.voiceId, description: remixNote.trim(), ...(text ? { text } : {}) }))
    if (result) { setPreviewSet({ ...result, description: remixNote.trim(), remixOf: remixing }); setSaveName(remixing.name) }
  }

  async function save(preview: Preview, replace: boolean) {
    if (!previewSet || busy) return
    const name = saveName.trim() || (previewSet.remixOf?.name ?? 'New voice')
    const voiceDescription = previewSet.remixOf && previewSet.remixOf.description.length >= 20 && replace ? previewSet.remixOf.description : previewSet.description
    const result = await run(`save-${preview.generatedVoiceId}`, () => voiceApi<{ voice: SavedVoice; replaced: boolean }>({
      action: 'save', generatedVoiceId: preview.generatedVoiceId, name, description: voiceDescription, ...(replace && previewSet.remixOf ? { replaceVoiceId: previewSet.remixOf.voiceId } : {}),
    }))
    if (!result) return
    setNotice(replace ? (result.replaced ? `Saved “${result.voice.name}” and removed the original.` : `Saved “${result.voice.name}”, but the original could not be removed. Delete it from the list.`) : `Saved “${result.voice.name}” to your voices.`)
    setPreviewSet(null); setRemixing(null); setRemixNote('')
    setSpeakVoice(result.voice.voiceId)
    await load()
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault()
    if (!editing || busy) return
    const result = await run('edit', () => voiceApi<{ voice: SavedVoice }>({ action: 'edit', voiceId: editing.voiceId, name: editing.name.trim(), description: editing.description.trim() }), 'Voice details saved.')
    if (result) { setEditing(null); await load() }
  }

  async function remove(item: SavedVoice) {
    if (busy || !window.confirm(`Delete “${item.name}”? It is removed from your ElevenLabs account and can’t be undone.`)) return
    const result = await run(`delete-${item.voiceId}`, () => voiceApi<{ ok: boolean }>({ action: 'delete', voiceId: item.voiceId }), `Deleted “${item.name}”.`)
    if (!result) return
    if (speakVoice === item.voiceId) setSpeakVoice('')
    if (remixing?.voiceId === item.voiceId) { setRemixing(null); setPreviewSet(null) }
    if (editing?.voiceId === item.voiceId) setEditing(null)
    await load()
  }

  async function speak(event: FormEvent) {
    event.preventDefault()
    if (busy || !speakVoice || !speakText.trim()) return
    setBusy('speak'); setError(''); setNotice('')
    try {
      const response = await fetch('/api/voice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'speak', voiceId: speakVoice, text: speakText.trim(), model: speechModel, stability, similarity, style, speed }) })
      if (!response.ok) {
        const result = await response.json().catch(() => ({}))
        throw new Error(result.error || 'The voice could not read that text. Please try again.')
      }
      const blob = await response.blob()
      const name = allVoices.find(item => item.voiceId === speakVoice)?.name ?? 'voice'
      setSpoken({ url: URL.createObjectURL(blob), blob, name })
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'The voice could not read that text.') }
    finally { setBusy('') }
  }

  function tryVoice(item: SavedVoice) {
    setSpeakVoice(item.voiceId)
    requestAnimationFrame(() => { speakRef.current?.focus(); speakRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }) })
  }

  function startRemix(item: SavedVoice) {
    setRemixing(item); setRemixNote(''); setPreviewSet(null); setEditing(null)
    requestAnimationFrame(() => document.getElementById('remix-note')?.focus())
  }

  const disabled = Boolean(busy) || list?.configured === false
  const voiceRow = (item: SavedVoice, account: boolean) => <li key={item.voiceId} className="voice-row">
    {editing?.voiceId === item.voiceId ? <form className="voice-edit" onSubmit={saveEdit}>
      <label className="field-label" htmlFor={`voice-name-${item.voiceId}`}>Name</label>
      <input id={`voice-name-${item.voiceId}`} className="text-field" value={editing.name} maxLength={60} required onChange={event => setEditing({ ...editing, name: event.target.value })} disabled={Boolean(busy)}/>
      <label className="field-label" htmlFor={`voice-description-${item.voiceId}`}>Description</label>
      <textarea id={`voice-description-${item.voiceId}`} className="brief-textarea" rows={3} value={editing.description} minLength={20} maxLength={1000} required onChange={event => setEditing({ ...editing, description: event.target.value })} disabled={Boolean(busy)}/>
      <div className="voice-actions"><button className="secondary-button" type="submit" disabled={Boolean(busy) || editing.description.trim().length < 20}>{busy === 'edit' ? <LoaderCircle className="spin" size={14}/> : <Check size={14}/>} Save details</button><button type="button" className="secondary-button" onClick={() => setEditing(null)} disabled={Boolean(busy)}><X size={14}/> Cancel</button></div>
    </form> : <>
      <div className="voice-row-text"><strong>{item.name}</strong>{account && <small>In your ElevenLabs account</small>}<p>{item.description || 'No description.'}</p></div>
      <div className="voice-actions">
        <button type="button" className="secondary-button" onClick={() => tryVoice(item)} disabled={disabled}><Play size={14}/> Try it</button>
        <button type="button" className="secondary-button" onClick={() => startRemix(item)} disabled={disabled}><Shuffle size={14}/> Remix</button>
        <button type="button" className="secondary-button" onClick={() => { setEditing({ ...item }); setRemixing(null) }} disabled={disabled}><Pencil size={14}/> Edit</button>
        <button type="button" className="secondary-button voice-delete" onClick={() => void remove(item)} disabled={disabled} aria-label={`Delete ${item.name}`}>{busy === `delete-${item.voiceId}` ? <LoaderCircle className="spin" size={14}/> : <Trash2 size={14}/>} Delete</button>
      </div>
    </>}
  </li>

  return <div className="feature-page voice-page">
    <div className="feature-heading"><div className="section-eyebrow"><AudioLines size={15}/> THE VOICE GENERATOR</div><h1>Describe a voice.<br/><em>Hear it speak.</em></h1><p>Design a brand-new voice from a description, remix it until it fits, then have it read anything you write.</p></div>
    {list?.configured === false && <div className="error-banner" role="status"><AudioLines size={18}/><span>The Voice Generator needs an ElevenLabs API key. Add it as the <strong>ELEVENLABS_API_KEY</strong> secret on the Cloudflare Worker, then reload.</span></div>}
    {error && <div className="error-banner" role="alert"><X size={18}/><span>{error}</span><button type="button" onClick={() => setError('')} aria-label="Dismiss error"><X size={16}/></button></div>}
    {notice && <p className="voice-notice" role="status"><Check size={14}/> {notice}</p>}
    <div className="image-layout voice-layout">
      <div className="voice-column">
        {remixing ? <form className="settings-panel" onSubmit={remix}>
          <div className="panel-heading"><span className="number-tag">01</span><h2>Remix “{remixing.name}”</h2><button type="button" className="voice-link" onClick={() => { setRemixing(null); setPreviewSet(null) }} disabled={Boolean(busy)}>Back to new voice</button></div>
          <label className="field-label" htmlFor="remix-note">What should change?<span>Describe the changes, like “a little older, slower and raspier, same accent”.</span></label>
          <textarea id="remix-note" className="brief-textarea" rows={4} value={remixNote} onChange={event => setRemixNote(event.target.value)} minLength={20} maxLength={1000} required disabled={disabled}/>
          <Counter value={remixNote} min={20} max={1000}/>
          <PreviewTextField value={previewText} onChange={setPreviewText} disabled={disabled}/>
          <button className="primary-button" type="submit" disabled={disabled || remixNote.trim().length < 20}>{busy === 'remix' ? <LoaderCircle className="spin" size={17}/> : <Shuffle size={17}/>} {busy === 'remix' ? 'Remixing the voice…' : 'Generate remixes'}</button>
        </form> : <form className="settings-panel" onSubmit={design}>
          <div className="panel-heading"><span className="number-tag">01</span><h2>Design a voice</h2><span className="panel-caption">ELEVENLABS</span></div>
          <label className="field-label" htmlFor="voice-description">Describe the voice<span>Age, gender, accent, tone, pace, texture and the kind of role it plays.</span></label>
          <textarea id="voice-description" className="brief-textarea" rows={5} value={description} onChange={event => setDescription(event.target.value)} minLength={20} maxLength={1000} required disabled={disabled} placeholder="A warm, gravelly older man with a slow Southern drawl…"/>
          <Counter value={description} min={20} max={1000}/>
          <div className="prompt-chips">{examples.map((example, index) => <button type="button" key={example} disabled={disabled} onClick={() => setDescription(example)}>{['Porch storyteller', 'Podcast host', 'Documentary narrator'][index]}</button>)}</div>
          <PreviewTextField value={previewText} onChange={setPreviewText} disabled={disabled}/>
          <label className="select-field"><span>Design model</span><div><select value={designModel} onChange={event => setDesignModel(event.target.value)} disabled={disabled}>{designModels.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}</select></div></label>
          <div className="settings-grid">
            <Slider id="voice-loudness" label="Loudness" value={loudness} min={-1} max={1} step={0.1} onChange={setLoudness} disabled={disabled}/>
            <Slider id="voice-guidance" label="Follow the description" value={guidance} min={0} max={20} step={0.5} onChange={setGuidance} disabled={disabled}/>
          </div>
          <label className="toggle-field"><input type="checkbox" checked={enhance} onChange={event => setEnhance(event.target.checked)} disabled={disabled}/><span><strong>Enhance my description</strong><small>ElevenLabs expands a short description with more detail before designing.</small></span></label>
          <button className="primary-button" type="submit" disabled={disabled || description.trim().length < 20}>{busy === 'design' ? <LoaderCircle className="spin" size={17}/> : <WandSparkles size={17}/>} {busy === 'design' ? 'Designing voices…' : 'Generate voice previews'}</button>
          <p className="fresh-note">You get up to three takes. Each design uses ElevenLabs credits.</p>
        </form>}
        {previewSet && <section className="settings-panel voice-previews" aria-label="Voice previews">
          <div className="panel-heading"><span className="number-tag">✓</span><h2>{previewSet.remixOf ? 'Pick a remix' : 'Pick a preview'}</h2></div>
          {previewSet.text && <p className="box-hint">Reading: “{previewSet.text}”</p>}
          <label className="field-label" htmlFor="voice-save-name">Voice name</label>
          <input id="voice-save-name" className="text-field" value={saveName} maxLength={60} placeholder={previewSet.remixOf?.name ?? 'Name your voice'} onChange={event => setSaveName(event.target.value)} disabled={Boolean(busy)}/>
          <ol className="voice-preview-list">{previewSet.previews.map((preview, index) => <li key={preview.generatedVoiceId}>
            <span>Take {index + 1}{preview.duration ? ` · ${preview.duration.toFixed(1)} s` : ''}</span>
            <audio controls preload="metadata" src={previewUrls[index]}/>
            <div className="voice-actions">
              <button type="button" className="secondary-button" onClick={() => void save(preview, false)} disabled={Boolean(busy)}>{busy === `save-${preview.generatedVoiceId}` ? <LoaderCircle className="spin" size={14}/> : <Check size={14}/>} {previewSet.remixOf ? 'Save as new voice' : 'Save this voice'}</button>
              {previewSet.remixOf && <button type="button" className="secondary-button" onClick={() => void save(preview, true)} disabled={Boolean(busy)}><Shuffle size={14}/> Replace original</button>}
            </div>
          </li>)}</ol>
          <button type="button" className="ghost-button" onClick={() => setPreviewSet(null)} disabled={Boolean(busy)}><X size={14}/> Discard previews</button>
        </section>}
      </div>
      <div className="voice-column">
        <form className="image-output voice-speak" onSubmit={speak}>
          <div className="panel-heading"><span className="number-tag">02</span><h2>Hear it speak</h2></div>
          {allVoices.length ? <>
            <label className="select-field"><span>Voice</span><div><select value={speakVoice} onChange={event => setSpeakVoice(event.target.value)} disabled={Boolean(busy)} required><option value="" disabled>Choose a voice</option>{allVoices.map(item => <option key={item.voiceId} value={item.voiceId}>{item.name}</option>)}</select></div></label>
            <label className="field-label" htmlFor="voice-speak-text">Your text<span>Anything you want this voice to read. With Eleven v4 you can add tags like [whispers] or [laughs].</span></label>
            <textarea ref={speakRef} id="voice-speak-text" className="brief-textarea" rows={6} value={speakText} onChange={event => setSpeakText(event.target.value)} maxLength={2500} required disabled={disabled}/>
            <Counter value={speakText} max={2500}/>
            <label className="select-field"><span>Speech model</span><div><select value={speechModel} onChange={event => setSpeechModel(event.target.value)} disabled={disabled}>{speechModels.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}</select></div></label>
            <div className="settings-grid">
              <Slider id="voice-stability" label="Stability" value={stability} min={0} max={1} step={0.05} onChange={setStability} disabled={disabled}/>
              <Slider id="voice-similarity" label="Similarity" value={similarity} min={0} max={1} step={0.05} onChange={setSimilarity} disabled={disabled}/>
              <Slider id="voice-style" label="Style" value={style} min={0} max={1} step={0.05} onChange={setStyle} disabled={disabled}/>
              <Slider id="voice-speed" label="Speed" value={speed} min={0.7} max={1.2} step={0.05} onChange={setSpeed} disabled={disabled}/>
            </div>
            <button className="primary-button" type="submit" disabled={disabled || !speakVoice || !speakText.trim()}>{busy === 'speak' ? <LoaderCircle className="spin" size={17}/> : <Play size={17}/>} {busy === 'speak' ? 'Recording…' : 'Speak it'}</button>
            {spoken && <div className="voice-result"><audio controls autoPlay src={spoken.url}/><button type="button" className="secondary-button" onClick={() => saveBlob(spoken.blob, `${spoken.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'voice'}.mp3`)}><ArrowDown size={14}/> Download .mp3</button></div>}
          </> : <div className="output-empty"><AudioLines size={40} strokeWidth={1.2}/><h3>Your voices<br/>show up here.</h3><p>Design a voice and save a take you like.<br/>Then type anything for it to read.</p></div>}
        </form>
        <section className="image-output voice-library" aria-label="Your voices">
          <div className="panel-heading"><span className="number-tag">03</span><h2>Your voices</h2>{list && <span className="panel-caption">{list.voices.length} SAVED</span>}</div>
          {!list && !loadError && <p role="status" className="box-hint"><LoaderCircle className="spin" size={14}/> Loading your voices…</p>}
          {loadError && <p role="alert" className="box-hint">{loadError} <button type="button" className="voice-link" onClick={() => void load()}>Try again</button></p>}
          {list && !list.voices.length && <p className="box-hint">No saved voices yet. Save a preview to keep it.</p>}
          {list && list.voices.length > 0 && <ul className="voice-list">{list.voices.map(item => voiceRow(item, false))}</ul>}
          {list?.canManageAccount && list.account && list.account.length > 0 && <>
            <h3 className="voice-subhead">Other voices in your ElevenLabs account</h3>
            <ul className="voice-list">{list.account.map(item => voiceRow({ voiceId: item.voiceId, name: item.name, description: item.description }, true))}</ul>
          </>}
        </section>
      </div>
    </div>
  </div>
}

function PreviewTextField({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled: boolean }) {
  return <>
    <label className="field-label" htmlFor="voice-preview-text">Preview text (optional)<span>What the previews say, 100–1,000 characters. Leave it empty and ElevenLabs writes a line that suits the voice.</span></label>
    <textarea id="voice-preview-text" className="brief-textarea" rows={3} value={value} onChange={event => onChange(event.target.value)} maxLength={1000} disabled={disabled}/>
    <Counter value={value} min={100} max={1000}/>
  </>
}

function Slider({ id, label, value, min, max, step, onChange, disabled }: { id: string; label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void; disabled: boolean }) {
  return <label className="voice-slider" htmlFor={id}><span>{label}<output>{value.toFixed(2).replace(/\.?0+$/, '') || '0'}</output></span><input id={id} type="range" min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))} disabled={disabled}/></label>
}
