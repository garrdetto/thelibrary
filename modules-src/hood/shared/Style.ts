/** Exterior design for a house: cladding top and bottom, trim, windows, doors, roof and extras, plus the architectural features placed around it. */

export const PAINTS = [
  { name: 'Linen', color: '#ece4d4' }, { name: 'Chalk', color: '#f4f2ec' }, { name: 'Fog', color: '#c9d2d6' }, { name: 'Harbor gray', color: '#8e9aa3' },
  { name: 'Slate blue', color: '#5d7389' }, { name: 'Navy', color: '#2d3d55' }, { name: 'Sage', color: '#a7b597' }, { name: 'Olive', color: '#6f7a4c' },
  { name: 'Forest', color: '#3d5641' }, { name: 'Butter', color: '#ecd9a0' }, { name: 'Mustard', color: '#c9a03d' }, { name: 'Terracotta', color: '#c06d4e' },
  { name: 'Barn red', color: '#8b3a2f' }, { name: 'Clay', color: '#b98d6b' }, { name: 'Cocoa', color: '#6b4a38' }, { name: 'Charcoal', color: '#36383c' },
  { name: 'Black', color: '#1d1e20' }, { name: 'Seafoam', color: '#a9cfc2' }, { name: 'Teal', color: '#3c7f7a' }, { name: 'Blush', color: '#e2b8b0' },
  { name: 'Lavender', color: '#b8acd0' }, { name: 'Sand', color: '#d8c3a0' }, { name: 'Brick red', color: '#a5523f' }, { name: 'Antique brick', color: '#b07a5e' },
  { name: 'Limestone', color: '#d6cbb4' }, { name: 'Fieldstone', color: '#a39a8b' }, { name: 'Cedar', color: '#b07a4f' }, { name: 'Weathered wood', color: '#9b9286' },
] as const

export const CLADDINGS = ['lap', 'board', 'shake', 'brick', 'stone', 'stucco', 'panel'] as const
export type Cladding = (typeof CLADDINGS)[number]
export const CLADDING_LABELS: Record<Cladding, string> = { lap: 'Lap siding', board: 'Board and batten', shake: 'Cedar shake', brick: 'Brick', stone: 'Stacked stone', stucco: 'Stucco', panel: 'Modern panel' }
/** Cost per wall face when the cladding changes. */
export const CLADDING_COST: Record<Cladding, number> = { lap: 8, board: 9, shake: 11, brick: 18, stone: 22, stucco: 7, panel: 14 }

export const WAINSCOTS = [0, 0.25, 0.34, 0.5] as const
export const WAINSCOT_LABELS = ['None', 'Quarter', 'Third', 'Half'] as const

export const ROOF_STYLES = ['hip', 'gable', 'flat'] as const
export type RoofStyle = (typeof ROOF_STYLES)[number]
export const ROOF_MATERIALS = ['shingle', 'metal', 'clay', 'slate'] as const
export type RoofMaterial = (typeof ROOF_MATERIALS)[number]
export const ROOF_MATERIAL_LABELS: Record<RoofMaterial, string> = { shingle: 'Asphalt shingle', metal: 'Standing-seam metal', clay: 'Clay tile', slate: 'Slate' }
export const PITCHES = [0.32, 0.5, 0.78] as const
export const OVERHANGS = [0.2, 0.4, 0.7] as const

export const SHUTTERS = ['none', 'panel', 'louvered', 'board'] as const
export type ShutterStyle = (typeof SHUTTERS)[number]
export const WINDOW_GRIDS = ['none', 'cross', 'colonial', 'prairie'] as const
export type WindowGrid = (typeof WINDOW_GRIDS)[number]
export const DOOR_STYLES = ['panel', 'craftsman', 'glass', 'farmhouse', 'modern'] as const
export type DoorStyle = (typeof DOOR_STYLES)[number]
export const FOUNDATIONS = ['stone', 'brick', 'concrete'] as const
export type Foundation = (typeof FOUNDATIONS)[number]

