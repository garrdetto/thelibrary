import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { ArrowRight, Layers, Radio, Sparkles, Users } from 'lucide-react'
import { HubSlideshow } from './HubSlideshow'
import { moduleGroups } from '@/lib/modules'
import { arrangeModules } from '@/lib/module-layout'
import { useModuleLayout } from '@/lib/use-module-layout'
import type { ModuleId, ModuleSubject } from '@/lib/modules'

type Filter = 'All' | ModuleSubject

const PICK_COUNT = 8

export function ModuleHub({ onLaunch, account, online }: { onLaunch: (id: ModuleId) => void; account: ReactNode; online: ReactNode; username: string | null }) {
  const [filter, setFilter] = useState<Filter>('All')
  const layout = useModuleLayout()
  const { visible: learningModules, featured } = useMemo(() => arrangeModules(layout), [layout])
  const shown = filter === 'All' ? learningModules : learningModules.filter(item => item.group === filter)
  const [picks, setPicks] = useState<typeof learningModules | null>(null)
  useEffect(() => {
    const pool = [...learningModules]
    for (let index = pool.length - 1; index > 0; index--) {
      const swap = Math.floor(Math.random() * (index + 1))
      ;[pool[index], pool[swap]] = [pool[swap], pool[index]]
    }
    setPicks(pool.slice(0, PICK_COUNT))
  }, [learningModules])
  const groups = moduleGroups.filter(group => learningModules.some(item => item.group === group))
  return <section className="hub" aria-label="Learning modules">
    <div className="hub-hero">
      <div className="hub-hero-copy">
        <span className="hub-eyebrow"><Sparkles size={13}/> the library · learning modules</span>
        <h1>Learn by doing.<br/><em>Master every module.</em></h1>
        <div className="hub-picks" aria-label="Random modules">
          {picks ? picks.map(item => <button type="button" key={item.id} className="hub-pick" style={{ '--module-accent': item.accent } as CSSProperties} onClick={() => onLaunch(item.id)} aria-label={`Launch ${item.title}`} title={item.title}>
            <img src={item.image} alt="" loading="lazy"/>
            <span>{item.title}</span>
          </button>) : Array.from({ length: PICK_COUNT }, (_, index) => <span key={index} className="hub-pick is-loading" aria-hidden="true"/>)}
        </div>
        <div className="hub-stats">
          <span><Layers size={15}/><b>{learningModules.length}</b> modules</span>
          <span><Radio size={15}/><b>Live</b> head-to-head</span>
          <span><Users size={15}/><b>Room codes</b> for online sessions</span>
        </div>
        <div className="hub-actions">
          <button type="button" className="hub-cta" onClick={() => onLaunch(featured.id)}>Launch {featured.title} <ArrowRight size={18}/></button>
          <a className="hub-secondary" href="#modules">Browse modules</a>
        </div>
      </div>
      <HubSlideshow onLaunch={onLaunch} fallbackId={featured.id}/>
    </div>
    <div className={`hub-body${account || online ? '' : ' is-solo'}`}>
      <div className="hub-main" id="modules">
        <div className="hub-section-head">
          <h2>Module Library</h2>
          <div className="hub-filters" role="tablist" aria-label="Filter modules">
            {(['All', ...groups] as Filter[]).map(item => <button type="button" role="tab" key={item} aria-selected={filter === item} className={filter === item ? 'is-active' : ''} onClick={() => setFilter(item)}>{item}</button>)}
          </div>
        </div>
        <div className="hub-grid">
          {shown.map(item => <button type="button" key={item.id} className="module-card" style={{ '--module-accent': item.accent } as CSSProperties} onClick={() => onLaunch(item.id)}>
            <span className="module-art"><img src={item.image} alt="" loading="lazy"/><span className="module-launch">Launch <ArrowRight size={14}/></span></span>
            <span className="module-meta">
              <small>{item.subject}</small>
              <strong>{item.title}</strong>
              <span className="module-summary">{item.summary}</span>
              <span className="module-tags">{item.modes.map(mode => <i key={mode}>{mode}</i>)}</span>
            </span>
          </button>)}
        </div>
      </div>
      {(account || online) && <aside className="hub-side">
        {account}
        {online}
      </aside>}
    </div>
  </section>
}
