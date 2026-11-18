import { useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { ArrowLeft, EyeOff, ListMusic, Radar, ShieldCheck, Sparkles } from 'lucide-react'
import { MODULE_PREFIX, MUSIC_GRANT, MUSIC_TRACK_PREFIX, RADAR_GRANT, moduleGrants, musicTrackGrants, studioGrants } from '@/lib/access'
import { formatTrackTime } from '@/lib/music'
import type { MusicTrack } from '@/lib/music'
import { learningModules } from '@/lib/modules'
import { useModuleLayout } from '@/lib/use-module-layout'

export type Account = { id: string; username: string; pages: string[]; grants: string[]; radar: boolean; isAdmin: boolean; isOwner: boolean; needsPassword: boolean; createdAt: number }

const studioLabels: Record<(typeof studioGrants)[number], string> = { chat: 'AI chat', image: 'Image studio', lyrics: 'Lyric studio', voice: 'Voice generator' }
const moduleTitles = new Map<string, string>(learningModules.map(item => [item.id, item.title]))

function startingGrants(account: Account) {
  const list = [...(account.isAdmin ? [] : account.pages), ...account.grants]
  if (account.radar && !account.isOwner && !list.includes(RADAR_GRANT)) list.push(RADAR_GRANT)
  return [...new Set(list)]
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every(item => b.includes(item))

function Group({ icon, title, help, children }: { icon: ReactNode; title: string; help: ReactNode; children: ReactNode }) {
  return <fieldset className="adm-access-group">
    <legend><span aria-hidden>{icon}</span>{title}</legend>
    <p className="adm-access-help">{help}</p>
    {children}
  </fieldset>
}

function Toggle({ checked, disabled, label, detail, onChange }: { checked: boolean; disabled?: boolean; label: string; detail?: string; onChange: (value: boolean) => void }) {
  return <label className="adm-toggle">
    <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)}/>
    <span className="adm-toggle-track" aria-hidden/>
    <span className="adm-toggle-text"><strong>{label}</strong>{detail && <small>{detail}</small>}</span>
  </label>
}

