import type { BuildingKind, RoadKind } from '../../../modules-src/tello/data/MapData'
import type { CurveFit, LightStyle, WallStyle } from '../../../modules-src/tello/edits/WorldEdits'

export type ToolId =
  | 'select'
  | 'raise' | 'lower' | 'flatten' | 'smooth' | 'noise' | 'grade'
  | 'fill' | 'level' | 'paint' | 'drain' | 'river'
  | 'road' | 'redraw' | 'roadRemove'
  | 'building' | 'buildingRemove'
  | 'lot' | 'lotEdit' | 'lotRemove'
  | 'plant' | 'clear'
  | 'rail' | 'railCut'
  | 'light' | 'lightRow' | 'lightCut'
  | 'wall'

export type ShapeMode = 'brush' | 'area' | 'rect'

export interface ToolSettings {
  shape: ShapeMode
  radius: number
  falloff: number
  amount: number
  /** Heights the administrator types are relative to Lake Montello's surface (0). */
  height: number
  strength: number
  smoothSize: number
  noiseSize: number
  carry: boolean
  gradeHalf: number
  level: number
  dig: number
  drainFill: boolean
  river: { w: number; depth: number; bank: number; curve: number; fit: CurveFit; start: number; end: number; auto: boolean }
  road: { w: number; k: RoadKind; n: string; curve: number; fit: CurveFit; walkLeft: boolean; walkRight: boolean; walkW: number; walkGap: number; grade: boolean; shoulder: number; gradeFalloff: number; smooth: number; snap: boolean }
  building: { k: BuildingKind; h: number; ridge: number; roof: number; rc: string; n: string; level: boolean; yaw: number }
  lot: { stripes: boolean; margin: number }
  trees: { density: number; pine: number; hardwood: number; birch: number; hMin: number; hMax: number; floor: boolean }
  rail: { side: -1 | 1 }
  light: { style: LightStyle; h: number; spacing: number; offset: number; sides: 'left' | 'right' | 'both' }
  wall: { h: number; th: number; style: WallStyle; posts: number; cap: boolean; closed: boolean }
}

export const DEFAULT_SETTINGS: ToolSettings = {
  shape: 'brush',
  radius: 20,
  falloff: 15,
  amount: 1,
  height: 5,
  strength: 1,
  smoothSize: 12,
  noiseSize: 40,
  carry: true,
  gradeHalf: 6,
  level: 0.5,
  dig: 1.5,
  drainFill: true,
  river: { w: 14, depth: 1.8, bank: 8, curve: 60, fit: 'spline', start: 0, end: -0.5, auto: true },
  road: { w: 7.4, k: 1, n: '', curve: 30, fit: 'arcs', walkLeft: true, walkRight: true, walkW: 1.8, walkGap: 1.2, grade: true, shoulder: 1.5, gradeFalloff: 10, smooth: 40, snap: true },
  building: { k: 'house', h: 5.2, ridge: 2.6, roof: 1, rc: '#5c5853', n: '', level: true, yaw: 0 },
  lot: { stripes: true, margin: 0.5 },
  trees: { density: 160, pine: 1, hardwood: 1, birch: 0.25, hMin: 10, hMax: 22, floor: true },
  rail: { side: 1 },
  light: { style: 'cobra', h: 9, spacing: 45, offset: 1.2, sides: 'right' },
  wall: { h: 1.8, th: 0.35, style: 'brick', posts: 3.5, cap: true, closed: false },
}

/** Which tools take a brush, an area or a rectangle. */
export const SHAPED_TOOLS: ReadonlySet<ToolId> = new Set<ToolId>(['raise', 'lower', 'flatten', 'smooth', 'noise', 'paint', 'drain', 'plant', 'clear', 'railCut', 'lightCut'])

/** Tools that plot a line point by point (Enter or a double-click finishes it). */
export const LINE_TOOLS: ReadonlySet<ToolId> = new Set<ToolId>(['road', 'redraw', 'river', 'rail', 'wall', 'grade', 'lot', 'lightRow'])

export interface ToolInfo { id: ToolId; label: string; key?: string; hint: string }
export interface ToolGroup { name: string; tools: ToolInfo[] }

