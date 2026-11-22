/**
 * Every truck, trailer, cargo, look option and lot building in Truck Simulator. Renderer-free and shared with the Worker
 * (`/api/trucksim`), so prices and specs here are the single authority for physics, visuals and the economy.
 *
 * Vehicle frame: metres, origin on the ground under the front axle (trucks) or under the kingpin (trailers), +Z forward, +X to
 * the driver's left. Every make and model is original.
 */

export type TruckStyle = 'dump' | 'cabover' | 'longnose' | 'aero'
export type CabKind = 'day' | 'sleeper' | 'raised'
export type TrailerKind = 'tanker' | 'flatbed' | 'grain' | 'reefer' | 'lowboy'
export type HaulKind = 'dump' | TrailerKind
export type Finish = 'gloss' | 'metallic' | 'matte'
export type Stripe = 'none' | 'pinstripe' | 'band' | 'swoosh' | 'twoTone' | 'chevron'

export interface AxleSpec {
  z: number
  steer: boolean
  drive: boolean
  dual: boolean
  lift?: boolean
}

export interface DumpSpec {
  capacityKg: number
  volumeM3: number
  bedFrontZ: number
  bedRearZ: number
  hingeZ: number
  bedFloorY: number
  sideHeight: number
  maxAngleDeg: number
}

export interface Paint {
  primary: string
  secondary: string
  accent: string
  finish: Finish
  stripe: Stripe
}

export interface TruckModel {
  id: string
  brand: string
  name: string
  style: TruckStyle
  cab: CabKind
  price: number
  blurb: string
  frontZ: number
  rearZ: number
  width: number
  cabHeight: number
  roofHeight: number
  hoodLength: number
  sleeperLength: number
  wheelRadius: number
  track: number
  axles: AxleSpec[]
  massKg: number
  powerKw: number
  torqueNm: number
  idleRpm: number
  maxRpm: number
  gears: number[]
  reverseRatio: number
  finalDrive: number
  topSpeedKph: number
  fuelTankL: number
  fuelLPer100Km: number
  fifthWheelZ?: number
  dump?: DumpSpec
  defaultPaint: Paint
}

export interface RgnSpec {
  neckRearZ: number
  wellFrontZ: number
  wellRearZ: number
  wellHeight: number
}

export interface TrailerModel {
  id: string
  kind: TrailerKind
  name: string
  price: number
  blurb: string
  frontZ: number
  rearZ: number
  width: number
  height: number
  deckHeight: number
  kingpinHeight: number
  axles: number[]
  wheelRadius: number
  landingGearZ: number
  emptyMassKg: number
  maxPayloadKg: number
  capacityL?: number
  rgn?: RgnSpec
  defaultColor: string
}

export type CargoVisual =
  | 'gravel' | 'sand' | 'limestone' | 'riprap' | 'topsoil' | 'fill'
  | 'fuel'
  | 'beams' | 'coils' | 'rebar' | 'lumber' | 'plywood' | 'trusses' | 'pipe'
  | 'corn' | 'soybeans' | 'wheat'
  | 'pallets'
  | 'excavator'

export interface CargoSpec {
  id: string
  name: string
  haul: HaulKind
  minKg: number
  maxKg: number
  ratePerTonKm: number
  baseFee: number
  visual: CargoVisual
  color: string
  fragile: number
  coldChain?: boolean
}

export const FIFTH_WHEEL_HEIGHT = 1.2
export const KINGPIN_HEIGHT = 1.22
export const FUEL_PRICE_PER_L = 1.1
export const STARTING_CASH = 3000
export const STARTER_TRUCK = 'ridgeline-rd10'
export const RESALE_SHARE = 0.6
export const DEMOLISH_REFUND = 0.5
export const REPAIR_COST_PER_POINT = 90
/** Dirt points (0–100) a truck picks up per kilometre driven. */
export const DIRT_PER_KM = 2.2
/** What the public wash lane at the travel center charges; your own wash bay only uses water. */
export const PUBLIC_WASH_PRICE = 60
export const OWN_WASH_WATER = 8
/** Extra pay for delivering with a clean truck (dirt under `CLEAN_DIRT_LIMIT`). */
export const CLEAN_BONUS = 0.05
export const CLEAN_DIRT_LIMIT = 25
/** How far (m) the pressure washer's hose reaches from the unit to the middle of the truck. */
export const WASHER_REACH_M = 11
/** A pressure washer has to stand within this distance (m) of a steel shop on the same lot. */
export const WASHER_SHOP_GAP_M = 6

/** Price of the next strip of land for a lot that already has `owned` strips. */
export function landStripPrice(owned: number): number {
  return Math.round((16000 * Math.pow(1.45, owned)) / 500) * 500
}

const TEN_SPEED = [12.29, 8.51, 6.05, 4.38, 3.2, 2.29, 1.65, 1.25, 1.0, 0.78]
const THIRTEEN_SPEED = [12.29, 8.51, 6.05, 4.38, 3.4, 2.79, 2.29, 1.87, 1.53, 1.25, 1.0, 0.86, 0.73]

