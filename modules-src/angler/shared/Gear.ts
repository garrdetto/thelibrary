/** Rods, reels and presentations. Gear changes which fish come and how many get away, never the size curve. */
import type { Presentation } from './Species'

export type RodId = 'panfish' | 'walleye' | 'baitcaster' | 'catfish' | 'musky' | 'sturgeon'

export interface RodDef {
  id: RodId
  name: string
  lineTest: number
  presentations: Presentation[]
  price: number
  length: number
  color: [number, number, number]
  blurb: string
}

export const RODS: Record<RodId, RodDef> = {
  panfish: { id: 'panfish', name: 'Panfish Whisper', lineTest: 4, presentations: ['bobber', 'jig'], price: 0, length: 1.6, color: [0.85, 0.75, 0.35], blurb: 'Ultralight spinning rod on 4 lb line. Bobbers and tiny jigs for bluegill, perch and crappie.' },
  walleye: { id: 'walleye', name: 'Walleye Stick', lineTest: 8, presentations: ['jig', 'livebait'], price: 0, length: 2.0, color: [0.15, 0.2, 0.3], blurb: 'Medium spinning rod on 8 lb line. Jig and minnow or a slip-sinker rig: the all-rounder.' },
  baitcaster: { id: 'baitcaster', name: 'Baitcaster Pro', lineTest: 14, presentations: ['crank', 'spinner'], price: 1500, length: 2.1, color: [0.55, 0.08, 0.06], blurb: 'Medium-heavy casting rod on 14 lb line for crankbaits and spinnerbaits. Bass and pike.' },
  catfish: { id: 'catfish', name: 'Catfish Cannon', lineTest: 20, presentations: ['cutbait', 'livebait'], price: 2500, length: 2.3, color: [0.2, 0.35, 0.18], blurb: 'Heavy rod on 20 lb line for cut bait and live bait on the bottom. Best after dark.' },
  musky: { id: 'musky', name: 'Musky Mauler', lineTest: 80, presentations: ['bucktail', 'crank'], price: 6000, length: 2.6, color: [0.08, 0.08, 0.08], blurb: 'Extra-heavy rod on 80 lb braid. Ten-inch bucktails for musky and big pike; long waits.' },
  sturgeon: { id: 'sturgeon', name: 'Sturgeon Rig', lineTest: 100, presentations: ['crawler', 'cutbait'], price: 12000, length: 2.7, color: [0.3, 0.22, 0.12], blurb: 'Surf-weight rod on 100 lb braid with a heavy sinker. Built for river giants.' },
}

export const rodIds = Object.keys(RODS) as RodId[]

export const PRESENTATIONS: Record<Presentation, { name: string; short: string; float: boolean; size: number }> = {
  bobber: { name: 'Slip bobber and waxworm', short: 'Bobber', float: true, size: -0.25 },
  jig: { name: 'Jig and minnow', short: 'Jig', float: false, size: 0 },
  livebait: { name: 'Live minnow on a slip sinker', short: 'Live bait', float: false, size: 0.05 },
  crank: { name: 'Crankbait', short: 'Crankbait', float: false, size: 0.1 },
  spinner: { name: 'Spinnerbait', short: 'Spinnerbait', float: false, size: 0.05 },
  bucktail: { name: '10-inch bucktail', short: 'Bucktail', float: false, size: 0.35 },
  cutbait: { name: 'Cut bait on the bottom', short: 'Cut bait', float: false, size: 0.1 },
  crawler: { name: 'Nightcrawler gob, heavy sinker', short: 'Crawlers', float: false, size: 0 },
}

export interface Rig {
  rod: RodId
  presentation: Presentation
}

export const REELS = [
  { level: 0, name: 'Stock reel', price: 0, bonus: 0 },
  { level: 1, name: 'Smooth-drag reel', price: 400, bonus: 0.05 },
  { level: 2, name: 'Sealed-drag reel', price: 1200, bonus: 0.1 },
  { level: 3, name: 'Tournament reel', price: 3500, bonus: 0.15 },
] as const

export function validRig(rig: Rig, owned: RodId[]): boolean {
  return owned.includes(rig.rod) && RODS[rig.rod]?.presentations.includes(rig.presentation)
}
