import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, LoaderCircle, Sparkles, X } from 'lucide-react'
import prompts from '../../../assets-src/models/bushleague/prompts.json'
import { estimateCredits, POLYCOUNT_DEFAULTS } from '@/lib/meshy'
import type { MeshyJob, MeshyStatus, MeshyTarget } from '@/lib/meshy'
import { meshyAnimate, meshyCancel, meshyHide, meshyJobs, meshyModelFile, meshyRefine, meshyRig, meshyStatus, meshyText } from '@/lib/meshy-client'

type PromptItem = { id: string; label: string; prompt: string }
type PromptGroup = { id: string; label: string; target: MeshyTarget; items: PromptItem[] }
type Animation = { id: string; label: string; meshyActionId: number | null }

const GROUPS = prompts.groups as PromptGroup[]
const ANIMATIONS = prompts.animations as Animation[]
const NEGATIVE = prompts.negative as Record<string, string>
const TARGETS: ReadonlySet<MeshyTarget> = new Set(['ballplayer', 'ballpark'])
const KIND_LABEL: Record<MeshyJob['kind'], string> = { preview: 'Preview', refine: 'Textured', image: 'From image', remesh: 'Remesh', retexture: 'Retexture', rig: 'Rigged', animate: 'Animation' }
const POLL_MS = 5000
const credits = (value: number) => `${value} credit${value === 1 ? '' : 's'}`