export const TRUCKS: TruckModel[] = [
  {
    id: 'ridgeline-rd10', brand: 'Ridgeline', name: 'RD-10 Dump', style: 'dump', cab: 'day', price: 62000,
    blurb: 'Set-forward tandem dump with a square hood. Every hauler starts here.',
    frontZ: 1.45, rearZ: -8.25, width: 2.55, cabHeight: 2.95, roofHeight: 3.2, hoodLength: 2.2, sleeperLength: 0,
    wheelRadius: 0.53, track: 2.05,
    axles: [
      { z: 0, steer: true, drive: false, dual: false },
      { z: -5.0, steer: false, drive: true, dual: true },
      { z: -6.35, steer: false, drive: true, dual: true },
    ],
    massKg: 12500, powerKw: 300, torqueNm: 1900, idleRpm: 650, maxRpm: 2100, gears: TEN_SPEED, reverseRatio: 11.8, finalDrive: 4.1,
    topSpeedKph: 100, fuelTankL: 300, fuelLPer100Km: 40,
    dump: { capacityKg: 14000, volumeM3: 10, bedFrontZ: -2.75, bedRearZ: -8.1, hingeZ: -7.85, bedFloorY: 1.45, sideHeight: 1.25, maxAngleDeg: 52 },
    defaultPaint: { primary: '#d8a21c', secondary: '#1d1f22', accent: '#c9ccd1', finish: 'gloss', stripe: 'none' },
  },
  {
    id: 'ironhaul-dx', brand: 'Ironhaul', name: 'DX Tri-Axle Dump', style: 'dump', cab: 'day', price: 98000,
    blurb: 'Set-back front axle, sloped hood and a lift axle for heavier quarry loads.',
    frontZ: 2.35, rearZ: -8.6, width: 2.55, cabHeight: 3.0, roofHeight: 3.25, hoodLength: 2.0, sleeperLength: 0,
    wheelRadius: 0.53, track: 2.05,
    axles: [
      { z: 0, steer: true, drive: false, dual: false },
      { z: -4.25, steer: false, drive: false, dual: false, lift: true },
      { z: -5.6, steer: false, drive: true, dual: true },
      { z: -6.95, steer: false, drive: true, dual: true },
    ],
    massKg: 14000, powerKw: 340, torqueNm: 2300, idleRpm: 650, maxRpm: 2100, gears: TEN_SPEED, reverseRatio: 11.8, finalDrive: 4.3,
    topSpeedKph: 100, fuelTankL: 340, fuelLPer100Km: 44,
    dump: { capacityKg: 19000, volumeM3: 13, bedFrontZ: -2.6, bedRearZ: -8.45, hingeZ: -8.2, bedFloorY: 1.5, sideHeight: 1.4, maxAngleDeg: 52 },
    defaultPaint: { primary: '#c8321f', secondary: '#f2f2ee', accent: '#2a2c30', finish: 'gloss', stripe: 'band' },
  },
  {
    id: 'bedrock-quad', brand: 'Bedrock', name: 'Quad-Axle Dump', style: 'dump', cab: 'day', price: 135000,
    blurb: 'Two lift axles ahead of the drives: the biggest legal bed in the county.',
    frontZ: 1.5, rearZ: -9.1, width: 2.55, cabHeight: 3.05, roofHeight: 3.3, hoodLength: 2.35, sleeperLength: 0,
    wheelRadius: 0.53, track: 2.05,
    axles: [
      { z: 0, steer: true, drive: false, dual: false },
      { z: -3.9, steer: false, drive: false, dual: false, lift: true },
      { z: -4.9, steer: false, drive: false, dual: false, lift: true },
      { z: -6.1, steer: false, drive: true, dual: true },
      { z: -7.45, steer: false, drive: true, dual: true },
    ],
    massKg: 15500, powerKw: 375, torqueNm: 2500, idleRpm: 650, maxRpm: 2100, gears: THIRTEEN_SPEED, reverseRatio: 11.8, finalDrive: 4.3,
    topSpeedKph: 100, fuelTankL: 380, fuelLPer100Km: 48,
    dump: { capacityKg: 24000, volumeM3: 16, bedFrontZ: -2.7, bedRearZ: -8.95, hingeZ: -8.7, bedFloorY: 1.5, sideHeight: 1.55, maxAngleDeg: 52 },
    defaultPaint: { primary: '#2b5fa8', secondary: '#e9e9e4', accent: '#c9ccd1', finish: 'metallic', stripe: 'pinstripe' },
  },
  {
    id: 'kestrel-cx-day', brand: 'Kestrel', name: 'CX Cab-Over Day Cab', style: 'cabover', cab: 'day', price: 28000,
    blurb: 'Flat-nosed cab-over: short, nimble and cheap. The first semi most haulers buy.',
    frontZ: 1.45, rearZ: -5.95, width: 2.5, cabHeight: 3.1, roofHeight: 3.3, hoodLength: 0, sleeperLength: 0,
    wheelRadius: 0.52, track: 2.05,
    axles: [
      { z: 0, steer: true, drive: false, dual: false },
      { z: -3.9, steer: false, drive: true, dual: true },
      { z: -5.25, steer: false, drive: true, dual: true },
    ],
    massKg: 7600, powerKw: 300, torqueNm: 1850, idleRpm: 600, maxRpm: 2100, gears: TEN_SPEED, reverseRatio: 11.8, finalDrive: 3.55,
    topSpeedKph: 112, fuelTankL: 450, fuelLPer100Km: 34, fifthWheelZ: -4.35,
    defaultPaint: { primary: '#e8e6df', secondary: '#c4302b', accent: '#1d1f22', finish: 'gloss', stripe: 'band' },
  },
  {
    id: 'kestrel-cx-sleeper', brand: 'Kestrel', name: 'CX Cab-Over Sleeper', style: 'cabover', cab: 'sleeper', price: 46000,
    blurb: 'The cab-over with a bunk behind the seats for the long runs.',
    frontZ: 1.45, rearZ: -6.65, width: 2.5, cabHeight: 3.35, roofHeight: 3.55, hoodLength: 0, sleeperLength: 1.4,
    wheelRadius: 0.52, track: 2.05,
    axles: [
      { z: 0, steer: true, drive: false, dual: false },
      { z: -4.6, steer: false, drive: true, dual: true },
      { z: -5.95, steer: false, drive: true, dual: true },
    ],
    massKg: 8100, powerKw: 320, torqueNm: 2000, idleRpm: 600, maxRpm: 2100, gears: TEN_SPEED, reverseRatio: 11.8, finalDrive: 3.55,
    topSpeedKph: 112, fuelTankL: 520, fuelLPer100Km: 35, fifthWheelZ: -5.05,
    defaultPaint: { primary: '#1f5d46', secondary: '#e8e6df', accent: '#d9b44a', finish: 'gloss', stripe: 'swoosh' },
  },
  {
    id: 'pinnacle-lh-day', brand: 'Pinnacle', name: 'Classic Long Hood Day Cab', style: 'longnose', cab: 'day', price: 64000,
    blurb: 'Square long hood, tall chrome stacks and a big bumper: the classic road tractor.',
    frontZ: 1.55, rearZ: -7.35, width: 2.55, cabHeight: 3.0, roofHeight: 3.2, hoodLength: 2.75, sleeperLength: 0,
    wheelRadius: 0.53, track: 2.05,
    axles: [
      { z: 0, steer: true, drive: false, dual: false },
      { z: -5.3, steer: false, drive: true, dual: true },
      { z: -6.65, steer: false, drive: true, dual: true },
    ],
    massKg: 8300, powerKw: 410, torqueNm: 2500, idleRpm: 600, maxRpm: 2100, gears: THIRTEEN_SPEED, reverseRatio: 11.8, finalDrive: 3.36,
    topSpeedKph: 118, fuelTankL: 570, fuelLPer100Km: 36, fifthWheelZ: -5.75,
    defaultPaint: { primary: '#141518', secondary: '#9c1c22', accent: '#d7d9dd', finish: 'gloss', stripe: 'pinstripe' },
  },
  {
    id: 'pinnacle-lh-sleeper', brand: 'Pinnacle', name: 'Classic Long Hood 63" Sleeper', style: 'longnose', cab: 'sleeper', price: 86000,
    blurb: 'The long hood with a flat-top sleeper and a set-forward axle.',
    frontZ: 1.55, rearZ: -8.15, width: 2.55, cabHeight: 3.0, roofHeight: 3.2, hoodLength: 2.75, sleeperLength: 1.6,
    wheelRadius: 0.53, track: 2.05,
    axles: [
      { z: 0, steer: true, drive: false, dual: false },
      { z: -6.1, steer: false, drive: true, dual: true },
      { z: -7.45, steer: false, drive: true, dual: true },
    ],
    massKg: 8900, powerKw: 430, torqueNm: 2600, idleRpm: 600, maxRpm: 2100, gears: THIRTEEN_SPEED, reverseRatio: 11.8, finalDrive: 3.36,
    topSpeedKph: 118, fuelTankL: 600, fuelLPer100Km: 37, fifthWheelZ: -6.55,
    defaultPaint: { primary: '#5a1720', secondary: '#141518', accent: '#d7d9dd', finish: 'metallic', stripe: 'band' },
  },
  {
    id: 'pinnacle-lh-lwb', brand: 'Pinnacle', name: 'Classic Long Hood LWB 80" Sleeper', style: 'longnose', cab: 'raised', price: 128000,
    blurb: 'Long wheelbase, raised-roof sleeper and the strongest engine on the lot.',
    frontZ: 1.55, rearZ: -8.95, width: 2.55, cabHeight: 3.0, roofHeight: 4.0, hoodLength: 2.75, sleeperLength: 2.05,
    wheelRadius: 0.53, track: 2.05,
    axles: [
      { z: 0, steer: true, drive: false, dual: false },
      { z: -6.9, steer: false, drive: true, dual: true },
      { z: -8.25, steer: false, drive: true, dual: true },
    ],
    massKg: 9500, powerKw: 450, torqueNm: 2750, idleRpm: 600, maxRpm: 2100, gears: THIRTEEN_SPEED, reverseRatio: 11.8, finalDrive: 3.36,
    topSpeedKph: 120, fuelTankL: 760, fuelLPer100Km: 38, fifthWheelZ: -7.35,
    defaultPaint: { primary: '#e7e3d8', secondary: '#1b3f73', accent: '#d7d9dd', finish: 'gloss', stripe: 'swoosh' },
  },
  {
    id: 'northstar-aero-day', brand: 'Northstar', name: 'Aerodyne Day Cab', style: 'aero', cab: 'day', price: 52000,
    blurb: 'Sloped hood and side fairings: easy on fuel around the county.',
    frontZ: 2.05, rearZ: -6.95, width: 2.55, cabHeight: 3.0, roofHeight: 3.2, hoodLength: 2.3, sleeperLength: 0,
    wheelRadius: 0.52, track: 2.05,
    axles: [
      { z: 0, steer: true, drive: false, dual: false },
      { z: -4.9, steer: false, drive: true, dual: true },
      { z: -6.25, steer: false, drive: true, dual: true },
    ],
    massKg: 7900, powerKw: 335, torqueNm: 2250, idleRpm: 600, maxRpm: 2100, gears: TEN_SPEED, reverseRatio: 11.8, finalDrive: 3.25,
    topSpeedKph: 115, fuelTankL: 500, fuelLPer100Km: 31, fifthWheelZ: -5.35,
    defaultPaint: { primary: '#f1f1ee', secondary: '#2c6db5', accent: '#3b3e44', finish: 'gloss', stripe: 'swoosh' },
  },
  {
    id: 'northstar-aero-sleeper', brand: 'Northstar', name: 'Aerodyne Raised-Roof Sleeper', style: 'aero', cab: 'raised', price: 92000,
    blurb: 'Raised-roof sleeper with full fairings for long hauls at low fuel burn.',
    frontZ: 2.05, rearZ: -7.95, width: 2.55, cabHeight: 3.0, roofHeight: 4.0, hoodLength: 2.3, sleeperLength: 1.8,
    wheelRadius: 0.52, track: 2.05,
    axles: [
      { z: 0, steer: true, drive: false, dual: false },
      { z: -5.9, steer: false, drive: true, dual: true },
      { z: -7.25, steer: false, drive: true, dual: true },
    ],
    massKg: 8700, powerKw: 375, torqueNm: 2500, idleRpm: 600, maxRpm: 2100, gears: THIRTEEN_SPEED, reverseRatio: 11.8, finalDrive: 3.25,
    topSpeedKph: 118, fuelTankL: 620, fuelLPer100Km: 32, fifthWheelZ: -6.35,
    defaultPaint: { primary: '#5d6670', secondary: '#f1f1ee', accent: '#e0a12b', finish: 'metallic', stripe: 'band' },
  },
  {
    id: 'northstar-aero-lwb', brand: 'Northstar', name: 'Aerodyne LWB Sleeper', style: 'aero', cab: 'raised', price: 118000,
    blurb: 'Long wheelbase, the roomiest sleeper Northstar builds and a smooth ride loaded.',
    frontZ: 2.05, rearZ: -8.75, width: 2.55, cabHeight: 3.0, roofHeight: 4.05, hoodLength: 2.3, sleeperLength: 2.15,
    wheelRadius: 0.52, track: 2.05,
    axles: [
      { z: 0, steer: true, drive: false, dual: false },
      { z: -6.7, steer: false, drive: true, dual: true },
      { z: -8.05, steer: false, drive: true, dual: true },
    ],
    massKg: 9200, powerKw: 400, torqueNm: 2600, idleRpm: 600, maxRpm: 2100, gears: THIRTEEN_SPEED, reverseRatio: 11.8, finalDrive: 3.25,
    topSpeedKph: 120, fuelTankL: 700, fuelLPer100Km: 33, fifthWheelZ: -7.15,
    defaultPaint: { primary: '#0f2a4a', secondary: '#c7ccd2', accent: '#e0a12b', finish: 'metallic', stripe: 'swoosh' },
  },
]

