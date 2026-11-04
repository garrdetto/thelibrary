export const M = {
  paint: 0, ridePaint: 1, steel: 2, structural: 3, concrete: 4, wood: 5, fiberglass: 6, glass: 7, foliage: 8, bark: 9,
  cloth: 10, skin: 11, rubber: 12, terrain: 13, paving: 14, water: 15, stone: 16, chrome: 17, lamp: 18, roof: 19, neon: 20,
} as const

export type MaterialId = typeof M[keyof typeof M]

export const MATERIAL_COUNT = 24

export const LAYER = { neon: -2, none: -1, brushed: 0, painted: 1, concrete: 2, wood: 3, gelcoat: 4, grass: 5, paver: 6, water: 7 } as const

type Material = { rough: number; metal: number; layer: number; scale: number; coat?: number; wrap?: number; bump?: number; f0?: number }

const TABLE: Record<number, Material> = {
  [M.paint]: { rough: 0.55, metal: 0, layer: LAYER.painted, scale: 1.2, bump: 0.25 },
  [M.ridePaint]: { rough: 0.42, metal: 0, layer: LAYER.painted, scale: 1.4, coat: 0.6, bump: 0.2 },
  [M.steel]: { rough: 0.3, metal: 1, layer: LAYER.brushed, scale: 2.2, bump: 0.25 },
  [M.structural]: { rough: 0.48, metal: 0.85, layer: LAYER.brushed, scale: 1.1, bump: 0.35 },
  [M.concrete]: { rough: 0.9, metal: 0, layer: LAYER.concrete, scale: 0.7, bump: 0.8 },
  [M.wood]: { rough: 0.75, metal: 0, layer: LAYER.wood, scale: 0.45, bump: 0.9 },
  [M.fiberglass]: { rough: 0.24, metal: 0, layer: LAYER.gelcoat, scale: 0.8, coat: 0.85, bump: 0.15 },
  [M.glass]: { rough: 0.05, metal: 0, layer: LAYER.none, scale: 1, f0: 0.14, coat: 0.5 },
  [M.foliage]: { rough: 0.82, metal: 0, layer: LAYER.grass, scale: 0.9, wrap: 0.55, bump: 0.6, f0: 0.025 },
  [M.bark]: { rough: 0.9, metal: 0, layer: LAYER.wood, scale: 1.6, bump: 1 },
  [M.cloth]: { rough: 0.95, metal: 0, layer: LAYER.painted, scale: 3, wrap: 0.25, bump: 0.3 },
  [M.skin]: { rough: 0.6, metal: 0, layer: LAYER.none, scale: 1, wrap: 0.45, f0: 0.028 },
  [M.rubber]: { rough: 0.85, metal: 0, layer: LAYER.concrete, scale: 3, bump: 0.2 },
  [M.terrain]: { rough: 0.95, metal: 0, layer: LAYER.grass, scale: 0.35, bump: 0.7, f0: 0.012 },
  [M.paving]: { rough: 0.85, metal: 0, layer: LAYER.paver, scale: 0.5, bump: 0.7, f0: 0.03 },
  [M.water]: { rough: 0.05, metal: 0, layer: LAYER.water, scale: 0.18, f0: 0.02, bump: 1 },
  [M.stone]: { rough: 0.85, metal: 0, layer: LAYER.concrete, scale: 0.5, bump: 1 },
  [M.chrome]: { rough: 0.16, metal: 1, layer: LAYER.brushed, scale: 3, bump: 0.1 },
  [M.lamp]: { rough: 0.3, metal: 0, layer: LAYER.none, scale: 1, coat: 0.3 },
  [M.roof]: { rough: 0.7, metal: 0, layer: LAYER.concrete, scale: 0.9, bump: 0.5 },
  [M.neon]: { rough: 0.35, metal: 0, layer: LAYER.neon, scale: 1, coat: 0.4, f0: 0.05 },
}

export function materialTable(): { a: Float32Array; b: Float32Array } {
  const a = new Float32Array(MATERIAL_COUNT * 4), b = new Float32Array(MATERIAL_COUNT * 4)
  for (let i = 0; i < MATERIAL_COUNT; i++) {
    const m = TABLE[i] ?? TABLE[M.paint]
    a.set([m.rough, m.metal, m.layer, m.scale], i * 4)
    b.set([m.coat ?? 0, m.wrap ?? 0, m.bump ?? 0.5, m.f0 ?? 0.04], i * 4)
  }
  return { a, b }
}
