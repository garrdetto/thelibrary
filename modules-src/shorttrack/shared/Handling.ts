import type { Config, TrackId } from '../next/sim/config'

export const HANDLING_TRACKS: TrackId[] = ['prison', 'bullring', 'dells', 'dellswide', 'dirt']

type CfgKey = 'grip' | 'aiGrip' | 'apronGrip' | 'power' | 'maxAccel' | 'brake' | 'engineBrake' | 'drag' | 'steerLow' | 'steerSpeed' | 'steerRampIn' | 'steerRampOut'

export type HandlingSetting = {
  key: string
  label: string
  help: string
  min: number
  max: number
  fields: CfgKey[]
}

/** Handling settings, each a multiplier on the track's stock numbers (1 = stock). */
export const HANDLING_SETTINGS = [
  { key: 'grip', label: 'Track grip', help: 'How hard the tires hold on the racing surface. The AI drives to the same grip.', min: 0.6, max: 1.6, fields: ['grip', 'aiGrip'] },
  { key: 'apronGrip', label: 'Apron grip', help: 'Grip on the flat apron below the racing surface.', min: 0.5, max: 1.6, fields: ['apronGrip'] },
  { key: 'power', label: 'Engine power', help: 'Pull at speed and top speed.', min: 0.5, max: 1.6, fields: ['power'] },
  { key: 'accel', label: 'Acceleration off the line', help: 'The most the car can accelerate at low speed.', min: 0.5, max: 1.6, fields: ['maxAccel'] },
  { key: 'brake', label: 'Brakes', help: 'Braking strength.', min: 0.5, max: 1.8, fields: ['brake'] },
  { key: 'engineBrake', label: 'Lift-off slowing', help: 'How quickly the car slows when you lift off the gas.', min: 0.3, max: 2, fields: ['engineBrake'] },
  { key: 'drag', label: 'Air drag', help: 'Higher drag lowers top speed on the straights.', min: 0.5, max: 2, fields: ['drag'] },
  { key: 'steer', label: 'Steering lock', help: 'How far the front wheels turn.', min: 0.6, max: 1.6, fields: ['steerLow'] },
  { key: 'steerSpeed', label: 'Steering fall-off at speed', help: 'Higher means less steering at high speed; lower keeps more lock.', min: 0.4, max: 2, fields: ['steerSpeed'] },
  { key: 'steerResponse', label: 'Steering response', help: 'How quickly the wheel follows your input.', min: 0.4, max: 2.5, fields: ['steerRampIn', 'steerRampOut'] },
] as const satisfies readonly HandlingSetting[]

export type HandlingKey = (typeof HANDLING_SETTINGS)[number]['key']
export type HandlingTune = Partial<Record<HandlingKey, number>>
export type HandlingBase = Record<CfgKey, number>

const round = (value: number) => Math.round(value * 100) / 100

/** Keeps known settings in range, rounded to whole percent; drops stock (1) values. */
export function sanitizeHandling(raw: unknown): HandlingTune {
  const out: HandlingTune = {}
  if (!raw || typeof raw !== 'object') return out
  const source = raw as Record<string, unknown>
  for (const setting of HANDLING_SETTINGS) {
    const value = source[setting.key]
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    const clean = round(Math.min(setting.max, Math.max(setting.min, value)))
    if (clean !== 1) out[setting.key] = clean
  }
  return out
}

export function handlingBase(cfg: Config): HandlingBase {
  const base = {} as HandlingBase
  for (const setting of HANDLING_SETTINGS) for (const field of setting.fields) base[field] = cfg[field]
  return base
}

/** Sets the config's handling numbers to the stock numbers times the tune. */
export function applyHandling(cfg: Config, base: HandlingBase, tune: HandlingTune): void {
  for (const setting of HANDLING_SETTINGS) {
    const factor = tune[setting.key] ?? 1
    for (const field of setting.fields) cfg[field] = base[field] * factor
  }
}

export function sameHandling(a: HandlingTune, b: HandlingTune): boolean {
  return HANDLING_SETTINGS.every(setting => (a[setting.key] ?? 1) === (b[setting.key] ?? 1))
}

export function isHandlingTrack(value: unknown): value is TrackId {
  return typeof value === 'string' && (HANDLING_TRACKS as string[]).includes(value)
}
