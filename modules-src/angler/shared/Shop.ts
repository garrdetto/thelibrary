/** The bait shop catalog, purchases and what can be equipped. Prices are Tackle Credits; nothing here changes the size curve. */
import { BOATS, liveries, normalizePaint } from './Boats'
import type { BoatKind, Livery } from './Boats'
import { REELS, RODS, rodIds } from './Gear'
import type { RodId } from './Gear'
import type { AnglerProfile } from './Profile'
import type { Presentation } from './Species'
import { STYLE_LABELS, bottomStyles, hatStyles, normalizeLook, shoeStyles, topStyles } from './Wardrobe'
import type { Look } from './Wardrobe'

export type ShopCategory = 'rods' | 'reels' | 'boats' | 'motors' | 'electronics' | 'tops' | 'bottoms' | 'shoes' | 'hats' | 'extras' | 'paint'

export interface ShopItem {
  id: string
  name: string
  category: ShopCategory
  price: number
  blurb: string
  requires?: string
}

const wardrobePrices: Record<string, number> = {
  'top:parka': 0, 'top:tee': 0, 'top:hoodie': 350, 'top:flannel': 450, 'top:fishing': 650, 'top:jersey': 550, 'top:tank': 250,
  'bottom:cargo': 0, 'bottom:jeans': 0, 'bottom:sweatpants': 300, 'bottom:joggers': 450, 'bottom:shorts': 250, 'bottom:boardshorts': 400, 'bottom:athletic': 350,
  'shoes:boots': 0, 'shoes:sneakers': 0, 'shoes:hikers': 550, 'shoes:deck': 400,
  'hat:beanie': 0, 'hat:none': 0, 'hat:cap': 0, 'hat:bucket': 300,
  'acc:sunglasses': 400, 'acc:bare-hands': 0,
}

const liveryPrices: Record<Livery, number> = { sweep: 0, solid: 0, twotone: 600, fade: 900, racing: 1400 }

export const MOTORS = [
  { level: 0, name: 'Stock outboard', price: 0, boost: 1 },
  { level: 1, name: 'Tuned prop and trim', price: 1000, boost: 1.06 },
  { level: 2, name: 'High-output outboard', price: 3500, boost: 1.13 },
  { level: 3, name: 'Racing lower unit', price: 9000, boost: 1.2 },
] as const

export const SONARS = [
  { level: 0, name: '2D sonar', price: 0, blurb: 'Depth, bottom hardness and fish arches.' },
  { level: 1, name: 'Down-imaging sonar', price: 1800, blurb: 'Sharper arches with a size hint for each fish.' },
  { level: 2, name: 'Side-imaging and fish ID', price: 5500, blurb: 'Names the likeliest species under the boat and shows the bite outlook for nearby spots.' },
] as const

export function catalog(): ShopItem[] {
  const items: ShopItem[] = []
  for (const id of rodIds) if (RODS[id].price > 0) items.push({ id: `rod:${id}`, name: RODS[id].name, category: 'rods', price: RODS[id].price, blurb: `${RODS[id].blurb} ${RODS[id].lineTest} lb line.` })
  for (const r of REELS) if (r.level > 0) items.push({ id: `reel:${r.level}`, name: r.name, category: 'reels', price: r.price, blurb: `Lands ${Math.round(r.bonus * 100)}% more of the fish that would break off.`, requires: r.level > 1 ? `reel:${r.level - 1}` : undefined })
  items.push({ id: 'boat:jon', name: BOATS.jon.name, category: 'boats', price: 1500, blurb: 'A light tiller boat that floats in a foot of water: perfect for bogs and backwaters. Seats four on benches.' })
  items.push({ id: 'boat:pontoon', name: BOATS.pontoon.name, category: 'boats', price: 7500, blurb: 'A slow, wide party barge with lounges for four and the comfiest idle fishing on the lake.' })
  for (const m of MOTORS) if (m.level > 0) items.push({ id: `motor:${m.level}`, name: m.name, category: 'motors', price: m.price, blurb: `Top speed +${Math.round((m.boost - 1) * 100)}% on every boat.`, requires: m.level > 1 ? `motor:${m.level - 1}` : undefined })
  for (const s of SONARS) if (s.level > 0) items.push({ id: `sonar:${s.level}`, name: s.name, category: 'electronics', price: s.price, blurb: s.blurb, requires: s.level > 1 ? `sonar:${s.level - 1}` : undefined })
  items.push({ id: 'almanac', name: "Guide's Almanac", category: 'electronics', price: 4000, blurb: 'Shows the best bite windows for every lake over the next 24 hours.' })
  for (const [id, price] of Object.entries(wardrobePrices)) {
    if (price === 0) continue
    const [kind, style] = id.split(':')
    const category: ShopCategory = kind === 'top' ? 'tops' : kind === 'bottom' ? 'bottoms' : kind === 'shoes' ? 'shoes' : kind === 'hat' ? 'hats' : 'extras'
    items.push({ id, name: style === 'sunglasses' ? 'Polarized sunglasses' : STYLE_LABELS[style] ?? style, category, price, blurb: style === 'sunglasses' ? 'Cut the glare and look the part.' : 'Wear it in any colour from the palette.' })
  }
  for (const l of liveries) if (liveryPrices[l] > 0) items.push({ id: `livery:${l}`, name: `${l === 'twotone' ? 'Two-tone' : l === 'fade' ? 'Fade' : 'Racing stripes'} livery`, category: 'paint', price: liveryPrices[l], blurb: 'A new hull design for the bass boat, in any colours.' })
  return items
}

