export type PoolEffects = {
  lighting: boolean
  fade: boolean
  electric: boolean
  pulse: boolean
  chase: boolean
  sparkles: boolean
  aurora: boolean
  spotlight: boolean
}

export const defaultPoolEffects: PoolEffects = { lighting: true, fade: false, electric: false, pulse: false, chase: false, sparkles: false, aurora: false, spotlight: false }

export const poolEffectOptions = [
  { id: 'fade', label: 'Color fade' },
  { id: 'electric', label: 'Electric edge' },
  { id: 'pulse', label: 'Breathing glow' },
  { id: 'chase', label: 'Chasing lights' },
  { id: 'sparkles', label: 'Rail sparkles' },
  { id: 'aurora', label: 'Color wash' },
  { id: 'spotlight', label: 'Table spotlight' },
] as const
