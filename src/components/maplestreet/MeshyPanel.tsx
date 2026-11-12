import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { LoaderCircle, Sparkles, Trash2, X } from 'lucide-react'
import { estimateCredits, MESHY_AI_MODELS, NEGATIVE_DEFAULTS, POLYCOUNT_DEFAULTS, POLYCOUNT_RANGE, PREVIEW_COUNT_MAX, PROMPT_HELPERS } from '@/lib/meshy'
import type { MeshyAiModel, MeshyJob, MeshyStatus, MeshyTarget } from '@/lib/meshy'
import { meshyCancel, meshyDelete, meshyHide, meshyImage, meshyJobs, meshyModelFile, meshyRefine, meshyRemesh, meshyRetexture, meshyStatus, meshyText } from '@/lib/meshy-client'
import type { MeshySource } from '@/lib/meshy-client'
import { NumberInput } from '../admin/NumberInput'

export type MeshySourceOption = { label: string; source: MeshySource }

type Props = {
  target: MeshyTarget
  /** Published items or vehicles that Retexture and Remesh can start from. */
  sources: MeshySourceOption[]
  /** Opens a finished model in the editor beside this panel. */
  onOpen: (file: File, job: MeshyJob) => void
}

const POLL_MS = 5000
const KIND_LABEL: Record<MeshyJob['kind'], string> = { preview: 'Preview', refine: 'Textured', image: 'From image', remesh: 'Remesh', retexture: 'Retexture', rig: 'Rigged', animate: 'Animation' }
const MODEL_LABEL: Record<MeshyAiModel, string> = { latest: 'Latest (best quality)', 'meshy-6': 'Meshy 6', 'meshy-6-lite': 'Meshy 6 Lite (cheapest)' }
const credits = (value: number) => `${value} credit${value === 1 ? '' : 's'}`

async function imageToDataUrl(file: File, maxSide = 1024): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return canvas.toDataURL('image/png')
}