export const TRAILERS: TrailerModel[] = [
  {
    id: 'tanker-9500', kind: 'tanker', name: 'Fuel Tanker 9,000 gal', price: 24000,
    blurb: 'Polished aluminium tank in four compartments for diesel and gasoline.',
    frontZ: 0.9, rearZ: -12.1, width: 2.5, height: 3.4, deckHeight: 1.25, kingpinHeight: KINGPIN_HEIGHT,
    axles: [-10.3, -11.6], wheelRadius: 0.51, landingGearZ: -2.2, emptyMassKg: 7200, maxPayloadKg: 26000, capacityL: 34000,
    defaultColor: '#c9ced4',
  },
  {
    id: 'flatbed-48', kind: 'flatbed', name: '48 ft Flatbed', price: 9500,
    blurb: 'Steel and lumber, strapped down at every tie point.',
    frontZ: 0.9, rearZ: -13.7, width: 2.6, height: 1.55, deckHeight: 1.5, kingpinHeight: KINGPIN_HEIGHT,
    axles: [-11.8, -13.1], wheelRadius: 0.51, landingGearZ: -2.2, emptyMassKg: 5800, maxPayloadKg: 21000,
    defaultColor: '#3c4046',
  },
  {
    id: 'grain-42', kind: 'grain', name: 'Grain Hopper 42 ft', price: 19500,
    blurb: 'Two hopper gates and a roll tarp for corn, beans and wheat.',
    frontZ: 0.9, rearZ: -11.9, width: 2.55, height: 3.3, deckHeight: 1.3, kingpinHeight: KINGPIN_HEIGHT,
    axles: [-10.6, -11.9], wheelRadius: 0.51, landingGearZ: -2.2, emptyMassKg: 6400, maxPayloadKg: 23500,
    defaultColor: '#b7bdc4',
  },
  {
    id: 'reefer-53', kind: 'reefer', name: '53 ft Reefer', price: 34000,
    blurb: 'Insulated box with a diesel cooling unit; back square into the dock.',
    frontZ: 1.0, rearZ: -15.15, width: 2.6, height: 4.1, deckHeight: 1.3, kingpinHeight: KINGPIN_HEIGHT,
    axles: [-12.8, -14.1], wheelRadius: 0.51, landingGearZ: -2.4, emptyMassKg: 7300, maxPayloadKg: 19500,
    defaultColor: '#eef0f1',
  },
  {
    id: 'rgn-55', kind: 'lowboy', name: 'RGN Lowboy 55 ton', price: 44000,
    blurb: 'Removable gooseneck: detach it, drive the machine on over the front and reconnect.',
    frontZ: 0.9, rearZ: -15.6, width: 2.6, height: 1.6, deckHeight: 0.6, kingpinHeight: KINGPIN_HEIGHT,
    axles: [-12.4, -13.7, -15.0], wheelRadius: 0.45, landingGearZ: -1.6, emptyMassKg: 16000, maxPayloadKg: 50000,
    rgn: { neckRearZ: -3.1, wellFrontZ: -3.1, wellRearZ: -11.6, wellHeight: 0.6 },
    defaultColor: '#262a2f',
  },
]