export interface HouseStyle {
  upper: Cladding
  upperColor: number
  lower: Cladding
  lowerColor: number
  wainscot: number
  trimColor: number
  trimWidth: number
  cornerBoards: boolean
  foundation: Foundation
  shutters: ShutterStyle
  shutterColor: number
  windowGrid: WindowGrid
  windowBoxes: boolean
  doorStyle: DoorStyle
  doorColor: number
  roofStyle: RoofStyle
  roofMaterial: RoofMaterial
  roofColor: number
  pitch: number
  overhang: number
  gutters: boolean
  porchLights: boolean
  interiorColor: number
}

export function defaultStyle(): HouseStyle {
  return {
    upper: 'lap', upperColor: 2, lower: 'brick', lowerColor: 22, wainscot: 1,
    trimColor: 1, trimWidth: 1, cornerBoards: true, foundation: 'stone',
    shutters: 'panel', shutterColor: 5, windowGrid: 'colonial', windowBoxes: false,
    doorStyle: 'craftsman', doorColor: 12, roofStyle: 'hip', roofMaterial: 'shingle', roofColor: 15,
    pitch: 1, overhang: 1, gutters: true, porchLights: true, interiorColor: 1,
  }
}

const pick = <T extends string>(list: readonly T[], value: unknown, fallback: T): T => (list as readonly string[]).includes(String(value)) ? (value as T) : fallback
const index = (length: number, value: unknown, fallback: number): number => { const n = Number(value); return Number.isInteger(n) && n >= 0 && n < length ? n : fallback }

export function sanitizeStyle(input: unknown, base?: HouseStyle): HouseStyle {
  const d = base ?? defaultStyle()
  if (!input || typeof input !== 'object') return d
  const v = input as Record<string, unknown>
  return {
    upper: pick(CLADDINGS, v.upper, d.upper), upperColor: index(PAINTS.length, v.upperColor, d.upperColor),
    lower: pick(CLADDINGS, v.lower, d.lower), lowerColor: index(PAINTS.length, v.lowerColor, d.lowerColor),
    wainscot: index(WAINSCOTS.length, v.wainscot, d.wainscot),
    trimColor: index(PAINTS.length, v.trimColor, d.trimColor), trimWidth: index(3, v.trimWidth, d.trimWidth),
    cornerBoards: typeof v.cornerBoards === 'boolean' ? v.cornerBoards : d.cornerBoards,
    foundation: pick(FOUNDATIONS, v.foundation, d.foundation),
    shutters: pick(SHUTTERS, v.shutters, d.shutters), shutterColor: index(PAINTS.length, v.shutterColor, d.shutterColor),
    windowGrid: pick(WINDOW_GRIDS, v.windowGrid, d.windowGrid), windowBoxes: typeof v.windowBoxes === 'boolean' ? v.windowBoxes : d.windowBoxes,
    doorStyle: pick(DOOR_STYLES, v.doorStyle, d.doorStyle), doorColor: index(PAINTS.length, v.doorColor, d.doorColor),
    roofStyle: pick(ROOF_STYLES, v.roofStyle, d.roofStyle), roofMaterial: pick(ROOF_MATERIALS, v.roofMaterial, d.roofMaterial),
    roofColor: index(PAINTS.length, v.roofColor, d.roofColor), pitch: index(PITCHES.length, v.pitch, d.pitch), overhang: index(OVERHANGS.length, v.overhang, d.overhang),
    gutters: typeof v.gutters === 'boolean' ? v.gutters : d.gutters, porchLights: typeof v.porchLights === 'boolean' ? v.porchLights : d.porchLights,
    interiorColor: index(PAINTS.length, v.interiorColor, d.interiorColor),
  }
}

