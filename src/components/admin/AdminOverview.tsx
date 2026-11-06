import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowRight, Car, FerrisWheel, Flag, KeyRound, LayoutGrid, Package, ShieldCheck, Sparkles, Users } from 'lucide-react'
import { isModuleAvailable, learningModules } from '@/lib/modules'
import { arrangeModules } from '@/lib/module-layout'
import { useModuleLayout } from '@/lib/use-module-layout'

type Account = { pages: string[]; isAdmin: boolean; needsPassword: boolean }
type Asset = { status?: string; active?: boolean }
type Counts = { published: number; drafts: number }
type Section = 'library' | 'people' | 'changes' | 'maplestreet' | 'vehicles' | 'park-rides' | 'shorttrack-cars'

function countAssets(list: Asset[]): Counts {
  return {
    published: list.filter(item => item.status ? item.status === 'published' : item.active !== false).length,
    drafts: list.filter(item => item.status === 'draft').length,
  }
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' })
  if (!response.ok) throw new Error('unavailable')
  return response.json() as Promise<T>
}

function Stat({ icon, label, value, detail, onOpen, cta }: { icon: ReactNode; label: string; value: ReactNode; detail: ReactNode; onOpen: () => void; cta: string }) {
  return <article className="adm-stat">
    <header><span className="adm-stat-icon" aria-hidden>{icon}</span><h3>{label}</h3></header>
    <p className="adm-stat-value">{value}</p>
    <p className="adm-stat-detail">{detail}</p>
    <button type="button" className="adm-link" onClick={onOpen}>{cta} <ArrowRight size={14} aria-hidden/></button>
  </article>
}

export function AdminOverview({ onOpen }: { onOpen: (section: Section) => void }) {
  const layout = useModuleLayout()
  const arranged = useMemo(() => arrangeModules(layout), [layout])
  const [accounts, setAccounts] = useState<Account[] | null | 'error'>(null)
  const [items, setItems] = useState<Counts | null | 'error'>(null)
  const [vehicles, setVehicles] = useState<Counts | null | 'error'>(null)
  const [rides, setRides] = useState<Counts | null | 'error'>(null)
  const [raceCars, setRaceCars] = useState<Counts | null | 'error'>(null)

  useEffect(() => {
    getJson<{ users: Account[] }>('/api/workspace-admin').then(result => setAccounts(result.users)).catch(() => setAccounts('error'))
    getJson<{ items: Asset[] }>('/api/maplestreet-items?drafts=1').then(result => setItems(countAssets(result.items))).catch(() => setItems('error'))
    getJson<{ vehicles: Asset[] }>('/api/maplestreet-vehicles?drafts=1').then(result => setVehicles(countAssets(result.vehicles))).catch(() => setVehicles('error'))
    getJson<{ records: Asset[] }>('/api/park-rides?drafts=1').then(result => setRides(countAssets(result.records))).catch(() => setRides('error'))
    getJson<{ cars: Asset[] }>('/api/shorttrack-cars?drafts=1').then(result => setRaceCars(countAssets(result.cars))).catch(() => setRaceCars('error'))
  }, [])

  const people = accounts && accounts !== 'error' ? {
    total: accounts.length,
    studio: accounts.filter(account => !account.isAdmin && account.pages.length > 0).length,
    resets: accounts.filter(account => account.needsPassword).length,
  } : null
  const pending = <span className="adm-skeleton" aria-label="Loading"/>
  const failed = <span className="adm-muted">Unavailable</span>
  const assetValue = (counts: Counts | null | 'error') => counts === 'error' ? failed : counts ? counts.published : pending
  const assetDetail = (counts: Counts | null | 'error', noun: string) => counts && counts !== 'error' ? `${counts.drafts} draft${counts.drafts === 1 ? '' : 's'} waiting · published ${noun} appear in the shared town` : ' '

  return <div className="adm-overview">
    <div className="adm-stats">
      <Stat icon={<LayoutGrid size={18}/>} label="Module library" value={<>{arranged.visible.length}<small>/{learningModules.filter(item => isModuleAvailable(item.id)).length}</small></>}
        detail={<>Featured: <b>{arranged.featured.title}</b>{layout.hidden.length ? ` · ${layout.hidden.length} hidden` : ''}</>} onOpen={() => onOpen('library')} cta="Arrange modules"/>
      <Stat icon={<Users size={18}/>} label="Accounts" value={accounts === 'error' ? failed : people ? people.total : pending}
        detail={people ? `${people.studio} with studio access${people.resets ? ` · ${people.resets} password reset${people.resets === 1 ? '' : 's'} pending` : ''}` : ' '} onOpen={() => onOpen('people')} cta="Manage people"/>
      <Stat icon={<Package size={18}/>} label="Fox Plains items" value={assetValue(items)} detail={assetDetail(items, 'items')} onOpen={() => onOpen('maplestreet')} cta="Open item editor"/>
      <Stat icon={<Car size={18}/>} label="Fox Plains vehicles" value={assetValue(vehicles)} detail={assetDetail(vehicles, 'vehicles')} onOpen={() => onOpen('vehicles')} cta="Open vehicle editor"/>
      <Stat icon={<FerrisWheel size={18}/>} label="Thrill Park rides" value={assetValue(rides)} detail={rides && rides !== 'error' ? `${rides.drafts} draft${rides.drafts === 1 ? '' : 's'} waiting · published rides appear in every park’s build menu` : ' '} onOpen={() => onOpen('park-rides')} cta="Open ride creator"/>
      <Stat icon={<Flag size={18}/>} label="Short Track race cars" value={assetValue(raceCars)} detail={raceCars && raceCars !== 'error' ? `${raceCars.drafts} draft${raceCars.drafts === 1 ? '' : 's'} waiting · published cars join the Short Track vehicle list` : ' '} onOpen={() => onOpen('shorttrack-cars')} cta="Open car editor"/>
    </div>

    <section className="adm-card">
      <header className="adm-card-head"><h3>Library preview</h3><button type="button" className="adm-link" onClick={() => onOpen('library')}>Change order <ArrowRight size={14} aria-hidden/></button></header>
      <ol className="adm-preview-row">
        {arranged.visible.map((item, index) => <li key={item.id} className={item.id === arranged.featured.id ? 'is-featured' : ''}>
          <img src={item.image} alt="" loading="lazy"/><span><b>{index + 1}</b> {item.title}</span>
        </li>)}
      </ol>
    </section>

    <section className="adm-card adm-quick">
      <h3>Shortcuts</h3>
      <div>
        <button type="button" onClick={() => onOpen('changes')}><Sparkles size={16} aria-hidden/> Ask Claude to change the site</button>
        <button type="button" onClick={() => onOpen('people')}><KeyRound size={16} aria-hidden/> Reset a password</button>
        <button type="button" onClick={() => onOpen('people')}><ShieldCheck size={16} aria-hidden/> Grant studio access</button>
        <a href="/modules/maplestreet.html?dev=1" target="_blank" rel="noopener"><Car size={16} aria-hidden/> Open the Fox Plains developer instance</a>
      </div>
    </section>
  </div>
}