export const CARGOS: CargoSpec[] = [
  { id: 'gravel', name: 'Gravel', haul: 'dump', minKg: 9000, maxKg: 24000, ratePerTonKm: 9, baseFee: 420, visual: 'gravel', color: '#8d877d', fragile: 0 },
  { id: 'sand', name: 'Washed sand', haul: 'dump', minKg: 9000, maxKg: 24000, ratePerTonKm: 9, baseFee: 400, visual: 'sand', color: '#c9a86b', fragile: 0 },
  { id: 'limestone', name: 'Crushed limestone', haul: 'dump', minKg: 9000, maxKg: 24000, ratePerTonKm: 10, baseFee: 450, visual: 'limestone', color: '#b9b5aa', fragile: 0 },
  { id: 'riprap', name: 'Rip-rap', haul: 'dump', minKg: 12000, maxKg: 24000, ratePerTonKm: 11, baseFee: 520, visual: 'riprap', color: '#77736b', fragile: 0 },
  { id: 'topsoil', name: 'Screened topsoil', haul: 'dump', minKg: 8000, maxKg: 20000, ratePerTonKm: 8, baseFee: 380, visual: 'topsoil', color: '#4a3726', fragile: 0 },
  { id: 'diesel', name: 'Diesel fuel', haul: 'tanker', minKg: 18000, maxKg: 26000, ratePerTonKm: 15, baseFee: 1100, visual: 'fuel', color: '#d9c25a', fragile: 0.5 },
  { id: 'gasoline', name: 'Unleaded gasoline', haul: 'tanker', minKg: 16000, maxKg: 24000, ratePerTonKm: 17, baseFee: 1250, visual: 'fuel', color: '#e2d8a8', fragile: 0.6 },
  { id: 'beams', name: 'Steel I-beams', haul: 'flatbed', minKg: 14000, maxKg: 21000, ratePerTonKm: 13, baseFee: 950, visual: 'beams', color: '#5c4a3f', fragile: 0.2 },
  { id: 'coils', name: 'Steel coils', haul: 'flatbed', minKg: 15000, maxKg: 21000, ratePerTonKm: 14, baseFee: 1000, visual: 'coils', color: '#8f969d', fragile: 0.3 },
  { id: 'rebar', name: 'Rebar bundles', haul: 'flatbed', minKg: 10000, maxKg: 18000, ratePerTonKm: 12, baseFee: 850, visual: 'rebar', color: '#6b4a34', fragile: 0.1 },
  { id: 'lumber', name: 'Dimensional lumber', haul: 'flatbed', minKg: 9000, maxKg: 17000, ratePerTonKm: 12, baseFee: 800, visual: 'lumber', color: '#c79a5e', fragile: 0.3 },
  { id: 'plywood', name: 'Plywood', haul: 'flatbed', minKg: 8000, maxKg: 16000, ratePerTonKm: 12, baseFee: 780, visual: 'plywood', color: '#d1ad74', fragile: 0.4 },
  { id: 'trusses', name: 'Roof trusses', haul: 'flatbed', minKg: 5000, maxKg: 9000, ratePerTonKm: 16, baseFee: 900, visual: 'trusses', color: '#d5b17a', fragile: 0.7 },
  { id: 'pipe', name: 'Concrete pipe', haul: 'flatbed', minKg: 12000, maxKg: 20000, ratePerTonKm: 13, baseFee: 920, visual: 'pipe', color: '#a6a39b', fragile: 0.5 },
  { id: 'corn', name: 'Shelled corn', haul: 'grain', minKg: 16000, maxKg: 23500, ratePerTonKm: 11, baseFee: 760, visual: 'corn', color: '#e0b43c', fragile: 0.1 },
  { id: 'soybeans', name: 'Soybeans', haul: 'grain', minKg: 16000, maxKg: 23500, ratePerTonKm: 12, baseFee: 800, visual: 'soybeans', color: '#c8b27a', fragile: 0.1 },
  { id: 'wheat', name: 'Hard red wheat', haul: 'grain', minKg: 16000, maxKg: 23500, ratePerTonKm: 11, baseFee: 760, visual: 'wheat', color: '#b98a4b', fragile: 0.1 },
  { id: 'frozen', name: 'Frozen food', haul: 'reefer', minKg: 10000, maxKg: 19500, ratePerTonKm: 16, baseFee: 1150, visual: 'pallets', color: '#9fc2d8', fragile: 0.5, coldChain: true },
  { id: 'produce', name: 'Fresh produce', haul: 'reefer', minKg: 9000, maxKg: 18000, ratePerTonKm: 15, baseFee: 1050, visual: 'pallets', color: '#7dbb5a', fragile: 0.7, coldChain: true },
  { id: 'dairy', name: 'Dairy', haul: 'reefer', minKg: 10000, maxKg: 19000, ratePerTonKm: 15, baseFee: 1100, visual: 'pallets', color: '#f2efe4', fragile: 0.6, coldChain: true },
  { id: 'excavator', name: '20-ton excavator', haul: 'lowboy', minKg: 20500, maxKg: 20500, ratePerTonKm: 22, baseFee: 2400, visual: 'excavator', color: '#e3a21a', fragile: 0.4 },
]

