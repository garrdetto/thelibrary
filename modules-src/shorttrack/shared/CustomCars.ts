/**
 * Admin-made Short Track Showdown bodies. A custom car is a model placed in
 * the stock car's frame (metres, +x forward, +y up, +z the driver's right,
 * road at y = 0) and always drives on the stock car's physics. Shared by the
 * Worker, the admin car editor and the module.
 */

export type Point3 = { x: number; y: number; z: number }
export type CarAxle = { x: number; radius: number; width: number; halfTrack: number }
export type ModelTransform = { scale: number; yaw: number; x: number; y: number; z: number }
/**
 * Which part wears the driver's paint. `body` paints the whole model (dark parts such as glass and
 * tyres stay dark); `material` one material; `color` every texel close to `key`. `none` is from
 * older saves and now paints like `body`: every car takes the driver's colours.
 */
export type CarPaint = { mode: 'body' | 'none' | 'material' | 'color'; material: string; key: string; tolerance: number; color: string }

/** What drivers may change on this car in the Garage. The main colour is always theirs. */
export type CarGarage = {
  /** Paint schemes (stripes, flames, two-tone…) with the secondary and accent colours. */
  schemes: boolean
  /** The sponsor logo on the sides and hood. */
  logos: boolean
  /** Race numbers (as decals at the placed spots, painted on at the stock spots otherwise). */
  numbers: boolean
}
export const DEFAULT_GARAGE: CarGarage = { schemes: true, logos: true, numbers: true }
/** The car's Garage options, with older saves (no `garage`) allowing everything. */
export const carGarage = (spec: { garage?: Partial<CarGarage> | null }): CarGarage => ({ ...DEFAULT_GARAGE, ...(spec.garage ?? {}) })
/** The paint mode the game uses: `none` from older saves paints the whole body. */
export const paintMode = (paint: CarPaint): Exclude<CarPaint['mode'], 'none'> => paint.mode === 'none' ? 'body' : paint.mode
export type CarNumbers = {
  door: { x: number; y: number; h: number } | null
  roof: { x: number; h: number } | null
  tail: { y: number; h: number } | null
}

export type CustomCarSpec = {
  blurb: string
  model: ModelTransform
  axles: [CarAxle, CarAxle]
  wheelsRemoved: boolean
  paint: CarPaint
  garage?: CarGarage
  numbers: CarNumbers
  lights: { tail: Point3 | null }
}

export type CarStatus = 'draft' | 'published' | 'retired'

export type CustomCarRecord = CustomCarSpec & {
  id: string
  name: string
  modelUrl: string
  status: CarStatus
  active: boolean
  updatedAt: number
}

/** The built-in Super Late Model (`public/modules/shorttrack-car.bin`), measured from its mesh. */
export const STOCK_CAR = {
  front: 2.573,
  rear: -2.756,
  width: 2.19,
  height: 1.222,
  axles: [
    { x: 1.342, radius: 0.354, width: 0.46, halfTrack: 0.849 },
    { x: -1.448, radius: 0.352, width: 0.44, halfTrack: 0.841 },
  ] as [CarAxle, CarAxle],
  numbers: { door: { x: -0.05, y: 0.52, h: 0.3 }, roof: { x: -0.62, h: 0.36 }, tail: { y: 0.8, h: 0.17 } } as CarNumbers,
  tail: { x: -2.72, y: 0.82, z: 0.72 } as Point3,
}
export const STOCK_LENGTH = STOCK_CAR.front - STOCK_CAR.rear

export const CAR_LIMITS = {
  nameMin: 2,
  nameMax: 32,
  blurbMax: 60,
  modelBytes: 12 * 1024 * 1024,
  lengthMin: 3.6,
  lengthMax: 7,
  wheelRadiusMin: 0.22,
  wheelRadiusMax: 0.5,
} as const

export const CUSTOM_CAR_PREFIX = 'custom:'
export const CUSTOM_CAR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
export const carVehicleKey = (id: string) => `${CUSTOM_CAR_PREFIX}${id}`
export const carIdOf = (veh: string) => veh.startsWith(CUSTOM_CAR_PREFIX) && CUSTOM_CAR_ID.test(veh.slice(CUSTOM_CAR_PREFIX.length)) ? veh.slice(CUSTOM_CAR_PREFIX.length) : null

/** Real makes, models and racing series stay out of car names: every body is an original design. */
export const CAR_BRAND_PATTERN = /\b(ford|chevy|chevrolet|gmc|dodge|ram|jeep|chrysler|cadillac|buick|pontiac|oldsmobile|plymouth|tesla|toyota|lexus|honda|acura|nissan|infiniti|mazda|subaru|mitsubishi|hyundai|kia|volkswagen|vw|audi|porsche|bmw|mercedes|benz|volvo|ferrari|lamborghini|maserati|alfa ?romeo|fiat|bugatti|bentley|rolls-?royce|mclaren|aston ?martin|corvette|mustang|camaro|camry|charger|challenger|monte ?carlo|impala|fusion|supra|nascar|arca|indycar|formula ?1|f1)\b/i

/** A number spot's glyph height `h` (metres at 100% size) as the module's `numberSize` spot. */
export const numberSpot = (h: number) => ({ base: h, maxW: h * 4.6, maxH: h * 1.8 })