export const TOOL_GROUPS: ToolGroup[] = [
  { name: 'Pick', tools: [{ id: 'select', label: 'Select', key: 'V', hint: 'Click a road, building, lot or edit to inspect and change it. Drag empty ground to pan.' }] },
  {
    name: 'Land',
    tools: [
      { id: 'raise', label: 'Raise', key: 'R', hint: 'Paint to raise the ground. Buildings, lots and water on it move with it.' },
      { id: 'lower', label: 'Lower', key: 'L', hint: 'Paint to lower the ground.' },
      { id: 'flatten', label: 'Flatten', key: 'F', hint: 'Paint to set the ground to one height. Alt-click picks the height under the cursor.' },
      { id: 'smooth', label: 'Smooth', key: 'S', hint: 'Paint to even out bumps and steps.' },
      { id: 'noise', label: 'Roughen', hint: 'Paint gentle natural bumps.' },
      { id: 'grade', label: 'Grade line', key: 'G', hint: 'Click points along a line; the ground is levelled across it and sloped evenly between the heights at its points.' },
    ],
  },
  {
    name: 'Water',
    tools: [
      { id: 'fill', label: 'Fill low ground', hint: 'Click low ground: everything joined to it below the level fills with water.' },
      { id: 'level', label: 'Water level', hint: 'Click a lake, pond or river to raise or lower its surface to the level.' },
      { id: 'paint', label: 'Paint water', hint: 'Paint water at the level wherever the ground is below it (optionally digging a bed).' },
      { id: 'drain', label: 'Drain', hint: 'Paint to take water away; the bed is raised to dry ground.' },
      { id: 'river', label: 'River', hint: 'Click points down a river: it cuts a channel with banks and water falling from the first level to the last.' },
    ],
  },
  {
    name: 'Roads',
    tools: [
      { id: 'road', label: 'Road builder', key: 'B', hint: 'Click centre points; corners round off on their own. Drag points to move them, Backspace removes the last, Enter builds it.' },
      { id: 'redraw', label: 'Redraw road', hint: 'Click a road (or sidewalk) to load it into the road builder; building it replaces the old one.' },
      { id: 'roadRemove', label: 'Remove road', hint: 'Click a road, driveway, sidewalk or trail to take it out.' },
    ],
  },
  {
    name: 'Buildings',
    tools: [
      { id: 'building', label: 'Add building', hint: 'Drag a rectangle for the footprint; hold Shift to turn it with the drag.' },
      { id: 'buildingRemove', label: 'Remove building', hint: 'Click a building to take it down.' },
    ],
  },
  {
    name: 'Parking',
    tools: [
      { id: 'lot', label: 'Draw lot', hint: 'Click the corners of a parking lot; Enter closes it.' },
      { id: 'lotEdit', label: 'Reshape lot', hint: 'Click a lot, drag its corners, then Apply.' },
      { id: 'lotRemove', label: 'Remove lot', hint: 'Click a parking lot to take it out.' },
    ],
  },
  {
    name: 'Trees',
    tools: [
      { id: 'plant', label: 'Plant trees', key: 'T', hint: 'Paint or outline an area to plant a stand of trees at the density and mix you set.' },
      { id: 'clear', label: 'Clear trees', hint: 'Paint or outline an area to clear every tree in it.' },
    ],
  },
  {
    name: 'Street',
    tools: [
      { id: 'rail', label: 'Guardrail', hint: 'Click points along the rail; Enter builds it.' },
      { id: 'railCut', label: 'Remove guardrails', hint: 'Paint over guardrails (the automatic ones too) to take them down.' },
      { id: 'light', label: 'Streetlight', hint: 'Click to put up a light; its arm faces the nearest road.' },
      { id: 'lightRow', label: 'Lights along a line', hint: 'Click points along a street; lights go up every spacing metres on the side you pick.' },
      { id: 'lightCut', label: 'Remove lights', hint: 'Paint over lights (the downtown lamps and lot lights too) to take them down.' },
      { id: 'wall', label: 'Wall / fence', key: 'W', hint: 'Click points along a brick wall or fence; Enter builds it.' },
    ],
  },
]

export function toolInfo(id: ToolId): ToolInfo {
  for (const g of TOOL_GROUPS) for (const t of g.tools) if (t.id === id) return t
  return TOOL_GROUPS[0].tools[0]
}