export type StackOption = 'none' | 'single' | 'dual' | 'dualTall'
export type BumperOption = 'stock' | 'chrome' | 'heavy'
export type LightOption = 'stock' | 'cabBar' | 'full'
export type WheelOption = 'steel' | 'polished' | 'black'
export type FlapOption = 'plain' | 'chrome'
export type HornOption = 'stock' | 'air'
export type GrilleOption = 'stock' | 'bars' | 'slats' | 'mesh' | 'blackout'
export type RoofOption = 'none' | 'low' | 'tall'

export interface TruckLook {
  paint: Paint
  stacks: StackOption
  visor: boolean
  bumper: BumperOption
  lights: LightOption
  wheels: WheelOption
  mudflaps: FlapOption
  horn: HornOption
  grille: GrilleOption
  /** Roof fairing over the cab (and a flat-top sleeper); trucks with a raised sleeper or a dump bed never get one. */
  roof: RoofOption
  /** Side fairings between the steer axle and the drives; never on dump trucks. */
  skirts: boolean
}

export const LOOK_PRICES = {
  repaint: 1200,
  finish: { gloss: 0, metallic: 900, matte: 600 } as Record<Finish, number>,
  stripe: { none: 0, pinstripe: 350, band: 500, swoosh: 800, twoTone: 1100, chevron: 900 } as Record<Stripe, number>,
  stacks: { none: 0, single: 700, dual: 1400, dualTall: 2200 } as Record<StackOption, number>,
  visor: 650,
  bumper: { stock: 0, chrome: 1600, heavy: 2400 } as Record<BumperOption, number>,
  lights: { stock: 0, cabBar: 800, full: 1900 } as Record<LightOption, number>,
  wheels: { steel: 0, polished: 2600, black: 1500 } as Record<WheelOption, number>,
  mudflaps: { plain: 0, chrome: 300 } as Record<FlapOption, number>,
  horn: { stock: 0, air: 450 } as Record<HornOption, number>,
  grille: { stock: 0, bars: 900, slats: 900, mesh: 1300, blackout: 700 } as Record<GrilleOption, number>,
  roof: { none: 0, low: 1400, tall: 2100 } as Record<RoofOption, number>,
  skirts: 1800,
}

