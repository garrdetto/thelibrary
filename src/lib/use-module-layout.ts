import { useEffect, useState } from 'react'
import { defaultModuleLayout, normalizeModuleLayout } from './module-layout'
import type { ModuleLayout } from './module-layout'

let current: ModuleLayout | null = null
let loading: Promise<void> | null = null
const listeners = new Set<(layout: ModuleLayout) => void>()

function publish(layout: ModuleLayout) {
  current = layout
  listeners.forEach(listener => listener(layout))
}

async function readResponse(response: Response) {
  const result = await response.json().catch(() => ({})) as { layout?: Partial<ModuleLayout>; error?: string }
  if (!response.ok || !result.layout) throw new Error(result.error ?? 'The library order is unavailable right now.')
  return normalizeModuleLayout(result.layout)
}

export function loadModuleLayout(force = false) {
  if (loading && !force) return loading
  loading = fetch('/api/module-layout', { credentials: 'same-origin' })
    .then(readResponse)
    .then(publish)
    .catch(() => { if (!current) publish(defaultModuleLayout) })
  return loading
}

export function useModuleLayout() {
  const [layout, setLayout] = useState<ModuleLayout>(current ?? defaultModuleLayout)
  useEffect(() => {
    listeners.add(setLayout)
    if (current) setLayout(current)
    else void loadModuleLayout()
    return () => { listeners.delete(setLayout) }
  }, [])
  return layout
}

async function send(body: unknown) {
  const response = await fetch('/api/module-layout', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const layout = await readResponse(response)
  publish(layout)
  return layout
}

export function saveModuleLayout(layout: ModuleLayout) {
  return send({ order: layout.order, hidden: layout.hidden, featured: layout.featured })
}

export function resetModuleLayout() {
  return send({ action: 'reset' })
}
