import type { Design } from '../shared/Design'
import { materialByIndex, materialIndex } from '../shared/Materials'

export type LevelProgress = { cost: number; stars: number }
export type Summary = { signedIn: boolean; progress: Record<number, LevelProgress>; points: number; stars: number }

export function pack(design: Design): number[][] {
  return design.beams.map(beam => [beam.x1, beam.y1, beam.x2, beam.y2, materialIndex[beam.m]])
}

export function unpack(beams: number[][]): Design {
  return { beams: beams.filter(row => Array.isArray(row) && row.length === 5 && materialByIndex[row[4]]).map(([x1, y1, x2, y2, m]) => ({ x1, y1, x2, y2, m: materialByIndex[m] })) }
}

export async function loadSummary(): Promise<Summary> {
  try {
    const response = await fetch('/api/bridge', { credentials: 'same-origin' })
    if (!response.ok) throw new Error('offline')
    return await response.json() as Summary
  } catch {
    return { signedIn: false, progress: {}, points: 0, stars: 0 }
  }
}

export async function loadSaved(level: number): Promise<Design | null> {
  try {
    const response = await fetch(`/api/bridge?level=${level}`, { credentials: 'same-origin' })
    if (!response.ok) return null
    const body = await response.json() as { beams: number[][] | null }
    return body.beams ? unpack(body.beams) : null
  } catch {
    return null
  }
}

export async function saveSolve(level: number, design: Design): Promise<(Summary & { saved: boolean }) | { error: string }> {
  try {
    const response = await fetch('/api/bridge', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'solve', level, beams: pack(design) }),
    })
    const body = await response.json() as Summary & { saved: boolean; error?: string }
    if (!response.ok) return { error: body.error ?? 'Could not save this bridge.' }
    return { ...body, signedIn: true }
  } catch {
    return { error: 'Could not reach the library to save this bridge.' }
  }
}

const draftKey = (level: number) => `tl-bridge-draft-${level}`

export function readDraft(level: number): Design | null {
  try {
    const raw = localStorage.getItem(draftKey(level))
    return raw ? unpack(JSON.parse(raw) as number[][]) : null
  } catch {
    return null
  }
}

export function writeDraft(level: number, design: Design) {
  try {
    if (design.beams.length) localStorage.setItem(draftKey(level), JSON.stringify(pack(design)))
    else localStorage.removeItem(draftKey(level))
  } catch {
    /* storage unavailable */
  }
}