/** True when this truck can carry a roof fairing (no raised sleeper, no dump bed). */
export function roofAllowed(model: TruckModel): boolean {
  return model.style !== 'dump' && model.cab !== 'raised'
}

/** True when this truck can carry side skirts (every semi tractor). */
export function skirtsAllowed(model: TruckModel): boolean {
  return model.style !== 'dump'
}

/** Clears the parts this truck can't carry. Returns the same object. */
export function fitLook(look: TruckLook, model: TruckModel): TruckLook {
  if (!roofAllowed(model)) look.roof = 'none'
  if (!skirtsAllowed(model)) look.skirts = false
  return look
}

export function defaultLook(model: TruckModel): TruckLook {
  const dump = model.style === 'dump'
  const cabover = model.style === 'cabover'
  return {
    paint: { ...model.defaultPaint },
    stacks: dump ? 'single' : cabover ? 'single' : model.style === 'longnose' ? 'dualTall' : 'none',
    visor: model.style === 'longnose',
    bumper: model.style === 'longnose' ? 'chrome' : dump ? 'heavy' : 'stock',
    lights: 'stock',
    wheels: model.style === 'longnose' ? 'polished' : 'steel',
    mudflaps: 'plain',
    horn: 'stock',
    grille: 'stock',
    roof: model.style === 'aero' && model.cab === 'day' ? 'low' : 'none',
    skirts: model.style === 'aero',
  }
}

/** A factory design: a set of parts and a paint layout the dealer and the garage apply in one click (colours are kept). */
export interface TruckDesign {
  id: string
  name: string
  blurb: string
  finish: Finish
  stripe: Stripe
  parts: Omit<TruckLook, 'paint'>
}

export const DESIGNS: TruckDesign[] = [
  {
    id: 'heritage', name: 'Heritage', blurb: 'Two-tone paint, a chrome bar grille, visor and tall stacks.', finish: 'gloss', stripe: 'twoTone',
    parts: { stacks: 'dualTall', visor: true, bumper: 'chrome', lights: 'cabBar', wheels: 'polished', mudflaps: 'chrome', horn: 'air', grille: 'bars', roof: 'none', skirts: false },
  },
  {
    id: 'fleet', name: 'Fleet aero', blurb: 'Tall roof fairing, side skirts and a slatted grille for the lowest fuel burn.', finish: 'gloss', stripe: 'band',
    parts: { stacks: 'none', visor: false, bumper: 'stock', lights: 'stock', wheels: 'steel', mudflaps: 'plain', horn: 'stock', grille: 'slats', roof: 'tall', skirts: true },
  },
  {
    id: 'workhorse', name: 'Workhorse', blurb: 'Blacked-out grille, heavy bumper, cab-bar lights and matte chevrons.', finish: 'matte', stripe: 'chevron',
    parts: { stacks: 'single', visor: false, bumper: 'heavy', lights: 'cabBar', wheels: 'black', mudflaps: 'plain', horn: 'air', grille: 'blackout', roof: 'none', skirts: false },
  },
  {
    id: 'showroom', name: 'Showroom', blurb: 'Metallic paint, mesh grille, a full light set and every bit of chrome.', finish: 'metallic', stripe: 'swoosh',
    parts: { stacks: 'dual', visor: true, bumper: 'chrome', lights: 'full', wheels: 'polished', mudflaps: 'chrome', horn: 'air', grille: 'mesh', roof: 'low', skirts: false },
  },
]

