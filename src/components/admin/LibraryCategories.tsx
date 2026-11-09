import { useState } from 'react'
import type { Dispatch, FormEvent, SetStateAction } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { learningModules } from '@/lib/modules'
import type { ModuleId } from '@/lib/modules'
import { CATEGORY_LIMIT, CATEGORY_NAME_MAX, OTHER_CATEGORY, TOP_COUNT, arrangeModules } from '@/lib/module-layout'
import type { ModuleLayout } from '@/lib/module-layout'

const byId = new Map(learningModules.map(item => [item.id, item]))

function slug(name: string, taken: Set<string>) {
  const base = name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'category'
  let id = base
  for (let count = 2; taken.has(id); count++) id = `${base}-${count}`
  return id
}

export function LibraryCategories({ draft, setDraft }: { draft: ModuleLayout; setDraft: Dispatch<SetStateAction<ModuleLayout>> }) {
  const [newName, setNewName] = useState('')
  const [filter, setFilter] = useState('')
  const hidden = new Set(draft.hidden)
  const autoTop = arrangeModules(draft).top
  const query = filter.trim().toLowerCase()
  const rows = draft.order.filter(id => !query || byId.get(id)?.title.toLowerCase().includes(query))

  function setTop(slot: number, id: string) {
    setDraft(current => {
      const top = [...current.top]
      while (top.length < slot) top.push(autoTop[top.length]?.id ?? current.order[0])
      if (id) top[slot] = id as ModuleId
      else top.splice(slot, 1)
      return { ...current, top: [...new Set(top)].slice(0, TOP_COUNT) }
    })
  }

  function addCategory(event: FormEvent) {
    event.preventDefault()
    const name = newName.trim().slice(0, CATEGORY_NAME_MAX)
    if (!name || draft.categories.length >= CATEGORY_LIMIT) return
    setDraft(current => ({ ...current, categories: [...current.categories, { id: slug(name, new Set([OTHER_CATEGORY.id, ...current.categories.map(item => item.id)])), name }] }))
    setNewName('')
  }

  function rename(id: string, name: string) {
    setDraft(current => ({ ...current, categories: current.categories.map(item => item.id === id ? { ...item, name: name.slice(0, CATEGORY_NAME_MAX) } : item) }))
  }

  function moveCategory(index: number, to: number) {
    setDraft(current => {
      if (to < 0 || to >= current.categories.length) return current
      const categories = [...current.categories]
      const [item] = categories.splice(index, 1)
      categories.splice(to, 0, item)
      return { ...current, categories }
    })
  }

  function removeCategory(id: string, name: string) {
    if (!window.confirm(`Remove the category “${name}”? Its modules stay in the library and in any other categories they belong to.`)) return
    setDraft(current => ({
      ...current,
      categories: current.categories.filter(item => item.id !== id),
      assignments: Object.fromEntries(Object.entries(current.assignments).map(([module, list]) => [module, (list ?? []).filter(item => item !== id)])),
    }))
  }

  function toggleAssignment(module: ModuleId, category: string) {
    setDraft(current => {
      const list = current.assignments[module] ?? []
      return { ...current, assignments: { ...current.assignments, [module]: list.includes(category) ? list.filter(item => item !== category) : [...list, category] } }
    })
  }

  const blankNames = draft.categories.some(item => !item.name.trim())

  return <div className="adm-categories">
    <section className="adm-card" aria-labelledby="adm-top-title">
      <div className="adm-card-head"><h3 id="adm-top-title">Top 5</h3></div>
      <p className="adm-help">These five sit at the very top of the sidebar. Leave a slot on Automatic to fill it with the next module in the library order.</p>
      <ol className="adm-top-list">
        {Array.from({ length: TOP_COUNT }, (_, slot) => {
          const chosen = draft.top[slot] ?? ''
          return <li key={slot}>
            <label htmlFor={`adm-top-${slot}`}>#{slot + 1}</label>
            <select id={`adm-top-${slot}`} value={chosen} onChange={event => setTop(slot, event.target.value)} disabled={slot > draft.top.length}>
              <option value="">Automatic{!chosen && autoTop[slot] ? ` (${autoTop[slot].title})` : ''}</option>
              {draft.order.map(id => <option key={id} value={id} disabled={hidden.has(id) || draft.top.includes(id) && draft.top[slot] !== id}>{byId.get(id)?.title}{hidden.has(id) ? ' (hidden)' : ''}</option>)}
            </select>
          </li>
        })}
      </ol>
    </section>

    <section className="adm-card" aria-labelledby="adm-cat-title">
      <div className="adm-card-head"><h3 id="adm-cat-title">Categories</h3><span className="adm-muted">{draft.categories.length} of {CATEGORY_LIMIT}</span></div>
      <p className="adm-help">Categories are the drop-downs in the sidebar and the sort buttons on the homepage, in this order. Empty categories are not shown; modules without a category appear under Other.</p>
      <ul className="adm-cat-list">
        {draft.categories.map((category, index) => {
          const count = draft.order.filter(id => draft.assignments[id]?.includes(category.id)).length
          return <li key={category.id}>
            <input aria-label={`Name of category ${index + 1}`} value={category.name} maxLength={CATEGORY_NAME_MAX} onChange={event => rename(category.id, event.target.value)} className={category.name.trim() ? '' : 'is-invalid'}/>
            <span className="adm-muted">{count} module{count === 1 ? '' : 's'}</span>
            <span className="adm-arrange-actions">
              <button type="button" className="adm-icon" onClick={() => moveCategory(index, index - 1)} disabled={index === 0} aria-label={`Move ${category.name} up`} title="Move up"><ArrowUp size={16} aria-hidden/></button>
              <button type="button" className="adm-icon" onClick={() => moveCategory(index, index + 1)} disabled={index === draft.categories.length - 1} aria-label={`Move ${category.name} down`} title="Move down"><ArrowDown size={16} aria-hidden/></button>
              <button type="button" className="adm-icon" onClick={() => removeCategory(category.id, category.name)} aria-label={`Remove ${category.name}`} title="Remove"><Trash2 size={16} aria-hidden/></button>
            </span>
          </li>
        })}
      </ul>
      {blankNames && <p className="adm-error" role="alert">Every category needs a name before you publish.</p>}
      <form className="adm-cat-add" onSubmit={addCategory}>
        <input aria-label="New category name" placeholder="New category name" value={newName} maxLength={CATEGORY_NAME_MAX} onChange={event => setNewName(event.target.value)}/>
        <button type="submit" className="adm-btn" disabled={!newName.trim() || draft.categories.length >= CATEGORY_LIMIT}><Plus size={15} aria-hidden/> Add category</button>
      </form>
    </section>

    <section className="adm-card" aria-labelledby="adm-assign-title">
      <div className="adm-card-head"><h3 id="adm-assign-title">Which modules go where</h3>
        <input className="adm-cat-search" type="search" aria-label="Find a module" placeholder="Find a module" value={filter} onChange={event => setFilter(event.target.value)}/>
      </div>
      <p className="adm-help">Tick every category a module belongs to. A module can be in several.</p>
      {draft.categories.length === 0 ? <p className="adm-muted">Add a category first.</p> : rows.length === 0 ? <p className="adm-muted">No module matches “{filter}”.</p> : <ul className="adm-assign-list">
        {rows.map(id => {
          const item = byId.get(id)!
          const list = draft.assignments[id] ?? []
          return <li key={id} className={hidden.has(id) ? 'is-hidden' : ''}>
            <span className="adm-assign-title"><img src={item.image} alt="" loading="lazy"/><strong>{item.title}</strong>{hidden.has(id) && <em className="adm-pill">Hidden</em>}{list.length === 0 && <em className="adm-pill">Other</em>}</span>
            <fieldset>
              <legend className="adm-sr">Categories for {item.title}</legend>
              {draft.categories.map(category => <label key={category.id} className={list.includes(category.id) ? 'is-on' : ''}>
                <input type="checkbox" checked={list.includes(category.id)} onChange={() => toggleAssignment(id, category.id)}/>{category.name || 'Unnamed'}
              </label>)}
            </fieldset>
          </li>
        })}
      </ul>}
    </section>
  </div>
}