export function MeshyPanel({ target, sources, onOpen }: Props) {
  const [status, setStatus] = useState<MeshyStatus | null>(null)
  const [jobs, setJobs] = useState<MeshyJob[] | null>(null)
  const [mode, setMode] = useState<'text' | 'image' | 'edit'>('text')
  const [prompt, setPrompt] = useState('')
  const [negative, setNegative] = useState(NEGATIVE_DEFAULTS[target])
  const [aiModel, setAiModel] = useState<MeshyAiModel>('latest')
  const [count, setCount] = useState(2)
  const [polycount, setPolycount] = useState(POLYCOUNT_DEFAULTS[target])
  const [image, setImage] = useState<string | null>(null)
  const [texture, setTexture] = useState(true)
  const [sourceIndex, setSourceIndex] = useState(0)
  const [editPrompt, setEditPrompt] = useState('')
  const [refinePrompt, setRefinePrompt] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refreshStatus = useCallback(async () => {
    try { setStatus(await meshyStatus()) } catch (error) { setMessage({ tone: 'error', text: (error as Error).message }) }
  }, [])

  const refreshJobs = useCallback(async () => {
    try {
      const data = await meshyJobs()
      setJobs(data.jobs)
      return data.jobs
    } catch (error) {
      setMessage({ tone: 'error', text: (error as Error).message })
      return null
    }
  }, [])

  useEffect(() => { void refreshStatus() }, [refreshStatus])
  useEffect(() => {
    if (!status?.connected) return
    let alive = true
    const loop = async () => {
      const list = await refreshJobs()
      if (!alive) return
      const running = list?.some(j => j.status === 'PENDING' || j.status === 'IN_PROGRESS')
      timer.current = setTimeout(() => void loop(), running ? POLL_MS : POLL_MS * 4)
    }
    void loop()
    return () => { alive = false; if (timer.current) clearTimeout(timer.current) }
  }, [status?.connected, refreshJobs])

  const visibleJobs = useMemo(() => jobs?.filter(j => j.target === target) ?? null, [jobs, target])

  async function run(key: string, action: () => Promise<unknown>, done: string) {
    setBusy(key)
    setMessage(null)
    try {
      await action()
      setMessage({ tone: 'ok', text: done })
      await Promise.all([refreshJobs(), refreshStatus()])
    } catch (error) {
      setMessage({ tone: 'error', text: (error as Error).message })
    } finally {
      setBusy(null)
    }
  }

  function addHelper(text: string) {
    setPrompt(current => current.toLowerCase().includes(text.toLowerCase()) ? current : `${current.trim()}${current.trim() ? ', ' : ''}${text}`)
  }

  async function onImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { setMessage({ tone: 'error', text: 'Choose a PNG, JPEG or WebP image.' }); return }
    setImage(await imageToDataUrl(file))
  }

  async function open(job: MeshyJob) {
    setBusy(`open-${job.id}`)
    setMessage(null)
    try {
      onOpen(await meshyModelFile(job.id, `meshy-${job.kind}-${job.id.slice(0, 6)}.glb`), job)
      setMessage({ tone: 'ok', text: 'Opened in the editor. Scale it and publish when it looks right.' })
      void refreshJobs()
    } catch (error) {
      setMessage({ tone: 'error', text: (error as Error).message })
    } finally {
      setBusy(null)
    }
  }

  function deleteJob(job: MeshyJob, running: boolean) {
    const what = `this ${KIND_LABEL[job.kind].toLowerCase()} job (“${job.prompt.length > 60 ? `${job.prompt.slice(0, 60)}…` : job.prompt}”)`
    const stop = running ? ' Meshy stops working on it and doesn’t refund credits for tasks that already started.' : ''
    if (!window.confirm(`Delete ${what} and its stored model?${stop} Items, vehicles and rides you already published from it keep their own copy. This can’t be undone.`)) return
    void run(`delete-${job.id}`, () => meshyDelete(job.id), 'Deleted the job and its stored model.')
  }

  const previewCost = estimateCredits({ kind: 'preview', model: aiModel, count })
  const imageCost = estimateCredits({ kind: 'image', model: aiModel, texture })
  const enough = (cost: number) => status?.balance == null || status.balance >= cost
  const source = sources[sourceIndex]?.source

  if (status === null) return <section className="ms-meshy" aria-label="Generate with Meshy"><p role="status"><LoaderCircle className="spin" size={16}/> Checking Meshy…</p></section>
  if (!status.connected) return <section className="ms-meshy" aria-label="Generate with Meshy">
    <h2><Sparkles size={18} aria-hidden/> Generate with Meshy</h2>
    <p className="ms-meshy-off" role="status">Meshy isn’t connected. Add the <code>MESHY_API_KEY</code> secret to the Worker in Cloudflare and reload this page to generate and edit models here. You can still upload models yourself.</p>
  </section>

  return <section className="ms-meshy" aria-label="Generate with Meshy">
    <header className="ms-meshy-head">
      <h2><Sparkles size={18} aria-hidden/> Generate with Meshy</h2>
      <span className="ms-meshy-balance">{status.balance == null ? 'Balance unavailable' : `${status.balance.toLocaleString()} credits left`}</span>
    </header>
    {target === 'ride' && <p className="ms-meshy-note">Thrill Park rides must be original: no real park, ride or film names, mascots or logos. Ask for the ride on its own, without riders or scenery; the park adds guests, queues and lights.</p>}
    {target === 'vehicle' && <p className="ms-meshy-note">Vehicles must be original designs: no real makes, model names, logos or badges. The game adds its own spinning, steering wheels, so ask for a body without wheels.</p>}
    {target === 'racecar' && <p className="ms-meshy-note">Race cars must be original designs: no real makes, models, series, sponsors or logos. The track adds wheels, the driver’s paint color and race numbers, so ask for a plain body without wheels, decals or numbers.</p>}

    <div className="ms-meshy-tabs" role="tablist" aria-label="Meshy tools">
      {(['text', 'image', 'edit'] as const).map(value => <button key={value} type="button" role="tab" aria-selected={mode === value} className={mode === value ? 'is-active' : ''} onClick={() => setMode(value)}>{value === 'text' ? 'Text → 3D' : value === 'image' ? 'Image → 3D' : 'Edit a published model'}</button>)}
    </div>

    {mode === 'text' && <form className="ms-meshy-form" onSubmit={(event: FormEvent) => { event.preventDefault(); void run('text', () => meshyText({ target, prompt, negativePrompt: negative, aiModel, count, polycount }), `Started ${count} preview${count > 1 ? 's' : ''}. Pick the best one, then refine it for textures.`) }}>
      <label>Describe the model<textarea value={prompt} onChange={event => setPrompt(event.target.value)} rows={3} maxLength={600} required minLength={3} placeholder={target === 'vehicle' ? 'A boxy two-door utility wagon with a roof rack' : target === 'racecar' ? 'A low, wedge-nosed short-track race car with a tall rear spoiler and flat sides' : target === 'ride' ? 'A spinning octopus ride with eight teal tub cars on long arms, on a round deck' : 'A mid-century walnut sideboard with brass handles'}/></label>
      <div className="ms-meshy-chips" aria-label="Prompt helpers">{PROMPT_HELPERS[target].map(text => <button key={text} type="button" onClick={() => addHelper(text)}>+ {text}</button>)}</div>
      <label>Avoid<input value={negative} onChange={event => setNegative(event.target.value)} maxLength={300}/></label>
      <div className="ms-meshy-row">
        <label>Model<select value={aiModel} onChange={event => setAiModel(event.target.value as MeshyAiModel)}>{MESHY_AI_MODELS.map(m => <option key={m} value={m}>{MODEL_LABEL[m]}</option>)}</select></label>
        <label>Previews<NumberInput min={1} max={PREVIEW_COUNT_MAX} integer value={count} onChange={setCount}/></label>
        <label>Polygons<NumberInput min={POLYCOUNT_RANGE.min} max={POLYCOUNT_RANGE.max} step={500} integer value={polycount} onChange={setPolycount}/></label>
      </div>
      <button type="submit" disabled={!!busy || prompt.trim().length < 3 || !enough(previewCost)}>{busy === 'text' ? <LoaderCircle className="spin" size={14}/> : null} Generate previews · about {credits(previewCost)}</button>
    </form>}

    {mode === 'image' && <form className="ms-meshy-form" onSubmit={(event: FormEvent) => { event.preventDefault(); if (image) void run('image', () => meshyImage({ target, image, texture, aiModel, prompt, polycount }), 'Started. The textured model appears in the job list when it’s done.') }}>
      <label>Reference image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => void onImage(event)}/></label>
      {image && <img className="ms-meshy-ref" src={image} alt="Reference image to turn into a model"/>}
      <label>Texture notes (optional)<input value={prompt} onChange={event => setPrompt(event.target.value)} maxLength={600}/></label>
      <div className="ms-meshy-row">
        <label>Model<select value={aiModel} onChange={event => setAiModel(event.target.value as MeshyAiModel)}>{MESHY_AI_MODELS.map(m => <option key={m} value={m}>{MODEL_LABEL[m]}</option>)}</select></label>
        <label>Polygons<NumberInput min={POLYCOUNT_RANGE.min} max={POLYCOUNT_RANGE.max} step={500} integer value={polycount} onChange={setPolycount}/></label>
      </div>
      <label className="ms-meshy-check"><input type="checkbox" checked={texture} onChange={event => setTexture(event.target.checked)}/> Add textures</label>
      <button type="submit" disabled={!!busy || !image || !enough(imageCost)}>{busy === 'image' ? <LoaderCircle className="spin" size={14}/> : null} Generate · about {credits(imageCost)}</button>
    </form>}

    {mode === 'edit' && <div className="ms-meshy-form">
      {sources.length === 0 ? <p>Publish something first, or use Retexture and Remesh on a finished job below.</p> : <>
        <label>Published model<select value={sourceIndex} onChange={event => setSourceIndex(Number(event.target.value))}>{sources.map((s, i) => <option key={i} value={i}>{s.label}</option>)}</select></label>
        <label>New look (retexture prompt)<input value={editPrompt} onChange={event => setEditPrompt(event.target.value)} maxLength={600} placeholder="Weathered sage-green paint with chrome trim"/></label>
        <div className="ms-meshy-row">
          <button type="button" disabled={!!busy || !source || editPrompt.trim().length < 3 || !enough(estimateCredits({ kind: 'retexture' }))} onClick={() => source && void run('retexture', () => meshyRetexture(target, source, editPrompt), 'Retexture started.')}>Retexture · {credits(estimateCredits({ kind: 'retexture' }))}</button>
          <label>Polygons<NumberInput min={POLYCOUNT_RANGE.min} max={POLYCOUNT_RANGE.max} step={500} integer value={polycount} onChange={setPolycount}/></label>
          <button type="button" disabled={!!busy || !source || !enough(estimateCredits({ kind: 'remesh' }))} onClick={() => source && void run('remesh', () => meshyRemesh(target, source, polycount), 'Remesh started.')}>Remesh · {credits(estimateCredits({ kind: 'remesh' }))}</button>
        </div>
      </>}
    </div>}

    {message && <p role={message.tone === 'error' ? 'alert' : 'status'} className={message.tone === 'error' ? 'ms-items-error' : 'ms-items-ok'}>{message.text}</p>}

    <h3>Jobs</h3>
    {visibleJobs === null && <p role="status"><LoaderCircle className="spin" size={16}/> Loading jobs…</p>}
    {visibleJobs?.length === 0 && <p>No Meshy jobs yet.</p>}
    {!!visibleJobs?.length && <ul className="ms-meshy-jobs">
      {visibleJobs.map(job => {
        const running = job.status === 'PENDING' || job.status === 'IN_PROGRESS'
        const done = job.status === 'SUCCEEDED'
        return <li key={job.id} className={`is-${job.status.toLowerCase()}`}>
          {job.thumbnailUrl ? <img src={job.thumbnailUrl} alt="" loading="lazy"/> : <span className="ms-meshy-thumb" aria-hidden/>}
          <div>
            <strong>{KIND_LABEL[job.kind]}</strong>
            <span title={job.prompt}>{job.prompt}</span>
            {running && <progress max={100} value={job.progress} aria-label={`${KIND_LABEL[job.kind]} progress`}>{job.progress}%</progress>}
            <small>{running ? `${job.status === 'PENDING' ? 'Queued' : 'Working'} · ${job.progress}%` : job.status === 'SUCCEEDED' ? 'Done' : job.status === 'CANCELED' ? 'Canceled' : 'Failed'} · {credits(job.credits)}{job.error ? ` · ${job.error}` : ''}</small>
          </div>
          <div className="ms-meshy-actions">
            {done && job.kind === 'preview' && <>
              <input aria-label="Texture prompt for refining" placeholder="Texture prompt (optional)" value={refinePrompt[job.id] ?? ''} onChange={event => setRefinePrompt(current => ({ ...current, [job.id]: event.target.value }))}/>
              <button type="button" disabled={!!busy || !enough(estimateCredits({ kind: 'refine' }))} onClick={() => void run(`refine-${job.id}`, () => meshyRefine(job.id, refinePrompt[job.id] ?? ''), 'Refining with textures.')}>Pick &amp; refine · {credits(estimateCredits({ kind: 'refine' }))}</button>
            </>}
            {done && job.kind !== 'preview' && <button type="button" disabled={!!busy} onClick={() => void run(`remesh-${job.id}`, () => meshyRemesh(target, { jobId: job.id }, polycount), `Remeshing to ${polycount.toLocaleString()} polygons.`)}>Remesh to {polycount.toLocaleString()} · {credits(estimateCredits({ kind: 'remesh' }))}</button>}
            {done && <button type="button" className="ms-meshy-open" disabled={!!busy} onClick={() => void open(job)}>{busy === `open-${job.id}` ? <LoaderCircle className="spin" size={14}/> : null} Open in editor</button>}
            {running && <button type="button" disabled={!!busy} onClick={() => void run(`cancel-${job.id}`, () => meshyCancel(job.id), 'Canceled. Meshy doesn’t refund credits for tasks that already started.')}>Cancel</button>}
            <button type="button" aria-label={`Delete this ${KIND_LABEL[job.kind].toLowerCase()} job and its stored model`} disabled={!!busy} onClick={() => deleteJob(job, running)}>{busy === `delete-${job.id}` ? <LoaderCircle className="spin" size={14} aria-hidden/> : <Trash2 size={14} aria-hidden/>} Delete</button>
            {!running && <button type="button" aria-label="Remove from list (keeps the stored model)" title="Remove from list (keeps the stored model)" disabled={!!busy} onClick={() => void run(`hide-${job.id}`, () => meshyHide(job.id), 'Removed from the list.')}><X size={14} aria-hidden/></button>}
          </div>
        </li>
      })}
    </ul>}
  </section>
}
