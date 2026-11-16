import { useEffect, useRef, useState } from 'react'
import { History, X } from 'lucide-react'
import type { WorldEditRevision, WorldEditState } from '../../lib/world-edits-client'
import { deleteRevision, restoreRevision, snapshotDraft, unpublishEdits } from '../../lib/world-edits-client'

interface Props {
  state: WorldEditState | null
  onState: (state: WorldEditState, loadEdits: boolean) => void
  onClose: () => void
  unsaved: boolean
}

/** Saved versions of the edits: keep a named copy, restore an older one into the draft, take the published edits down. */
export function Revisions({ state, onState, onClose, unsaved }: Props) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dialog = useRef<HTMLDivElement>(null)
  useEffect(() => {
    dialog.current?.focus()
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])

  async function run(fn: () => Promise<WorldEditState>, load: boolean) {
    setBusy(true)
    setError('')
    try {
      onState(await fn(), load)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    } finally {
      setBusy(false)
    }
  }

  const list: WorldEditRevision[] = state?.revisions ?? []
  return <div className="we-modal" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
    <div className="we-dialog" role="dialog" aria-modal="true" aria-labelledby="we-rev-title" tabIndex={-1} ref={dialog}>
      <header><h2 id="we-rev-title"><History size={18} aria-hidden /> Versions</h2><button type="button" className="we-icon" aria-label="Close" onClick={onClose}><X size={16} /></button></header>
      <p className="we-hint">The draft saves itself as you work. Keep a named copy before big changes; restoring an older version puts it in the draft (the current draft stays in the list).</p>
      <div className="we-row">
        <input type="text" value={note} maxLength={120} placeholder="Name this version (e.g. Before the new river)" aria-label="Version name" onChange={(e) => setNote(e.target.value)} />
        <button type="button" className="we-btn is-primary" disabled={busy || !note.trim() || !state?.draftRev || unsaved} title={unsaved ? 'Wait for the draft to save' : undefined} onClick={() => run(() => snapshotDraft(note.trim()), false).then(() => setNote(''))}>Keep this version</button>
      </div>
      {error && <p className="we-warn" role="alert">{error}</p>}
      <ul className="we-revs">
        {list.map((r) => <li key={r.id}>
          <div>
            <strong>{r.note || (r.draft ? 'Working draft' : 'Untitled version')}</strong>
            <small>{new Date(r.updatedAt).toLocaleString()} · {r.ops} edit{r.ops === 1 ? '' : 's'} · {r.bytes < 1024 ? `${r.bytes} bytes` : `${(r.bytes / 1024).toFixed(r.bytes < 10240 ? 1 : 0)} KB`} · {r.author}</small>
          </div>
          <span className="we-tags">{r.published && <em className="is-live">Live</em>}{r.draft && <em>Draft</em>}{r.kept && !r.published && <em>Kept</em>}</span>
          <div className="we-row">
            {!r.draft && <button type="button" className="we-btn small" disabled={busy} onClick={() => { if (!unsaved || confirm('Your latest changes have not saved yet. Restore anyway?')) run(() => restoreRevision(r.id), true) }}>Restore</button>}
            {!r.draft && !r.published && <button type="button" className="we-btn small danger" disabled={busy} onClick={() => { if (confirm('Delete this version for good?')) run(() => deleteRevision(r.id), false) }}>Delete</button>}
          </div>
        </li>)}
        {!list.length && <li><span className="we-hint">Nothing saved yet.</span></li>}
      </ul>
      {state?.publishedRev && <div className="we-callout">
        <strong>Take the edits off Life Sim</strong>
        <p>Everyone gets the plain surveyed map on their next visit. The versions stay here.</p>
        <button type="button" className="we-btn danger" disabled={busy} onClick={() => { if (confirm('Take the published edits off Life Sim?')) run(unpublishEdits, false) }}>Unpublish</button>
      </div>}
    </div>
  </div>
}
