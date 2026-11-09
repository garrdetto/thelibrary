import type { Need } from './Needs'
import type { LifeStage } from './Family'
import { MORE_ITEMS } from './CatalogMore'

export type Pose = 'stand' | 'sit' | 'lie'
/** Who may use an action: everyone on the lot that can reach it, household only, or guests only when the owner allows fridge and beds. */
export type GuestRule = 'yes' | 'ask' | 'no'
export type Placement = 'indoor' | 'outdoor' | 'any'
export type Category = 'seating' | 'beds' | 'surfaces' | 'kitchen' | 'bathroom' | 'electronics' | 'hobbies' | 'kids' | 'lighting' | 'decor' | 'outdoor'

export interface ActionDef {
  id: string
  label: string
  /** Longest the action runs, in sim minutes; it ends early once every need it feeds is full. */
  minutes: number
  gains: Partial<Record<Need, number>>
  /** Household money earned (or spent when negative) per sim minute. */
  money?: number
  pose: Pose
  guest: GuestRule
  /** Youngest and oldest life stage that may use it; see `actionAges` in `shared/Family.ts` for the default. */
  ages?: [LifeStage, LifeStage]
}

export interface ObjectDef {
  id: string
  name: string
  category: Category
  price: number
  w: number
  d: number
  height: number
  place: Placement
  /** Flat objects (rugs) never block walking or other objects. */
  flat?: boolean
  /** How many Sims can use it at once (sofas, benches, picnic tables). */
  seats?: number
  color: string
  accent: string
  actions: ActionDef[]
}