export function PersonAccess({ account, viewerIsOwner, busy, onBack, onSave, onSetAdmin, onResetPassword, onDelete }: {
  account: Account
  viewerIsOwner: boolean
  busy: boolean
  onBack: () => void
  onSave: (username: string, grants: string[]) => void
  onSetAdmin: (admin: boolean) => void
  onResetPassword: () => void
  onDelete: () => void
}) {
  const initial = useMemo(() => startingGrants(account), [account])
  const [username, setUsername] = useState(account.username)
  const [grants, setGrants] = useState<string[]>(initial)
  const [tracks, setTracks] = useState<MusicTrack[] | null>(null)
  const [tracksError, setTracksError] = useState('')
  const [chooseTracks, setChooseTracks] = useState(musicTrackGrants(initial).length > 0)
  const layout = useModuleLayout()
  const locked = account.isAdmin && !viewerIsOwner
  const dirty = username.trim().toLowerCase() !== account.username || !sameSet(grants, initial)
  const has = (grant: string) => grants.includes(grant)
  const set = (grant: string, on: boolean) => setGrants(current => on ? [...new Set([...current, grant])] : current.filter(item => item !== grant))

  useEffect(() => {
    let active = true
    fetch('/api/music?admin=1', { headers: { Accept: 'application/json' } })
      .then(async response => {
        const result = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(result.error ?? 'The music list is unavailable right now.')
        if (active) setTracks(result.tracks ?? [])
      })
      .catch(failure => { if (active) { setTracks([]); setTracksError(failure instanceof Error ? failure.message : 'The music list is unavailable right now.') } })
    return () => { active = false }
  }, [])

  const pickedTracks = musicTrackGrants(grants)
  const hiddenModules = useMemo(() => {
    const ids = new Set<string>([...(layout.hidden as string[]), ...moduleGrants(grants)])
    return [...ids].filter(id => moduleTitles.has(id)).sort((a, b) => moduleTitles.get(a)!.localeCompare(moduleTitles.get(b)!))
  }, [layout.hidden, grants])

  function setChoose(value: boolean) {
    setChooseTracks(value)
    if (!value) setGrants(current => current.filter(item => !item.startsWith(MUSIC_TRACK_PREFIX)))
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const cleaned = has(MUSIC_GRANT) ? grants : grants.filter(item => !item.startsWith(MUSIC_TRACK_PREFIX))
    onSave(username.trim(), cleaned)
  }

  const roleLabel = account.isOwner ? 'Owner' : account.isAdmin ? 'Administrator' : 'Member'

  return <form className="adm-person" onSubmit={submit}>
    <div className="adm-person-head">
      <button type="button" className="adm-btn adm-btn-ghost" onClick={onBack}><ArrowLeft size={16} aria-hidden/> Everyone</button>
      <span className="adm-person-avatar is-large" aria-hidden>{account.username.slice(0, 1).toUpperCase()}</span>
      <div>
        <h2>{account.username}</h2>
        <p>{roleLabel} · joined {new Date(account.createdAt).toLocaleDateString()}{account.needsPassword ? ' · password reset waiting for next sign-in' : ''}</p>
      </div>
    </div>

    {locked && <p className="adm-help">Only the owner can change {account.isOwner ? 'the owner account' : 'another administrator'}.</p>}

    <fieldset className="adm-access-groups" disabled={locked || busy}>
      <Group icon={<ShieldCheck size={16}/>} title="Account" help={account.isOwner ? 'You sign in with the owner password whatever the username is.' : 'Usernames are 3–20 letters, numbers, underscores or hyphens.'}>
        <label className="adm-field">Username<input value={username} minLength={3} maxLength={20} pattern="[a-zA-Z0-9_\-]{3,20}" required onChange={event => setUsername(event.target.value)}/></label>
      </Group>

      <Group icon={<Sparkles size={16}/>} title="Studios" help={account.isAdmin ? 'Administrators have every studio.' : 'Each studio uses Gemini or ElevenLabs on the site’s account.'}>
        <div className="adm-check-grid">{studioGrants.map(page => <label key={page} className="adm-check">
          <input type="checkbox" checked={account.isAdmin || has(page)} disabled={account.isAdmin} onChange={event => set(page, event.target.checked)}/>{studioLabels[page]}
        </label>)}</div>
      </Group>

      <Group icon={<Radar size={16}/>} title="Axiom Radar" help={account.isOwner ? 'The Radar is yours. It is always on for the owner.' : viewerIsOwner ? 'Lets this person watch the Radar. Only you can pin coins, change its settings or control the bot.' : 'Only the owner can share the Radar.'}>
        <Toggle checked={account.isOwner || has(RADAR_GRANT)} disabled={account.isOwner || !viewerIsOwner} label={account.isOwner || has(RADAR_GRANT) ? 'Can open the Axiom Radar' : 'No access'} onChange={value => set(RADAR_GRANT, value)}/>
      </Group>

      <Group icon={<ListMusic size={16}/>} title="Music player" help="A player in the bottom-left corner that keeps playing as they move around the site. It starts on its own once their browser allows sound, usually after their first click.">
        <Toggle checked={has(MUSIC_GRANT)} label={has(MUSIC_GRANT) ? 'Music player on' : 'Music player off'} detail={has(MUSIC_GRANT) ? (chooseTracks && pickedTracks.length ? `${pickedTracks.length} chosen track${pickedTracks.length === 1 ? '' : 's'}` : 'Every track, in playlist order') : undefined} onChange={value => set(MUSIC_GRANT, value)}/>
        {has(MUSIC_GRANT) && <div className="adm-music-choice">
          <div className="adm-segment" role="group" aria-label="Which tracks">
            <button type="button" aria-pressed={!chooseTracks} className={!chooseTracks ? 'is-active' : ''} onClick={() => setChoose(false)}>Every track</button>
            <button type="button" aria-pressed={chooseTracks} className={chooseTracks ? 'is-active' : ''} onClick={() => setChoose(true)}>Choose tracks</button>
          </div>
          {chooseTracks && (tracks === null ? <p role="status" className="adm-muted">Loading tracks…</p>
            : tracksError ? <p role="alert" className="adm-error">{tracksError}</p>
            : !tracks.length ? <p className="adm-muted">No tracks yet. Upload some in Music player.</p>
            : <>
              <ul className="adm-track-picks">{tracks.map(track => <li key={track.id}><label className="adm-check">
                <input type="checkbox" checked={pickedTracks.includes(track.id)} onChange={event => set(`${MUSIC_TRACK_PREFIX}${track.id}`, event.target.checked)}/>
                <span>{track.title}{track.artist && <small> · {track.artist}</small>}</span><small className="adm-track-time">{formatTrackTime(track.duration)}</small>
              </label></li>)}</ul>
              {!pickedTracks.length && <p className="adm-muted">Nothing picked yet, so they’ll hear every track.</p>}
            </>)}
        </div>}
      </Group>

      <Group icon={<EyeOff size={16}/>} title="Hidden modules" help={account.isAdmin ? 'Administrators can open every module.' : 'Modules you hid in Module order stay hidden from everyone except the people you tick here.'}>
        {account.isAdmin ? null : hiddenModules.length ? <div className="adm-check-grid">{hiddenModules.map(id => <label key={id} className="adm-check">
          <input type="checkbox" checked={has(`${MODULE_PREFIX}${id}`)} onChange={event => set(`${MODULE_PREFIX}${id}`, event.target.checked)}/>
          {moduleTitles.get(id)}{!(layout.hidden as string[]).includes(id) && <small> (visible to everyone now)</small>}
        </label>)}</div> : <p className="adm-muted">Every module is visible to everyone. Hide one in Module order to share it with only certain people.</p>}
      </Group>
    </fieldset>

    <div className="adm-person-actions">
      {!locked && <button className="adm-btn adm-btn-primary" type="submit" disabled={busy || !dirty}>{busy ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}</button>}
      {dirty && !busy && <button type="button" className="adm-btn adm-btn-ghost" onClick={() => { setUsername(account.username); setGrants(initial); setChooseTracks(musicTrackGrants(initial).length > 0) }}>Undo changes</button>}
      {viewerIsOwner && !account.isOwner && <button className="adm-btn" type="button" disabled={busy} onClick={() => onSetAdmin(!account.isAdmin)}>{account.isAdmin ? 'Remove admin' : 'Make admin'}</button>}
      {!locked && !account.isOwner && <button className="adm-btn" type="button" disabled={busy} onClick={onResetPassword}>Reset password</button>}
      {!locked && !account.isOwner && <button className="adm-btn adm-btn-danger" type="button" disabled={busy} onClick={onDelete}>Delete</button>}
    </div>
  </form>
}
