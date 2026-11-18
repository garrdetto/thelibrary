import { Suspense, lazy, useEffect, useState } from 'react'
import type { ComponentType, KeyboardEvent, ReactNode } from 'react'
import { AudioLines, Brush, Car, FerrisWheel, Flag, Gauge, Image, ImageUp, LandPlot, LayoutDashboard, LayoutGrid, ListMusic, LoaderCircle, MessageCircle, Mountain, Music2, Package, Radar, Settings2, ShieldCheck, Sparkles, Target, Trophy, UserRoundX, Users } from 'lucide-react'
import { WorkspaceAdmin } from './WorkspaceAdmin'
import { SiteChanges } from './SiteChanges'
import { AdminOverview } from './admin/AdminOverview'
import { LibraryArrange } from './admin/LibraryArrange'

export type StudioId = 'chat' | 'image' | 'lyrics' | 'voice'

const MapleStreetItemEditor = lazy<ComponentType>(() => import.meta.env.SSR ? Promise.resolve({ default: () => null }) : import('./maplestreet/MapleStreetItemEditor'))
const ParkRideCreator = lazy<ComponentType>(() => import.meta.env.SSR ? Promise.resolve({ default: () => null }) : import('./park/rides/RideCreator'))
const MapleStreetVehicleEditor = lazy<ComponentType>(() => import.meta.env.SSR ? Promise.resolve({ default: () => null }) : import('./maplestreet/vehicle/VehicleEditor'))
const ShortTrackCarEditor = lazy<ComponentType>(() => import.meta.env.SSR ? Promise.resolve({ default: () => null }) : import('./shorttrack/cars/CarEditor'))
const ShortTrackHandling = lazy<ComponentType>(() => import.meta.env.SSR ? Promise.resolve({ default: () => null }) : import('./shorttrack/HandlingSettings'))
const DartsSettings = lazy<ComponentType>(() => import.meta.env.SSR ? Promise.resolve({ default: () => null }) : import('./darts/DartsSettings'))
const ClipartGenerator = lazy<ComponentType>(() => import.meta.env.SSR ? Promise.resolve({ default: () => null }) : import('./admin/ClipartGenerator'))
const ImageEditor = lazy<ComponentType>(() => import.meta.env.SSR ? Promise.resolve({ default: () => null }) : import('./admin/ImageEditor'))
const WorldEditor = lazy<ComponentType>(() => import.meta.env.SSR ? Promise.resolve({ default: () => null }) : import('./world/WorldEditor'))
const LifeSimResetCharacter = lazy<ComponentType>(() => import.meta.env.SSR ? Promise.resolve({ default: () => null }) : import('./lifesim/ResetCharacter'))
const MusicLibrary = lazy<ComponentType<{ onOpenPerson: (id: string) => void }>>(() => import.meta.env.SSR ? Promise.resolve({ default: () => null }) : import('./admin/MusicLibrary'))
const BushLeagueAssets = lazy<ComponentType>(() => import.meta.env.SSR ? Promise.resolve({ default: () => null }) : import('./bushleague/BushLeagueAssets'))

const areas = [
  { id: 'site', label: 'Site', icon: ShieldCheck },
  { id: 'modules', label: 'Module settings', icon: Settings2 },
] as const
type Area = (typeof areas)[number]['id']

