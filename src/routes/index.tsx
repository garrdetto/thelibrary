import { PoolAccount } from '@/components/PoolAccount'
import { WorkspaceAdmin } from '@/components/WorkspaceAdmin'
import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { ArrowDown, ArrowRight, ArrowUp, Bookmark, Check, ChevronDown, CircleDot, Flag, Cloud, Copy, Download, Feather, Image, Info, LoaderCircle, Menu, MessageCircle, Music2, AudioLines, Plus, Redo2, RefreshCcw, Shuffle, Sparkles, Undo2, WandSparkles, X } from 'lucide-react'
import { isSiteTheme, siteThemes } from '@/lib/site-themes'
import type { SiteTheme } from '@/lib/site-themes'
import { PoolTable } from '@/components/PoolTable'
import { usePoolLobby } from '@/components/PoolLobby'
import { InvitePopups } from '@/components/SitePresence'
import { Streamdown } from 'streamdown'
import type { Creation, LyricCorrection, LyricPreset, Message, SongSettings, StudioMode } from '@/lib/studio-types'

export const Route = createFileRoute('/')({ component: Studio })

const Racing = lazy(() => import('@/components/Racing').then(module => ({ default: module.Racing })))
const ParkGame = lazy(() => import('@/components/park/ParkGame').then(module => ({ default: module.ParkGame })))

const defaultSettings: SongSettings = { genre: 'Indie pop', customGenre: '', artist: '', explicit: true, vibe: 'Dreamy & atmospheric', mood: 'Bittersweet', pitch: 'Mid-range', style: 'Conversational & intimate', instruments: 'Soft piano, warm bass, brushed drums', structure: 'Verse / Chorus / Verse / Chorus / Bridge / Chorus', instructions: '' }
const navigation = [
  { id: 'chat', label: 'AI chat', icon: MessageCircle },
  { id: 'image', label: 'Image studio', icon: Image },
  { id: 'lyrics', label: 'Lyric studio', icon: Music2 },
  { id: 'pool', label: '8BallPool', icon: CircleDot },
  { id: 'racing', label: 'Racing', icon: Flag },
  { id: 'park', label: 'Thrill Park', icon: Sparkles },
] as const

const genreOptions = ['Indie pop', 'Pop', 'Pop-punk', 'Rap', 'Old school rap', 'Trap', 'Drill', 'Boyband pop', 'R&B / Soul', 'Hip-hop', 'Emo', 'Punk rock', 'Metal', 'Grunge', 'Country', 'Folk', 'Alternative rock', 'Indie rock', 'Electronic', 'EDM', 'Reggaeton', 'Afrobeats', 'K-pop', 'Funk', 'Blues', 'Jazz', 'Gospel']

async function requestApi(url: string, body?: unknown, method = body ? 'POST' : 'GET') {
  const response = await fetch(url, body ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { method })
  const result = await response.json().catch(() => ({ error: response.status === 429 ? 'Please slow down and try again in a moment.' : 'The cloud service could not be reached. Please try again shortly.' }))
  if (!response.ok) throw new Error(result.error || 'Something went wrong. Please try again.')
  return result
}

function BrandMark({ small = false }: { small?: boolean }) {
  return <span className={`brand-mark ${small ? 'small' : ''}`} aria-hidden="true"><svg viewBox="0 0 40 40" fill="none"><path d="M6.5 28v-8.5M6.5 21.5c0-3.2 5-3.2 5 0V28M11.5 21.5c0-3.2 5-3.2 5 0V28" stroke="currentColor" strokeOpacity=".55" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"/><path d="M19.5 12 23 28l3.5-11L30 28l3.5-16" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"/></svg></span>
}

