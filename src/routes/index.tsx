import { PoolAccount } from '@/components/PoolAccount'
import { SignInRibbon } from '@/components/SignInRibbon'
import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { ArrowDown, LogOut, ArrowRight, ArrowUp, Bomb, Bookmark, CarFront, Crosshair, Layers, Grid3x3, Bot, Crown, Disc, Gauge, Hash, House, Maximize2, Plane, Trophy, Check, ChevronDown, CircleDot, Flag, Cloud, Copy, Download, Feather, Image, Info, LoaderCircle, Menu, MessageCircle, Music2, AudioLines, Plus, Redo2, RefreshCcw, ScanFace, Shuffle, Sparkles, Undo2, WandSparkles, Wrench, Keyboard, Mic2, PartyPopper, Fish, RollerCoaster, X, Castle, Hand, Cookie, Store, Target } from 'lucide-react'
import { isSiteTheme, toSiteTheme, siteThemes } from '@/lib/site-themes'
import type { SiteTheme } from '@/lib/site-themes'
import { usePoolLobby } from '@/components/PoolLobby'
import { InvitePopups } from '@/components/SitePresence'
import { GroupChat } from '@/components/GroupChat'
import type { ChatInvite, ChatModule, InviteKind } from '@/components/GroupChat'
import { ModuleHub } from '@/components/ModuleHub'
import { LapRecordBoard } from '@/components/LapRecordBoard'
import { FairwayRecordBoard } from '@/components/FairwayRecordBoard'
import { RackReelRecordBoard } from '@/components/RackReelRecordBoard'
import { DartsRecordBoard } from '@/components/DartsRecordBoard'
import { AnglerRecordBoard } from '@/components/AnglerRecordBoard'
import { ModuleScoreboard } from '@/components/ModuleScoreboard'
import { ModuleScoreTabs } from '@/components/ModuleScoreTabs'
import { AdminRecordResetButton, RecordResetProvider } from '@/components/AdminRecordReset'
import { hasScoreBoard, isScoredModule } from '@/lib/module-scores'
import { embeddedModules, isEmbeddedModuleId, isModuleAvailable, learningModules } from '@/lib/modules'
import { useModuleLayout } from '@/lib/use-module-layout'
import { ModuleNav } from '@/components/ModuleNav'
import { ScoreNotices } from '@/components/ScoreNotices'
import type { ModuleId } from '@/lib/modules'
import { Markdown } from '@/components/Markdown'
import type { Creation, LyricCorrection, LyricPreset, Message, SongSettings, StudioMode } from '@/lib/studio-types'

export const Route = createFileRoute('/')({ component: Studio })

const Racing = lazy(() => import('@/components/Racing').then(module => ({ default: module.Racing })))
const ParkGame = lazy(() => import('@/components/park/ParkGame').then(module => ({ default: module.ParkGame })))
const PoolTable = lazy(() => import('@/components/PoolTable').then(module => ({ default: module.PoolTable })))
const AdminPanel = lazy(() => import('@/components/AdminPanel').then(module => ({ default: module.AdminPanel })))
const LensCreator = lazy(() => import('@/components/LensCreator').then(module => ({ default: module.LensCreator })))
const VoiceStudio = lazy(() => import('@/components/VoiceStudio').then(module => ({ default: module.VoiceStudio })))

const defaultSettings: SongSettings = { genre: 'Indie pop', customGenre: '', artist: '', explicit: true, vibe: 'Dreamy & atmospheric', mood: 'Bittersweet', pitch: 'Mid-range', style: 'Conversational & intimate', instruments: 'Soft piano, warm bass, brushed drums', structure: 'Verse / Chorus / Verse / Chorus / Bridge / Chorus', instructions: '' }
const navigation = [
  { id: 'chat', label: 'AI chat', icon: MessageCircle },
  { id: 'image', label: 'Image studio', icon: Image },
  { id: 'lyrics', label: 'Lyric studio', icon: Music2 },
  { id: 'voice', label: 'Voice generator', icon: AudioLines },
] as const
const moduleIcons: Record<ModuleId, typeof Trophy> = { park: Sparkles, park2: RollerCoaster, sandlot3d: Trophy, sandlot: Trophy, botwreck: Bot, pool: CircleDot, racing: Flag, oval: Gauge, chess: Crown, checkers: Disc, '2048': Hash, helicopter: Plane, shorttrack: Gauge, maplestreet: House, foxlake: House, fairway: Flag, darts: Target, demoderby: CarFront, bushleague: Trophy, alphabet: Keyboard, tetradrop: Layers, bubbles: CircleDot, sudoku: Grid3x3, minesweeper: Bomb, blockhead: Crosshair, songmaker: Mic2, party: PartyPopper, angler: Fish, rackreel: Crosshair, county: Plane, hood: House, lens: ScanFace, foodchain: Fish, keep: Castle, giant: Hand, cookies: Cookie, hotdog: Store, pingpong: CircleDot, proskater: Trophy, recall: Layers }
const inviteKinds: Partial<Record<ModuleId, InviteKind>> = { sandlot: 'room', chess: 'room', checkers: 'room', pool: 'pool', racing: 'link', oval: 'link', shorttrack: 'room', maplestreet: 'room', foxlake: 'room', fairway: 'room', party: 'room', angler: 'room', rackreel: 'room', pingpong: 'room', darts: 'room' }
const activityLabels: Record<string, string> = Object.fromEntries(learningModules.map(item => [item.id, `In ${item.title}`]))
const playLinks = embeddedModules.filter(item => isModuleAvailable(item.id)).map(item => ({ id: item.id, label: item.title, src: item.src }))
type StudioView = StudioMode | 'voice'
type View = StudioView | 'home' | 'admin' | ModuleId
const studioViews: readonly string[] = ['chat', 'image', 'lyrics', 'voice']
const isPlayId = isEmbeddedModuleId
const shortTrackModes = ['time-attack', 'race', 'multiplayer'] as const
const shortTrackModeNames = { 'time-attack': 'Time Attack', race: 'Solo Race', multiplayer: 'Online' }
const shortTrackTracks = [{ id: 'prison-v2', name: 'Prison Speedway (0.29 mi)' }, { id: 'shorttrack-v2', name: 'Showdown Bullring (0.5 mi)' }, { id: 'dells-v2', name: 'Dells Short Track (0.3 mi)' }, { id: 'dellswide-v2', name: 'Dells Wide Oval (0.27 mi)' }, { id: 'dirt-v2', name: 'Dells Dirt Oval (0.3 mi)' }] as const
const shortTrackArchive = { label: 'Classic', note: 'Laps set on the classic vehicle physics. This book is read-only.', trackOf: (track: string) => track.replace(/-v2$/, '') }

