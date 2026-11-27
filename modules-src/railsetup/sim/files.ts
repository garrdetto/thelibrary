import { z } from 'zod'
import { INPUT_IDS } from './inputs'
import type { Snapshot } from './lab'

const num = z.union([z.number(), z.string()]).transform(v => typeof v === 'number' ? v : Number(v)).pipe(z.number().finite())

const frontAdj = z.record(z.string(), z.number().finite())

export const snapshotSchema = z.object({
  name: z.string().trim().min(1).max(60),
  inputs: z.record(z.string(), z.unknown()).transform(raw => {
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(raw)) {
      if (!INPUT_IDS.has(k) || v === '' || v == null) continue
      const n = num.safeParse(v)
      if (n.success) out[k] = n.data
    }
    return out
  }),
  adj: z.object({ L: frontAdj.optional(), R: frontAdj.optional() }).partial().optional(),
  radj: z.record(z.string(), z.number().finite()).optional(),
  out: z.record(z.string(), z.number().nullable()).optional(),
})

export function parseSetupFile(raw: unknown): Snapshot[] {
  const body = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : null
  const list = ([] as unknown[]).concat(body ? (body.setup ?? body.setups ?? body) : raw)
  if (!list.length) throw new Error('not a setup file')
  return list.map(item => {
    const parsed = snapshotSchema.safeParse(item)
    if (!parsed.success) throw new Error('not a setup file')
    const s = parsed.data
    return { name: s.name, inputs: s.inputs, adj: s.adj, radj: s.radj, out: s.out ? Object.fromEntries(Object.entries(s.out).filter(([, v]) => v != null)) as Record<string, number> : undefined }
  })
}

export function setupFile(s: Snapshot) {
  return { app: 'RailSetupLab', kind: 'setup', setup: s }
}

export function fileName(name: string, ext = 'json'): string {
  return (name.replace(/[^\w .-]+/g, '_').trim() || 'setup') + '.' + ext
}