export function owns(profile: AnglerProfile, id: string): boolean {
  const [kind, value] = id.split(':')
  if (kind === 'rod') return profile.rods.includes(value as RodId)
  if (kind === 'reel') return profile.reel >= Number(value)
  if (kind === 'motor') return profile.motor >= Number(value)
  if (kind === 'sonar') return profile.sonar >= Number(value)
  if (kind === 'boat') return profile.boats.includes(value as BoatKind)
  if (id in wardrobePrices && wardrobePrices[id] === 0) return true
  if (kind === 'livery' && liveryPrices[value as Livery] === 0) return true
  return profile.items.includes(id)
}

export function purchase(profile: AnglerProfile, id: string): { ok: true } | { ok: false; error: string } {
  const item = catalog().find(i => i.id === id)
  if (!item) return { ok: false, error: 'That item is not sold here.' }
  if (owns(profile, id)) return { ok: false, error: 'You already own that.' }
  if (item.requires && !owns(profile, item.requires)) return { ok: false, error: 'Buy the previous upgrade first.' }
  if (profile.tc < item.price) return { ok: false, error: `You need ${item.price - profile.tc} more Tackle Credits.` }
  profile.tc -= item.price
  const [kind, value] = id.split(':')
  if (kind === 'rod') profile.rods.push(value as RodId)
  else if (kind === 'reel') profile.reel = Number(value)
  else if (kind === 'motor') profile.motor = Number(value)
  else if (kind === 'sonar') profile.sonar = Number(value)
  else if (kind === 'boat') profile.boats.push(value as BoatKind)
  else profile.items.push(id)
  return { ok: true }
}

export function lookAllowed(profile: AnglerProfile, look: Look): string | null {
  if (!owns(profile, `top:${look.top}`)) return 'You do not own that top yet.'
  if (!owns(profile, `bottom:${look.bottom}`)) return 'You do not own those pants yet.'
  if (!owns(profile, `shoes:${look.shoes}`)) return 'You do not own those shoes yet.'
  if (!owns(profile, `hat:${look.hat}`)) return 'You do not own that hat yet.'
  if (look.sunglasses && !owns(profile, 'acc:sunglasses')) return 'You do not own sunglasses yet.'
  return null
}

export function equip(profile: AnglerProfile, patch: Record<string, unknown>): { ok: true } | { ok: false; error: string } {
  if (patch.look !== undefined) {
    const look = normalizeLook(patch.look)
    const problem = lookAllowed(profile, look)
    if (problem) return { ok: false, error: problem }
    profile.look = look
  }
  if (patch.paint !== undefined && patch.paint && typeof patch.paint === 'object') {
    const { kind, paint } = patch.paint as { kind?: unknown; paint?: unknown }
    if (typeof kind !== 'string' || !(kind in BOATS)) return { ok: false, error: 'Unknown boat.' }
    const next = normalizePaint(paint)
    if (!owns(profile, `livery:${next.livery}`)) return { ok: false, error: 'You do not own that livery yet.' }
    profile.paint[kind as BoatKind] = next
  }
  if (patch.boat !== undefined) {
    if (typeof patch.boat !== 'string' || !profile.boats.includes(patch.boat as BoatKind)) return { ok: false, error: 'You do not own that boat.' }
    profile.boat = patch.boat as BoatKind
  }
  if (patch.rig !== undefined && patch.rig && typeof patch.rig === 'object') {
    const { rod, presentation } = patch.rig as { rod?: unknown; presentation?: unknown }
    if (typeof rod !== 'string' || !profile.rods.includes(rod as RodId)) return { ok: false, error: 'You do not own that rod.' }
    if (typeof presentation !== 'string' || !RODS[rod as RodId].presentations.includes(presentation as Presentation)) return { ok: false, error: 'That rod cannot fish that presentation.' }
    profile.rig = { rod: rod as RodId, presentation: presentation as Presentation }
  }
  return { ok: true }
}

export function wardrobeOptions() {
  return { tops: topStyles, bottoms: bottomStyles, shoes: shoeStyles, hats: hatStyles }
}
