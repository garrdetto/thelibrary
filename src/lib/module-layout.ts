import { isModuleAvailable, learningModules as allLearningModules } from './modules'
import type { LearningModule, ModuleId } from './modules'

export type ModuleCategory = { id: string; name: string }

export type ModuleLayout = {
  order: ModuleId[]
  hidden: ModuleId[]
  featured: ModuleId | null
  categories: ModuleCategory[]
  assignments: Partial<Record<ModuleId, string[]>>
  top: ModuleId[]
  updatedAt: string | null
}

export type CategoryGroup = { category: ModuleCategory; modules: LearningModule[] }

export const TOP_COUNT = 5
export const CATEGORY_LIMIT = 24
export const CATEGORY_NAME_MAX = 32
export const categoryIdPattern = /^[a-z0-9-]{1,32}$/
export const OTHER_CATEGORY: ModuleCategory = { id: 'other', name: 'Other' }

const learningModules = allLearningModules.filter(item => isModuleAvailable(item.id))

export const moduleIds = learningModules.map(item => item.id) as [ModuleId, ...ModuleId[]]

export const defaultCategories: ModuleCategory[] = [
  { id: 'sports', name: 'Sports' },
  { id: 'racing', name: 'Racing & Driving' },
  { id: 'worlds', name: 'Build & Explore' },
  { id: 'outdoors', name: 'Outdoors' },
  { id: 'business', name: 'Business' },
  { id: 'puzzles', name: 'Board & Puzzle' },
  { id: 'arcade', name: 'Arcade & Reflex' },
  { id: 'creative', name: 'Creative' },
]

const defaultAssignments: Partial<Record<ModuleId, string[]>> = {
  sandlot3d: ['sports'], sandlot: ['sports'], fairway: ['sports'], darts: ['sports'], bushleague: ['sports'], proskater: ['sports'], pingpong: ['sports'], pool: ['sports'],
  shorttrack: ['racing'], racing: ['racing'], oval: ['racing'], demoderby: ['racing'], botwreck: ['racing'], county: ['racing', 'worlds'],
  maplestreet: ['worlds'], foxlake: ['worlds', 'outdoors'], hood: ['worlds'], park: ['worlds', 'business'], park2: ['worlds', 'business'],
  angler: ['outdoors'], rackreel: ['outdoors'],
  cookies: ['business'], hotdog: ['business'],
  chess: ['puzzles'], checkers: ['puzzles'], '2048': ['puzzles'], tetradrop: ['puzzles'], sudoku: ['puzzles'], minesweeper: ['puzzles'], recall: ['puzzles'], bubbles: ['puzzles'],
  helicopter: ['arcade'], blockhead: ['arcade'], foodchain: ['arcade'], keep: ['arcade'], giant: ['arcade'], alphabet: ['arcade'], party: ['arcade'],
  songmaker: ['creative'], lens: ['creative'],
}

const known = new Set<string>(moduleIds)

function cleanCategories(input: unknown): ModuleCategory[] | null {
  if (!Array.isArray(input)) return null
  const seen = new Set<string>([OTHER_CATEGORY.id])
  const categories: ModuleCategory[] = []
  for (const entry of input) {
    if (!entry || typeof entry !== 'object') continue
    const { id, name } = entry as { id?: unknown; name?: unknown }
    if (typeof id !== 'string' || !categoryIdPattern.test(id) || seen.has(id) || typeof name !== 'string') continue
    const label = name.trim().slice(0, CATEGORY_NAME_MAX)
    if (!label) continue
    seen.add(id)
    categories.push({ id, name: label })
    if (categories.length >= CATEGORY_LIMIT) break
  }
  return categories
}

export function defaultModuleCategories(id: ModuleId) {
  return defaultAssignments[id] ?? []
}

export function normalizeModuleLayout(input: Partial<ModuleLayout> | null | undefined): ModuleLayout {
  const seen = new Set<string>()
  const order: ModuleId[] = []
  for (const id of input?.order ?? []) if (known.has(id) && !seen.has(id)) { seen.add(id); order.push(id) }
  for (const id of moduleIds) if (!seen.has(id)) order.push(id)
  const hidden = [...new Set((input?.hidden ?? []).filter(id => known.has(id)))]
  const featured = input?.featured && known.has(input.featured) && !hidden.includes(input.featured) ? input.featured : null
  const categories = cleanCategories(input?.categories) ?? defaultCategories.map(item => ({ ...item }))
  const categoryIds = new Set(categories.map(item => item.id))
  const given = input?.assignments && typeof input.assignments === 'object' ? input.assignments : {}
  const assignments: Partial<Record<ModuleId, string[]>> = {}
  for (const id of moduleIds) {
    const chosen = Object.prototype.hasOwnProperty.call(given, id) && Array.isArray(given[id]) ? given[id]! : defaultModuleCategories(id)
    assignments[id] = [...new Set(chosen.filter(category => typeof category === 'string' && categoryIds.has(category)))]
  }
  const top = [...new Set((Array.isArray(input?.top) ? input.top : []).filter(id => known.has(id)))].slice(0, TOP_COUNT)
  return { order, hidden, featured, categories, assignments, top, updatedAt: input?.updatedAt ?? null }
}

export const defaultModuleLayout: ModuleLayout = normalizeModuleLayout(null)

export function arrangeModules(layout: ModuleLayout): { visible: LearningModule[]; featured: LearningModule; top: LearningModule[]; groups: CategoryGroup[] } {
  const byId = new Map(learningModules.map(item => [item.id, item]))
  const clean = normalizeModuleLayout(layout)
  const hidden = new Set(clean.hidden)
  const visible = clean.order.filter(id => !hidden.has(id)).map(id => byId.get(id)!)
  const list = visible.length ? visible : learningModules
  const featured = (clean.featured && list.find(item => item.id === clean.featured)) || list[0]
  const top = clean.top.map(id => list.find(item => item.id === id)).filter((item): item is LearningModule => Boolean(item))
  for (const item of list) { if (top.length >= TOP_COUNT) break; if (!top.includes(item)) top.push(item) }
  const groups: CategoryGroup[] = clean.categories.map(category => ({ category, modules: list.filter(item => clean.assignments[item.id]?.includes(category.id)) }))
  const other = list.filter(item => !clean.assignments[item.id]?.length)
  if (other.length) groups.push({ category: OTHER_CATEGORY, modules: other })
  return { visible: list, featured, top, groups: groups.filter(group => group.modules.length > 0) }
}

export function layoutPayload(layout: ModuleLayout) {
  return { order: layout.order, hidden: layout.hidden, featured: layout.featured, categories: layout.categories, assignments: layout.assignments, top: layout.top }
}

export function sameLayout(a: ModuleLayout, b: ModuleLayout) {
  const sorted = (layout: ModuleLayout) => JSON.stringify({ ...layoutPayload(layout), hidden: [...layout.hidden].sort(), assignments: moduleIds.map(id => [...(layout.assignments[id] ?? [])].sort()) })
  return sorted(a) === sorted(b)
}
