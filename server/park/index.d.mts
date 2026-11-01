export type ParkMap = { w: number; h: number; corners: number[]; surface: number[]; water: number[]; path: number[]; pathElevation: number[]; pathColor: number[]; pathAdd: number[]; obj: number[]; owner: number[]; litter: number[] }
export type Piece = { c: number; s: number; sp?: 'station' | 'chain' | 'brakes' | 'booster' | 'loop'; k?: number }
export type Pose = { x: number; y: number; h: number; dir: number; slope: number }
export type Train = { s: number; v: number; phase: string; timer: number; riders: number[]; ridersCount?: number; lap: number; stalled: number; pace?: number }
export type RideStats = { valid: boolean; e: number; i: number; n: number; maxSpeed?: number; avgSpeed?: number; rideTime?: number; length?: number; maxG?: number; minG?: number; latG?: number; drops?: number; highestDrop?: number; inversions?: number; airtime?: number }
export type Entity = {
  id: number; type: 'scenery' | 'stall' | 'ride' | 'gate' | 'parkEntrance'; x: number; y: number; park: number; kind?: string; rot?: number; dir?: number
  size?: [number, number]
  ride?: string | number; role?: 'entrance' | 'exit'; name?: string; price?: number; open?: boolean; sales?: number; revenue?: number
  status?: 'open' | 'closed' | 'broken'; entrance?: number; exit?: number; queue?: number[]; riders?: number[]; queueLength?: number; ridersCount?: number
  cycle?: { phase: string; timer: number; spin?: number }; reliability?: number; totalRiders?: number; monthRiders?: number; color?: string | null; stats?: RideStats | null; mechanic?: number
  style?: string; start?: { x: number; y: number; dir: number; h: number }; pieces?: Piece[]; complete?: boolean; trains?: Train[]; cars?: number; spent?: number; rev?: number
}
export type Guest = { id: number; park: number; x: number; y: number; tx: number; ty: number; state: string; hidden?: boolean; happy: number; items: string[]; kid: boolean; shirt: number; thoughts: string[]; dir?: number; energy?: number; hunger?: number; thirst?: number; cash?: number }
export type Staff = { id: number; role: 'handyman' | 'mechanic' | 'entertainer' | 'security' | 'supervisor' | 'ems'; park: number; name: string; x: number; y: number; tx?: number; ty?: number; state: string; swept: number; fixed: number; target?: { ride?: number } | null; dir?: number }
export type Ledger = { rides: number; shops: number; entry: number; construction: number; upkeep: number; wages: number; electricity: number; marketing: number; interest: number; landscaping: number }
export type Objective = { type: 'guests' | 'value' | 'coasters' | 'none' | 'versus'; guests?: number; rating?: number; year?: number; value?: number; count?: number; excitement?: number }
export type HistoryRow = { label: string; income: number; expenses: number; profit: number; guests: number; rating: number; value: number; cash: number; company: number; wages?: number; electricity?: number }
export type Park = { id: number; parkId: string; name: string; named?: boolean; color: string; cash: number; loan: number; maxLoan: number; entryFee: number; rating: number; value: number; guestsIn: number; totalGuests: number; open: boolean; marketing: { kind: string; until: number; boost: number }[]; month: Ledger; history: HistoryRow[]; thoughts: [string, number][]; objective: Objective; status: 'playing' | 'won' | 'lost'; happiness?: number; litter?: number; spawn?: { rate: number; cap: number } }
export type News = { id: number; t: number; park: number; text: string; kind: string; ref: number | null }
export type ParkState = {
  v: number; scenario: string; mode: 'solo' | 'coop' | 'versus'; seed: number; rng: number; map: ParkMap; entities: Record<string, Entity>; nextId: number; staffSeq: number; guestSeq: number
  pathVersion: number; structVersion: number; parks: Park[]; guests: Guest[]; staff: Staff[]
  time: { tick: number; seconds: number; day: number; month: number; year: number; dayFraction: number }
  weather: { kind: 'sunny' | 'cloudy' | 'rain'; temp: number; next: number }; speed: number; news: News[]; newsSeq: number; ended: { text: string; winner: number; values?: number[] } | null
  trackCells: Map<number, { ride: number; piece: number; lo: number; hi: number }[]>; fields: Map<string, Int16Array>
}
export type Command = { t: string; [key: string]: unknown }
export type CommandResult = { ok: boolean; error?: string; warning?: string | null; id?: number; cost?: number; refund?: number; complete?: boolean; pieces?: number }
export type TrackPath = { pos: Float32Array; tan: Float32Array; up: Float32Array; curv: Float32Array; piece: Int16Array; count: number; ds: number; length: number; closed: boolean; stationEnd: number; specials: (string | null)[] }
export type FlatRideDef = { name: string; category: string; size: [number, number]; cost: number; upkeep: number; capacity: number; rideTime: number; loadTime: number; price: number; stats: { e: number; i: number; n: number }; height: number; description: string }
export type CoasterStyle = { name: string; category?: string; trackType?: 'coaster' | 'kart' | 'slide' | 'river'; cost: number; pieceCost: number; upkeep: number; maxHeight: number; loops: boolean; steep: boolean; seats: number; excitementBonus: number; intensityBonus: number; drive?: number; maxSpeed?: number; track: string; support: string; train: string; description: string }
export type StallDef = { name: string; size?: [number, number]; cost: number; upkeep: number; price: number; item: string; kind: string; color: string; sign: string; hunger?: number; thirst?: number; happiness?: number }
export type ScenarioDef = { name: string; difficulty: string; size: number; seed: number; terrain: string; cash: number; loan: number; maxLoan: number; objective: Objective; description: string; versus?: boolean }