/** Admin tab for Bush League Baseball's Meshy batch: every prompt in assets-src/models/bushleague/prompts.json, one click per item or per group, then refine, rig, animate and download for the Blender clean-up. */
export function BushLeagueAssets() {
  const [status, setStatus] = useState<MeshyStatus | null>(null)
  const [jobs, setJobs] = useState<MeshyJob[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmGroup, setConfirmGroup] = useState<string | null>(null)
  const [animation, setAnimation] = useState<Record<string, { actionId: string; label: string }>>({})
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
      const running = list?.some(job => job.status === 'PENDING' || job.status === 'IN_PROGRESS')
      timer.current = setTimeout(() => void loop(), running ? POLL_MS : POLL_MS * 4)
    }
    void loop()
    return () => { alive = false; if (timer.current) clearTimeout(timer.current) }
  }, [status?.connected, refreshJobs])

  const ours = useMemo(() => jobs?.filter(job => TARGETS.has(job.target)) ?? null, [jobs])
  const previewCost = estimateCredits({ kind: 'preview', model: 'latest', count: 1 })
  const enough = (cost: number) => status?.balance == null || status.balance >= cost

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

  const generate = (group: PromptGroup, item: PromptItem) => meshyText({ target: group.target, prompt: item.prompt, negativePrompt: NEGATIVE[group.target] ?? '', aiModel: 'latest', count: 1, polycount: POLYCOUNT_DEFAULTS[group.target] })

  async function download(job: MeshyJob) {
    setBusy(`download-${job.id}`)
    try {
      const file = await meshyModelFile(job.id, `bushleague-${job.kind}-${job.id.slice(0, 6)}.glb`)
      const url = URL.createObjectURL(file)
      const link = Object.assign(document.createElement('a'), { href: url, download: file.name })
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
    } catch (error) {
      setMessage({ tone: 'error', text: (error as Error).message })
    } finally {
      setBusy(null)
    }
  }

  if (status === null) return <section className="ms-meshy" aria-label="Bush League assets"><p role="status"><LoaderCircle className="spin" size={16}/> Checking Meshy…</p></section>
  if (!status.connected) return <section className="ms-meshy" aria-label="Bush League assets">
    <h2><Sparkles size={18} aria-hidden/> Bush League Baseball assets</h2>
    <p className="ms-meshy-off" role="status">Meshy isn’t connected. Add the <code>MESHY_API_KEY</code> secret to the Worker in Cloudflare and reload this page.</p>
  </section>

  return <section className="ms-meshy" aria-label="Bush League assets">
    <header className="ms-meshy-head">
      <h2><Sparkles size={18} aria-hidden/> Bush League Baseball assets</h2>
      <span className="ms-meshy-balance">{status.balance == null ? 'Balance unavailable' : `${status.balance.toLocaleString()} credits left`}</span>
    </header>
    <p className="ms-meshy-note">Every prompt here is kept in <code>assets-src/models/bushleague/prompts.json</code> so the set can be regenerated. Everything must be original: no real teams, players, logos, uniforms or ballparks. Generate previews, refine the best, rig players at 1.85 m, add animation clips, then download for the Blender clean-up scripts in <code>scripts/blender/bushleague/</code>.</p>

    {GROUPS.map(group => {
      const cost = previewCost * group.items.length
      return <div key={group.id} className="ms-meshy-form">
        <div className="ms-meshy-row">
          <h3>{group.label}</h3>
          {confirmGroup === group.id
            ? <>
              <button type="button" disabled={!!busy || !enough(cost)} onClick={() => { setConfirmGroup(null); void run(`group-${group.id}`, async () => { for (const item of group.items) await generate(group, item) }, `Started ${group.items.length} previews.`) }}>Confirm · about {credits(cost)}</button>
              <button type="button" onClick={() => setConfirmGroup(null)}>Keep</button>
            </>
            : <button type="button" disabled={!!busy || !enough(cost)} onClick={() => setConfirmGroup(group.id)}>Generate all {group.items.length} · about {credits(cost)}</button>}
        </div>
        <ul className="ms-meshy-jobs">
          {group.items.map(item => <li key={item.id}>
            <span className="ms-meshy-thumb" aria-hidden/>
            <div><strong>{item.label}</strong><span title={item.prompt}>{item.prompt}</span></div>
            <div className="ms-meshy-actions">
              <button type="button" disabled={!!busy || !enough(previewCost)} onClick={() => void run(`item-${item.id}`, () => generate(group, item), `Started a preview of ${item.label}.`)}>{busy === `item-${item.id}` ? <LoaderCircle className="spin" size={14}/> : null} Generate · {credits(previewCost)}</button>
            </div>
          </li>)}
        </ul>
      </div>
    })}

    {message && <p role={message.tone === 'error' ? 'alert' : 'status'} className={message.tone === 'error' ? 'ms-items-error' : 'ms-items-ok'}>{message.text}</p>}

    <h3>Jobs</h3>
    {ours === null && <p role="status"><LoaderCircle className="spin" size={16}/> Loading jobs…</p>}
    {ours?.length === 0 && <p>No Bush League jobs yet.</p>}
    {!!ours?.length && <ul className="ms-meshy-jobs">
      {ours.map(job => {
        const running = job.status === 'PENDING' || job.status === 'IN_PROGRESS'
        const done = job.status === 'SUCCEEDED'
        const pick = animation[job.id] ?? { actionId: '', label: ANIMATIONS[0]?.label ?? 'Clip' }
        return <li key={job.id} className={`is-${job.status.toLowerCase()}`}>
          {job.thumbnailUrl ? <img src={job.thumbnailUrl} alt="" loading="lazy"/> : <span className="ms-meshy-thumb" aria-hidden/>}
          <div>
            <strong>{KIND_LABEL[job.kind]} · {job.target === 'ballplayer' ? 'Player' : 'Park'}</strong>
            <span title={job.prompt}>{job.prompt}</span>
            {running && <progress max={100} value={job.progress} aria-label={`${KIND_LABEL[job.kind]} progress`}>{job.progress}%</progress>}
            <small>{running ? `${job.status === 'PENDING' ? 'Queued' : 'Working'} · ${job.progress}%` : done ? 'Done' : job.status === 'CANCELED' ? 'Canceled' : 'Failed'} · {credits(job.credits)}{job.error ? ` · ${job.error}` : ''}</small>
          </div>
          <div className="ms-meshy-actions">
            {done && job.kind === 'preview' && <button type="button" disabled={!!busy || !enough(estimateCredits({ kind: 'refine' }))} onClick={() => void run(`refine-${job.id}`, () => meshyRefine(job.id, ''), 'Refining with textures.')}>Pick &amp; refine · {credits(estimateCredits({ kind: 'refine' }))}</button>}
            {done && job.target === 'ballplayer' && (job.kind === 'refine' || job.kind === 'remesh' || job.kind === 'retexture' || job.kind === 'image') && <button type="button" disabled={!!busy || !enough(estimateCredits({ kind: 'rig' }))} onClick={() => void run(`rig-${job.id}`, () => meshyRig(job.id, 1.85), 'Rigging at 1.85 m.')}>Rig · {credits(estimateCredits({ kind: 'rig' }))}</button>}
            {done && job.kind === 'rig' && <>
              <select aria-label="Animation clip" value={pick.label} onChange={event => {
                const chosen = ANIMATIONS.find(item => item.label === event.target.value)
                setAnimation(current => ({ ...current, [job.id]: { label: event.target.value, actionId: chosen?.meshyActionId != null ? String(chosen.meshyActionId) : current[job.id]?.actionId ?? '' } }))
              }}>{ANIMATIONS.map(item => <option key={item.id}>{item.label}</option>)}</select>
              <input aria-label="Meshy animation action id" inputMode="numeric" placeholder="Action id" value={pick.actionId} onChange={event => setAnimation(current => ({ ...current, [job.id]: { ...pick, actionId: event.target.value.replace(/\D/g, '') } }))} style={{ width: 90 }}/>
              <button type="button" disabled={!!busy || pick.actionId === '' || !enough(estimateCredits({ kind: 'animate' }))} onClick={() => void run(`animate-${job.id}`, () => meshyAnimate(job.id, Number(pick.actionId), pick.label), `Animating: ${pick.label}.`)}>Animate · about {credits(estimateCredits({ kind: 'animate' }))}</button>
            </>}
            {done && job.kind !== 'preview' && <button type="button" disabled={!!busy} onClick={() => void download(job)}>{busy === `download-${job.id}` ? <LoaderCircle className="spin" size={14}/> : <Download size={14} aria-hidden/>} .glb</button>}
            {running && <button type="button" disabled={!!busy} onClick={() => void run(`cancel-${job.id}`, () => meshyCancel(job.id), 'Canceled. Meshy doesn’t refund credits for tasks that already started.')}>Cancel</button>}
            {!running && <button type="button" aria-label="Remove from list" disabled={!!busy} onClick={() => void run(`hide-${job.id}`, () => meshyHide(job.id), 'Removed from the list.')}><X size={14} aria-hidden/></button>}
          </div>
        </li>
      })}
    </ul>}
  </section>
}

export default BushLeagueAssets