/** Ready-made looks to start from. */
export const STYLE_PRESETS: { name: string; style: Partial<HouseStyle> }[] = [
  { name: 'Classic colonial', style: { upper: 'lap', upperColor: 1, wainscot: 0, shutters: 'louvered', shutterColor: 16, windowGrid: 'colonial', doorStyle: 'panel', doorColor: 12, roofStyle: 'gable', roofMaterial: 'shingle', roofColor: 15, trimColor: 1, pitch: 2 } },
  { name: 'Brick craftsman', style: { upper: 'shake', upperColor: 6, lower: 'brick', lowerColor: 22, wainscot: 2, shutters: 'none', windowGrid: 'prairie', doorStyle: 'craftsman', doorColor: 14, roofStyle: 'gable', roofColor: 14, trimColor: 0, pitch: 1, overhang: 2 } },
  { name: 'Modern farmhouse', style: { upper: 'board', upperColor: 1, wainscot: 0, shutters: 'none', windowGrid: 'none', doorStyle: 'farmhouse', doorColor: 16, roofStyle: 'gable', roofMaterial: 'metal', roofColor: 16, trimColor: 16, trimWidth: 0, pitch: 2 } },
  { name: 'Mid-century', style: { upper: 'panel', upperColor: 26, lower: 'stone', lowerColor: 25, wainscot: 3, shutters: 'none', windowGrid: 'none', doorStyle: 'modern', doorColor: 10, roofStyle: 'hip', roofColor: 15, pitch: 0, overhang: 2, trimColor: 15 } },
  { name: 'Coastal cottage', style: { upper: 'shake', upperColor: 27, wainscot: 0, shutters: 'board', shutterColor: 18, windowGrid: 'cross', windowBoxes: true, doorStyle: 'glass', doorColor: 18, roofStyle: 'hip', roofMaterial: 'slate', roofColor: 3, trimColor: 1 } },
  { name: 'Desert stucco', style: { upper: 'stucco', upperColor: 21, wainscot: 0, shutters: 'none', windowGrid: 'none', doorStyle: 'craftsman', doorColor: 11, roofStyle: 'hip', roofMaterial: 'clay', roofColor: 11, pitch: 0, trimColor: 13, foundation: 'concrete' } },
  { name: 'Urban flat', style: { upper: 'panel', upperColor: 15, lower: 'brick', lowerColor: 23, wainscot: 3, shutters: 'none', windowGrid: 'none', doorStyle: 'modern', doorColor: 9, roofStyle: 'flat', roofColor: 15, trimColor: 16, cornerBoards: false } },
]

export const FEATURE_KINDS = ['canopy', 'porch', 'pergola', 'fence', 'chimney'] as const
export type FeatureKind = (typeof FEATURE_KINDS)[number]
export const CANOPY_STYLES = ['shed', 'gable', 'arch', 'flat', 'awning'] as const
export const PORCH_POSTS = ['square', 'round', 'tapered'] as const
export const FENCE_STYLES = ['picket', 'privacy', 'iron', 'rail', 'gate'] as const
export const FEATURE_LABELS: Record<string, string> = {
  shed: 'Shed', gable: 'Gable', arch: 'Arched', flat: 'Flat modern', awning: 'Striped awning',
  square: 'Square posts', round: 'Round columns', tapered: 'Tapered craftsman',
  picket: 'Picket', privacy: 'Privacy', iron: 'Wrought iron', rail: 'Split rail', gate: 'Gate',
}

/** Something built onto or around the house: a canopy over an opening, a porch roof or pergola over an area, a run of fence, or a chimney. */
export interface Feature {
  id: number
  kind: FeatureKind
  /** Canopy: wall edge; chimney: tile; porch, pergola, fence: from (x, z) to (x2, z2). */
  x: number
  z: number
  v?: 0 | 1
  x2?: number
  z2?: number
  style: string
  color: number
  width?: number
}

export const FEATURE_COSTS = { canopyPerTile: 260, porchPerTile: 70, pergolaPerTile: 45, fencePerEdge: 28, gate: 120, chimney: 950 }

export function featureStyles(kind: FeatureKind): readonly string[] {
  if (kind === 'canopy') return CANOPY_STYLES
  if (kind === 'porch') return PORCH_POSTS
  if (kind === 'fence') return FENCE_STYLES
  return ['standard']
}
