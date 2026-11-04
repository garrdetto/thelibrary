import { isModuleAvailable, learningModules as allLearningModules } from './modules'
import type { LearningModule, ModuleId } from './modules'

export type ModuleLayout = {
  order: ModuleId[]
  hidden: ModuleId[]
  featured: ModuleId | null
  updatedAt: string | null
}

const learningModules = allLearningModules.filter(item => isModuleAvailable(item.id))

export const moduleIds = learningModules.map(item => item.id) as [ModuleId, ...ModuleId[]]

export const defaultModuleLayout: ModuleLayout = { order: [...moduleIds], hidden: [], featured: null, updatedAt: null }

const known = new Set<string>(moduleIds)

export function normalizeModuleLayout(input: Partial<ModuleLayout> | null | undefined): ModuleLayout {
  const seen = new Set<string>()
  const order: ModuleId[] = []
  for (const id of input?.order ?? []) if (known.has(id) && !seen.has(id)) { seen.add(id); order.push(id) }
  for (const id of moduleIds) if (!seen.has(id)) order.push(id)
  const hidden = [...new Set((input?.hidden ?? []).filter(id => known.has(id)))]
  const featured = input?.featured && known.has(input.featured) && !hidden.includes(input.featured) ? input.featured : null
  return { order, hidden, featured, updatedAt: input?.updatedAt ?? null }
}

export function arrangeModules(layout: ModuleLayout): { visible: LearningModule[]; featured: LearningModule } {
  const byId = new Map(learningModules.map(item => [item.id, item]))
  const hidden = new Set(layout.hidden)
  const visible = normalizeModuleLayout(layout).order.filter(id => !hidden.has(id)).map(id => byId.get(id)!)
  const list = visible.length ? visible : learningModules
  const featured = (layout.featured && list.find(item => item.id === layout.featured)) || list[0]
  return { visible: list, featured }
}

export function sameLayout(a: ModuleLayout, b: ModuleLayout) {
  return a.order.join() === b.order.join() && [...a.hidden].sort().join() === [...b.hidden].sort().join() && a.featured === b.featured
}
