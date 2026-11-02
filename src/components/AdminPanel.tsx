import { Suspense, lazy, useState } from 'react'
import type { ComponentType, KeyboardEvent } from 'react'
import { LoaderCircle } from 'lucide-react'
import { WorkspaceAdmin } from './WorkspaceAdmin'
import { SiteChanges } from './SiteChanges'

const MapleStreetItemEditor = lazy<ComponentType>(() => import.meta.env.SSR ? Promise.resolve({ default: () => null }) : import('./maplestreet/MapleStreetItemEditor'))
const MapleStreetVehicleEditor = lazy<ComponentType>(() => import.meta.env.SSR ? Promise.resolve({ default: () => null }) : import('./maplestreet/vehicle/VehicleEditor'))

const tabs = [{ id: 'people', label: 'People & permissions' }, { id: 'changes', label: 'Site changes' }, { id: 'maplestreet', label: 'Maple Street items' }, { id: 'vehicles', label: 'Maple Street vehicles' }] as const
type Tab = (typeof tabs)[number]['id']

export function AdminPanel() {
  const [tab, setTab] = useState<Tab>('people')
  function onKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    const index = tabs.findIndex(item => item.id === tab)
    const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]
    setTab(next.id)
    document.getElementById(`admin-tab-${next.id}`)?.focus()
  }
  return <div className="admin-panel">
    <div className="admin-tabs" role="tablist" aria-label="Admin sections">
      {tabs.map(item => <button key={item.id} id={`admin-tab-${item.id}`} type="button" role="tab" aria-selected={tab === item.id} aria-controls={`admin-pane-${item.id}`} tabIndex={tab === item.id ? 0 : -1} className={tab === item.id ? 'is-active' : ''} onClick={() => setTab(item.id)} onKeyDown={onKey}>{item.label}</button>)}
    </div>
    <div id={`admin-pane-${tab}`} role="tabpanel" aria-labelledby={`admin-tab-${tab}`}>
      {tab === 'people' && <WorkspaceAdmin/>}
      {tab === 'changes' && <SiteChanges/>}
      {tab === 'maplestreet' && <Suspense fallback={<p className="race-loading" role="status"><LoaderCircle className="spin" size={18}/> Opening the item editor…</p>}><MapleStreetItemEditor/></Suspense>}
      {tab === 'vehicles' && <Suspense fallback={<p className="race-loading" role="status"><LoaderCircle className="spin" size={18}/> Opening the vehicle editor…</p>}><MapleStreetVehicleEditor/></Suspense>}
    </div>
  </div>
}
