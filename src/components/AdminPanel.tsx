import { Suspense, lazy, useEffect, useState } from 'react'
import type { ComponentType, KeyboardEvent } from 'react'
import { Car, FerrisWheel, LayoutDashboard, LayoutGrid, LoaderCircle, Package, ShieldCheck, Sparkles, Users } from 'lucide-react'
import { WorkspaceAdmin } from './WorkspaceAdmin'
import { SiteChanges } from './SiteChanges'
import { AdminOverview } from './admin/AdminOverview'
import { LibraryArrange } from './admin/LibraryArrange'

const MapleStreetItemEditor = lazy<ComponentType>(() => import.meta.env.SSR ? Promise.resolve({ default: () => null }) : import('./maplestreet/MapleStreetItemEditor'))
const ParkRideCreator = lazy<ComponentType>(() => import.meta.env.SSR ? Promise.resolve({ default: () => null }) : import('./park/rides/RideCreator'))
const MapleStreetVehicleEditor = lazy<ComponentType>(() => import.meta.env.SSR ? Promise.resolve({ default: () => null }) : import('./maplestreet/vehicle/VehicleEditor'))

const sections = [
  { id: 'overview', group: 'Dashboard', label: 'Overview', icon: LayoutDashboard, title: 'Overview', blurb: 'Everything you manage on the library at a glance.' },
  { id: 'library', group: 'Library', label: 'Module order', icon: LayoutGrid, title: 'Module order', blurb: 'Arrange the homepage library and sidebar, pick the featured module and hide modules you are not ready to show.' },
  { id: 'people', group: 'Accounts', label: 'People & permissions', icon: Users, title: 'People & permissions', blurb: 'Choose who can use each studio. Passwords are never shown; reset one if someone forgets theirs.' },
  { id: 'changes', group: 'Site', label: 'Site changes', icon: Sparkles, title: 'Site changes', blurb: 'Ask Claude to change the site, follow each run and publish or undo the result.' },
  { id: 'maplestreet', group: 'Fox Plains', label: 'Items', icon: Package, title: 'Fox Plains items', blurb: 'Publish Buy-mode furniture and props to the shared town.' },
  { id: 'vehicles', group: 'Fox Plains', label: 'Vehicles', icon: Car, title: 'Fox Plains vehicles', blurb: 'Build, tune and publish vehicles for the dealer lot and neighbor traffic.' },
  { id: 'park-rides', group: 'Thrill Park', label: 'Ride creator', icon: FerrisWheel, title: 'Thrill Park ride creator', blurb: 'Generate rides with Meshy, set how they move and what they cost, and publish them to every park’s build menu.' },
] as const
type Section = (typeof sections)[number]['id']
const groups = [...new Set(sections.map(item => item.group))]

function sectionFromHash(): Section {
  if (typeof window === 'undefined') return 'overview'
  const id = window.location.hash.replace(/^#admin\/?/, '')
  return sections.some(item => item.id === id) ? id as Section : 'overview'
}

function Loading({ text }: { text: string }) {
  return <p className="race-loading" role="status"><LoaderCircle className="spin" size={18}/> {text}</p>
}

export function AdminPanel() {
  const [section, setSection] = useState<Section>('overview')
  useEffect(() => { setSection(sectionFromHash()) }, [])

  function open(next: Section, focus = false) {
    setSection(next)
    if (window.location.hash.startsWith('#admin') || window.location.hash === '') window.history.replaceState(null, '', `#admin/${next}`)
    if (focus) requestAnimationFrame(() => document.getElementById(`admin-tab-${next}`)?.focus())
    else document.querySelector('.adm-main')?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  function onKey(event: KeyboardEvent<HTMLButtonElement>) {
    const keys = ['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End']
    if (!keys.includes(event.key)) return
    event.preventDefault()
    const index = sections.findIndex(item => item.id === section)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? sections.length - 1 : (index + (event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : sections.length - 1)) % sections.length
    open(sections[next].id, true)
  }

  const current = sections.find(item => item.id === section)!
  return <div className="adm">
    <aside className="adm-nav">
      <div className="adm-brand"><span aria-hidden><ShieldCheck size={18}/></span><div><strong>Admin console</strong><small>the library</small></div></div>
      <div role="tablist" aria-label="Admin sections" aria-orientation="vertical">
        {groups.map(group => <div key={group} className="adm-nav-group">
          <p>{group}</p>
          {sections.filter(item => item.group === group).map(item => <button key={item.id} id={`admin-tab-${item.id}`} type="button" role="tab" aria-selected={section === item.id} aria-controls="admin-pane" tabIndex={section === item.id ? 0 : -1} className={section === item.id ? 'is-active' : ''} onClick={() => open(item.id)} onKeyDown={onKey}>
            <item.icon size={17} strokeWidth={1.8} aria-hidden/><span>{item.label}</span>
          </button>)}
        </div>)}
      </div>
    </aside>
    <div className="adm-main" id="admin-pane" role="tabpanel" aria-labelledby={`admin-tab-${section}`}>
      <header className="adm-head">
        <p className="adm-crumb">Admin <span aria-hidden>/</span> {current.group}</p>
        <h1>{current.title}</h1>
        <p>{current.blurb}</p>
      </header>
      <div className={`adm-body adm-body-${section}`}>
        {section === 'overview' && <AdminOverview onOpen={next => open(next)}/>}
        {section === 'library' && <LibraryArrange/>}
        {section === 'people' && <WorkspaceAdmin/>}
        {section === 'changes' && <SiteChanges/>}
        {section === 'maplestreet' && <Suspense fallback={<Loading text="Opening the item editor…"/>}><MapleStreetItemEditor/></Suspense>}
        {section === 'vehicles' && <Suspense fallback={<Loading text="Opening the vehicle editor…"/>}><MapleStreetVehicleEditor/></Suspense>}
        {section === 'park-rides' && <Suspense fallback={<Loading text="Opening the ride creator…"/>}><ParkRideCreator/></Suspense>}
      </div>
    </div>
  </div>
}
