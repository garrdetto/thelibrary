export const CELL = 2

export type MaterialId = 'road' | 'wood' | 'steel' | 'cable' | 'heavy'

export type Material = {
  id: MaterialId
  name: string
  costPerMetre: number
  massPerMetre: number
  strength: number
  stiffness: number
  road: boolean
  tensionOnly: boolean
  maxCells: number
  unlock: number
  color: string
  edge: string
  width: number
  hint: string
}

export const MATERIALS: Record<MaterialId, Material> = {
  road: { id: 'road', name: 'Road', costPerMetre: 200, massPerMetre: 120, strength: 160_000, stiffness: 2.4e8, road: true, tensionOnly: false, maxCells: 2, unlock: 1, color: '#3b3f47', edge: '#1d2026', width: 0.42, hint: 'Vehicles drive on it. Flat only.' },
  wood: { id: 'wood', name: 'Wood', costPerMetre: 100, massPerMetre: 35, strength: 110_000, stiffness: 1.2e8, road: false, tensionOnly: false, maxCells: 2, unlock: 1, color: '#c98a4b', edge: '#7a4f25', width: 0.24, hint: 'Cheap and light. Good for short spans.' },
  steel: { id: 'steel', name: 'Steel', costPerMetre: 260, massPerMetre: 60, strength: 320_000, stiffness: 4e8, road: false, tensionOnly: false, maxCells: 2, unlock: 11, color: '#d0473b', edge: '#7c231b', width: 0.26, hint: 'Three times as strong as wood.' },
  cable: { id: 'cable', name: 'Cable', costPerMetre: 120, massPerMetre: 12, strength: 300_000, stiffness: 2.5e8, road: false, tensionOnly: true, maxCells: 8, unlock: 21, color: '#e8e2cf', edge: '#8a8573', width: 0.1, hint: 'Pulls only, never pushes. Runs up to 8 squares.' },
  heavy: { id: 'heavy', name: 'Steel road', costPerMetre: 380, massPerMetre: 170, strength: 460_000, stiffness: 5e8, road: true, tensionOnly: false, maxCells: 2, unlock: 31, color: '#4a5260', edge: '#d0473b', width: 0.48, hint: 'A road deck built for heavy loads.' },
}

export const MATERIAL_ORDER: MaterialId[] = ['road', 'heavy', 'wood', 'steel', 'cable']

export const materialIndex: Record<MaterialId, number> = { road: 0, wood: 1, steel: 2, cable: 3, heavy: 4 }
export const materialByIndex: MaterialId[] = ['road', 'wood', 'steel', 'cable', 'heavy']

export function unlockedMaterials(level: number): MaterialId[] {
  return MATERIAL_ORDER.filter(id => MATERIALS[id].unlock <= level)
}
