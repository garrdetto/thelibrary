export const NEEDS = ['hunger', 'energy', 'hygiene', 'bladder', 'social', 'fun'] as const
export type Need = (typeof NEEDS)[number]
export type Needs = Record<Need, number>

export const NEED_LABELS: Record<Need, string> = {
  hunger: 'Hunger', energy: 'Energy', hygiene: 'Hygiene', bladder: 'Bladder', social: 'Social', fun: 'Fun',
}

/** Points lost per sim minute: hunger empties in about 18 hours, bladder in 14, energy in a day. */
export const DECAY: Needs = { hunger: 0.092, energy: 0.07, hygiene: 0.06, bladder: 0.12, social: 0.05, fun: 0.065 }

export function fullNeeds(): Needs {
  return { hunger: 85, energy: 90, hygiene: 85, bladder: 80, social: 70, fun: 75 }
}

export function clampNeed(value: number): number {
  return Math.max(0, Math.min(100, value))
}

export function decayNeeds(needs: Needs, minutes: number, floor = 0): void {
  for (const need of NEEDS) needs[need] = Math.max(Math.min(needs[need], floor), clampNeed(needs[need] - DECAY[need] * minutes))
}

/** How badly a need wants attention: near zero when full, about 4 when empty. */
export function urgency(value: number): number {
  const lack = (100 - clampNeed(value)) / 100
  return lack * lack * 4 + 0.03
}

export function mood(needs: Needs): number {
  let total = 0
  let worst = 100
  for (const need of NEEDS) {
    total += needs[need]
    worst = Math.min(worst, needs[need])
  }
  return Math.round((total / NEEDS.length) * 0.7 + worst * 0.3)
}

export function moodLabel(value: number): string {
  if (value >= 80) return 'Very happy'
  if (value >= 62) return 'Happy'
  if (value >= 45) return 'Fine'
  if (value >= 28) return 'Uncomfortable'
  return 'Miserable'
}

export function sanitizeNeeds(input: unknown): Needs {
  const base = fullNeeds()
  if (!input || typeof input !== 'object') return base
  const source = input as Record<string, unknown>
  for (const need of NEEDS) {
    const value = Number(source[need])
    if (Number.isFinite(value)) base[need] = clampNeed(value)
  }
  return base
}