export const TILE: number
export const LAND: number
export const UNIT: number
export const SIM_STEP: number
export const DAY_SECONDS: number
export const MONTHS: string[]
export const DIRS: [number, number][]
export const DAYS_PER_MONTH: number
export const STAFF_WAGE_PER_DAY: number
export const ELECTRICITY_COST_PER_TILE_PER_DAY: number
export const ENGINE_VERSION: number
export const MAX_GUESTS: number
export const CAR_GAP: number
export const PATH_STEP_LIMIT: number
export const STAIR_STEP_LIMIT: number
export const FLAT_RIDES: Record<string, FlatRideDef>
export const COASTER_STYLES: Record<string, CoasterStyle>
export const COASTER_PRESETS: Record<string, { name: string; style: string; station: number; description: string; pieces: Piece[] }>
export const STALLS: Record<string, StallDef>
export const SCENERY: Record<string, { name: string; cost: number; height: number }>
export const PATH_ADDITIONS: Record<number, { id: string; name: string; cost: number }>
export const STAFF: Record<string, { name: string; wage: number; color: string }>
export const SURFACES: string[]
export const COSTS: Record<string, number>
export const SCENARIOS: Record<string, ScenarioDef>
export const PARK_COLORS: string[]
export const MARKETING: Record<string, { name: string; cost: number; days: number; boost: number }>
export function clamp(value: number, min: number, max: number): number
export function formatMoney(value: number): string
export function guestName(id: number): string
export function createPark(scenarioId: string, options?: { mode?: 'solo' | 'coop' | 'versus'; players?: number; parkNames?: string[] }): ParkState
export function stepPark(state: ParkState, dt?: number): void
export function applyCommand(state: ParkState, cmd: Command, park?: number): CommandResult
export function serializePark(state: ParkState, includeGuests?: boolean): unknown
export function deserializePark(data: unknown): ParkState
export function electricityTiles(state: ParkState, park: number): number
export function dailyOperatingCosts(state: ParkState, park: number): { wages: number; electricity: number; poweredTiles: number }
export function tileIndex(map: ParkMap, x: number, y: number): number
export function inMap(map: ParkMap, x: number, y: number): boolean
export function tileCorners(map: ParkMap, x: number, y: number): [number, number, number, number]
export function tileMin(map: ParkMap, x: number, y: number): number
export function tileMax(map: ParkMap, x: number, y: number): number
export function tileSlope(map: ParkMap, x: number, y: number): { flat: boolean; base: number; dir: number }
export function groundHeightAt(map: ParkMap, wx: number, wy: number, tile?: number): number
export function pathHeightAt(map: ParkMap, wx: number, wy: number, tile?: number): number
export function pathsConnect(map: ParkMap, ax: number, ay: number, bx: number, by: number, tile?: number): boolean
export function isWalkPath(kind: number): boolean
export function trackPoses(ride: Entity): Pose[]
export function samplePiece(pose: Pose, piece: Piece, steps?: number): { x: number; y: number; z: number; psi: number; bank: number }[]
export function buildTrackPath(ride: Entity): TrackPath | null
export function sampleAt(path: TrackPath, s: number, out?: Record<string, number>): { x: number; y: number; z: number; tx: number; ty: number; tz: number; ux: number; uy: number; uz: number; index: number; piece: number }
export function ridePath(state: ParkState, ride: Entity): TrackPath | null
export function validatePiece(state: ParkState, ride: Entity, piece: Piece): { ok?: boolean; error?: string; cost?: number; closes?: boolean; next?: Pose; cells?: { x: number; y: number; lo: number; hi: number }[] }
export function pieceCostPreview(state: ParkState, ride: Entity, piece: Piece): { ok?: boolean; error?: string; cost?: number; closes?: boolean }
export function footprint(entity: Entity): { x: number; y: number; w: number; h: number }
export function footprintTiles(entity: Entity): [number, number][]
export function stationTiles(state: ParkState, ride: Entity): [number, number][]
export function frontTile(gate: { x: number; y: number; dir: number }): { x: number; y: number }
export function stallFrontTile(stall: Entity): { x: number; y: number }
export function stallFootprintError(state: ParkState, park: number, stall: Entity, rot: number, selfId?: number): string | null
export function stallPlacementRotation(state: ParkState, park: number, stall: Entity, preferred?: number, selfId?: number): number | null
export function rideCapacity(ride: Entity): number
export function rideValue(ride: Entity): number
export function mechanicJobDistance(state: ParkState, mechanic: Staff, ride: Entity): number
export function objectiveText(objective: Objective): string
export function parkValue(state: ParkState, park: number): number
export function companyValue(state: ParkState, park: number): number
export function terrainPlan(state: ParkState, park: number, r: { x0: number; y0: number; x1: number; y1: number }, op: string): { error?: string; cost?: number }
export function encodeDynamic(state: ParkState, sinceNews?: number): unknown
export function applyDynamic(state: ParkState, dyn: unknown): void
export function encodeGuests(guests: Guest[]): Int32Array
export function decodeGuests(buffer: ArrayBuffer | Int32Array, previous?: Guest[]): Guest[]
export function guestDetail(state: ParkState, id: number): Record<string, unknown> | null
export function checksum(state: ParkState): number
export function queueLine(state: ParkState, ride: Entity): { tiles: [number, number][]; entry: [number, number] | null }
