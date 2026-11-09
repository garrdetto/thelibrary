import { Suspense, lazy, useEffect, useState } from 'react'
import type { ComponentType, KeyboardEvent } from 'react'
import { Car, Feather, FerrisWheel, Flag, Gauge, LayoutDashboard, LayoutGrid, LoaderCircle, Package, Settings2, ShieldCheck, Sparkles, Trophy, Users } from 'lucide-react'
import { WorkspaceAdmin } from './WorkspaceAdmin'
import { SiteChanges } from './SiteChanges'
import { AdminOverview } from './admin/AdminOverview'
import { LibraryArrange } from './admin/LibraryArrange'
import { AdminStudios } from './admin/AdminStudios'
import type { StudioId } from './admin/AdminStudios'

const MapleStreetItemEditor = lazy<ComponentType>(() => import.meta.env.SSR ? Promise.resolve({ default: () => null }) : import('./maplestreet/MapleStreetItemEditor'))
const ParkRideCreator = lazy<ComponentType>(() => import.meta.env.SSR ? Promise.resolve({ default: () => null }) : import('./park/rides/RideCreator'))
const MapleStreetVehicleEditor = lazy<ComponentType>(() => import.meta.env.SSR ? Promise.resolve({ default: () => null }) : import('./maplestreet/vehicle/VehicleEditor'))
const ShortTrackCarEditor = lazy<ComponentType>(() => import.meta.env.SSR ? Promise.resolve({ default: () => null }) : import('./shorttrack/cars/CarEditor'))
const ShortTrackHandling = lazy<ComponentType>(() => import.meta.env.SSR ? Promise.resolve({ default: () => null }) : import('./shorttrack/HandlingSettings'))
const BushLeagueAssets = lazy<ComponentType>(() => import.meta.env.SSR ? Promise.resolve({ default: () => null }) : import('./bushleague/BushLeagueAssets'))

const areas = [
  { id: 'site', label: 'Site', icon: ShieldCheck },
  { id: 'modules', label: 'Module settings', icon: Settings2 },
] as const
type Area = (typeof areas)[number]['id']

const sections = [
  { id: 'overview', area: 'site', group: 'Dashboard', label: 'Overview', icon: LayoutDashboard, title: 'Overview', blurb: 'Everything you manage on the library at a glance.' },
  { id: 'library', area: 'site', group: 'Library', label: 'Module order', icon: LayoutGrid, title: 'Module order', blurb: 'Arrange the homepage library and sidebar, pick the featured module and hide modules you are not ready to show.' },
  { id: 'workspace', area: 'site', group: 'Workspace', label: 'Your workspace', icon: Feather, title: 'Your workspace', blurb: 'Your studios: AI chat, the Image studio and the Lyric studio.' },
  { id: 'people', area: 'site', group: 'Accounts', label: 'People & permissions', icon: Users, title: 'People & permissions', blurb: 'Choose who can use each studio. Passwords are never shown; reset one if someone forgets theirs.' },
  { id: 'changes', area: 'site', group: 'Site', label: 'Site changes', icon: Sparkles, title: 'Site changes', blurb: 'Ask Claude to change the site, follow each run and publish or undo the result.' },
  { id: 'maplestreet', area: 'modules', group: 'Fox Plains', label: 'Items', icon: Package, title: 'Fox Plains items', blurb: 'Publish Buy-mode furniture and props to the shared town.' },
  { id: 'vehicles', area: 'modules', group: 'Fox Plains', label: 'Vehicles', icon: Car, title: 'Fox Plains vehicles', blurb: 'Build, tune and publish vehicles for the dealer lot and neighbor traffic.' },
  { id: 'shorttrack-cars', area: 'modules', group: 'Short Track Showdown', label: 'Race cars', icon: Flag, title: 'Short Track race cars', blurb: 'Generate car bodies with Meshy, fit wheels, paint and race numbers, and publish them to the Short Track Showdown vehicle list.' },
  { id: 'shorttrack-handling', area: 'modules', group: 'Short Track Showdown', label: 'Handling', icon: Gauge, title: 'Short Track handling', blurb: 'Grip, power, brakes and steering for each track. Changes apply to every driver and the AI field from their next race.' },
  { id: 'bushleague', area: 'modules', group: 'Bush League Baseball', label: 'Assets', icon: Trophy, title: 'Bush League Baseball assets', blurb: 'Generate players, gear, park props and mascots with Meshy from the committed prompt list, then refine, rig, animate and download them for the Blender clean-up.' },
  { id: 'park-rides', area: 'modules', group: 'Thrill Park', label: 'Ride creator', icon: FerrisWheel, title: 'Thrill Park ride creator', blurb: 'Generate rides with Meshy, set how they move and what they cost, and publish them to every park’s build menu.' },
] as const
type Section = (typeof sections)[number]['id']

function sectionFromHash(): Section {
  if (typeof window === 'undefined') return 'overview'
  const id = window.location.hash.replace(/^#admin\/?/, '')
  if (id === 'modules') return 'maplestreet'
  return sections.some(item => item.id === id) ? id as Section : 'overview'
}

function Loading({ text }: { text: string }) {
  return <p className="race-loading" role="status"><LoaderCircle className="spin" size={18}/> {text}</p>
}

export function AdminPanel({ onOpenStudio }: { onOpenStudio?: (id: StudioId) => void }) {
  const [section, setSection] = useState<Section>('overview')
  useEffect(() => { setSection(sectionFromHash()) }, [])

  const current = sections.find(item => item.id === section)!
  const area: Area = current.area
  const visible = sections.filter(item => item.area === area)
  const groups = [...new Set(visible.map(item => item.group))]

  function open(next: Section, focus = false) {
    setSection(next)
    if (window.location.hash.startsWith('#admin') || window.location.hash === '') window.history.replaceState(null, '', `#admin/${next}`)
    if (focus) requestAnimationFrame(() => document.getElementById(`admin-tab-${next}`)?.focus())
    else document.querySelector('.adm-main')?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  function openArea(next: Area) {
    if (next === area) return
    const first = sections.find(item => item.area === next)!
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
        {section === 'workspace' && <AdminStudios onOpenStudio={onOpenStudio}/>}
        {section === 'people' && <WorkspaceAdmin/>}
        {section === 'changes' && <SiteChanges/>}
        {section === 'maplestreet' && <Suspense fallback={<Loading text="Opening the item editor…"/>}><MapleStreetItemEditor/></Suspense>}
        {section === 'vehicles' && <Suspense fallback={<Loading text="Opening the vehicle editor…"/>}><MapleStreetVehicleEditor/></Suspense>}
        {section === 'shorttrack-cars' && <Suspense fallback={<Loading text="Opening the car editor…"/>}><ShortTrackCarEditor/></Suspense>}
        {section === 'shorttrack-handling' && <Suspense fallback={<Loading text="Opening the handling settings…"/>}><ShortTrackHandling/></Suspense>}
        {section === 'bushleague' && <Suspense fallback={<Loading text="Opening the asset batch…"/>}><BushLeagueAssets/></Suspense>}
        {section === 'park-rides' && <Suspense fallback={<Loading text="Opening the ride creator…"/>}><ParkRideCreator/></Suspense>}
      </div>
    </div>
  </div>
}
