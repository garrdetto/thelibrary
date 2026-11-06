export type ParkMap = { w: number; h: number; corners: number[]; surface: number[]; water: number[]; path: number[]; pathElevation: number[]; pathColor: number[]; pathAdd: number[]; pathOrder: number[]; obj: number[]; owner: number[]; litter: number[] }
export type Piece = { c: number; s: number; sp?: 'station' | 'chain' | 'brakes' | 'booster' | 'loop' | 'corkscrew'; k?: number }
export type Pose = { x: number; y: number; h: number; dir: number; slope: number }
export type Train = { s: number; v: number; phase: string; timer: number; riders: number[]; ridersCount?: number; lap: number; stalled: number; pace?: number; waitS?: number }
export type RideStats = { valid: boolean; e: number; i: number; n: number; maxSpeed?: number; avgSpeed?: number; rideTime?: number; length?: number; maxG?: number; minG?: number; latG?: number; drops?: number; highestDrop?: number; inversions?: number; airtime?: number }
export type Entity = {
  id: number; type: 'scenery' | 'stall' | 'ride' | 'gate' | 'parkEntrance' | 'hotel'; x: number; y: number; park: number; kind?: string; rot?: number; dir?: number
  floors?: number; colors?: HotelColors; roof?: string; addons?: Record<string, boolean>; entrance?: { x: number; y: number } | null; occupancy?: number; lastNight?: number; district?: boolean
  rate?: number; service?: string; condition?: number; profit?: number; invested?: number; nights?: number[]; night?: HotelNight | null
  using?: Record<string, number>; today?: HotelDayStats | null; yesterday?: HotelDayStats | null; visitTakings?: number; prices?: Record<string, number>
  size?: [number, number]; wave?: string; comments?: { t: number; text: string; mood: 'pos' | 'mix' | 'neg'; who: string }[]; commentCounts?: { pos: number; mix: number; neg: number }
  ride?: string | number; role?: 'entrance' | 'exit'; name?: string; price?: number; open?: boolean; sales?: number; revenue?: number
  status?: 'open' | 'closed' | 'broken'; entrance?: number; exit?: number; queue?: number[]; riders?: number[]; queueLength?: number; ridersCount?: number
  cycle?: { phase: string; timer: number; spin?: number }; reliability?: number; totalRiders?: number; monthRiders?: number; color?: string | null; trackColor?: string | null; supportColor?: string | null; trainColor?: string | null; colors?: Record<string, string> | null; scheme?: number | null; stats?: RideStats | null; mechanic?: number
  style?: string; start?: { x: number; y: number; dir: number; h: number }; pieces?: Piece[]; complete?: boolean; trains?: Train[]; cars?: number; carsSet?: boolean; spent?: number; rev?: number
}
export type Guest = { id: number; park: number; x: number; y: number; tx: number; ty: number; state: string; hidden?: boolean; happy: number; items: string[]; kid: boolean; shirt: number; thoughts: string[]; dir?: number; energy?: number; hunger?: number; thirst?: number; cash?: number }
export type Staff = { id: number; role: 'handyman' | 'mechanic' | 'entertainer' | 'security' | 'supervisor' | 'ems'; park: number; name: string; x: number; y: number; tx?: number; ty?: number; state: string; swept: number; fixed: number; target?: { ride?: number } | null; dir?: number }
export type Ledger = { rides: number; shops: number; entry: number; construction: number; upkeep: number; wages: number; electricity: number; marketing: number; interest: number; landscaping: number; hotels?: number; hotelUpkeep?: number; hotelAmenities?: number; hotelStaff?: number }
export type Objective = { type: 'guests' | 'value' | 'coasters' | 'none' | 'versus'; guests?: number; rating?: number; year?: number; value?: number; count?: number; excitement?: number }
export type HistoryRow = { label: string; income: number; expenses: number; profit: number; guests: number; rating: number; value: number; cash: number; company: number; wages?: number; electricity?: number }
export type LandRect = { x0: number; y0: number; x1: number; y1: number }
export type ParkLand = { initial: LandRect; limit: LandRect }
export type Park = { id: number; parkId: string; land?: ParkLand | null; name: string; named?: boolean; color: string; schemes?: ColorScheme[]; cash: number; loan: number; maxLoan: number; entryFee: number; rating: number; value: number; guestsIn: number; totalGuests: number; open: boolean; marketing: { kind: string; until: number; boost: number }[]; month: Ledger; history: HistoryRow[]; thoughts: [string, number][]; objective: Objective; resortHotels?: number; millionAt?: MillionAt; status: 'playing' | 'won' | 'lost'; happiness?: number; litter?: number; spawn?: GuestSpawn }
export type News = { id: number; t: number; park: number; text: string; kind: string; ref: number | null }
export type MillionAt = { seconds: number; day: number; month: number; year: number; value: number; rating: number; approx?: boolean }
export type ParkState = {
  v: number; scenario: string; mode: 'solo' | 'coop' | 'versus'; seed: number; rng: number; map: ParkMap; entities: Record<string, Entity>; nextId: number; staffSeq: number; guestSeq: number
  pathVersion: number; structVersion: number; parks: Park[]; guests: Guest[]; staff: Staff[]
  time: { tick: number; seconds: number; day: number; month: number; year: number; dayFraction: number }
  weather: { kind: 'sunny' | 'cloudy' | 'rain'; temp: number; next: number }; speed: number; news: News[]; newsSeq: number; ended: { text: string; winner: number; values?: number[] } | null
  trackCells: Map<number, { ride: number; piece: number; lo: number; hi: number }[]>; fields: Map<string, Int16Array>
}
export type ColorRole = 'primary' | 'secondary' | 'accent' | 'trim' | 'lights' | 'glow'
export type ColorScheme = { name: string; colors: Record<ColorRole, string> }
export type ColorSlot = { key: string; name: string; role: ColorRole; def: string | null }
export type HotelColors = { primary: number; secondary: number; trim: number }
export type HotelDayStats = { visits: number; takings: number; home: number }
export type AmenityVisit = { name: string; doing: string; time: number; price: number; seats: number; min: number; free?: boolean; kids?: boolean; daytime?: boolean; effects: Record<string, number>; thought: string }
export type AmenityUse = { id: string; name: string; doing: string; using: number; capacity: number; price: number; defaultPrice: number; limit: number; free: boolean }
export type HotelNight = { occupied: number; rate: number; rooms: number; amenities: number; staff: number; utilities: number; maintenance: number; amenityCosts: number; income: number; costs: number; profit: number }
export type HotelAddon = { name: string; cost: number; occupancy: number; share?: number; upkeep?: number; amenity?: boolean }
export type HotelService = { name: string; staff: number; occupancy: number; wear: number; spend: number }
export type HotelDef = { name: string; min: [number, number]; max: [number, number]; floors: [number, number]; base: number; perTileFloor: number; density: number; rate: number; upkeep: number; luxury: number; roofs: string[]; colors: HotelColors; description: string }
export type GuestSpawn = { rate: number; cap: number; buildCap?: number; landCap?: number; limit?: 'rides' | 'land' | 'max' | 'closed' }
export type Command = { t: string; [key: string]: unknown }
export type CommandResult = { ok: boolean; error?: string; warning?: string | null; id?: number; cost?: number; refund?: number; complete?: boolean; pieces?: number; count?: number }
export type TrackPath = { pos: Float32Array; tan: Float32Array; up: Float32Array; curv: Float32Array; piece: Int16Array; count: number; ds: number; length: number; closed: boolean; stationEnd: number; specials: (string | null)[]; hairpins?: boolean[] }
export type FlatRideDef = { name: string; category: string; size: [number, number]; cost: number; upkeep: number; capacity: number; rideTime: number; loadTime: number; price: number; stats: { e: number; i: number; n: number }; height: number; description: string; resize?: FlatResize; waves?: string; custom?: CustomRideInfo }
export type CustomRideMotionType = 'none' | 'spin' | 'swing' | 'wheel' | 'drop' | 'bob'
export type CustomPieceMotionType = 'spin' | 'swing' | 'wobble' | 'flip' | 'bob' | 'level'
export type CustomRidePiece = { type: CustomPieceMotionType; speed: number; amount: number; from: number; to: number; inner: number; outer: number; split: 'pieces' | 'sectors'; count: number; hang: 'top' | 'centre' | 'bottom' | 'clicked'; axis: 'radial' | 'tangent' | 'x' | 'y'; stagger: number; alternate: boolean; on: number; picks: [number, number, number][]; matching: boolean }
export type CustomRideMotion = { type: CustomRideMotionType; speed: number; amount: number; axis: 'x' | 'y'; split: number; pivot: [number, number, number]; rise: number; pieces: CustomRidePiece[] }
export type CustomPlatformShape = 'square' | 'round' | 'octagon' | 'hexagon'
export type CustomPlatformSteps = 'none' | 'front' | 'back' | 'left' | 'right' | 'sides' | 'all'
export type CustomPlatformColumn = 'none' | 'fixed' | 'telescoping'
export type CustomRidePlatform = { enabled: boolean; shape: CustomPlatformShape; fill: number; height: number; tiers: number; inset: number; top: string; side: string; trim: string; edge: boolean; steps: CustomPlatformSteps; stepColor: string; fence: boolean; fenceHeight: number; fenceColor: string; column: CustomPlatformColumn; columnRadius: number; columnSections: number; columnColor: string; columnTop: number }
export type CustomRideInfo = { id: string; motion: CustomRideMotion; platform: CustomRidePlatform; meshVersion: number; thumb: boolean; retired: boolean }
export type CustomRideRecordInput = { id: string; name: string; category: string; size: [number, number]; cost: number; upkeep: number; capacity: number; rideTime: number; loadTime: number; price: number; stats: { e: number; i: number; n: number }; height: number; description: string; motion: CustomRideMotion; platform?: CustomRidePlatform; meshVersion: number; thumb: boolean; active: boolean }
export const CUSTOM_RIDE_PREFIX: string
export const CUSTOM_RIDE_ID: RegExp
export const CUSTOM_RIDE_CATEGORIES: string[]
export const CUSTOM_RIDE_MOTIONS: CustomRideMotionType[]
export const CUSTOM_PIECE_MOTIONS: CustomPieceMotionType[]
export const CUSTOM_PIECE_SPLITS: CustomRidePiece['split'][]
export const CUSTOM_PIECE_HANGS: CustomRidePiece['hang'][]
export const CUSTOM_PIECE_AXES: CustomRidePiece['axis'][]
export const CUSTOM_RIDE_LIMITS: { nameMin: number; nameMax: number; descriptionMax: number; sizeMin: number; sizeMax: number; heightMin: number; heightMax: number; costMin: number; costMax: number; upkeepMax: number; capacityMin: number; capacityMax: number; rideTimeMin: number; rideTimeMax: number; loadTimeMin: number; loadTimeMax: number; priceMax: number; statMax: number; speedMin: number; speedMax: number; meshBytes: number; thumbBytes: number; sourceBytes: number; trianglesMin: number; trianglesMax: number; piecesMax: number; picksMax: number; instancesMax: number; pieceCountMax: number; reachMax: number; riseMax: number; platformHeightMax: number; platformTiersMax: number; platformTriangles: number; columnRadiusMax: number; columnSectionsMax: number }
export function sanitizeMotion(raw: unknown): CustomRideMotion
export function sanitizePlatform(raw: unknown): CustomRidePlatform
export const CUSTOM_PLATFORM_SHAPES: CustomPlatformShape[]
export const CUSTOM_PLATFORM_STEPS: CustomPlatformSteps[]
export const CUSTOM_PLATFORM_COLUMNS: CustomPlatformColumn[]
export function customRideDef(raw: unknown): FlatRideDef | null
export function registerCustomRides(list: unknown): string[]
export function isCustomRide(id: unknown): boolean
export function buildableRide(def: FlatRideDef | undefined): boolean
export type FlatResize = { min: [number, number]; max: [number, number]; costBase: number; costPerTile: number; upkeepBase: number; upkeepPerTile: number; capacityPerTile: number; excitementPerTile: number; maxSizeBonus: number }
export type WaveSetting = { name: string; e: number; i: number; n: number; height: number; speed: number }
export type FlatSpec = { size: [number, number]; cost: number; upkeep: number; capacity: number; rideTime: number; loadTime: number; height: number; stats: { e: number; i: number; n: number } }
export type CoasterStyle = { name: string; category?: string; trackType?: 'coaster' | 'kart' | 'slide' | 'river'; cost: number; pieceCost: number; upkeep: number; maxHeight: number; loops: boolean; steep: boolean; corkscrews?: boolean; hairpin?: boolean; seats: number; excitementBonus: number; intensityBonus: number; drive?: number; maxSpeed?: number; track: string; support: string; train: string; description: string }
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
export const LAND_SQUARE_COST: number
export const LAND_AREA_MAX: number
export const GUESTS_PER_OWNED_TILE: number
export const BUILD_CAP_MULTIPLIER: number
export function ownedTileCount(state: ParkState, park: number): number
export function landAreaPlan(state: ParkState, park: number, area: { x0: number; y0: number; x1: number; y1: number }): { error?: string; tiles: number[]; cost: number }
export function rideCommentsDetail(state: ParkState, id: number): { id: number; now: number; comments: { t: number; text: string; mood: 'pos' | 'mix' | 'neg'; who: string }[]; counts: { pos: number; mix: number; neg: number } } | null
export function recordComment(state: ParkState, ride: Entity, guest: Guest, kind: string): unknown
export function guestProfile(rnd: () => number, kid: boolean): { type: 'kid' | 'thrill' | 'casual'; minI: number; maxI: number; tolerance: number }
export const HOTELS: Record<string, HotelDef>
export const HOTEL_ADDONS: Record<string, HotelAddon>
export const HOTEL_SERVICE: Record<string, HotelService>
export const HOTEL_SIZE_LIMIT: number
export const HOTEL_FLOOR_LIMIT: number
export const HOTEL_HISTORY_NIGHTS: number
export const RESIZE_PREMIUM: number
export function addonCost(id: string, kind: string, rooms: number): number
export function amenityBooks(addon: HotelAddon, def: HotelDef, rooms: number, occupied: number, rate: number, service?: HotelService): { income: number; cost: number; perGuest?: number }
export const SHRINK_REFUND: number
export function hotelRateLimits(kind: string): [number, number]
export function hotelResizeCost(hotel: Entity, size: [number, number], floors: number): number
export function hotelRefurbishCost(hotel: Entity): number
export function rateFactor(def: HotelDef, rate?: number): number
export function hotelOccupancy(state: ParkState, hotel: Entity, inDistrict: boolean): number
export function hotelNight(hotel: Entity, occupancy: number, inDistrict?: boolean): HotelNight | null
export function hotelPortfolio(state: ParkState, park: number): { hotels: number; rooms: number; occupied: number; income: number; costs: number; profit: number; lifetime: number; invested: number }
export const FLOOR_HEIGHT: number
export const HOTEL_GUESTS_PER_ROOM: number
export function hotelSpec(kind: string, size: [number, number], floors: number, addons?: Record<string, boolean>): { rooms: number; building: number; cost: number; upkeep: number; rate: number; guestBonus: number } | null
export function hotelOrientedFits(def: HotelDef, w: number, h: number): boolean
export function hotelLoadFits(def: HotelDef, w: number, h: number): boolean
export const AMENITY_VISITS: Record<string, AmenityVisit>
export const AMENITY_PRICE_MAX: number
export const AMENITY_SEAT_LIMIT: number
export function amenityDefaultPrice(kind: string, id: string): number
export function amenityPriceLimit(kind: string, id: string): number
export function amenityPrice(hotel: Entity, id: string): number
export function amenityCapacity(hotel: Entity, id: string): number
export function amenityOpen(state: ParkState, hotel: Entity, id: string): boolean
export function amenityUse(hotel: Entity): AmenityUse[]
export function hotelDay(): HotelDayStats
export function hotelHeight(hotel: { floors?: number }): number
export function hotelEntranceFor(state: ParkState, park: number, x: number, y: number, w: number, h: number): { x: number; y: number } | null
export function spawnRate(state: ParkState, park: Park): GuestSpawn
export const CAR_GAP: number
export const PATH_STEP_LIMIT: number
export const STAIR_STEP_LIMIT: number
export const FLAT_RIDES: Record<string, FlatRideDef>
export const WAVE_SETTINGS: Record<string, WaveSetting>
export function flatSpec(rideId: string, size?: [number, number] | null, wave?: string | null): FlatSpec | null
export function rideFlatSpec(ride: Entity): FlatSpec | null
export function validFlatSize(def: FlatRideDef, w: unknown, h: unknown): boolean
export const COASTER_STYLES: Record<string, CoasterStyle>
export const COASTER_PRESETS: Record<string, { name: string; style: string; station: number; description: string; pieces: Piece[]; footprint?: [number, number]; height?: number; cost?: number }>
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
export const SLOPE_RISE: number
export const STAIR_RISE: number
export function pathRamp(map: ParkMap, x: number, y: number): { dx: number; dy: number; low: number; high: number } | null
export function pathsConnect(map: ParkMap, ax: number, ay: number, bx: number, by: number, tile?: number): boolean
export function isWalkPath(kind: number): boolean
export function trackPoses(ride: Entity): Pose[]
export function samplePiece(pose: Pose, piece: Piece, steps?: number): { x: number; y: number; z: number; psi: number; bank: number }[]
export function buildTrackPath(ride: Entity): TrackPath | null
export function sampleAt(path: TrackPath, s: number, out?: Record<string, number>): { x: number; y: number; z: number; tx: number; ty: number; tz: number; ux: number; uy: number; uz: number; index: number; piece: number }
export function ridePath(state: ParkState, ride: Entity): TrackPath | null
export function validatePiece(state: ParkState, ride: Entity, piece: Piece): { ok?: boolean; error?: string; cost?: number; closes?: boolean; next?: Pose; piece?: Piece; adjusted?: boolean; cells?: { x: number; y: number; lo: number; hi: number }[] }
export function pieceCostPreview(state: ParkState, ride: Entity, piece: Piece): { ok?: boolean; error?: string; cost?: number; closes?: boolean; piece?: Piece; adjusted?: boolean }
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
export const MILLION_VALUE: number
export const MILLION_RATING: number
export function checkMillionDash(state: ParkState): void
export function millionFromHistory(park: Park, time: ParkState['time']): MillionAt | null
export function terrainPlan(state: ParkState, park: number, r: { x0: number; y0: number; x1: number; y1: number }, op: string, levelTo?: number | null): { error?: string; cost?: number }
export function encodeDynamic(state: ParkState, sinceNews?: number): unknown
export function applyDynamic(state: ParkState, dyn: unknown): void
export function encodeGuests(guests: Guest[]): Int32Array
export function decodeGuests(buffer: ArrayBuffer | Int32Array, previous?: Guest[]): Guest[]
export function guestDetail(state: ParkState, id: number): Record<string, unknown> | null
export function checksum(state: ParkState): number
export function queueLine(state: ParkState, ride: Entity): { tiles: [number, number][]; entry: [number, number] | null; join?: [number, number] | null; direct?: boolean }
export function exitLine(state: ParkState, ride: Entity): { tiles: [number, number][]; entry: [number, number] | null; join: [number, number] | null; direct?: boolean }
export function levelStartHeight(map: ParkState['map'], r: { x0: number; y0: number; x1: number; y1: number }, sx?: number, sy?: number): number | null
export type QueueLayout = { prev: number; next: number; rails: [boolean, boolean, boolean, boolean]; bend: boolean; axis: number; order: number }
export function nextPathOrder(map: ParkMap): number
export function pathOrderAt(map: ParkMap, i: number): number
export function queueLinks(map: ParkMap, x: number, y: number): { prev: number; next: number }
export function queueStep(map: ParkMap, cur: [number, number], forward: boolean, seen: Set<number>, avoid?: Set<number> | null): { x: number; y: number; d: number } | null
export function queueLayout(map: ParkMap, x: number, y: number, openings?: number[], links?: { prev: number; next: number } | null): QueueLayout
export const KARTS_PER_STATION_TILE: number
export const KART_LIMIT: number
export function kartCount(stationLength: number): number
export function kartRestS(path: TrackPath, index: number): number
export function kartLane(index: number): number
export const ROLES: ColorRole[]
export const ROLE_NAMES: Record<ColorRole, string>
export const SCHEME_COUNT: number
export const RIDE_SLOTS: Record<string, ColorSlot[]>
export const COASTER_SLOTS: ColorSlot[]
export const DEFAULT_SCHEMES: ColorScheme[]
export const PRESETS: ColorScheme[]
export function rideSlots(ride: Entity | null | undefined): ColorSlot[]
export function slotDefault(ride: Entity, slot: ColorSlot): string
export function parkSchemes(park: Park | null | undefined): ColorScheme[]
export function sanitizeScheme(raw: unknown, fallback: ColorScheme): ColorScheme
export function rideColors(ride: Entity, park: Park | null | undefined): string[]
export function colorsFromRoles(ride: Entity, roles: Record<ColorRole, string>): Record<string, string>
export function sanitizeRideColors(ride: Entity, raw: unknown): Record<string, string> | null