export const DESIGN_BY_ID: Record<string, TruckDesign> = Object.fromEntries(DESIGNS.map((d) => [d.id, d]))

/**
 * `base` with design `id` applied: the design's parts, finish and stripe, keeping the colours. `'factory'` gives the model's stock
 * parts. Parts the truck can't carry are left off.
 */
export function designLook(model: TruckModel, id: string, base: TruckLook = defaultLook(model)): TruckLook {
  const stock = defaultLook(model)
  const design = DESIGN_BY_ID[id]
  const paint = { ...base.paint, finish: design ? design.finish : stock.paint.finish, stripe: design ? design.stripe : stock.paint.stripe }
  const parts = design ? design.parts : stock
  const look: TruckLook = {
    paint, stacks: parts.stacks, visor: parts.visor, bumper: parts.bumper, lights: parts.lights, wheels: parts.wheels,
    mudflaps: parts.mudflaps, horn: parts.horn, grille: parts.grille, roof: parts.roof, skirts: parts.skirts,
  }
  if (design && model.style === 'aero' && look.stacks === 'dualTall') look.stacks = 'dual'
  return fitLook(look, model)
}

/** The id of the design `look` matches exactly (parts, finish and stripe), `'factory'` for the stock parts, or null when custom. */
export function designOf(model: TruckModel, look: TruckLook): string | null {
  for (const id of ['factory', ...DESIGNS.map((d) => d.id)]) {
    if (lookCost(look, designLook(model, id, look)) === 0) return id
  }
  return null
}

/** What the garage charges to go from `from` to `to` (only the parts that change). */
export function lookCost(from: TruckLook, to: TruckLook): number {
  let cost = 0
  const p = from.paint
  const q = to.paint
  if (p.primary !== q.primary || p.secondary !== q.secondary || p.accent !== q.accent) cost += LOOK_PRICES.repaint
  if (p.finish !== q.finish) cost += LOOK_PRICES.finish[q.finish] + (LOOK_PRICES.finish[q.finish] === 0 ? 150 : 0)
  if (p.stripe !== q.stripe) cost += LOOK_PRICES.stripe[q.stripe] + (q.stripe === 'none' ? 150 : 0)
  if (from.stacks !== to.stacks) cost += LOOK_PRICES.stacks[to.stacks]
  if (from.visor !== to.visor) cost += to.visor ? LOOK_PRICES.visor : 100
  if (from.bumper !== to.bumper) cost += LOOK_PRICES.bumper[to.bumper]
  if (from.lights !== to.lights) cost += LOOK_PRICES.lights[to.lights]
  if (from.wheels !== to.wheels) cost += LOOK_PRICES.wheels[to.wheels]
  if (from.mudflaps !== to.mudflaps) cost += LOOK_PRICES.mudflaps[to.mudflaps]
  if (from.horn !== to.horn) cost += LOOK_PRICES.horn[to.horn]
  if (from.grille !== to.grille) cost += LOOK_PRICES.grille[to.grille] + (to.grille === 'stock' ? 150 : 0)
  if (from.roof !== to.roof) cost += LOOK_PRICES.roof[to.roof] + (to.roof === 'none' ? 250 : 0)
  if (from.skirts !== to.skirts) cost += to.skirts ? LOOK_PRICES.skirts : 200
  return cost
}

export type BuildCategory = 'paving' | 'structure' | 'addon' | 'fence'
export type BuildMode = 'drag' | 'place' | 'line'

export interface BuildDef {
  id: string
  name: string
  category: BuildCategory
  mode: BuildMode
  /** Per square metre for `drag`, per metre for `line`, flat for `place`. */
  cost: number
  w: number
  d: number
  minW?: number
  minD?: number
  maxW?: number
  maxD?: number
  height: number
  solid: boolean
  colorable: boolean
  defaultColor: string
  defaultColor2?: string
  blurb: string
  /** A shop where your trucks are refuelled and repaired at cost. */
  service?: boolean
  /** Where you wash your own trucks by hand (water only). */
  wash?: boolean
}