const BASE_ITEMS: readonly ObjectDef[] = [
  { id: 'bed-twin', name: 'Pine Twin Bed', category: 'beds', price: 320, w: 1, d: 2, height: 0.6, place: 'indoor', color: '#c79a64', accent: '#5b83c4',
    actions: [{ id: 'sleep', label: 'Sleep', minutes: 480, gains: { energy: 0.26 }, pose: 'lie', guest: 'ask' }, { id: 'nap', label: 'Nap', minutes: 90, gains: { energy: 0.2 }, pose: 'lie', guest: 'ask' }] },
  { id: 'bed-double', name: 'Harbor Double Bed', category: 'beds', price: 950, w: 2, d: 2, height: 0.65, place: 'indoor', seats: 2, color: '#7a4f33', accent: '#d9d2c3',
    actions: [{ id: 'sleep', label: 'Sleep', minutes: 480, gains: { energy: 0.3 }, pose: 'lie', guest: 'ask' }, { id: 'nap', label: 'Nap', minutes: 90, gains: { energy: 0.24 }, pose: 'lie', guest: 'ask' }] },
  { id: 'fridge', name: 'Cool Box Fridge', category: 'kitchen', price: 620, w: 1, d: 1, height: 1.9, place: 'indoor', color: '#e8ecef', accent: '#9aa3ab',
    actions: [{ id: 'snack', label: 'Grab a snack', minutes: 12, gains: { hunger: 1.6 }, pose: 'stand', guest: 'ask' }, { id: 'meal', label: 'Have a cold meal', minutes: 35, gains: { hunger: 1.9 }, money: -0.4, pose: 'stand', guest: 'ask' }] },
  { id: 'stove', name: 'Four-Burner Stove', category: 'kitchen', price: 450, w: 1, d: 1, height: 0.92, place: 'indoor', color: '#f2f2f0', accent: '#2c2c2c',
    actions: [{ id: 'cook', label: 'Cook a hot dinner', minutes: 45, gains: { hunger: 2.4, fun: 0.15 }, money: -0.5, pose: 'stand', guest: 'no', ages: ['teen', 'adult'] }] },
  { id: 'counter', name: 'Butcher-Block Counter', category: 'kitchen', price: 160, w: 1, d: 1, height: 0.92, place: 'indoor', color: '#f5f1e8', accent: '#b98a55', actions: [] },
  { id: 'kitchen-sink', name: 'Farmhouse Sink', category: 'kitchen', price: 280, w: 1, d: 1, height: 0.92, place: 'indoor', color: '#f5f1e8', accent: '#c7ced4',
    actions: [{ id: 'wash', label: 'Wash dishes', minutes: 20, gains: { hygiene: 0.3 }, pose: 'stand', guest: 'yes' }] },
  { id: 'dining-table', name: 'Oak Dining Table', category: 'kitchen', price: 300, w: 2, d: 1, height: 0.76, place: 'indoor', color: '#9b6a3d', accent: '#7c532f', actions: [] },
  { id: 'dining-chair', name: 'Spindle Chair', category: 'seating', price: 110, w: 1, d: 1, height: 0.9, place: 'any', color: '#9b6a3d', accent: '#c9b28d',
    actions: [{ id: 'sit', label: 'Sit down', minutes: 30, gains: { energy: 0.08, fun: 0.05 }, pose: 'sit', guest: 'yes' }] },
  { id: 'sofa', name: 'Cloud Sofa', category: 'seating', price: 780, w: 2, d: 1, height: 0.85, place: 'indoor', seats: 2, color: '#5a7fa8', accent: '#e8dcc8',
    actions: [{ id: 'sit', label: 'Relax', minutes: 45, gains: { energy: 0.1, fun: 0.25 }, pose: 'sit', guest: 'yes' }, { id: 'nap', label: 'Nap', minutes: 75, gains: { energy: 0.17 }, pose: 'lie', guest: 'ask' }] },
  { id: 'armchair', name: 'Wingback Armchair', category: 'seating', price: 380, w: 1, d: 1, height: 1.0, place: 'indoor', color: '#a8553f', accent: '#5b3a28',
    actions: [{ id: 'sit', label: 'Relax', minutes: 45, gains: { energy: 0.1, fun: 0.22 }, pose: 'sit', guest: 'yes' }] },
  { id: 'tv', name: 'Wide-Screen TV', category: 'electronics', price: 540, w: 1, d: 1, height: 1.3, place: 'indoor', color: '#2b2b30', accent: '#3a6fa8',
    actions: [{ id: 'watch', label: 'Watch TV', minutes: 60, gains: { fun: 1.2 }, pose: 'stand', guest: 'yes' }] },
  { id: 'bookshelf', name: 'Tall Bookshelf', category: 'decor', price: 260, w: 1, d: 1, height: 1.9, place: 'indoor', color: '#7c532f', accent: '#c44e3f',
    actions: [{ id: 'read', label: 'Read a book', minutes: 50, gains: { fun: 0.7 }, pose: 'stand', guest: 'yes' }] },
  { id: 'toilet', name: 'Low-Flow Toilet', category: 'bathroom', price: 300, w: 1, d: 1, height: 0.8, place: 'indoor', color: '#f7f7f5', accent: '#dfe3e6',
    actions: [{ id: 'use', label: 'Use toilet', minutes: 8, gains: { bladder: 12 }, pose: 'sit', guest: 'yes' }] },
  { id: 'shower', name: 'Glass Shower', category: 'bathroom', price: 680, w: 1, d: 1, height: 2.1, place: 'indoor', color: '#dfe7ec', accent: '#9fc6dc',
    actions: [{ id: 'shower', label: 'Take a shower', minutes: 25, gains: { hygiene: 4 }, pose: 'stand', guest: 'ask' }] },
  { id: 'bath-sink', name: 'Pedestal Sink', category: 'bathroom', price: 210, w: 1, d: 1, height: 0.9, place: 'indoor', color: '#f7f7f5', accent: '#c7ced4',
    actions: [{ id: 'wash', label: 'Wash up', minutes: 10, gains: { hygiene: 2.2 }, pose: 'stand', guest: 'yes' }] },
  { id: 'computer', name: 'Desk and Computer', category: 'electronics', price: 900, w: 1, d: 1, height: 1.2, place: 'indoor', color: '#8a6a48', accent: '#30343a',
    actions: [
      { id: 'work', label: 'Freelance work', minutes: 120, gains: { fun: -0.15, energy: -0.05 }, money: 1.1, pose: 'sit', guest: 'no', ages: ['teen', 'adult'] },
      { id: 'play', label: 'Browse and chat online', minutes: 50, gains: { fun: 1.0, social: 0.3 }, pose: 'sit', guest: 'no' },
    ] },
  { id: 'stereo', name: 'Bookshelf Stereo', category: 'electronics', price: 240, w: 1, d: 1, height: 0.7, place: 'indoor', color: '#3a3a40', accent: '#d8a23c',
    actions: [{ id: 'dance', label: 'Dance', minutes: 30, gains: { fun: 1.1, energy: -0.08, social: 0.15 }, pose: 'stand', guest: 'yes' }] },
  { id: 'lamp', name: 'Arc Floor Lamp', category: 'decor', price: 90, w: 1, d: 1, height: 1.7, place: 'indoor', color: '#2f2f2f', accent: '#ffe7b0', actions: [] },
  { id: 'plant', name: 'Potted Fern', category: 'decor', price: 60, w: 1, d: 1, height: 0.9, place: 'any', color: '#b5653d', accent: '#4f8f45', actions: [] },
  { id: 'rug', name: 'Woven Rug', category: 'decor', price: 130, w: 2, d: 2, height: 0.02, place: 'indoor', flat: true, color: '#b8574a', accent: '#e9d6b4', actions: [] },
  { id: 'grill', name: 'Kettle Grill', category: 'outdoor', price: 340, w: 1, d: 1, height: 1.0, place: 'outdoor', color: '#22252a', accent: '#c0392b',
    actions: [{ id: 'grill', label: 'Grill burgers', minutes: 40, gains: { hunger: 2.0, fun: 0.4, social: 0.2 }, money: -0.4, pose: 'stand', guest: 'yes', ages: ['teen', 'adult'] }] },
  { id: 'bench', name: 'Park Bench', category: 'outdoor', price: 220, w: 2, d: 1, height: 0.85, place: 'outdoor', seats: 2, color: '#7f5a3b', accent: '#2f3236',
    actions: [{ id: 'sit', label: 'Sit and people-watch', minutes: 40, gains: { fun: 0.35, energy: 0.06, social: 0.1 }, pose: 'sit', guest: 'yes' }] },
  { id: 'picnic', name: 'Picnic Table', category: 'outdoor', price: 420, w: 2, d: 2, height: 0.78, place: 'outdoor', seats: 4, color: '#a87a4a', accent: '#8a6038',
    actions: [{ id: 'sit', label: 'Sit and chat', minutes: 40, gains: { fun: 0.25, social: 0.5 }, pose: 'sit', guest: 'yes' }] },
  { id: 'garden', name: 'Raised Garden Bed', category: 'outdoor', price: 160, w: 2, d: 1, height: 0.5, place: 'outdoor', color: '#8a5d38', accent: '#5aa04a',
    actions: [{ id: 'tend', label: 'Tend the garden', minutes: 40, gains: { fun: 0.55 }, pose: 'stand', guest: 'yes' }] },
  { id: 'hoop', name: 'Driveway Hoop', category: 'outdoor', price: 300, w: 1, d: 1, height: 3.0, place: 'outdoor', color: '#e8e8e8', accent: '#e8682c',
    actions: [{ id: 'shoot', label: 'Shoot hoops', minutes: 40, gains: { fun: 1.0, energy: -0.12, hygiene: -0.08 }, pose: 'stand', guest: 'yes' }] },
  { id: 'tree', name: 'Shade Maple', category: 'outdoor', price: 120, w: 1, d: 1, height: 5.0, place: 'outdoor', color: '#6b4a2f', accent: '#4f8a3f', actions: [] },
  { id: 'flowers', name: 'Flower Bed', category: 'outdoor', price: 70, w: 1, d: 1, height: 0.4, place: 'outdoor', color: '#6b4a2f', accent: '#e86f9a', actions: [] },
]

