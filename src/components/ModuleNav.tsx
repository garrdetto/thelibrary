import { useEffect, useMemo, useState } from 'react'
import type { ComponentType } from 'react'
import { ChevronDown, Trophy } from 'lucide-react'
import { arrangeModules } from '@/lib/module-layout'
import type { ModuleLayout } from '@/lib/module-layout'
import type { ModuleId } from '@/lib/modules'

type Icon = ComponentType<{ size?: number; strokeWidth?: number }>

export function ModuleNav({ layout, view, busy, icons, onSelect }: { layout: ModuleLayout; view: string; busy: boolean; icons: Record<ModuleId, Icon>; onSelect: (id: ModuleId) => void }) {
  const { top, groups } = useMemo(() => arrangeModules(layout), [layout])
  const [open, setOpen] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    const home = groups.find(group => group.modules.some(item => item.id === view))
    if (!home) return
    setOpen(current => groups.some(group => current.has(group.category.id) && group.modules.some(item => item.id === view)) ? current : new Set(current).add(home.category.id))
  }, [view, groups])

  function toggle(id: string) {
    setOpen(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function item(id: ModuleId, label: string, rank?: number) {
    const Icon = icons[id] ?? Trophy
    return <button key={id} type="button" className={`nav-item${rank ? ' nav-top-item' : ''} ${view === id ? 'active' : ''}`} onClick={() => onSelect(id)} disabled={busy}>
      {rank ? <span className="nav-top-rank" aria-hidden="true">{rank}</span> : <Icon size={19} strokeWidth={1.7}/>}
      <span>{label}</span>{view === id && <span className="active-dot"/>}
    </button>
  }

  return <>
    <p className="nav-caption nav-caption-play">TOP 5</p>
    <div className="nav-top" aria-label="Top 5 modules" role="group">
      {top.map((entry, index) => item(entry.id, entry.title, index + 1))}
    </div>
    <p className="nav-caption nav-caption-play">CATEGORIES</p>
    {groups.map(group => {
      const expanded = open.has(group.category.id)
      const listId = `nav-category-${group.category.id}`
      return <div key={group.category.id} className={`nav-category${expanded ? ' is-open' : ''}`}>
        <button type="button" className="nav-category-toggle" aria-expanded={expanded} aria-controls={listId} onClick={() => toggle(group.category.id)}>
          <span>{group.category.name}</span>
          <small>{group.modules.length}</small>
          <ChevronDown size={15} aria-hidden="true"/>
        </button>
        {expanded && <div id={listId} className="nav-category-list">{group.modules.map(entry => item(entry.id, entry.title))}</div>}
      </div>
    })}
  </>
}