const sections = [
  { id: 'overview', area: 'site', group: 'Dashboard', label: 'Overview', icon: LayoutDashboard, title: 'Overview', blurb: 'Everything you manage on the library at a glance.' },
  { id: 'changes', area: 'site', group: 'Dashboard', label: 'Site changes', icon: Sparkles, title: 'Site changes', blurb: 'Ask Claude to change the site, follow each run and publish or undo the result.' },
  { id: 'library', area: 'site', group: 'Library', label: 'Module order', icon: LayoutGrid, title: 'Module order', blurb: 'Arrange the homepage library and sidebar, pick the featured module and hide modules you are not ready to show.' },
  { id: 'chat', area: 'site', group: 'Studios', label: 'AI Chat', icon: MessageCircle, title: 'AI Chat', blurb: 'Talk ideas through with Gemini.' },
  { id: 'image', area: 'site', group: 'Studios', label: 'Image Studio', icon: Image, title: 'Image Studio', blurb: 'Create and edit pictures from a description with Gemini.' },
  { id: 'lyrics', area: 'site', group: 'Studios', label: 'Lyric Studio', icon: Music2, title: 'Lyric Studio', blurb: 'Write, fine-tune and revamp song lyrics with Gemini.' },
  { id: 'voice', area: 'site', group: 'Studios', label: 'Voice Generator', icon: AudioLines, title: 'Voice Generator', blurb: 'Design, remix and delete ElevenLabs voices, then hear them read your own text.' },
  { id: 'people', area: 'site', group: 'Accounts', label: 'People & permissions', icon: Users, title: 'People & permissions', blurb: 'Click anyone to choose what they can use and see: studios, the music player, Axiom Radar and modules you have hidden from everyone else. Passwords are never shown; reset one if someone forgets theirs.' },
  { id: 'music', area: 'site', group: 'Accounts', label: 'Music player', icon: ListMusic, title: 'Music player', blurb: 'Upload MP3s and choose who hears them. People you switch on get a player in the corner, with your tracks and live Wisconsin radio, that keeps playing as they move around the site.' },
  { id: 'image-editor', area: 'site', group: 'Tools', label: 'Image editor', icon: ImageUp, title: 'Image editor', blurb: 'Upload images in bulk, select text to remove, rewrite or fill with Gemini, and save them as numbered files: name1, name2 and on until you change the name.' },
  { id: 'clipart', area: 'site', group: 'Tools', label: 'Clipart generator', icon: Brush, title: 'HD clipart generator', blurb: 'Turn batches of photographs into realistic HD clipart with free Cloudflare Workers AI image-to-image engines (or Gemini), with full style control, a reference image, before-and-after preview and ZIP export.' },
  { id: 'gspro', area: 'site', group: 'Tools', label: 'GSPro Analyzer', icon: LandPlot, title: 'GSPro Analyzer', blurb: 'Stream every GSPro shot live from your simulator PC, save it, and break it down by club with dispersion, gapping and tips. Opens on its own page.' },
  { id: 'axiom-radar', area: 'site', group: 'Tools', label: 'Axiom Radar', icon: Radar, title: 'Axiom Radar', blurb: 'Coins ranked by live Axiom viewers with price moves, holder quality, smart holders and buy and watch signals. Opens on its own page.' },
  { id: 'world-editor', area: 'modules', group: 'Life Sim', label: 'World editor', icon: Mountain, title: 'Life Sim world editor', blurb: 'Reshape Montello: raise, lower, flatten and smooth the land, fill or drain water and fix the rivers, build and redraw roads with sidewalks and smooth curves, change or remove buildings, draw and trim parking lots, plant or clear trees, and put up guardrails, streetlights and brick walls. Publish when it looks right.' },
  { id: 'vehicles', area: 'modules', group: 'Life Sim', label: 'Vehicles', icon: Car, title: 'Life Sim vehicles', blurb: 'Build and publish vehicles for Life Sim’s dealership. They are for Life Sim only; tune their top speed and handling in Life Sim’s developer panel (F8).' },
  { id: 'lifesim-reset', area: 'modules', group: 'Life Sim', label: 'Reset character', icon: UserRoundX, title: 'Reset a Life Sim character', blurb: 'Send yourself or any player back to the character creator. Cash, gear and clothes are kept.' },
  { id: 'maplestreet', area: 'modules', group: 'Fox Plains', label: 'Items', icon: Package, title: 'Fox Plains items', blurb: 'Publish Buy-mode furniture and props to the shared town.' },
  { id: 'shorttrack-cars', area: 'modules', group: 'Short Track Showdown', label: 'Race cars', icon: Flag, title: 'Short Track race cars', blurb: 'Generate car bodies with Meshy, fit wheels, paint and race numbers, and publish them to the Short Track Showdown vehicle list.' },
  { id: 'shorttrack-handling', area: 'modules', group: 'Short Track Showdown', label: 'Handling', icon: Gauge, title: 'Short Track handling', blurb: 'Grip, power, brakes and steering for each track. Changes apply to every driver and the AI field from their next race.' },
  { id: 'bushleague', area: 'modules', group: 'Bush League Baseball', label: 'Assets', icon: Trophy, title: 'Bush League Baseball assets', blurb: 'Generate players, gear, park props and mascots with Meshy from the committed prompt list, then refine, rig, animate and download them for the Blender clean-up.' },
  { id: 'darts', area: 'modules', group: 'Darts', label: 'Settings', icon: Target, title: 'Darts settings', blurb: 'Tune the throw meter, offer or hide the classic meter, and pick the colours of both boards and the darts.' },
  { id: 'park-rides', area: 'modules', group: 'Thrill Park', label: 'Ride creator', icon: FerrisWheel, title: 'Thrill Park ride creator', blurb: 'Generate rides with Meshy, set how they move and what they cost, and publish them to every park’s build menu.' },
] as const
type Section = (typeof sections)[number]['id']
const studioIds: readonly string[] = ['chat', 'image', 'lyrics', 'voice']
const isStudio = (id: string): id is StudioId => studioIds.includes(id)