export const CATALOG: readonly ObjectDef[] = [...BASE_ITEMS, ...MORE_ITEMS]

const BY_ID = new Map(CATALOG.map(def => [def.id, def]))

export function objectDef(id: string): ObjectDef | undefined {
  return BY_ID.get(id)
}

export function actionDef(def: ObjectDef, id: string): ActionDef | undefined {
  return def.actions.find(action => action.id === id)
}

export const CATEGORY_LABELS: Record<Category, string> = {
  seating: 'Seating', beds: 'Beds', surfaces: 'Tables & storage', kitchen: 'Kitchen', bathroom: 'Bathroom', electronics: 'Electronics',
  hobbies: 'Hobbies', kids: 'Babies & kids', lighting: 'Lighting', decor: 'Decor', outdoor: 'Yard & play',
}

export const BUILD_COSTS = { wall: 12, floor: 4, door: 150, window: 90, refund: 0.5 }

export const FLOOR_MATERIALS = [
  { name: 'Honey oak', color: '#c08a52' },
  { name: 'Walnut', color: '#7a5034' },
  { name: 'Slate tile', color: '#7d8790' },
  { name: 'White tile', color: '#e7e6e1' },
  { name: 'Sage carpet', color: '#9aab8c' },
  { name: 'Patio stone', color: '#b3aa9c' },
  { name: 'Cedar deck', color: '#b9814f' },
  { name: 'Brick pavers', color: '#b0604a' },
  { name: 'Flagstone', color: '#a8a090' },
  { name: 'Poured concrete', color: '#cfccc4' },
  { name: 'Pea gravel', color: '#c2b8a6' },
  { name: 'Herringbone oak', color: '#c8935a' },
  { name: 'Hex tile', color: '#e9e7e2' },
  { name: 'Marble', color: '#efeeea' },
  { name: 'Terracotta tile', color: '#c47a55' },
] as const

/** A short icon for each Buy category tab. */
export const CATEGORY_ICONS: Record<Category, string> = {
  seating: '🛋', beds: '🛏', surfaces: '🗄', kitchen: '🍳', bathroom: '🛁', electronics: '📺', hobbies: '🎨', kids: '🧸', lighting: '💡', decor: '🪴', outdoor: '🌳',
}