export const BUILDINGS: BuildDef[] = [
  { id: 'pave-gravel', name: 'Gravel', category: 'paving', mode: 'drag', cost: 3, w: 10, d: 10, minW: 2, minD: 2, maxW: 120, maxD: 90, height: 0.06, solid: false, colorable: false, defaultColor: '#8a847a', blurb: 'Crushed stone parking. Cheap and quick.' },
  { id: 'pave-asphalt', name: 'Asphalt', category: 'paving', mode: 'drag', cost: 11, w: 10, d: 10, minW: 2, minD: 2, maxW: 120, maxD: 90, height: 0.08, solid: false, colorable: false, defaultColor: '#2f3134', blurb: 'Smooth blacktop with painted stalls.' },
  { id: 'pave-concrete', name: 'Concrete pad', category: 'paving', mode: 'drag', cost: 18, w: 10, d: 10, minW: 2, minD: 2, maxW: 120, maxD: 90, height: 0.12, solid: false, colorable: false, defaultColor: '#b4b1a9', blurb: 'Heavy-duty pad for shops and wash bays.' },
  { id: 'shop-steel', name: 'Steel shop', category: 'structure', mode: 'drag', cost: 165, w: 16, d: 24, minW: 12, minD: 14, maxW: 40, maxD: 36, height: 8, solid: true, colorable: true, defaultColor: '#8d969e', defaultColor2: '#2b4f7a', blurb: 'Insulated steel building with a roll-up door for every 5 m of front.', service: true },
  { id: 'pole-barn', name: 'Pole barn', category: 'structure', mode: 'drag', cost: 95, w: 14, d: 20, minW: 10, minD: 10, maxW: 36, maxD: 30, height: 6.5, solid: true, colorable: true, defaultColor: '#8e2f25', defaultColor2: '#ece8df', blurb: 'Open-front pole barn to keep trailers out of the weather.' },
  { id: 'office-building', name: 'Office', category: 'structure', mode: 'drag', cost: 240, w: 10, d: 8, minW: 8, minD: 6, maxW: 20, maxD: 15, height: 4, solid: true, colorable: true, defaultColor: '#d8d2c4', defaultColor2: '#3a3f46', blurb: 'Dispatch office with windows facing the yard.' },
  { id: 'office-trailer', name: 'Office trailer', category: 'addon', mode: 'place', cost: 6500, w: 4, d: 12, height: 3, solid: true, colorable: true, defaultColor: '#e7e4dc', blurb: 'A quick dispatch office on blocks.' },
  { id: 'fuel-island', name: 'Fuel island', category: 'addon', mode: 'place', cost: 18000, w: 6, d: 10, height: 5, solid: true, colorable: true, defaultColor: '#c4302b', blurb: 'Your own diesel pumps under a lit canopy.', service: true },
  { id: 'wash-bay', name: 'Wash bay', category: 'addon', mode: 'place', cost: 22000, w: 8, d: 22, height: 6, solid: true, colorable: true, defaultColor: '#2c6db5', blurb: 'Drive-through truck wash.', wash: true },
  { id: 'pressure-washer', name: 'Pressure washer', category: 'addon', mode: 'place', cost: 2800, w: 1, d: 2, height: 1.5, solid: true, colorable: true, defaultColor: '#d8a21c', blurb: 'Hot-water washer on a hose reel. Stand it beside your steel shop, park within reach and spray the truck yourself.', wash: true },
  { id: 'parts-shed', name: 'Parts shed', category: 'addon', mode: 'place', cost: 4200, w: 4, d: 6, height: 3, solid: true, colorable: true, defaultColor: '#6b7a5a', blurb: 'Filters, belts and spare tyres.' },
  { id: 'tire-rack', name: 'Tire rack', category: 'addon', mode: 'place', cost: 1500, w: 2, d: 6, height: 2.4, solid: true, colorable: false, defaultColor: '#1f2124', blurb: 'A rack of spare truck tyres.' },
  { id: 'light-pole', name: 'Light pole', category: 'addon', mode: 'place', cost: 900, w: 1, d: 1, height: 9, solid: true, colorable: false, defaultColor: '#6e747a', blurb: 'Lights the yard after dark.' },
  { id: 'sign', name: 'Company sign', category: 'addon', mode: 'place', cost: 1800, w: 1, d: 5, height: 5, solid: true, colorable: true, defaultColor: '#f2a33a', blurb: 'Your name on a lit sign at the road.' },
  { id: 'dumpster', name: 'Dumpster', category: 'addon', mode: 'place', cost: 600, w: 2, d: 3, height: 1.8, solid: true, colorable: true, defaultColor: '#2f6b3a', blurb: 'Roll-off dumpster.' },
  { id: 'air-station', name: 'Air station', category: 'addon', mode: 'place', cost: 1200, w: 2, d: 2, height: 1.6, solid: true, colorable: false, defaultColor: '#c4302b', blurb: 'Tyre air and a shop compressor.' },
  { id: 'flag-pole', name: 'Flag pole', category: 'addon', mode: 'place', cost: 700, w: 1, d: 1, height: 10, solid: true, colorable: false, defaultColor: '#c9ccd1', blurb: 'A tall pole with a plain blue flag.' },
  { id: 'fence-chain', name: 'Chain-link fence', category: 'fence', mode: 'line', cost: 25, w: 10, d: 0.15, height: 2.2, solid: true, colorable: false, defaultColor: '#9aa0a6', blurb: 'Galvanised chain-link with a top rail.' },
  { id: 'fence-wood', name: 'Privacy fence', category: 'fence', mode: 'line', cost: 35, w: 10, d: 0.15, height: 2, solid: true, colorable: true, defaultColor: '#8a6a45', blurb: 'Board-on-board privacy fence.' },
]

export const TRUCK_BY_ID: Record<string, TruckModel> = Object.fromEntries(TRUCKS.map((m) => [m.id, m]))
export const TRAILER_BY_ID: Record<string, TrailerModel> = Object.fromEntries(TRAILERS.map((m) => [m.id, m]))
export const CARGO_BY_ID: Record<string, CargoSpec> = Object.fromEntries(CARGOS.map((c) => [c.id, c]))
export const BUILDING_BY_ID: Record<string, BuildDef> = Object.fromEntries(BUILDINGS.map((b) => [b.id, b]))

export function trailerForKind(kind: TrailerKind): TrailerModel {
  const model = TRAILERS.find((t) => t.kind === kind)
  if (!model) throw new Error(`No trailer of kind ${kind}`)
  return model
}

/** Which haul a truck can do on its own (dump trucks) or with a trailer of this kind behind it. */
export function haulFor(truck: TruckModel, trailer: TrailerModel | null): HaulKind | null {
  if (truck.dump) return 'dump'
  if (truck.fifthWheelZ !== undefined && trailer) return trailer.kind
  return null
}