const genreOptions = ['Indie pop', 'Pop', 'Pop-punk', 'Rap', 'Old school rap', 'Trap', 'Drill', 'Boyband pop', 'R&B / Soul', 'Hip-hop', 'Emo', 'Punk rock', 'Metal', 'Grunge', 'Country', 'Folk', 'Alternative rock', 'Indie rock', 'Electronic', 'EDM', 'Reggaeton', 'Afrobeats', 'K-pop', 'Funk', 'Blues', 'Jazz', 'Gospel']

async function requestApi(url: string, body?: unknown, method = body ? 'POST' : 'GET') {
  const response = await fetch(url, body ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { method })
  const result = await response.json().catch(() => ({ error: response.status === 429 ? 'Please slow down and try again in a moment.' : 'The cloud service could not be reached. Please try again shortly.' }))
  if (!response.ok) throw new Error(result.error || 'Something went wrong. Please try again.')
  return result
}

function BrandMark({ small = false }: { small?: boolean }) {
  return <span className={`brand-mark ${small ? 'small' : ''}`} aria-hidden="true"><svg viewBox="0 0 40 40" fill="none"><path d="M8 11.5c4.2-1.6 8.3-1.2 12 1.6v16.4c-3.7-2.8-7.8-3.2-12-1.6V11.5Z" stroke="currentColor" strokeOpacity=".55" strokeWidth="2.1" strokeLinejoin="round"/><path d="M32 11.5c-4.2-1.6-8.3-1.2-12 1.6v16.4c3.7-2.8 7.8-3.2 12-1.6V11.5Z" stroke="currentColor" strokeWidth="2.3" strokeLinejoin="round"/><path d="M24 17v7h4" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"/></svg></span>
}

