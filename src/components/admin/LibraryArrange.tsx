import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { ArrowDown, ArrowUp, ChevronsUp, Eye, EyeOff, GripVertical, LoaderCircle, RotateCcw, Star } from 'lucide-react'
import { learningModules } from '@/lib/modules'
import type { ModuleId } from '@/lib/modules'
import { arrangeModules, sameLayout } from '@/lib/module-layout'
import type { ModuleLayout } from '@/lib/module-layout'
import { loadModuleLayout, resetModuleLayout, saveModuleLayout, useModuleLayout } from '@/lib/use-module-layout'

const byId = new Map(learningModules.map(item => [item.id, item]))

function move<T>(list: T[], from: number, to: number) {
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(Math.max(0, Math.min(next.length, to)), 0, item)
  return next
}

export function LibraryArrange() {
  const saved = useModuleLayout()
  const [draft, setDraft] = useState<ModuleLayout>(saved)
  const [dragging, setDragging] = useState<ModuleId | null>(null)
  const [busy, setBusy] = useState<'save' | 'reset' | null>(null)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [announce, setAnnounce] = useState('')
  const listRef = useRef<HTMLOListElement>(null)
  const dirty = !sameLayout(draft, saved)

  useEffect(() => { void loadModuleLayout(true) }, [])
  useEffect(() => { if (!dirty) setDraft(saved) }, [saved])

  const featuredId = useMemo(() => arrangeModules(draft).featured.id, [draft])
  const hidden = new Set(draft.hidden)
  const shownCount = draft.order.length - hidden.size

  function reorder(id: ModuleId, to: number, say = true) {
    setDraft(current => {
      const from = current.order.indexOf(id)
      if (from < 0 || from === to) return current
      return { ...current, order: move(current.order, from, to) }
    })
    if (say) setAnnounce(`${byId.get(id)?.title} moved to position ${to + 1} of ${draft.order.length}.`)
  }

  function onHandleKey(event: KeyboardEvent<HTMLButtonElement>, id: ModuleId, index: number) {
    const to = event.key === 'ArrowUp' ? index - 1 : event.key === 'ArrowDown' ? index + 1 : event.key === 'Home' ? 0 : event.key === 'End' ? draft.order.length - 1 : null
    if (to === null || to < 0 || to >= draft.order.length) return
    event.preventDefault()
    reorder(id, to)
    requestAnimationFrame(() => document.getElementById(`arrange-handle-${id}`)?.focus())
  }

  function onPointerDown(event: PointerEvent<HTMLButtonElement>, id: ModuleId) {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(id)
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>, id: ModuleId) {
    if (dragging !== id || !listRef.current) return
    const rows = [...listRef.current.querySelectorAll<HTMLLIElement>('li[data-id]')].filter(row => row.dataset.id !== id)
    let target = 0
    for (const row of rows) { const box = row.getBoundingClientRect(); if (event.clientY > box.top + box.height / 2) target++ }
    const from = draft.order.indexOf(id)
    if (target !== from) reorder(id, target, false)
  }

  function onPointerUp(id: ModuleId) {
    if (dragging !== id) return
    setDragging(null)
    setAnnounce(`${byId.get(id)?.title} dropped at position ${draft.order.indexOf(id) + 1}.`)
  }

  function toggleHidden(id: ModuleId) {
    if (!hidden.has(id) && shownCount <= 1) { setNotice({ tone: 'error', text: 'Keep at least one module in the library.' }); return }
    setDraft(current => {
      const nextHidden = current.hidden.includes(id) ? current.hidden.filter(item => item !== id) : [...current.hidden, id]
      return { ...current, hidden: nextHidden, featured: current.featured === id && nextHidden.includes(id) ? null : current.featured }
    })
  }

  async function save() {
    setBusy('save'); setNotice(null)
    try { setDraft(await saveModuleLayout(draft)); setNotice({ tone: 'ok', text: 'Library order published. Everyone sees it on their next visit.' }) }
    catch (error) { setNotice({ tone: 'error', text: (error as Error).message }) }
    finally { setBusy(null) }
  }

  async function reset() {
    if (!window.confirm('Put every module back in its original order, show them all and clear the featured pick?')) return
    setBusy('reset'); setNotice(null)
    try { setDraft(await resetModuleLayout()); setNotice({ tone: 'ok', text: 'Library order reset to the default.' }) }
    catch (error) { setNotice({ tone: 'error', text: (error as Error).message }) }
    finally { setBusy(null) }
  }

  return <div className="adm-arrange">
    <div className="adm-toolbar">
      <div className="adm-toolbar-stats">
        <span><b>{shownCount}</b> shown</span>
        <span><b>{hidden.size}</b> hidden</span>
        <span><Star size={13} aria-hidden/> {byId.get(featuredId)?.title}</span>
        {saved.updatedAt && <span className="adm-muted">Published {new Date(saved.updatedAt).toLocaleString()}</span>}
      </div>
      <button type="button" className="adm-btn adm-btn-ghost" onClick={() => void reset()} disabled={busy !== null}>{busy === 'reset' ? <LoaderCircle className="spin" size={15}/> : <RotateCcw size={15} aria-hidden/>} Reset to default</button>
    </div>

    <p className="adm-help">Drag a module by its handle, or focus the handle and use the arrow keys (Home and End jump to the ends). The order here is the order of the homepage grid and the sidebar; the star picks the featured module at the top of the homepage.</p>

    <ol ref={listRef} className={`adm-arrange-list${dragging ? ' is-dragging' : ''}`} aria-label="Module order">
      {draft.order.map((id, index) => {
        const item = byId.get(id)!
        const isHidden = hidden.has(id)
        return <li key={id} data-id={id} className={`${dragging === id ? 'is-lifted' : ''}${isHidden ? ' is-hidden' : ''}`}>
          <button type="button" id={`arrange-handle-${id}`} className="adm-handle" aria-label={`Move ${item.title}, position ${index + 1} of ${draft.order.length}`} aria-describedby="arrange-help"
            onPointerDown={event => onPointerDown(event, id)} onPointerMove={event => onPointerMove(event, id)} onPointerUp={() => onPointerUp(id)} onPointerCancel={() => onPointerUp(id)} onKeyDown={event => onHandleKey(event, id, index)}>
            <GripVertical size={18} aria-hidden/>
          </button>
          <span className="adm-rank" aria-hidden>{index + 1}</span>
          <img src={item.image} alt="" loading="lazy"/>
          <span className="adm-arrange-meta">
            <strong>{item.title}{featuredId === id && <em className="adm-pill adm-pill-accent">Featured</em>}{isHidden && <em className="adm-pill">Hidden</em>}</strong>
            <small>{item.subject === item.group ? item.subject : `${item.subject} · ${item.group}`}</small>
          </span>
          <span className="adm-arrange-actions">
            <button type="button" className="adm-icon" onClick={() => reorder(id, 0)} disabled={index === 0} title="Move to top" aria-label={`Move ${item.title} to the top`}><ChevronsUp size={16} aria-hidden/></button>
            <button type="button" className="adm-icon" onClick={() => reorder(id, index - 1)} disabled={index === 0} title="Move up" aria-label={`Move ${item.title} up`}><ArrowUp size={16} aria-hidden/></button>
            <button type="button" className="adm-icon" onClick={() => reorder(id, index + 1)} disabled={index === draft.order.length - 1} title="Move down" aria-label={`Move ${item.title} down`}><ArrowDown size={16} aria-hidden/></button>
            <button type="button" className={`adm-icon${featuredId === id ? ' is-on' : ''}`} onClick={() => setDraft(current => ({ ...current, featured: id }))} disabled={isHidden} aria-pressed={featuredId === id} title="Feature on the homepage" aria-label={`Feature ${item.title} on the homepage`}><Star size={16} aria-hidden/></button>
            <button type="button" className={`adm-icon${isHidden ? ' is-off' : ''}`} onClick={() => toggleHidden(id)} aria-pressed={!isHidden} title={isHidden ? 'Show in the library' : 'Hide from the library'} aria-label={isHidden ? `Show ${item.title} in the library` : `Hide ${item.title} from the library`}>{isHidden ? <EyeOff size={16} aria-hidden/> : <Eye size={16} aria-hidden/>}</button>
          </span>
        </li>
      })}
    </ol>
    <p id="arrange-help" className="adm-sr">Use the arrow keys to move this module.</p>
    <p className="adm-sr" aria-live="polite">{announce}</p>

    <div className={`adm-savebar${dirty ? ' is-dirty' : ''}`} role="region" aria-label="Save changes">
      <span>{dirty ? 'You have unpublished changes to the library order.' : notice?.tone === 'ok' ? notice.text : 'The library order is up to date.'}</span>
      <div>
        <button type="button" className="adm-btn adm-btn-ghost" onClick={() => setDraft(saved)} disabled={!dirty || busy !== null}>Discard</button>
        <button type="button" className="adm-btn adm-btn-primary" onClick={() => void save()} disabled={!dirty || busy !== null}>{busy === 'save' ? <><LoaderCircle className="spin" size={15}/> Publishing…</> : 'Publish order'}</button>
      </div>
    </div>
    {notice?.tone === 'error' && <p role="alert" className="adm-error">{notice.text}</p>}
  </div>
}