function Studio() {
  const [view, setView] = useState<StudioMode | 'pool' | 'racing' | 'park' | 'home' | 'admin'>('home')
  const [access, setAccess] = useState<{ username: string | null; isAdmin: boolean; pages: string[]; settings: { theme?: string } }>({ username: null, isAdmin: false, pages: [], settings: {} })
  const [accountReady, setAccountReady] = useState(false)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [presets, setPresets] = useState<LyricPreset[]>([])
  const [presetName, setPresetName] = useState('')
  const [presetBusy, setPresetBusy] = useState(false)
  const [presetNotice, setPresetNotice] = useState('')
  const [current, setCurrent] = useState<Creation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [settings, setSettings] = useState<SongSettings>(defaultSettings)
  const [aspect, setAspect] = useState('1:1')
  const [format, setFormat] = useState('png')
  const [copied, setCopied] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [theme, setTheme] = useState<SiteTheme>('gray')
  const [selection, setSelection] = useState<{ start: number; end: number; original: string } | null>(null)
  const [replacement, setReplacement] = useState('')
  const [teach, setTeach] = useState(false)
  const [corrections, setCorrections] = useState<LyricCorrection[]>([])
  const [revamp, setRevamp] = useState('')
  const [styleDirection, setStyleDirection] = useState('')
  const [styleCopied, setStyleCopied] = useState(false)
  const [busyAction, setBusyAction] = useState('')
  const [laterVersions, setLaterVersions] = useState<Creation[]>([])
  const lyricsRef = useRef<HTMLTextAreaElement>(null)
  const [revision, setRevision] = useState('')
  const [downloading, setDownloading] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const [raceJoinRequest, setRaceJoinRequest] = useState(0)
  const lobby = usePoolLobby(access.username, accountReady, view === 'pool' ? 'pool' : view === 'racing' ? 'racing' : 'site')
  const matchId = lobby.match?.id

  useEffect(() => {
    if (!matchId) return
    setView('pool')
    setMobileOpen(false)
    window.history.replaceState(null, '', window.location.pathname)
  }, [matchId])

  function joinRaceInvite() {
    if (lobby.match) lobby.leave()
    setRaceJoinRequest(value => value + 1)
    setView('racing')
    setMobileOpen(false)
    window.history.replaceState(null, '', '#racing')
  }

  useEffect(() => {
    const savedTheme = document.documentElement.dataset.theme
    if (isSiteTheme(savedTheme)) setTheme(savedTheme)
    if (window.location.hash === '#racing') setView('racing')
    if (window.location.hash === '#park') setView('park')
  }, [])

  useEffect(() => {
    let active = true
    async function refreshAccess() {
      try {
        const result = await requestApi('/api/workspace-access')
        if (active) {
          setAccess(result); setAccountReady(true)
          const savedTheme = result.settings?.theme
          if (isSiteTheme(savedTheme) && savedTheme !== document.documentElement.dataset.theme) applyTheme(savedTheme, false)
        }
      } catch (failure) {
        if (active) { setAccess({ username: null, isAdmin: false, pages: [], settings: {} }); setAccountReady(true); setError(failure instanceof Error ? failure.message : 'Account access is unavailable.') }
      }
    }
    void refreshAccess()
    const refresh = () => { void refreshAccess() }
    window.addEventListener('focus', refresh)
    return () => { active = false; window.removeEventListener('focus', refresh) }
  }, [])
  useEffect(() => {
    if (['chat', 'image', 'lyrics'].includes(view) && !access.pages.includes(view) || view === 'admin' && !access.isAdmin) {
      setView('home'); setCurrent(null); setMessages([]); setInput('')
    }
    if (!access.pages.includes('lyrics')) { setCorrections([]); setPresets([]) }
  }, [access, view])
  useEffect(() => {
    if (!access.pages.includes('lyrics')) return
    requestApi('/api/learning').then(result => setCorrections(result.items)).catch(() => {})
    requestApi('/api/lyric-presets').then(result => setPresets(result.items)).catch(() => {})
  }, [access])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [messages, busy])
  useEffect(() => {
    if (!helpOpen && !mobileOpen) return
    const previousFocus = document.activeElement as HTMLElement | null
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') { setHelpOpen(false); setMobileOpen(false) }
      if (event.key !== 'Tab' || !helpOpen) return
      const controls = document.querySelectorAll<HTMLButtonElement>('.about-modal button')
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', handleKey)
    return () => { document.removeEventListener('keydown', handleKey); previousFocus?.focus() }
  }, [helpOpen, mobileOpen])

  function applyTheme(next: SiteTheme, save: boolean) {
    setTheme(next)
    document.documentElement.dataset.theme = next
    document.cookie = `vv_theme=${next}; Path=/; SameSite=Lax; Max-Age=31536000${window.location.protocol === 'https:' ? '; Secure' : ''}`
    if (save && access.username) void fetch('/api/account-settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ theme: next }) }).catch(() => undefined)
  }

  function switchView(next: StudioMode | 'pool' | 'racing' | 'park' | 'home' | 'admin') {
    if (busy || ['chat', 'image', 'lyrics'].includes(next) && !access.pages.includes(next) || next === 'admin' && !access.isAdmin) return
    if (lobby.match && next !== 'pool') lobby.leave()
    setSelection(null)
    setView(next)
    window.history.replaceState(null, '', next === 'racing' ? '#racing' : next === 'park' ? '#park' : window.location.pathname)
    setCurrent(null)
    setMessages([])
    setInput('')
    setError('')
    setRevision('')
    setRevamp('')
    setStyleDirection('')
    setLaterVersions([])
    setMobileOpen(false)
  }

  async function generate(event?: FormEvent, action: 'new' | 'revise' | 'revamp' = 'new') {
    event?.preventDefault()
    const prompt = action === 'revise' ? revision.trim() : action === 'revamp' ? revamp.trim() || 'A fresh take that fits the current settings.' : input.trim()
    if (!prompt || busy || view === 'pool' || view === 'racing' || view === 'park' || view === 'home' || view === 'admin') return
    setBusy(true)
    setBusyAction(action)
    setError('')
    const oldMessages = messages
    if (view === 'chat') { setMessages([...messages, { role: 'user', content: prompt }]); setInput('') }
    try {
      const result = await requestApi('/api/studio', { kind: view, prompt, action, aspect, ...(current ? { previousId: current.id } : {}), ...(view === 'lyrics' ? { settings } : {}) })
      setSelection(null)
      setCurrent(result.item)
      setMessages(result.item.messages)
      setRevision('')
      setLaterVersions([])
      if (action === 'revamp') setRevamp('')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Please try again.')
      if (view === 'chat') { setMessages(oldMessages); setInput(prompt) }
    } finally { setBusy(false); setBusyAction('') }
  }

  async function generateStylePrompt(event: FormEvent) {
    event.preventDefault()
    if (!current || busy) return
    setBusy(true)
    setBusyAction('style')
    setError('')
    try {
      const result = await requestApi('/api/studio', { kind: 'lyrics', action: 'style', prompt: styleDirection.trim() || 'Match the song as written.', previousId: current.id })
      setCurrent(result.item)
      setLaterVersions((items) => items.map((item) => item.id === result.item.id ? result.item : item))
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not create the style prompt.') }
    finally { setBusy(false); setBusyAction('') }
  }

  async function copyStylePrompt() {
    if (!current?.stylePrompt) return
    try { await navigator.clipboard.writeText(current.stylePrompt); setStyleCopied(true); setTimeout(() => setStyleCopied(false), 2000) }
    catch { setError('Clipboard access is unavailable. Select the style prompt and copy it manually.') }
  }

  async function showPreviousVersion() {
    if (!current?.parentId || busy) return
    setBusy(true)
    setBusyAction('history')
    setError('')
    try {
      const parent = (await requestApi(`/api/library?id=${current.parentId}`)).item
      setLaterVersions((items) => [current, ...items])
      setCurrent(parent)
      setSelection(null)
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'The previous version could not be opened.') }
    finally { setBusy(false); setBusyAction('') }
  }

  function showNextVersion() {
    const [next, ...rest] = laterVersions
    if (!next || busy) return
    setCurrent(next)
    setLaterVersions(rest)
    setSelection(null)
  }

  function forgetPrompts() {
    if (busy) return
    setCurrent(null)
    setInput('')
    setRevision('')
    setRevamp('')
    setStyleDirection('')
    setSelection(null)
    setLaterVersions([])
    setSettings((value) => ({ ...value, customGenre: '', artist: '' }))
    setError('')
  }

  async function clearLearning(id?: string) {
    if (busy) return
    try {
      await requestApi(id ? `/api/learning?id=${id}` : '/api/learning', undefined, 'DELETE')
      setCorrections((items) => id ? items.filter((item) => item.id !== id) : [])
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not clear learning.') }
  }

  async function savePreset() {
    const name = presetName.trim()
    if (!name || presetBusy) return
    setPresetBusy(true); setPresetNotice(''); setError('')
    try {
      const result = await requestApi('/api/lyric-presets', { name, settings })
      setPresets(items => [result.item, ...items.filter(item => item.id !== result.item.id)])
      setPresetNotice(`Saved “${result.item.name}”.`)
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not save this style.') }
    finally { setPresetBusy(false) }
  }

  function applyPreset(preset: LyricPreset) {
    if (busy) return
    setSettings({ ...defaultSettings, ...preset.settings })
    setPresetName(preset.name)
    setPresetNotice(`Loaded “${preset.name}”.`)
  }

  async function deletePreset(preset: LyricPreset) {
    if (presetBusy || !window.confirm(`Delete the saved style “${preset.name}”?`)) return
    setPresetBusy(true); setPresetNotice(''); setError('')
    try {
      await requestApi(`/api/lyric-presets?id=${preset.id}`, undefined, 'DELETE')
      setPresets(items => items.filter(item => item.id !== preset.id))
      setPresetNotice(`Deleted “${preset.name}”.`)
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not delete this style.') }
    finally { setPresetBusy(false) }
  }

  function captureSelection() {
    const field = lyricsRef.current
    if (!field || busy || field.selectionStart === field.selectionEnd) return
    const start = field.selectionStart
    const end = field.selectionEnd
    setSelection({ start, end, original: field.value.slice(start, end) })
    setReplacement(field.value.slice(start, end))
    setTeach(false)
  }

  async function applyEdit(event: FormEvent) {
    event.preventDefault()
    if (!selection || !current || busy || !replacement.trim()) return
    setBusy(true)
    setError('')
    try {
      const result = await requestApi('/api/studio', { kind: 'lyrics', action: 'edit', prompt: 'Manual lyric correction', previousId: current.id, teach, selection: { ...selection, replacement } })
      setCurrent(result.item)
      setLaterVersions([])
      if (result.correction) setCorrections((items) => [result.correction, ...items].slice(0, 30))
      setSelection(null)
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not save the edit.') }
    finally { setBusy(false) }
  }

  function suggest(next: StudioMode, prompt: string) {
    switchView(next)
    setInput(prompt)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  async function copyLyrics() {
    if (!current) return
    try { await navigator.clipboard.writeText(current.content); setCopied(true); setTimeout(() => setCopied(false), 2000) }
    catch { setError('Clipboard access is unavailable. Select the lyrics and copy them manually.') }
  }

  function saveFile(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  async function downloadImage() {
    if (!current || downloading) return
    setDownloading(true)
    setError('')
    try {
      const response = await fetch(`/api/asset?id=${current.id}`)
      if (!response.ok) throw new Error('The image could not be downloaded. Please try again.')
      const bitmap = await createImageBitmap(await response.blob())
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Image conversion is unavailable in this browser.')
      if (format === 'jpg') { context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height) }
      context.drawImage(bitmap, 0, 0)
      bitmap.close()
      const mime = format === 'jpg' ? 'image/jpeg' : `image/${format}`
      const converted = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, 0.94))
      if (!converted || converted.type !== mime) throw new Error('Your browser does not support this format. Please choose PNG.')
      saveFile(converted, `myworkhelper-${current.id.slice(0, 8)}.${format}`)
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Download failed.') }
    finally { setDownloading(false) }
  }

  const activeLabel = view === 'home' ? 'Your account' : view === 'admin' ? 'Admin' : navigation.find((item) => item.id === view)?.label

  return <div className="studio-shell">
    {mobileOpen && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
    <aside className={`sidebar ${mobileOpen ? 'is-open' : ''}`}>
      <a className="brand" href="/" aria-label="myWorkHelper home"><BrandMark /><span><span className="brand-name"><em>my</em>WorkHelper</span><small>A SPACE FOR YOUR IDEAS</small></span></a>
      {access.pages.length > 0 && <button className="new-session" onClick={() => switchView(access.pages[0] as StudioMode)} disabled={busy}><Plus size={17} /> New creation <span>↗</span></button>}
      <p className="nav-caption">YOUR WORKSPACE</p>
      <nav aria-label="Studio navigation">
        {navigation.filter(item => item.id === 'pool' || item.id === 'racing' || item.id === 'park' || access.pages.includes(item.id)).map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${view === id ? 'active' : ''}`} onClick={() => switchView(id)} disabled={busy}><Icon size={19} strokeWidth={1.7}/><span>{label}</span>{view === id && <span className="active-dot" />}{id === 'lyrics' && <span className="new-tag">NEW</span>}</button>)}
        <div className="nav-divider" /><button className={`nav-item ${view === 'home' ? 'active' : ''}`} onClick={() => switchView('home')}>Account / Login</button>
      </nav>
      <div className="sidebar-bottom"><div className="creative-note"><span className="tiny-star">✳</span><strong>Made for your imagination.</strong><p>A thought, a picture, a melody.<br/>See where it takes you.</p></div><button className="help-link" onClick={() => setHelpOpen(true)}><Info size={16}/> About your studio <ArrowRight size={14}/></button><div className="workspace-profile"><span className="profile-icon"><Feather size={18}/></span><div>Personal workspace<small>Your own creative corner</small></div></div></div>
    </aside>

    <main className="main-panel">
      <header className="topbar"><div className="breadcrumb"><button className="mobile-menu" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu size={20}/></button><span>Workspace</span><span className="breadcrumb-slash">/</span><strong>{activeLabel}</strong></div><label className="theme-picker"><span>Theme</span><select aria-label="Site color theme" value={theme} onChange={(event) => { const next = event.target.value; if (isSiteTheme(next)) applyTheme(next, true) }}>{siteThemes.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label><div className="cloud-badge"><span/><Cloud size={14}/> Cloud-powered</div>{access.isAdmin && <button className="admin-top-button" onClick={() => switchView('admin')} disabled={busy}>Admin</button>}</header>
      <div className={`workspace-content ${view === 'chat' ? 'chat-content' : view === 'racing' ? 'racing-content' : view === 'park' ? 'park-content' : view === 'pool' ? 'pool-content' : ''}`}>
        {error && <div className="error-banner" role="alert"><Info size={18}/><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error"><X size={16}/></button></div>}

        {view === 'home' && <section className="account-home"><div className="home-confetti" aria-hidden="true"><span/><span/><span/><span/><span/><span/></div><PoolAccount intro="Sign in or create an account with any username and a 3-digit password. No email needed. Your settings and customizations follow your account." username={access.username} ready={accountReady} disabled={false} beforeChange={async () => {}} onFailure={() => {}}/><span className="section-eyebrow home-eyebrow"><Sparkles size={14}/> WELCOME TO MYWORKHELPER</span><h1>Rack 'em up.<br/><em>Rev it up. Have fun.</em></h1><div className="account-game-links"><button className="game-launch game-launch-pool" onClick={() => switchView('pool')}><span className="game-launch-art" aria-hidden="true"><i className="launch-ball launch-ball-eight">8</i><i className="launch-ball launch-ball-one">1</i><i className="launch-ball launch-ball-cue"/></span><span className="game-launch-text"><small>8-ball · 9-ball · multiplayer</small><strong>Play Pool</strong></span><ArrowRight className="game-launch-arrow" size={30}/></button><button className="game-launch game-launch-racing" onClick={() => switchView('racing')}><span className="game-launch-art" aria-hidden="true"><i className="launch-flag"/><i className="launch-car"><b/></i><i className="launch-speed"/></span><span className="game-launch-text"><small>Laps · records · speed</small><strong>Play Racing</strong></span><ArrowRight className="game-launch-arrow" size={30}/></button><button className="game-launch game-launch-park" onClick={() => switchView('park')}><span className="game-launch-art" aria-hidden="true"><i className="launch-track"/><i className="launch-cart"/></span><span className="game-launch-text"><small>Build · coasters · co-op</small><strong>Play Thrill Park</strong></span><ArrowRight className="game-launch-arrow" size={30}/></button></div></section>}
        {view === 'admin' && access.isAdmin && <WorkspaceAdmin/>}
        {view === 'pool' && <PoolTable lobby={lobby}/>}
        {view === 'park' && <Suspense fallback={<p className="race-loading" role="status"><LoaderCircle className="spin" size={18}/> Opening the park gates…</p>}><ParkGame username={access.username} accountReady={accountReady}/></Suspense>}
        {view === 'racing' && <Suspense fallback={<p className="race-loading" role="status"><LoaderCircle className="spin" size={18}/> Loading the race track…</p>}><Racing players={lobby.players} playerName={lobby.name} joinRequest={raceJoinRequest} onJoinHandled={() => setRaceJoinRequest(0)}/></Suspense>}
        {view === 'chat' && <>
          {!messages.length ? <div className="welcome">
            <div className="welcome-eyebrow"><span className="eyebrow-line"/> A LITTLE SPACE TO MAKE SOMETHING <span className="eyebrow-line"/></div>
            <h1>Good ideas start<br/>with a <span className="thought-word">little thought.<svg viewBox="0 0 280 18" preserveAspectRatio="none" aria-hidden="true"><path d="M3 12Q110 1 275 9M20 16Q150 7 258 13"/></svg></span></h1>
            <p className="welcome-subtitle">Think out loud. Create something visual. Find the right words.<br/>Your creative companion, all in one place.</p>
            <div className="suggestion-grid">
              <button className="suggestion-card card-think" onClick={() => suggest('chat', 'Help me brainstorm a fresh creative project I can start this weekend.')}><div className="card-art thought-art"><span className="art-orbit orbit-one"/><span className="art-orbit orbit-two"/><span className="art-orbit orbit-three"/><span className="orbit-spark">✳</span><span className="small-spark">+</span></div><div className="card-label"><MessageCircle size={16}/><span>A fresh perspective</span><ArrowRight size={16}/></div><p>Turn a spark into your next big idea.</p></button>
              {access.pages.includes('image') && <button className="suggestion-card card-picture" onClick={() => suggest('image', 'A minimal botanical illustration of an olive branch on warm cream paper, muted sage green, simple and elegant.')}><div className="card-art picture-art"><div className="art-print print-back"/><div className="art-print print-front"><span className="art-sun"/><span className="art-hill hill-back"/><span className="art-hill hill-front"/></div><span className="picture-spark">✧</span></div><div className="card-label"><Image size={16}/><span>Picture the possibility</span><ArrowRight size={16}/></div><p>A few words. An entirely new visual.</p></button>}
              {access.pages.includes('lyrics') && <button className="suggestion-card card-song" onClick={() => suggest('lyrics', 'A bittersweet song about outgrowing your hometown but still feeling its pull.')}><div className="card-art song-art"><span className="music-staff"/><span className="note note-one">♪</span><span className="note note-two">♫</span><span className="note note-three">♪</span><span className="song-spark">✳</span></div><div className="card-label"><Music2 size={16}/><span>Find your next verse</span><ArrowRight size={16}/></div><p>Real feelings. Words that sound like you.</p></button>}
            </div>
            <div className="starter-hint"><Sparkles size={14}/><span>No perfect prompt needed. Just start with what’s on your mind.</span></div>
          </div> : <div className="conversation" aria-live="polite">{messages.map((message, index) => <div key={index} className={`message ${message.role}`}><div className="message-avatar">{message.role === 'assistant' ? <BrandMark small/> : <Feather size={18}/>}</div><div className="message-body"><span className="message-author">{message.role === 'assistant' ? 'myWorkHelper' : 'You'}</span><Streamdown>{message.content}</Streamdown></div></div>)}{busy && <div className="thinking"><BrandMark small/><span className="thinking-dots"><i/><i/><i/></span><span>Connecting the dots…</span></div>}<div ref={bottomRef}/></div>}
          <div className="composer-zone"><form className="chat-composer" onSubmit={generate}><textarea ref={inputRef} value={input} onChange={(event) => setInput(event.target.value)} placeholder="What’s on your mind? Let’s make something of it." aria-label="Chat message" rows={2} maxLength={4000} disabled={busy} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void generate() } }}/><div className="composer-toolbar"><div className="composer-tools"><span className="composer-mode"><MessageCircle size={14}/> Chat</span>{access.pages.includes('image') && <button type="button" onClick={() => suggest('image', input)} disabled={busy}><Image size={15}/> Create image</button>}{access.pages.includes('lyrics') && <button type="button" onClick={() => suggest('lyrics', input)} disabled={busy}><Music2 size={15}/> Write lyrics</button>}</div><button className="send-button" type="submit" aria-label="Send message" disabled={!input.trim() || busy}>{busy ? <LoaderCircle className="spin" size={18}/> : <ArrowUp size={20}/>}</button></div></form><div className="composer-footnote"><span><Cloud size={12}/> Your ideas, powered by the cloud.</span><span>AI can make mistakes. Keep your own perspective.</span></div></div>
        </>}

        {view === 'lyrics' && <div className="feature-page"><div className="feature-heading"><div className="section-eyebrow"><Music2 size={15}/> THE LYRIC STUDIO</div><h1>Find the words.<br/><em>Keep the feeling.</em></h1><p>Original lyrics with a story to tell. Your sound, your way.</p></div><div className="lyric-layout"><form className="settings-panel" onSubmit={generate}><div className="panel-heading"><span className="number-tag">01</span><h2>Shape your song</h2><span className="panel-caption">THE BRIEF</span></div><label className="field-label" htmlFor="song-topic">What’s the story?<span>The feeling, moment, or idea at its heart.</span></label><textarea ref={inputRef} id="song-topic" className="brief-textarea" rows={4} placeholder="Leaving a familiar place behind, but carrying a little of it with you…" value={input} onChange={(event) => setInput(event.target.value)} required maxLength={4000} disabled={busy}/><div className="saved-styles"><div className="field-label">Saved styles<span>Load your go-to settings and instructions, or save the current ones under a name.</span></div>{presets.length > 0 && <div className="preset-list">{presets.map((preset) => <span key={preset.id} className="preset-chip"><button type="button" onClick={() => applyPreset(preset)} disabled={busy || presetBusy}><Bookmark size={12}/> {preset.name}</button><button type="button" aria-label={`Delete saved style ${preset.name}`} onClick={() => void deletePreset(preset)} disabled={busy || presetBusy}><X size={12}/></button></span>)}</div>}<div className="preset-save"><input className="text-field" aria-label="Saved style name" value={presetName} maxLength={60} placeholder="Name this style…" onChange={(event) => { setPresetName(event.target.value); setPresetNotice('') }} disabled={busy || presetBusy}/><button type="button" className="secondary-button" onClick={() => void savePreset()} disabled={busy || presetBusy || !presetName.trim()}>{presetBusy ? <LoaderCircle size={14} className="spin"/> : <Bookmark size={14}/>} Save style</button></div>{presetNotice && <p className="fresh-note" role="status">{presetNotice}</p>}</div><MultiSelectField disabled={busy} label="Genre" value={settings.genre} allowEmpty={Boolean(settings.customGenre?.trim())} options={genreOptions} onChange={(genre) => setSettings({ ...settings, genre })}/><label className="field-label" htmlFor="custom-genre">Custom genre<span>Optional. Type any genre and it gets researched and blended in.</span></label><input id="custom-genre" className="text-field" value={settings.customGenre || ''} maxLength={120} placeholder="Midwest emo, phonk, 2000s crunk…" disabled={busy} onChange={(event) => { const customGenre = event.target.value; setSettings({ ...settings, customGenre, genre: settings.genre || (customGenre.trim() ? '' : defaultSettings.genre) }) }}/><label className="field-label" htmlFor="artist-influence">Artist influence<span>Optional. Their style, flow and attitude get researched. Their actual lyrics never get copied.</span></label><input id="artist-influence" className="text-field" value={settings.artist || ''} maxLength={120} placeholder="Eminem, Paramore, Backstreet Boys…" disabled={busy} onChange={(event) => setSettings({ ...settings, artist: event.target.value })}/><label className="toggle-field"><input type="checkbox" checked={settings.explicit !== false} onChange={(event) => setSettings({ ...settings, explicit: event.target.checked })} disabled={busy}/><span><strong>Explicit & unfiltered</strong><small>Swearing allowed. Savage, unhinged and blunt, but still makes sense.</small></span></label><div className="settings-grid"><SelectField label="Mood" value={settings.mood} options={['Bittersweet', 'Hopeful', 'Melancholic', 'Joyful', 'Romantic', 'Defiant', 'Reflective', 'Heartbroken', 'Savage', 'Unhinged', 'Cocky', 'Petty', 'Angry']} onChange={(mood) => setSettings({ ...settings, mood })}/><MultiSelectField disabled={busy} label="Vibe" value={settings.vibe} options={['Dreamy & atmospheric', 'Warm & nostalgic', 'Raw & stripped back', 'Dark & cinematic', 'Bright & energetic', 'Laid-back & mellow', 'Aggressive & hard-hitting', 'Chaotic & unhinged', 'Gritty & street', 'Playful & cheeky']} onChange={(vibe) => setSettings({ ...settings, vibe })}/><SelectField label="Vocal pitch" value={settings.pitch} options={['Mid-range', 'Low / baritone', 'Low / alto', 'High / tenor', 'High / soprano', 'Flexible range']} onChange={(pitch) => setSettings({ ...settings, pitch })}/></div><MultiSelectField disabled={busy} label="Writing style" value={settings.style} options={['Conversational & intimate', 'Story-driven & vivid', 'Poetic & understated', 'Direct & honest', 'Rhythmic & expressive', 'Savage & unfiltered', 'Braggadocious', 'Storytelling bars']} onChange={(style) => setSettings({ ...settings, style })}/><label className="field-label" htmlFor="instruments">Instruments & production</label><input id="instruments" className="text-field" value={settings.instruments} maxLength={250} required onChange={(event) => setSettings({ ...settings, instruments: event.target.value })}/><SelectField label="Song structure" value={settings.structure} options={['Verse / Chorus / Verse / Chorus / Bridge / Chorus', 'Verse / Pre-chorus / Chorus / Verse / Chorus / Bridge / Chorus', 'Verse / Chorus / Verse / Chorus', 'Verse / Verse / Bridge / Verse', 'Verse / Hook / Verse / Hook / Verse / Hook', 'Verse / Pre-chorus / Chorus / Verse / Pre-chorus / Chorus / Bridge / Chorus']} onChange={(structure) => setSettings({ ...settings, structure })}/><label className="field-label" htmlFor="style-instructions">Your style instructions<span>Optional. Standing directions like perspective, slang, themes to avoid or how hooks should land. Saved with your styles.</span></label><textarea id="style-instructions" className="brief-textarea" rows={3} maxLength={2000} value={settings.instructions || ''} placeholder="Always first person, Midwest slang, no love songs, short punchy hooks…" disabled={busy} onChange={(event) => setSettings({ ...settings, instructions: event.target.value })}/><div className="song-rule"><Check size={15}/><span>Your prompt is ideas, not lines. Plain talk, no clichés, no intro lyrics.</span></div><button className="primary-button" type="submit" disabled={busy || !input.trim()}>{busyAction === 'new' ? <LoaderCircle size={17} className="spin"/> : <WandSparkles size={17}/>} {busyAction === 'new' ? 'Finding your words…' : current ? 'Write a brand-new song' : 'Generate lyrics'}<ArrowRight size={16}/></button>{current && <p className="fresh-note">A new song starts from scratch — not a remix.</p>}{(current || input.trim() || revision.trim() || revamp.trim()) && <><button type="button" className="ghost-button" onClick={forgetPrompts} disabled={busy}><RefreshCcw size={14}/> Forget previous prompts</button><p className="fresh-note">Clears the brief, the open song and its fine-tune memory. Saved styles and learned corrections stay.</p></>}</form><section className="song-output"><div className="panel-heading"><span className="number-tag">02</span><h2>Your lyrics</h2>{current && <span className="saved-label"><Check size={12}/> Saved</span>}</div>{current ? <><div className="song-title-row"><div><span className="section-eyebrow">{[current.settings?.genre, current.settings?.customGenre].filter(Boolean).join(' | ')} · {current.settings?.mood}{current.settings?.artist ? ` · inspired by ${current.settings.artist}` : ''}</span><h3>{current.title}</h3></div><div className="output-actions"><button title="Previous version" aria-label="Show previous version" onClick={showPreviousVersion} disabled={busy || !current.parentId}>{busyAction === 'history' ? <LoaderCircle size={17} className="spin"/> : <Undo2 size={17}/>}</button><button title="Next version" aria-label="Show next version" onClick={showNextVersion} disabled={busy || !laterVersions.length}><Redo2 size={17}/></button><button title="Copy lyrics" aria-label="Copy lyrics" onClick={copyLyrics}>{copied ? <Check size={17}/> : <Copy size={17}/>}</button><button title="Download lyrics" aria-label="Download lyrics as text" onClick={() => saveFile(new Blob([`${current.title}\n\n${current.content}`], { type: 'text/plain' }), 'myworkhelper-lyrics.txt')}><Download size={17}/></button></div></div><p className="selection-hint">Highlight any words or lines to replace them exactly. Keyboard: hold Shift and use the arrow keys.</p><textarea ref={lyricsRef} className="lyrics-text lyrics-selectable" aria-label="Generated lyrics; select text to edit" readOnly value={current.content} onSelect={captureSelection} disabled={busy} />{selection && <form className="revision-box inline-editor" onSubmit={applyEdit}><label htmlFor="lyric-replacement">Rewrite the highlighted text</label><blockquote>{selection.original}</blockquote><textarea id="lyric-replacement" value={replacement} onChange={(event) => setReplacement(event.target.value)} rows={4} maxLength={20000} disabled={busy} required/><label className="teach-option"><input type="checkbox" checked={teach} onChange={(event) => setTeach(event.target.checked)} disabled={busy}/> Teach AI from this mistake</label><p>Your words replace only this selection. Checked corrections are saved and guide every future song until you clear learning.</p><div className="edit-actions"><button className="secondary-button" type="submit" disabled={busy || !replacement.trim()}>{busy ? 'Saving…' : 'Save replacement'}</button><button type="button" onClick={() => setSelection(null)} disabled={busy}>Cancel</button></div></form>}<form className="revision-box" onSubmit={(event) => generate(event, 'revise')}><label htmlFor="revision">A little fine-tuning?</label><p className="box-hint">Small, targeted fixes like rhymes, syllables or a weak word. Everything else stays, and earlier fine-tunes are remembered.</p>{current.tuning.length > 0 && <ol className="tuning-list" aria-label="Remembered fine-tunes">{current.tuning.map((note, index) => <li key={`${index}-${note}`}>{note}</li>)}</ol>}<textarea id="revision" placeholder="Fix the rhyme at the end of verse 2…" value={revision} onChange={(event) => setRevision(event.target.value)} rows={2} maxLength={4000} disabled={busy}/><button className="secondary-button" disabled={busy || !revision.trim()} type="submit">{busyAction === 'revise' ? <LoaderCircle size={14} className="spin"/> : <WandSparkles size={14}/>} {busyAction === 'revise' ? 'Fine-tuning…' : 'Apply fine-tune'}</button></form><form className="revision-box" onSubmit={(event) => generate(event, 'revamp')}><label htmlFor="revamp">Revamp the whole song</label><p className="box-hint">Rewrites every line with a new sound, same story. It uses your current settings, so change the genre, vibe, mood or artist on the left first.</p><textarea id="revamp" placeholder="Make it a cocky old school rap track with a petty attitude…" value={revamp} onChange={(event) => setRevamp(event.target.value)} rows={2} maxLength={4000} disabled={busy}/><button className="secondary-button" disabled={busy} type="submit">{busyAction === 'revamp' ? <LoaderCircle size={14} className="spin"/> : <Shuffle size={14}/>} {busyAction === 'revamp' ? 'Revamping…' : 'Revamp entire song'}</button></form><form className="revision-box style-prompt-box" onSubmit={generateStylePrompt}><label htmlFor="style-direction">Suno style prompt</label><p className="box-hint">A ready-to-paste “Style of Music” description of the voice, pitch, instruments, sound and vibe for this version. Artist names are left out because Suno rejects them.</p><textarea id="style-direction" placeholder="Optional: female vocals, around 90 BPM, heavier 808s…" value={styleDirection} onChange={(event) => setStyleDirection(event.target.value)} rows={2} maxLength={4000} disabled={busy}/><button className="secondary-button" disabled={busy} type="submit">{busyAction === 'style' ? <LoaderCircle size={14} className="spin"/> : <AudioLines size={14}/>} {busyAction === 'style' ? 'Describing the sound…' : current.stylePrompt ? 'Regenerate style prompt' : 'Generate style prompt'}</button>{current.stylePrompt && <div className="style-prompt-output"><textarea readOnly aria-label="Suno style prompt" value={current.stylePrompt} rows={5}/><div><span>{current.stylePrompt.length} characters</span><button type="button" className="secondary-button" onClick={copyStylePrompt}>{styleCopied ? <Check size={14}/> : <Copy size={14}/>} {styleCopied ? 'Copied' : 'Copy for Suno'}</button></div></div>}</form></> : busy ? <div className="output-skeleton" aria-live="polite"><LoaderCircle size={26} className="spin"/><h3>A story is taking shape.</h3><p>Writing, refining, and checking your song’s structure.</p><span/><span/><span/></div> : <div className="output-empty"><div className="empty-song-art"><Music2 size={42} strokeWidth={1}/><span>♪</span></div><h3>Every song starts<br/>with something real.</h3><p>Give us the feeling.<br/>We’ll help you find the words.</p><div className="example-cues">[intro]<br/>[soft piano enters]<br/>[verse 1]</div><small>Clean sections. Thoughtful cues.<br/>Ready for your next step.</small></div>}{corrections.length > 0 && <details className="session-learning"><summary>{corrections.length} learned correction{corrections.length === 1 ? '' : 's'} guiding your songs</summary><ul>{corrections.map((item) => <li key={item.id}><span><s>{item.original}</s> → {item.replacement}</span><button type="button" onClick={() => clearLearning(item.id)} disabled={busy} aria-label="Forget this correction"><X size={13}/></button></li>)}</ul><button type="button" className="clear-learning" onClick={() => clearLearning()} disabled={busy}>Clear all learning</button></details>}</section></div></div>}

        {view === 'image' && <div className="feature-page image-page"><div className="feature-heading"><div className="section-eyebrow"><Image size={15}/> THE IMAGE STUDIO</div><h1>A picture, from<br/><em>a little possibility.</em></h1><p>Describe what you see in your mind. Make it something you can keep.</p></div><div className="image-layout"><form className="settings-panel" onSubmit={generate}><div className="panel-heading"><span className="number-tag">01</span><h2>Paint the picture</h2></div><label className="field-label" htmlFor="image-prompt">What would you like to create?<span>A subject, a style, a few details. Simple is good.</span></label><textarea ref={inputRef} className="brief-textarea" id="image-prompt" rows={6} value={input} onChange={(event) => setInput(event.target.value)} maxLength={4000} required disabled={busy} placeholder="A simple line drawing of a wildflower, muted sage green on cream paper, a calm botanical feel…"/><div className="field-label">A place to start</div><div className="prompt-chips">{['Botanical illustration', 'Minimal landscape', 'Simple icon'].map((label) => <button type="button" key={label} disabled={busy} onClick={() => setInput(`Create a ${label.toLowerCase()}, simple shapes, muted natural colors, warm cream background, no text.`)}>{label}<Plus size={12}/></button>)}</div><SelectField label="Canvas shape" value={aspect} options={['1:1', '16:9', '9:16']} labels={['Square · 1:1', 'Landscape · 16:9', 'Portrait · 9:16']} onChange={setAspect}/><SelectField label="Download format" value={format} options={['png', 'jpg', 'webp']} labels={['PNG · crisp & lossless', 'JPG · small & shareable', 'WebP · lightweight']} onChange={setFormat}/><button className="primary-button" type="submit" disabled={busy || !input.trim()}>{busy ? <LoaderCircle className="spin" size={17}/> : <WandSparkles size={17}/>} {busy ? 'Bringing it to life…' : 'Generate image'}<ArrowRight size={16}/></button><p className="fresh-note">Images can take a little longer. Good things do.</p></form><section className="image-output"><div className="panel-heading"><span className="number-tag">02</span><h2>Your vision</h2>{current && <span className="saved-label"><Check size={12}/> Saved</span>}</div>{busy ? <div className="output-skeleton"><LoaderCircle className="spin" size={28}/><h3>Making space for your vision.</h3><p>Your image is being created in the cloud.</p><span/><span/><span/></div> : current ? <><div className="generated-image"><img src={`/api/asset?id=${current.id}`} alt={current.prompt}/></div><form className="revision-box" onSubmit={(event) => generate(event, 'revise')}><label htmlFor="image-revision">Modify this image</label><textarea id="image-revision" value={revision} onChange={(event) => setRevision(event.target.value)} placeholder="Make the background warmer, remove the text, add a wildflower…" rows={3} maxLength={4000} disabled={busy}/><button className="secondary-button" type="submit" disabled={busy || !revision.trim()}><WandSparkles size={14}/> Apply image changes</button></form><div className="image-output-footer"><p>{current.title}</p><button className="secondary-button" onClick={downloadImage} disabled={downloading}>{downloading ? <LoaderCircle className="spin" size={15}/> : <ArrowDown size={15}/>} Download .{format}</button></div></> : <div className="output-empty"><div className="large-picture-art"><div className="art-print print-front"><span className="art-sun"/><span className="art-hill hill-back"/><span className="art-hill hill-front"/></div></div><h3>From a few words<br/>to a whole new world.</h3><p>Your image appears here.<br/>Download it in the format that fits.</p><div className="format-tags"><span>.PNG</span><span>.JPG</span><span>.WEBP</span></div></div>}</section></div></div>}

      </div>
    </main>
    <InvitePopups lobby={lobby} onJoinRace={joinRaceInvite}/>
    {helpOpen && <div className="modal-backdrop" onClick={() => setHelpOpen(false)}><section className="about-modal" role="dialog" aria-modal="true" aria-labelledby="about-title" onClick={(event) => event.stopPropagation()}><button autoFocus className="modal-close" aria-label="Close about" onClick={() => setHelpOpen(false)}><X size={20}/></button><BrandMark/><h2 id="about-title">Your own creative corner.</h2><p>myWorkHelper brings chat, image generation, and original songwriting into one cloud-powered studio.</p><p>AI requests run on the server, so you never need to visit an AI provider’s website. Chat uses model knowledge, not live web search or your cloud documents.</p><p>Sign in with a username and a 3-digit password to keep your game settings, records, saved lyric styles and studio access on any device. Creations aren’t kept in a library; download anything you want to keep.</p><p>Lyrics are guided toward plain, natural language and coherent storytelling, with bracketed sections and instrumental-only intros. Your prompts are treated as ideas, not lines to copy. Artist and custom-genre styles are researched with web search when available, otherwise from model knowledge, and real lyrics are never reused. AI quality can vary; review and refine the result. Vocal pitch is a writing direction, not generated audio.</p><button className="primary-button" onClick={() => setHelpOpen(false)}>Back to creating <ArrowRight size={16}/></button></section></div>}
  </div>
}

function SelectField({ label, value, options, labels, onChange }: { label: string; value: string; options: string[]; labels?: string[]; onChange: (value: string) => void }) {
  return <label className="select-field"><span>{label}</span><div><select value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option, index) => <option key={option} value={option}>{labels?.[index] || option}</option>)}</select><ChevronDown size={14}/></div></label>
}

function MultiSelectField({ label, value, options, onChange, disabled, allowEmpty = false }: { label: string; value: string; options: string[]; onChange: (value: string) => void; disabled: boolean; allowEmpty?: boolean }) {
  const selected = value ? value.split(' | ') : []
  return <fieldset className="multi-select" disabled={disabled}><legend>{label}<small>Choose one or more</small></legend><div>{options.map((option) => <label key={option} className={selected.includes(option) ? 'selected' : ''}><input type="checkbox" checked={selected.includes(option)} onChange={() => { const next = selected.includes(option) ? selected.filter((item) => item !== option) : [...selected, option]; if (next.length || allowEmpty) onChange(next.join(' | ')) }}/>{option}</label>)}</div></fieldset>
}