function Studio() {
  const moduleLayout = useModuleLayout()
  const [view, setView] = useState<View>('home')
  const [access, setAccess] = useState<{ username: string | null; isAdmin: boolean; pages: string[]; settings: { theme?: string } }>({ username: null, isAdmin: false, pages: [], settings: {} })
  const [accountReady, setAccountReady] = useState(false)
  const [playRoom, setPlayRoom] = useState<string | null>(null)
  const [devPlay, setDevPlay] = useState(false)
  const playFrame = useRef<HTMLIFrameElement>(null)
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
  const [theme, setTheme] = useState<SiteTheme>('midnight')
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
  const lobby = usePoolLobby(access.username, accountReady, view === 'pool' ? 'pool' : view === 'racing' || view === 'oval' ? 'racing' : 'site')
  const matchId = lobby.match?.id

  useEffect(() => {
    if (!matchId) return
    setView('pool')
    setMobileOpen(false)
    window.history.replaceState(null, '', window.location.pathname)
  }, [matchId])

  function joinRaceInvite(track: 'circuit' | 'oval') {
    if (lobby.match) lobby.leave()
    setRaceJoinRequest(value => value + 1)
    setView(track === 'oval' ? 'oval' : 'racing')
    setMobileOpen(false)
    window.history.replaceState(null, '', track === 'oval' ? '#oval' : '#racing')
  }

  useEffect(() => {
    const savedTheme = document.documentElement.dataset.theme
    if (isSiteTheme(savedTheme)) setTheme(savedTheme)
    if (window.location.hash === '#racing') setView('racing')
    if (window.location.hash === '#oval') setView('oval')
    if (window.location.hash === '#park') setView('park')
    if (window.location.hash === '#park2') setView('park2')
    if (window.location.hash === '#lens') setView('lens')
    const playHash = window.location.hash.replace(/^#module-/, '').replace(/^foxplains2$/, 'foxlake')
    if (window.location.hash.startsWith('#module-') && isPlayId(playHash)) setView(playHash)
  }, [])

  useEffect(() => {
    let active = true
    async function refreshAccess() {
      try {
        const result = await requestApi('/api/workspace-access')
        if (active) {
          setAccess(result); setAccountReady(true)
          const savedTheme = toSiteTheme(result.settings?.theme)
          if (savedTheme && savedTheme !== document.documentElement.dataset.theme) applyTheme(savedTheme, false)
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
    if (!accountReady || !access.isAdmin || !window.location.hash.startsWith('#admin')) return
    const adminHash = window.location.hash.replace(/^#admin\/?/, '')
    setView(adminHash === 'chat' || adminHash === 'image' || adminHash === 'lyrics' || adminHash === 'voice' ? (access.pages.includes(adminHash) ? adminHash : 'admin') : 'admin')
  }, [accountReady, access.isAdmin])
  useEffect(() => {
    if (studioViews.includes(view) && !access.pages.includes(view) || view === 'admin' && !access.isAdmin) {
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

  const chatModule: ChatModule | null = (() => {
    const item = learningModules.find(entry => entry.id === view)
    return item ? { id: item.id, label: item.title, invite: inviteKinds[item.id] ?? null } : null
  })()

  function requestRoom() {
    return new Promise<string | null>(resolve => {
      const target = playFrame.current?.contentWindow
      if (!target) { resolve(null); return }
      const finish = (code: string | null) => { window.removeEventListener('message', listen); clearTimeout(timer); resolve(code) }
      const listen = (event: MessageEvent) => {
        if (event.origin === window.location.origin && event.source === target && event.data?.type === 'tl-room' && typeof event.data.code === 'string') finish(event.data.code)
      }
      window.addEventListener('message', listen)
      const timer = setTimeout(() => finish(null), 15000)
      target.postMessage({ type: 'tl-host' }, window.location.origin)
    })
  }

  async function signOut() {
    await fetch('/api/pool-account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'logout' }) }).catch(() => undefined)
    window.location.reload()
  }

  function joinChatInvite(invite: ChatInvite) {
    const id = invite.module
    if (!isModuleAvailable(id) || !learningModules.some(item => item.id === id)) return
    switchView(id as ModuleId)
    if (invite.code && isPlayId(id)) setPlayRoom(invite.code)
  }

  function switchView(next: View) {
    if (!isModuleAvailable(next) || busy || studioViews.includes(next) && !access.pages.includes(next) || next === 'admin' && !access.isAdmin) return
    if (lobby.match && next !== 'pool') lobby.leave()
    setSelection(null)
    setPlayRoom(null)
    setDevPlay(false)
    setView(next)
    window.history.replaceState(null, '', access.isAdmin && studioViews.includes(next) ? `#admin/${next}` : next === 'racing' ? '#racing' : next === 'oval' ? '#oval' : next === 'park' ? '#park' : next === 'park2' ? '#park2' : next === 'lens' ? '#lens' : isPlayId(next) ? `#module-${next}` : window.location.pathname)
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
    if (!prompt || busy || view === 'voice' || view === 'pool' || view === 'racing' || view === 'oval' || view === 'park' || view === 'park2' || view === 'lens' || view === 'home' || view === 'admin' || isPlayId(view)) return
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
      const blob = await response.blob()
      const vector = blob.type === 'image/svg+xml'
      if (format === 'svg') {
        if (!vector) throw new Error('This picture was not drawn as a vector, so it can’t be saved as SVG. Choose PNG.')
        saveFile(blob, `myworkhelper-${current.id.slice(0, 8)}.svg`)
        return
      }
      let source: CanvasImageSource
      let width: number
      let height: number
      if (vector) {
        const picture = new window.Image()
        picture.src = `/api/asset?id=${current.id}`
        await picture.decode()
        source = picture; width = picture.naturalWidth * 2; height = picture.naturalHeight * 2
      } else {
        const bitmap = await createImageBitmap(blob)
        source = bitmap; width = bitmap.width; height = bitmap.height
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Image conversion is unavailable in this browser.')
      if (format === 'jpg') { context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height) }
      context.drawImage(source, 0, 0, width, height)
      if (source instanceof ImageBitmap) source.close()
      const mime = format === 'jpg' ? 'image/jpeg' : `image/${format}`
      const converted = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, 0.94))
      if (!converted || converted.type !== mime) throw new Error('Your browser does not support this format. Please choose PNG.')
      saveFile(converted, `myworkhelper-${current.id.slice(0, 8)}.${format}`)
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Download failed.') }
    finally { setDownloading(false) }
  }

  const activePlay = playLinks.find(item => item.id === view)
  const devPlayActive = devPlay && access.isAdmin && activePlay?.id === 'maplestreet'
  const playSrc = activePlay ? `${activePlay.src}?${new URLSearchParams({ ...(access.username ? { name: access.username } : {}), ...(devPlayActive ? { dev: '1', solo: '1', panel: '1' } : playRoom ? { room: playRoom } : {}) })}`.replace(/\?$/, '') : ''
  function openDevPanel() {
    if (!devPlayActive) { setDevPlay(true); return }
    playFrame.current?.contentWindow?.postMessage({ type: 'tl-dev-panel' }, window.location.origin)
  }
  const studioView = view === 'chat' || view === 'image' || view === 'lyrics' || view === 'voice'
  const adminStudio = studioView && access.isAdmin
  function openAdminSection(section: string) {
    switchView('admin')
    window.history.replaceState(null, '', `#admin/${section}`)
  }
  function wrapStudio(page: ReactNode) {
    if (!adminStudio || !studioView) return page
    return <Suspense fallback={<p className="race-loading" role="status"><LoaderCircle className="spin" size={18}/> Loading the admin console…</p>}><AdminPanel studio={view} onOpenStudio={id => switchView(id)} onOpenSection={openAdminSection}>{page}</AdminPanel></Suspense>
  }
  const activeLabel = view === 'home' ? 'Module Library' : view === 'admin' || adminStudio ? 'Admin' : activePlay ? activePlay.label : learningModules.find(item => item.id === view)?.title ?? navigation.find((item) => item.id === view)?.label

  return <div className="studio-shell">
    {mobileOpen && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
    <aside className={`sidebar ${mobileOpen ? 'is-open' : ''}`}>
      <a className="brand" href="/" aria-label="the library home"><BrandMark /><span><span className="brand-name"><em>the</em> library</span><small>LEARNING MODULES</small></span></a>
      {!access.isAdmin && access.pages.length > 0 && <button className="new-session" onClick={() => switchView(access.pages[0] as StudioView)} disabled={busy}><Plus size={17} /> New creation <span>↗</span></button>}
      <nav aria-label="Site navigation">
        <button className={`nav-item nav-home ${view === 'home' ? 'active' : ''}`} onClick={() => switchView('home')} disabled={busy}><Sparkles size={19} strokeWidth={1.7}/><span>Module Library</span>{view === 'home' && <span className="active-dot" />}</button>
        {!access.isAdmin && access.pages.length > 0 && <p className="nav-caption nav-caption-play">YOUR WORKSPACE</p>}
        {navigation.filter(item => !access.isAdmin && access.pages.includes(item.id)).map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${view === id ? 'active' : ''}`} onClick={() => switchView(id)} disabled={busy}><Icon size={19} strokeWidth={1.7}/><span>{label}</span>{view === id && <span className="active-dot" />}{id === 'lyrics' && <span className="new-tag">NEW</span>}</button>)}
        <ModuleNav layout={moduleLayout} view={view} busy={busy} icons={moduleIcons} onSelect={id => switchView(id)}/>
        <div className="nav-divider" /><button className={`nav-item ${view === 'home' ? 'active' : ''}`} onClick={() => switchView('home')}>{access.username ? `Signed in as ${access.username}` : 'Sign in'}</button>
      </nav>
      <div className="sidebar-bottom"><div className="creative-note"><span className="tiny-star">✳</span><strong>Learn by doing.</strong><p>Strategy, physics, math<br/>and precision modules.</p></div><button className="help-link" onClick={() => setHelpOpen(true)}><Info size={16}/> About the library <ArrowRight size={14}/></button><div className="workspace-profile"><span className="profile-icon"><Feather size={18}/></span><div>{access.username ?? 'Guest'}<small>{access.username ? 'Progress saves to your account' : 'Sign in to save progress'}</small></div></div></div>
    </aside>

    <main className="main-panel"><RecordResetProvider>
      {accountReady && !access.username && <SignInRibbon/>}
      <header className="topbar"><button className="mobile-menu" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu size={20}/></button><div className="top-welcome"><h1>{access.username ? <>Welcome back, <em>{access.username}</em></> : <>Welcome to <em>the library</em></>}</h1><div className="breadcrumb"><span>the library</span><span className="breadcrumb-slash">/</span><strong>{activeLabel}</strong></div></div><label className="theme-picker"><span>Theme</span><select aria-label="Site color theme" value={theme} onChange={(event) => { const next = event.target.value; if (isSiteTheme(next)) applyTheme(next, true) }}>{siteThemes.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label><div className="cloud-badge"><span/><Cloud size={14}/> Cloud-powered</div>{access.isAdmin && <button className="admin-top-button" onClick={() => switchView('admin')} disabled={busy}>Admin</button>}{accountReady && (access.username ? <button type="button" className="top-account" onClick={() => void signOut()}><LogOut size={14}/> Sign out</button> : view !== 'home' && <button type="button" className="top-account is-signin" onClick={() => switchView('home')}>Sign in</button>)}</header>
      <div className={`workspace-content ${adminStudio ? 'admin-studio-content' : view === 'chat' ? 'chat-content': view === 'racing' || view === 'oval' ? 'racing-content' : view === 'park' || view === 'park2' ? 'park-content' : view === 'lens' ? 'lens-content' : view === 'pool' ? 'pool-content' : activePlay ? `play-content${activePlay.id === 'shorttrack' || activePlay.id === 'fairway' || hasScoreBoard(activePlay.id) ? ' has-board' : ''}` : view === 'home' ? 'hub-content' : ''}`}>
        {accountReady && !access.username && view !== 'pool' && view !== 'racing' && view !== 'oval' && <PoolAccount className="signin-spotlight" heading="Sign in or register" intro="Use any username and a password of 3 or more characters. A new username creates your account; an existing one signs you back in. No email needed, and your progress and settings follow your account." username={null} ready={accountReady} disabled={false} beforeChange={async () => {}} onFailure={() => {}}/>}
        {error && <div className="error-banner" role="alert"><Info size={18}/><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error"><X size={16}/></button></div>}

        {view === 'home' && access.username && <ScoreNotices username={access.username} onOpen={id => switchView(id)}/>}
        {view === 'home' && <ModuleHub username={access.username} onLaunch={id => switchView(id)} account={null} online={null}/>}
        {activePlay && <section className="play-frame" aria-label={activePlay.label}><div className="play-frame-bar"><strong>{activePlay.label}{devPlayActive && <span className="play-dev-tag">Developer instance</span>}</strong><div className="play-frame-actions">{access.isAdmin && activePlay.id === 'maplestreet' && <>{devPlayActive && <button type="button" className="play-dev-exit" onClick={() => setDevPlay(false)}>Exit developer instance</button>}<button type="button" className="play-dev-button" onClick={openDevPanel} aria-pressed={devPlayActive}><Wrench size={14}/> Developer Panel</button></>}<a href={devPlayActive ? `${activePlay.src}?dev=1&solo=1&panel=1` : activePlay.src} target="_blank" rel="noopener"><Maximize2 size={14}/> Open full screen</a></div></div><iframe ref={playFrame} key={`${activePlay.id}:${playRoom ?? ''}:${devPlayActive ? 'dev' : ''}`} src={playSrc} title={activePlay.label} allow="autoplay; fullscreen; gamepad" allowFullScreen/></section>}
        {activePlay?.id === 'shorttrack' && <LapRecordBoard track="prison-v2" trackName="Prison Speedway (0.29 mi)" modes={shortTrackModes} modeNames={shortTrackModeNames} trackOptions={shortTrackTracks} archive={shortTrackArchive}/>}
        {activePlay?.id === 'fairway' && <FairwayRecordBoard/>}
        {activePlay?.id === 'rackreel' && <RackReelRecordBoard/>}
        {activePlay?.id === 'darts' && <DartsRecordBoard/>}
        {activePlay?.id === 'angler' && <AnglerRecordBoard/>}
        {activePlay && isScoredModule(activePlay.id) && <ModuleScoreboard key={activePlay.id} module={activePlay.id} username={access.username}/>}
        {activePlay && !isScoredModule(activePlay.id) && hasScoreBoard(activePlay.id) && <ModuleScoreTabs key={activePlay.id} moduleId={activePlay.id} username={access.username}/>}
        {view === 'admin' && access.isAdmin && <Suspense fallback={<p className="race-loading" role="status"><LoaderCircle className="spin" size={18}/> Loading the admin console…</p>}><AdminPanel onOpenStudio={id => switchView(id)}/></Suspense>}
        {view === 'pool' && <Suspense fallback={<p className="race-loading" role="status"><LoaderCircle className="spin" size={18}/> Racking the balls…</p>}><PoolTable lobby={lobby}/></Suspense>}
        {view === 'park' && <Suspense fallback={<p className="race-loading" role="status"><LoaderCircle className="spin" size={18}/> Opening the park gates…</p>}><ParkGame username={access.username} accountReady={accountReady}/></Suspense>}
        {view === 'park2' && <Suspense fallback={<p className="race-loading" role="status"><LoaderCircle className="spin" size={18}/> Opening the park gates…</p>}><ParkGame key="park2" username={access.username} accountReady={accountReady} edition={2}/></Suspense>}
        {view === 'lens' && <Suspense fallback={<p className="race-loading" role="status"><LoaderCircle className="spin" size={18}/> Loading the lens creator…</p>}><LensCreator/></Suspense>}
        {(view === 'racing' || view === 'oval') && <Suspense fallback={<p className="race-loading" role="status"><LoaderCircle className="spin" size={18}/> Loading the race track…</p>}><Racing key={view} fixedTrack={view === 'oval' ? 'oval' : 'circuit'} players={lobby.players} playerName={lobby.name} joinRequest={raceJoinRequest} onJoinHandled={() => setRaceJoinRequest(0)}/></Suspense>}
        {studioView && wrapStudio(<>{view === 'chat' && <>
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
          </div> : <div className="conversation" aria-live="polite">{messages.map((message, index) => <div key={index} className={`message ${message.role}`}><div className="message-avatar">{message.role === 'assistant' ? <BrandMark small/> : <Feather size={18}/>}</div><div className="message-body"><span className="message-author">{message.role === 'assistant' ? 'the library' : 'You'}</span><Markdown>{message.content}</Markdown></div></div>)}{busy && <div className="thinking"><BrandMark small/><span className="thinking-dots"><i/><i/><i/></span><span>Connecting the dots…</span></div>}<div ref={bottomRef}/></div>}
          <div className="composer-zone"><form className="chat-composer" onSubmit={generate}><textarea ref={inputRef} value={input} onChange={(event) => setInput(event.target.value)} placeholder="What’s on your mind? Let’s make something of it." aria-label="Chat message" rows={2} maxLength={4000} disabled={busy} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void generate() } }}/><div className="composer-toolbar"><div className="composer-tools"><span className="composer-mode"><MessageCircle size={14}/> Chat</span>{access.pages.includes('image') && <button type="button" onClick={() => suggest('image', input)} disabled={busy}><Image size={15}/> Create image</button>}{access.pages.includes('lyrics') && <button type="button" onClick={() => suggest('lyrics', input)} disabled={busy}><Music2 size={15}/> Write lyrics</button>}</div><button className="send-button" type="submit" aria-label="Send message" disabled={!input.trim() || busy}>{busy ? <LoaderCircle className="spin" size={18}/> : <ArrowUp size={20}/>}</button></div></form><div className="composer-footnote"><span><Cloud size={12}/> Your ideas, powered by the cloud.</span><span>AI can make mistakes. Keep your own perspective.</span></div></div>
        </>}

        {view === 'lyrics' && <div className="feature-page"><div className="feature-heading"><div className="section-eyebrow"><Music2 size={15}/> THE LYRIC STUDIO</div><h1>Find the words.<br/><em>Keep the feeling.</em></h1><p>Original lyrics with a story to tell. Your sound, your way.</p></div><div className="lyric-layout"><form className="settings-panel" onSubmit={generate}><div className="panel-heading"><span className="number-tag">01</span><h2>Shape your song</h2><span className="panel-caption">THE BRIEF</span></div><label className="field-label" htmlFor="song-topic">What’s the story?<span>The feeling, moment, or idea at its heart.</span></label><textarea ref={inputRef} id="song-topic" className="brief-textarea" rows={4} placeholder="Leaving a familiar place behind, but carrying a little of it with you…" value={input} onChange={(event) => setInput(event.target.value)} required maxLength={4000} disabled={busy}/><div className="saved-styles"><div className="field-label">Saved styles<span>Load your go-to settings and instructions, or save the current ones under a name.</span></div>{presets.length > 0 && <div className="preset-list">{presets.map((preset) => <span key={preset.id} className="preset-chip"><button type="button" onClick={() => applyPreset(preset)} disabled={busy || presetBusy}><Bookmark size={12}/> {preset.name}</button><button type="button" aria-label={`Delete saved style ${preset.name}`} onClick={() => void deletePreset(preset)} disabled={busy || presetBusy}><X size={12}/></button></span>)}</div>}<div className="preset-save"><input className="text-field" aria-label="Saved style name" value={presetName} maxLength={60} placeholder="Name this style…" onChange={(event) => { setPresetName(event.target.value); setPresetNotice('') }} disabled={busy || presetBusy}/><button type="button" className="secondary-button" onClick={() => void savePreset()} disabled={busy || presetBusy || !presetName.trim()}>{presetBusy ? <LoaderCircle size={14} className="spin"/> : <Bookmark size={14}/>} Save style</button></div>{presetNotice && <p className="fresh-note" role="status">{presetNotice}</p>}</div><MultiSelectField disabled={busy} label="Genre" value={settings.genre} allowEmpty={Boolean(settings.customGenre?.trim())} options={genreOptions} onChange={(genre) => setSettings({ ...settings, genre })}/><label className="field-label" htmlFor="custom-genre">Custom genre<span>Optional. Type any genre and it gets researched and blended in.</span></label><input id="custom-genre" className="text-field" value={settings.customGenre || ''} maxLength={120} placeholder="Midwest emo, phonk, 2000s crunk…" disabled={busy} onChange={(event) => { const customGenre = event.target.value; setSettings({ ...settings, customGenre, genre: settings.genre || (customGenre.trim() ? '' : defaultSettings.genre) }) }}/><label className="field-label" htmlFor="artist-influence">Artist influence<span>Optional. Their style, flow and attitude get researched. Their actual lyrics never get copied.</span></label><input id="artist-influence" className="text-field" value={settings.artist || ''} maxLength={120} placeholder="Eminem, Paramore, Backstreet Boys…" disabled={busy} onChange={(event) => setSettings({ ...settings, artist: event.target.value })}/><label className="toggle-field"><input type="checkbox" checked={settings.explicit !== false} onChange={(event) => setSettings({ ...settings, explicit: event.target.checked })} disabled={busy}/><span><strong>Explicit & unfiltered</strong><small>Swearing allowed. Savage, unhinged and blunt, but still makes sense.</small></span></label><div className="settings-grid"><SelectField label="Mood" value={settings.mood} options={['Bittersweet', 'Hopeful', 'Melancholic', 'Joyful', 'Romantic', 'Defiant', 'Reflective', 'Heartbroken', 'Savage', 'Unhinged', 'Cocky', 'Petty', 'Angry']} onChange={(mood) => setSettings({ ...settings, mood })}/><MultiSelectField disabled={busy} label="Vibe" value={settings.vibe} options={['Dreamy & atmospheric', 'Warm & nostalgic', 'Raw & stripped back', 'Dark & cinematic', 'Bright & energetic', 'Laid-back & mellow', 'Aggressive & hard-hitting', 'Chaotic & unhinged', 'Gritty & street', 'Playful & cheeky']} onChange={(vibe) => setSettings({ ...settings, vibe })}/><SelectField label="Vocal pitch" value={settings.pitch} options={['Mid-range', 'Low / baritone', 'Low / alto', 'High / tenor', 'High / soprano', 'Flexible range']} onChange={(pitch) => setSettings({ ...settings, pitch })}/></div><MultiSelectField disabled={busy} label="Writing style" value={settings.style} options={['Conversational & intimate', 'Story-driven & vivid', 'Poetic & understated', 'Direct & honest', 'Rhythmic & expressive', 'Savage & unfiltered', 'Braggadocious', 'Storytelling bars']} onChange={(style) => setSettings({ ...settings, style })}/><label className="field-label" htmlFor="instruments">Instruments & production</label><input id="instruments" className="text-field" value={settings.instruments} maxLength={250} required onChange={(event) => setSettings({ ...settings, instruments: event.target.value })}/><SelectField label="Song structure" value={settings.structure} options={['Verse / Chorus / Verse / Chorus / Bridge / Chorus', 'Verse / Pre-chorus / Chorus / Verse / Chorus / Bridge / Chorus', 'Verse / Chorus / Verse / Chorus', 'Verse / Verse / Bridge / Verse', 'Verse / Hook / Verse / Hook / Verse / Hook', 'Verse / Pre-chorus / Chorus / Verse / Pre-chorus / Chorus / Bridge / Chorus']} onChange={(structure) => setSettings({ ...settings, structure })}/><label className="field-label" htmlFor="style-instructions">Your style instructions<span>Optional. Standing directions like perspective, slang, themes to avoid or how hooks should land. Saved with your styles.</span></label><textarea id="style-instructions" className="brief-textarea" rows={3} maxLength={2000} value={settings.instructions || ''} placeholder="Always first person, Midwest slang, no love songs, short punchy hooks…" disabled={busy} onChange={(event) => setSettings({ ...settings, instructions: event.target.value })}/><div className="song-rule"><Check size={15}/><span>Your prompt is ideas, not lines. Plain talk, no clichés, no intro lyrics.</span></div><button className="primary-button" type="submit" disabled={busy || !input.trim()}>{busyAction === 'new' ? <LoaderCircle size={17} className="spin"/> : <WandSparkles size={17}/>} {busyAction === 'new' ? 'Finding your words…' : current ? 'Write a brand-new song' : 'Generate lyrics'}<ArrowRight size={16}/></button>{current && <p className="fresh-note">A new song starts from scratch — not a remix.</p>}{(current || input.trim() || revision.trim() || revamp.trim()) && <><button type="button" className="ghost-button" onClick={forgetPrompts} disabled={busy}><RefreshCcw size={14}/> Forget previous prompts</button><p className="fresh-note">Clears the brief, the open song and its fine-tune memory. Saved styles and learned corrections stay.</p></>}</form><section className="song-output"><div className="panel-heading"><span className="number-tag">02</span><h2>Your lyrics</h2>{current && <span className="saved-label"><Check size={12}/> Saved</span>}</div>{current ? <><div className="song-title-row"><div><span className="section-eyebrow">{[current.settings?.genre, current.settings?.customGenre].filter(Boolean).join(' | ')} · {current.settings?.mood}{current.settings?.artist ? ` · inspired by ${current.settings.artist}` : ''}</span><h3>{current.title}</h3></div><div className="output-actions"><button title="Previous version" aria-label="Show previous version" onClick={showPreviousVersion} disabled={busy || !current.parentId}>{busyAction === 'history' ? <LoaderCircle size={17} className="spin"/> : <Undo2 size={17}/>}</button><button title="Next version" aria-label="Show next version" onClick={showNextVersion} disabled={busy || !laterVersions.length}><Redo2 size={17}/></button><button title="Copy lyrics" aria-label="Copy lyrics" onClick={copyLyrics}>{copied ? <Check size={17}/> : <Copy size={17}/>}</button><button title="Download lyrics" aria-label="Download lyrics as text" onClick={() => saveFile(new Blob([`${current.title}\n\n${current.content}`], { type: 'text/plain' }), 'myworkhelper-lyrics.txt')}><Download size={17}/></button></div></div><p className="selection-hint">Highlight any words or lines to replace them exactly. Keyboard: hold Shift and use the arrow keys.</p><textarea ref={lyricsRef} className="lyrics-text lyrics-selectable" aria-label="Generated lyrics; select text to edit" readOnly value={current.content} onSelect={captureSelection} disabled={busy} />{selection && <form className="revision-box inline-editor" onSubmit={applyEdit}><label htmlFor="lyric-replacement">Rewrite the highlighted text</label><blockquote>{selection.original}</blockquote><textarea id="lyric-replacement" value={replacement} onChange={(event) => setReplacement(event.target.value)} rows={4} maxLength={20000} disabled={busy} required/><label className="teach-option"><input type="checkbox" checked={teach} onChange={(event) => setTeach(event.target.checked)} disabled={busy}/> Teach AI from this mistake</label><p>Your words replace only this selection. Checked corrections are saved and guide every future song until you clear learning.</p><div className="edit-actions"><button className="secondary-button" type="submit" disabled={busy || !replacement.trim()}>{busy ? 'Saving…' : 'Save replacement'}</button><button type="button" onClick={() => setSelection(null)} disabled={busy}>Cancel</button></div></form>}<form className="revision-box" onSubmit={(event) => generate(event, 'revise')}><label htmlFor="revision">A little fine-tuning?</label><p className="box-hint">Small, targeted fixes like rhymes, syllables or a weak word. Everything else stays, and earlier fine-tunes are remembered.</p>{current.tuning.length > 0 && <ol className="tuning-list" aria-label="Remembered fine-tunes">{current.tuning.map((note, index) => <li key={`${index}-${note}`}>{note}</li>)}</ol>}<textarea id="revision" placeholder="Fix the rhyme at the end of verse 2…" value={revision} onChange={(event) => setRevision(event.target.value)} rows={2} maxLength={4000} disabled={busy}/><button className="secondary-button" disabled={busy || !revision.trim()} type="submit">{busyAction === 'revise' ? <LoaderCircle size={14} className="spin"/> : <WandSparkles size={14}/>} {busyAction === 'revise' ? 'Fine-tuning…' : 'Apply fine-tune'}</button></form><form className="revision-box" onSubmit={(event) => generate(event, 'revamp')}><label htmlFor="revamp">Revamp the whole song</label><p className="box-hint">Rewrites every line with a new sound, same story. It uses your current settings, so change the genre, vibe, mood or artist on the left first.</p><textarea id="revamp" placeholder="Make it a cocky old school rap track with a petty attitude…" value={revamp} onChange={(event) => setRevamp(event.target.value)} rows={2} maxLength={4000} disabled={busy}/><button className="secondary-button" disabled={busy} type="submit">{busyAction === 'revamp' ? <LoaderCircle size={14} className="spin"/> : <Shuffle size={14}/>} {busyAction === 'revamp' ? 'Revamping…' : 'Revamp entire song'}</button></form><form className="revision-box style-prompt-box" onSubmit={generateStylePrompt}><label htmlFor="style-direction">Suno style prompt</label><p className="box-hint">A ready-to-paste “Style of Music” description of the voice, pitch, instruments, sound and vibe for this version. Artist names are left out because Suno rejects them.</p><textarea id="style-direction" placeholder="Optional: female vocals, around 90 BPM, heavier 808s…" value={styleDirection} onChange={(event) => setStyleDirection(event.target.value)} rows={2} maxLength={4000} disabled={busy}/><button className="secondary-button" disabled={busy} type="submit">{busyAction === 'style' ? <LoaderCircle size={14} className="spin"/> : <AudioLines size={14}/>} {busyAction === 'style' ? 'Describing the sound…' : current.stylePrompt ? 'Regenerate style prompt' : 'Generate style prompt'}</button>{current.stylePrompt && <div className="style-prompt-output"><textarea readOnly aria-label="Suno style prompt" value={current.stylePrompt} rows={5}/><div><span>{current.stylePrompt.length} characters</span><button type="button" className="secondary-button" onClick={copyStylePrompt}>{styleCopied ? <Check size={14}/> : <Copy size={14}/>} {styleCopied ? 'Copied' : 'Copy for Suno'}</button></div></div>}</form></> : busy ? <div className="output-skeleton" aria-live="polite"><LoaderCircle size={26} className="spin"/><h3>A story is taking shape.</h3><p>Writing, refining, and checking your song’s structure.</p><span/><span/><span/></div> : <div className="output-empty"><div className="empty-song-art"><Music2 size={42} strokeWidth={1}/><span>♪</span></div><h3>Every song starts<br/>with something real.</h3><p>Give us the feeling.<br/>We’ll help you find the words.</p><div className="example-cues">[intro]<br/>[soft piano enters]<br/>[verse 1]</div><small>Clean sections. Thoughtful cues.<br/>Ready for your next step.</small></div>}{corrections.length > 0 && <details className="session-learning"><summary>{corrections.length} learned correction{corrections.length === 1 ? '' : 's'} guiding your songs</summary><ul>{corrections.map((item) => <li key={item.id}><span><s>{item.original}</s> → {item.replacement}</span><button type="button" onClick={() => clearLearning(item.id)} disabled={busy} aria-label="Forget this correction"><X size={13}/></button></li>)}</ul><button type="button" className="clear-learning" onClick={() => clearLearning()} disabled={busy}>Clear all learning</button></details>}</section></div></div>}

        {view === 'image' && <div className="feature-page image-page"><div className="feature-heading"><div className="section-eyebrow"><Image size={15}/> THE IMAGE STUDIO</div><h1>A picture, from<br/><em>a little possibility.</em></h1><p>Describe what you see in your mind. Make it something you can keep.</p></div><div className="image-layout"><form className="settings-panel" onSubmit={generate}><div className="panel-heading"><span className="number-tag">01</span><h2>Paint the picture</h2></div><label className="field-label" htmlFor="image-prompt">What would you like to create?<span>A subject, a style, a few details. Simple is good.</span></label><textarea ref={inputRef} className="brief-textarea" id="image-prompt" rows={6} value={input} onChange={(event) => setInput(event.target.value)} maxLength={4000} required disabled={busy} placeholder="A simple line drawing of a wildflower, muted sage green on cream paper, a calm botanical feel…"/><div className="field-label">A place to start</div><div className="prompt-chips">{['Botanical illustration', 'Minimal landscape', 'Simple icon'].map((label) => <button type="button" key={label} disabled={busy} onClick={() => setInput(`Create a ${label.toLowerCase()}, simple shapes, muted natural colors, warm cream background, no text.`)}>{label}<Plus size={12}/></button>)}</div><SelectField label="Canvas shape" value={aspect} options={['1:1', '16:9', '9:16']} labels={['Square · 1:1', 'Landscape · 16:9', 'Portrait · 9:16']} onChange={setAspect}/><SelectField label="Download format" value={format} options={['png', 'jpg', 'webp', 'svg']} labels={['PNG · crisp & lossless', 'JPG · small & shareable', 'WebP · lightweight', 'SVG · vector, any size']} onChange={setFormat}/><button className="primary-button" type="submit" disabled={busy || !input.trim()}>{busy ? <LoaderCircle className="spin" size={17}/> : <WandSparkles size={17}/>} {busy ? 'Bringing it to life…' : 'Generate image'}<ArrowRight size={16}/></button><p className="fresh-note">Claude Opus 5.5 draws each picture as a vector illustration. It can take a minute or two.</p></form><section className="image-output"><div className="panel-heading"><span className="number-tag">02</span><h2>Your vision</h2>{current && <span className="saved-label"><Check size={12}/> Saved</span>}</div>{busy ? <div className="output-skeleton"><LoaderCircle className="spin" size={28}/><h3>Making space for your vision.</h3><p>Claude is drawing your picture. This can take a minute or two.</p><span/><span/><span/></div> : current ? <><div className="generated-image"><img src={`/api/asset?id=${current.id}`} alt={current.prompt}/></div><form className="revision-box" onSubmit={(event) => generate(event, 'revise')}><label htmlFor="image-revision">Modify this image</label><textarea id="image-revision" value={revision} onChange={(event) => setRevision(event.target.value)} placeholder="Make the background warmer, remove the text, add a wildflower…" rows={3} maxLength={4000} disabled={busy}/><button className="secondary-button" type="submit" disabled={busy || !revision.trim()}><WandSparkles size={14}/> Apply image changes</button></form><div className="image-output-footer"><p>{current.title}</p><button className="secondary-button" onClick={downloadImage} disabled={downloading}>{downloading ? <LoaderCircle className="spin" size={15}/> : <ArrowDown size={15}/>} Download .{format}</button></div></> : <div className="output-empty"><div className="large-picture-art"><div className="art-print print-front"><span className="art-sun"/><span className="art-hill hill-back"/><span className="art-hill hill-front"/></div></div><h3>From a few words<br/>to a whole new world.</h3><p>Your image appears here.<br/>Download it in the format that fits.</p><div className="format-tags"><span>.PNG</span><span>.JPG</span><span>.WEBP</span><span>.SVG</span></div></div>}</section></div></div>}{view === 'voice' && <Suspense fallback={<p className="race-loading" role="status"><LoaderCircle className="spin" size={18}/> Opening the Voice Generator…</p>}><VoiceStudio/></Suspense>}</>)}

        <AdminRecordResetButton isAdmin={access.isAdmin}/>
      </div>
    </RecordResetProvider></main>
    <InvitePopups lobby={lobby} onJoinRace={joinRaceInvite}/>
    {accountReady && <GroupChat username={access.username} onSignIn={() => switchView('home')} module={chatModule} activityLabels={activityLabels} requestRoom={requestRoom} onPoolInvite={name => lobby.invite(name)} onJoinInvite={joinChatInvite}/>}
    {helpOpen && <div className="modal-backdrop" onClick={() => setHelpOpen(false)}><section className="about-modal" role="dialog" aria-modal="true" aria-labelledby="about-title" onClick={(event) => event.stopPropagation()}><button autoFocus className="modal-close" aria-label="Close about" onClick={() => setHelpOpen(false)}><X size={20}/></button><BrandMark/><h2 id="about-title">Welcome to the library.</h2><p>the library is a collection of hands-on learning modules covering strategy, physics, math and precision. Open any module from the library page or the sidebar; most run right in your browser with nothing to install.</p><p>Sign in with a username and a 3-digit password to keep your progress, records and settings on any device. Some modules support live head-to-head sessions with anyone who is online, or a private room code you can share.</p><p>Members with studio access also get AI chat, image creation, a lyric studio and a voice generator. AI requests run on the server; chat uses model knowledge, not live web search or your documents.</p><button className="primary-button" onClick={() => setHelpOpen(false)}>Back to the library <ArrowRight size={16}/></button></section></div>}
  </div>
}

function SelectField({ label, value, options, labels, onChange }: { label: string; value: string; options: string[]; labels?: string[]; onChange: (value: string) => void }) {
  return <label className="select-field"><span>{label}</span><div><select value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option, index) => <option key={option} value={option}>{labels?.[index] || option}</option>)}</select><ChevronDown size={14}/></div></label>
}

function MultiSelectField({ label, value, options, onChange, disabled, allowEmpty = false }: { label: string; value: string; options: string[]; onChange: (value: string) => void; disabled: boolean; allowEmpty?: boolean }) {
  const selected = value ? value.split(' | ') : []
  return <fieldset className="multi-select" disabled={disabled}><legend>{label}<small>Choose one or more</small></legend><div>{options.map((option) => <label key={option} className={selected.includes(option) ? 'selected' : ''}><input type="checkbox" checked={selected.includes(option)} onChange={() => { const next = selected.includes(option) ? selected.filter((item) => item !== option) : [...selected, option]; if (next.length || allowEmpty) onChange(next.join(' | ')) }}/>{option}</label>)}</div></fieldset>
}