function sectionFromHash(): Section {
  if (typeof window === 'undefined') return 'overview'
  const id = window.location.hash.replace(/^#admin\/?/, '').split('/')[0]
  if (id === 'modules') return 'maplestreet'
  return sections.some(item => item.id === id && !isStudio(item.id)) ? id as Section : 'overview'
}

function Loading({ text }: { text: string }) {
  return <p className="race-loading" role="status"><LoaderCircle className="spin" size={18}/> {text}</p>
}

export function AdminPanel({ studio, children, onOpenStudio, onOpenSection, canRadar = false }: { studio?: StudioId; children?: ReactNode; onOpenStudio?: (id: StudioId) => void; onOpenSection?: (id: string) => void; canRadar?: boolean }) {
  const [chosen, setSection] = useState<Section>(studio ?? 'overview')
  const [person, setPerson] = useState<string | null>(null)
  useEffect(() => {
    if (studio) return
    const from = sectionFromHash()
    setSection(from === 'axiom-radar' && !canRadar ? 'overview' : from)
    if (from === 'people') setPerson(window.location.hash.split('/')[2] ?? null)
  }, [studio, canRadar])
  const section: Section = studio ?? chosen

  const current = sections.find(item => item.id === section)!
  const area: Area = current.area
  const visible = sections.filter(item => item.area === area && (item.id !== 'axiom-radar' || canRadar))
  const groups = [...new Set(visible.map(item => item.group))]

  function leave(next: Section) {
    if (isStudio(next)) {
      if (next !== studio) onOpenStudio?.(next)
      return true
    }
    if (studio) { onOpenSection?.(next); return true }
    return false
  }

  function open(next: Section, focus = false) {
    if (next === 'axiom-radar') { window.location.assign('/axiom-radar'); return }
    if (next === 'gspro') { window.location.assign('/gspro'); return }
    if (leave(next)) return
    setSection(next)
    setPerson(null)
    if (window.location.hash.startsWith('#admin') || window.location.hash === '') window.history.replaceState(null, '', `#admin/${next}`)
    if (focus) requestAnimationFrame(() => document.getElementById(`admin-tab-${next}`)?.focus())
    else document.querySelector('.adm-main')?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  function choosePerson(id: string | null) {
    setPerson(id)
    if (window.location.hash.startsWith('#admin') || window.location.hash === '') window.history.replaceState(null, '', id ? `#admin/people/${id}` : '#admin/people')
  }

  function openArea(next: Area) {
    if (next === area) return
    const first = sections.find(item => item.area === next)!
    if (leave(first.id)) return
    setSection(first.id)
    if (window.location.hash.startsWith('#admin') || window.location.hash === '') window.history.replaceState(null, '', `#admin/${first.id}`)
  }

  function onKey(event: KeyboardEvent<HTMLButtonElement>) {
    const keys = ['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End']
    if (!keys.includes(event.key)) return
    event.preventDefault()
    const index = visible.findIndex(item => item.id === section)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? visible.length - 1 : (index + (event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : visible.length - 1)) % visible.length
    open(visible[next].id, true)
  }

  return <div className="adm">
    <aside className="adm-nav">
      <div className="adm-brand"><span aria-hidden><ShieldCheck size={18}/></span><div><strong>Admin console</strong><small>the library</small></div></div>
      <div className="adm-areas" role="group" aria-label="Admin area">
        {areas.map(item => <button key={item.id} type="button" aria-pressed={area === item.id} className={area === item.id ? 'is-active' : ''} onClick={() => openArea(item.id)}>
          <item.icon size={15} strokeWidth={1.9} aria-hidden/><span>{item.label}</span>
        </button>)}
      </div>
      <div role="tablist" aria-label={area === 'site' ? 'Site sections' : 'Module settings'} aria-orientation="vertical">
        {groups.map(group => <div key={group} className="adm-nav-group">
          <p>{group}</p>
          {visible.filter(item => item.group === group).map(item => <button key={item.id} id={`admin-tab-${item.id}`} type="button" role="tab" aria-selected={section === item.id} aria-controls="admin-pane" tabIndex={section === item.id ? 0 : -1} className={section === item.id ? 'is-active' : ''} onClick={() => open(item.id)} onKeyDown={onKey}>
            <item.icon size={17} strokeWidth={1.8} aria-hidden/><span>{item.label}</span>
          </button>)}
        </div>)}
      </div>
    </aside>
    <div className="adm-main" id="admin-pane" role="tabpanel" aria-labelledby={`admin-tab-${section}`}>
      <header className="adm-head">
        <p className="adm-crumb">Admin <span aria-hidden>/</span> {area === 'modules' ? <>Module settings <span aria-hidden>/</span> </> : null}{current.group}</p>
        <h1>{current.title}</h1>
        <p>{current.blurb}</p>
      </header>
      <div className={`adm-body adm-body-${section}`}>
        {section === 'overview' && <AdminOverview onOpen={next => open(next)}/>}
        {section === 'library' && <LibraryArrange/>}
        {studio && children}
        {section === 'people' && <WorkspaceAdmin person={person} onPerson={choosePerson}/>}
        {section === 'music' && <Suspense fallback={<Loading text="Opening the music player…"/>}><MusicLibrary onOpenPerson={id => { open('people'); choosePerson(id) }}/></Suspense>}
        {section === 'changes' && <SiteChanges/>}
        {section === 'axiom-radar' && <p className="race-loading"><a href="/axiom-radar">Open the Axiom Radar</a> It runs on its own page.</p>}
        {section === 'gspro' && <p className="race-loading"><a href="/gspro">Open the GSPro Analyzer</a> It runs on its own page.</p>}
        {section === 'image-editor' && <Suspense fallback={<Loading text="Opening the image editor…"/>}><ImageEditor/></Suspense>}
        {section === 'clipart' && <Suspense fallback={<Loading text="Opening the clipart generator…"/>}><ClipartGenerator/></Suspense>}
        {section === 'world-editor' && <Suspense fallback={<Loading text="Opening the world editor…"/>}><WorldEditor/></Suspense>}
        {section === 'lifesim-reset' && <Suspense fallback={<Loading text="Opening the character reset…"/>}><LifeSimResetCharacter/></Suspense>}
        {section === 'maplestreet' && <Suspense fallback={<Loading text="Opening the item editor…"/>}><MapleStreetItemEditor/></Suspense>}
        {section === 'vehicles' && <Suspense fallback={<Loading text="Opening the vehicle editor…"/>}><MapleStreetVehicleEditor/></Suspense>}
        {section === 'shorttrack-cars' && <Suspense fallback={<Loading text="Opening the car editor…"/>}><ShortTrackCarEditor/></Suspense>}
        {section === 'shorttrack-handling' && <Suspense fallback={<Loading text="Opening the handling settings…"/>}><ShortTrackHandling/></Suspense>}
        {section === 'bushleague' && <Suspense fallback={<Loading text="Opening the asset batch…"/>}><BushLeagueAssets/></Suspense>}
        {section === 'darts' && <Suspense fallback={<Loading text="Opening the Darts settings…"/>}><DartsSettings/></Suspense>}
        {section === 'park-rides' && <Suspense fallback={<Loading text="Opening the ride creator…"/>}><ParkRideCreator/></Suspense>}
      </div>
    </div>
  </div>
}
