/**
 * Downtown Montello's storefronts along West and East Montello Street and Main
 * Street: how each front looks, from the owner's own photos of the south side
 * of West Montello Street (one from the corner of West Street facing
 * south-east, one from the east facing back west) and of Main Street (the
 * south-west corner of Montello and Main, and the east side) and the video
 * from the quarry park (the south side of East Montello Street). The rest of the block gets a front in the same
 * spirit, picked from its building's seed. Names on signs are the businesses'
 * real names in plain lettering (OpenStreetMap or the photos); no logos.
 *
 * Renderer-free: positions are map coordinates (x east, z north, metres from
 * City Hall), matched to the nearest store building's covering rectangle.
 */

export type UpperFinish = 'brick' | 'stucco' | 'paint' | 'stone' | 'siding'
export type GroundFinish = 'glass' | 'logs' | 'stone' | 'brick' | 'boards' | 'porch'

export interface Sign {
  text: string
  board: number
  ink: number
}

export interface FrontStyle {
  /** The upper storey's wall colour and finish. */
  wall: number
  upper: UpperFinish
  /** The street storey: display windows, a log front, stone veneer, brick piers or vertical boards with a few windows. */
  ground: GroundFinish
  groundColor?: number
  /** The corner piers and base of the street storey, when they differ from `groundColor`. */
  pierColor?: number
  /** How many upper windows across, and how wide (metres), when they differ from the usual narrow sash windows. */
  windows?: number
  windowWidth?: number
  /** Upper windows filled in with brick. */
  blind?: boolean
  /** A raised terrace along the front: a rock-faced stone wall this high (metres) with an iron railing on top. */
  plinth?: { height: number; color: number }
  /** An iron balcony along the upper storey over this share of the front (0 to 1, left to right seen from the street). */
  balcony?: [number, number]
  /** A house on the street rather than a shop: the front stops at the eave, no cornice or sign, and the side walls get windows. */
  house?: boolean
  /** The street storey's height (metres), when it differs from the usual shop height. */
  streetStorey?: number
  /** A stepped parapet rising over the middle of the front (the theatre). */
  parapet?: 'stepped'
  /** A marquee over the entrance with this lettering, lit at night. */
  marquee?: string
  /** Put the sign board high on the upper wall instead of over the display windows. */
  signAt?: 'top'
  /** Cornice, window hoods, frames and sills. */
  trim: number
  hoods: 'arch' | 'flat'
  cornice: 'brackets' | 'corbel' | 'simple'
  /** A painted band just under the cornice. */
  band?: number
  /** Over the street storey: a shingled mansard, a flat awning (striped when `stripe` is set) or a tall ribbed metal panel; `span` is the share of the front it covers (0 to 1, left to right seen from the street). */
  awning?: { kind: 'mansard' | 'flat' | 'panel'; color: number; stripe?: number; span?: [number, number] }
  sign?: Sign
  /** A sign hung from a bracket, out over the sidewalk. */
  blade?: Sign
  /** An upper-storey bay window, at the left end of the front (seen from the street) unless it says `right`. */
  bay?: boolean | 'right'
  /** A corner turret on the upper storey with a shingled spire, at the end of the front by the cross street (`auto`). */
  turret?: 'auto' | 'left' | 'right'
  turretColor?: number
}

export interface KnownFront {
  /** Centre of the building's first covering rectangle, map coordinates. */
  at: [number, number]
  style: FrontStyle
  note: string
  /** The street the front faces, when the building stands on a corner. */
  street?: string
}

/** The streets whose buildings get storefronts, and the blocks they are built on (map coordinates). */
export const DOWNTOWN_STREETS = ['West Montello Street', 'East Montello Street', 'Main Street']
export const DOWNTOWN_BOX = { x0: -60, x1: 230, z0: -112, z1: 45 }
/** How far a front wall may stand from the street's centre line and still count as on the street. */
export const FRONT_REACH = 16

const CREAM = 0xe9dfc6
const TAN_TRIM = 0xc9a878

export const KNOWN_FRONTS: readonly KnownFront[] = [
  {
    at: [41.2, -16.6],
    note: 'Granite Falls Supper Club: red-brown brick with corbelled bands and dark recessed panels, a bay window, stone veneer below a shingled mansard awning',
    style: { wall: 0xa95f48, upper: 'brick', ground: 'stone', groundColor: 0xcdb895, trim: 0xb8826a, hoods: 'arch', cornice: 'corbel', band: 0x5e3428, awning: { kind: 'mansard', color: 0x4d3b30 }, sign: { text: 'Granite Falls', board: 0x6e2a20, ink: 0xf3e6c4 }, blade: { text: 'Supper Club', board: 0x1f3a2a, ink: 0xf1e9cf }, bay: true },
  },
  {
    at: [29, -22.1],
    note: 'TamBears: buff upper storey, dark brick and stone at the street, a hanging sign',
    style: { wall: 0xcdb791, upper: 'brick', ground: 'brick', groundColor: 0x7b4433, trim: CREAM, hoods: 'flat', cornice: 'simple', band: 0x8f8a7c, blade: { text: 'TamBears', board: 0xf3eee2, ink: 0x1b1b1b } },
  },
  {
    at: [22.8, -23.8],
    note: 'Tan stucco block with a long row of tall arched windows under cream hoods and a dark band below the cornice',
    style: { wall: 0xc9b38c, upper: 'stucco', ground: 'glass', groundColor: 0x8d8a83, trim: CREAM, hoods: 'arch', cornice: 'brackets', band: 0x4d5560 },
  },
  {
    at: [16.2, -27.3],
    note: 'The same tan stucco block (Gregory Wright Law Offices)',
    style: { wall: 0xc9b38c, upper: 'stucco', ground: 'glass', groundColor: 0x8d8a83, trim: CREAM, hoods: 'arch', cornice: 'brackets', band: 0x4d5560, sign: { text: 'Law Offices', board: 0x2e3a46, ink: 0xece6d6 } },
  },
  {
    at: [7.1, -24.3],
    note: 'Pale grey front with a white bracketed cornice',
    style: { wall: 0xd8d7d1, upper: 'paint', ground: 'glass', groundColor: 0x6f6d68, trim: 0xf4f2ec, hoods: 'arch', cornice: 'brackets' },
  },
  {
    at: [-1.8, -32.4],
    note: 'Yahooz: white upper storey with tan arched window hoods and cornice brackets over a log-sided front and the FOOD sign',
    style: { wall: 0xf1efe9, upper: 'paint', ground: 'logs', groundColor: 0xa06d3e, trim: TAN_TRIM, hoods: 'arch', cornice: 'brackets', sign: { text: 'FOOD', board: 0xf1e2a4, ink: 0x3a2414 }, blade: { text: 'Yahooz', board: 0x24272c, ink: 0xf3d24c } },
  },
]

/**
 * Main Street, from the owner's photos: the south-west corner of West Montello and Main Street with its turret and the
 * three fronts south of it on the west side, and the long buff block and the brown building on the east side.
 */
export const MAIN_STREET_FRONTS: readonly KnownFront[] = [
  {
    at: [92, 2.4],
    street: 'Main Street',
    note: 'The corner building: cream brick with red trim and cornice, a shingled bay, and a corner turret with a spire over West Montello Street',
    style: { wall: 0xdac798, upper: 'brick', ground: 'glass', groundColor: 0x9a8f7c, trim: 0x8f2f25, hoods: 'flat', cornice: 'brackets', bay: true, turret: 'auto', turretColor: 0xe2d3aa },
  },
  {
    at: [92, 2.4],
    street: 'West Montello Street',
    note: "The corner building's north side on West Montello: the same cream brick and red cornice over a rock-faced stone terrace wall with an iron railing, and balconies along the rear wing",
    style: { wall: 0xdac798, upper: 'brick', ground: 'brick', groundColor: 0xd6c394, trim: 0x8f2f25, hoods: 'flat', cornice: 'brackets', plinth: { height: 1.15, color: 0x8b8378 }, balcony: [0.5, 1] },
  },
  {
    at: [94.5, -6.7],
    note: 'Red brick front with a red cornice and a striped awning',
    style: { wall: 0xb4523d, upper: 'brick', ground: 'glass', groundColor: 0x5a3a30, trim: 0x9a3a2c, hoods: 'flat', cornice: 'simple', awning: { kind: 'flat', color: 0xf1efe8, stripe: 0x2e2e33 } },
  },
  {
    at: [95.3, -13.5],
    note: 'Brown brick front (Maggie\'s School of Movement)',
    style: { wall: 0x9b6b4b, upper: 'brick', ground: 'glass', groundColor: 0x5e4a3c, trim: 0xe4dac8, hoods: 'flat', cornice: 'corbel', sign: { text: "Maggie's School of Movement", board: 0x2e3a46, ink: 0xf1e9d6 } },
  },
  {
    at: [96.2, -23],
    note: 'MORE FOODS: a one-storey tan brick grocery with its green sign',
    style: { wall: 0xc7af86, upper: 'brick', ground: 'glass', groundColor: 0x7f6a52, trim: 0xebe3cf, hoods: 'flat', cornice: 'simple', sign: { text: 'MORE FOODS', board: 0x1f6b3a, ink: 0xffffff } },
  },
  {
    at: [138.9, -23.5],
    note: 'The long buff block, north part: segmental brick arches, a corbelled frieze with lattice panels, stone veneer below a yellow ribbed metal awning',
    style: { wall: 0xc9ae7b, upper: 'brick', ground: 'stone', groundColor: 0xd8cfba, trim: 0xe9dfc8, hoods: 'arch', cornice: 'corbel', band: 0x9a8356, awning: { kind: 'panel', color: 0xcfad45 } },
  },
  {
    at: [140.2, -35.6],
    note: 'The long buff block, south part: the same brick, tan vertical-board storefronts with dark brown trim and a small black awning',
    style: { wall: 0xc9ae7b, upper: 'brick', ground: 'boards', groundColor: 0xd9c291, pierColor: 0x4a3426, trim: 0x4a3426, hoods: 'arch', cornice: 'corbel', band: 0x9a8356, awning: { kind: 'flat', color: 0x23272b, span: [0, 0.32] } },
  },
  {
    at: [149.1, -49],
    note: 'Rock-faced block building beside the alley: two wide arched windows filled in with dark brick, a cream cornice band, cream boards between navy piers and a dark green panel over the shop',
    style: { wall: 0x8e8070, upper: 'stone', ground: 'boards', groundColor: 0xe3d8b4, pierColor: 0x2b3f7c, trim: 0xe6dcc6, hoods: 'arch', cornice: 'simple', windows: 2, windowWidth: 2.3, blind: true, awning: { kind: 'panel', color: 0x3c4a3a, span: [0.04, 0.74] } },
  },
]

/**
 * The south side of East Montello Street across from the quarry park, from the owner's video taken in the park: the
 * Montello Theatre, the white building beside it, and the two cream houses toward downtown.
 */
export const EAST_MONTELLO_FRONTS: readonly KnownFront[] = [
  {
    at: [215.1, -21],
    street: 'East Montello Street',
    note: 'Montello Theatre: red-brown brick with a stepped parapet, the name across the top and a lit marquee over the doors',
    style: { wall: 0x8e4b38, upper: 'brick', ground: 'brick', groundColor: 0x6e3a2c, trim: 0xe9dcc4, hoods: 'flat', cornice: 'simple', streetStorey: 3.4, parapet: 'stepped', sign: { text: 'Montello Theatre', board: 0xf1e6cc, ink: 0x8a2a1e }, signAt: 'top', marquee: 'NOW SHOWING' },
  },
  {
    at: [203.2, -21.7],
    note: 'The white flat-roofed building set back beside the theatre',
    style: { wall: 0xeeede8, upper: 'paint', ground: 'boards', groundColor: 0xeeede8, pierColor: 0x9a9a96, trim: 0xd8d8d2, hoods: 'flat', cornice: 'simple' },
  },
  {
    at: [195.6, -7.5],
    street: 'East Montello Street',
    note: 'The cream two-storey house with brown trim and a front porch',
    style: { wall: 0xe8dcbf, upper: 'siding', ground: 'porch', trim: 0x5a3a2a, hoods: 'flat', cornice: 'simple', house: true },
  },
  {
    at: [176.6, -8.3],
    street: 'East Montello Street',
    note: 'The cream storey-and-a-half house with its gable to the street and a front porch',
    style: { wall: 0xede5cd, upper: 'siding', ground: 'porch', trim: 0x6a4a36, hoods: 'flat', cornice: 'simple', house: true },
  },
]

const BRICKS = [0xa5503c, 0x8e4a3a, 0xc59a6a, 0xb8836a, 0x9c5a48, 0xb3684e]
const STUCCOS = [0xd8c7a2, 0xcbbd9e, 0xe0d3b6]
const PAINTS = [0xe8e2d6, 0x8fa3a8, 0x6f8a7a, 0xd9cbb0, 0x7d8c99]
const TRIMS = [CREAM, 0xf2f0ea, TAN_TRIM, 0x5a4a3c, 0x2f3a40]
const BOARDS = [0x24272c, 0x2e3a46, 0x5a2a22, 0x1f3a2a, 0xf1e9d6]

function rand(seed: number, salt: number): number {
  const x = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453
  return x - Math.floor(x)
}

function pick<T>(list: readonly T[], seed: number, salt: number): T {
  return list[Math.floor(rand(seed, salt) * list.length) % list.length]
}

/** A front for a downtown building nobody photographed yet, from its seed; its name (if any) goes on the sign. */
export function defaultFront(seed: number, name?: string): FrontStyle {
  const r = rand(seed, 11)
  const upper: UpperFinish = r < 0.6 ? 'brick' : r < 0.82 ? 'stucco' : 'paint'
  const wall = upper === 'brick' ? pick(BRICKS, seed, 12) : upper === 'stucco' ? pick(STUCCOS, seed, 12) : pick(PAINTS, seed, 12)
  const board = pick(BOARDS, seed, 13)
  const light = board === 0xf1e9d6
  return {
    wall,
    upper,
    ground: rand(seed, 14) < 0.82 ? 'glass' : 'brick',
    groundColor: pick([0x6f6d68, 0x3d4148, 0x7b4433, 0x8d8a83], seed, 15),
    trim: pick(TRIMS, seed, 16),
    hoods: rand(seed, 17) < 0.55 ? 'arch' : 'flat',
    cornice: upper === 'brick' && rand(seed, 18) < 0.5 ? 'corbel' : rand(seed, 18) < 0.8 ? 'brackets' : 'simple',
    band: rand(seed, 19) < 0.4 ? pick([0x4d5560, 0x5e3428, 0x8f8a7c], seed, 20) : undefined,
    awning: rand(seed, 21) < 0.35 ? { kind: rand(seed, 22) < 0.5 ? 'mansard' : 'flat', color: pick([0x3c4a3a, 0x5a2a22, 0x2c3440, 0x4d3b30], seed, 23) } : undefined,
    sign: name ? { text: name, board, ink: light ? 0x1b1b1b : 0xf1e9d6 } : undefined,
  }
}

/**
 * West Montello Street from the light to the west, from the owner's drive: the realty office on the north-west corner,
 * the river, the mural building, and the north side's fronts; and the three fronts on the south side between the
 * river and Granite Falls.
 */
export const WEST_MONTELLO_DRIVE_FRONTS: readonly KnownFront[] = [
  {
    at: [83.5, 36.0],
    street: 'West Montello Street',
    note: 'The realty office on the north-west corner: tan ledgestone, big dark windows and a deep brown fascia on a flat roof',
    style: { wall: 0xb4a793, upper: 'stone', ground: 'glass', groundColor: 0x34383c, pierColor: 0xa99b85, trim: 0x5b4636, hoods: 'flat', cornice: 'simple', awning: { kind: 'flat', color: 0x5b4636 } },
  },
  {
    at: [66.5, 26.8],
    street: 'West Montello Street',
    note: 'The mural building: pale blue with white trim, an oriel bay at the river end, a pressed-metal cornice and a blue shop front (the welcome mural is on its river wall)',
    style: { wall: 0xa7bccb, upper: 'siding', ground: 'glass', groundColor: 0x3f6f9e, pierColor: 0x3f6f9e, trim: 0xf2f0ea, hoods: 'flat', cornice: 'brackets', band: 0xb9c7d2, bay: 'right' },
  },
  {
    at: [60.4, 24.9],
    street: 'West Montello Street',
    note: 'Beige siding over a lime-green shop front, a dark bay window above',
    style: { wall: 0xd9cdb2, upper: 'siding', ground: 'glass', groundColor: 0x86b347, pierColor: 0x86b347, trim: 0x5a3a2c, hoods: 'flat', cornice: 'brackets', bay: true },
  },
  {
    at: [52.4, 24.1],
    street: 'West Montello Street',
    note: 'A tall tan false front with a red-brown bay and a dark red awning',
    style: { wall: 0xcdbd9a, upper: 'siding', ground: 'glass', groundColor: 0x6b2f2a, trim: 0xefe8d8, hoods: 'flat', cornice: 'simple', bay: 'right', awning: { kind: 'flat', color: 0x6b2f2a } },
  },
  {
    at: [44.1, 22.6],
    street: 'West Montello Street',
    note: 'Cream brick with arched windows (Central Wisconsin Pharmacy)',
    style: { wall: 0xd9c9a4, upper: 'brick', ground: 'glass', groundColor: 0x4a5a6a, trim: CREAM, hoods: 'arch', cornice: 'corbel', sign: { text: 'Central Wisconsin Pharmacy', board: 0x23395b, ink: 0xffffff } },
  },
  {
    at: [33.9, 21.6],
    street: 'West Montello Street',
    note: 'White Italianate front with a bracketed cornice and a round hanging sign (Oyster Crackers)',
    style: { wall: 0xefede6, upper: 'paint', ground: 'glass', groundColor: 0x2d2f33, trim: 0xf6f4ee, hoods: 'arch', cornice: 'brackets', blade: { text: 'Oyster Crackers', board: 0x1c1c1e, ink: 0xf3e7c9 } },
  },
  {
    at: [25.4, 20.3],
    street: 'West Montello Street',
    note: 'Tan siding with a blue and white striped awning',
    style: { wall: 0xd2c19c, upper: 'siding', ground: 'glass', groundColor: 0x5a6068, trim: 0xf2f0ea, hoods: 'flat', cornice: 'simple', awning: { kind: 'flat', color: 0x2e5a8a, stripe: 0xf1efe8 } },
  },
  {
    at: [72.1, -5.8],
    street: 'West Montello Street',
    note: 'Rivers Edge Saloon & Eatery: a cream Italianate front with tall arched windows by the bridge',
    style: { wall: 0xeae3d0, upper: 'paint', ground: 'glass', groundColor: 0x3d4148, trim: 0xf6f3ea, hoods: 'arch', cornice: 'brackets', sign: { text: 'Rivers Edge Saloon & Eatery', board: 0x2b2420, ink: 0xf1e2b8 } },
  },
  {
    at: [66.0, -13.7],
    street: 'West Montello Street',
    note: 'The Montello Candy Store: dark red-brown brick with an oriel bay and the flag out front',
    style: { wall: 0x7e3f34, upper: 'brick', ground: 'glass', groundColor: 0x2f2a28, trim: 0xe9dfc8, hoods: 'flat', cornice: 'corbel', bay: true, sign: { text: 'The Montello Candy Store', board: 0xf3e9d2, ink: 0x6a1f1a } },
  },
  {
    at: [56.4, -10.0],
    street: 'West Montello Street',
    note: 'Red brick with arched windows and a hanging sign (Silver-Smith Jewelry)',
    style: { wall: 0xa35a46, upper: 'brick', ground: 'glass', groundColor: 0x3a3532, trim: 0xe4d6bd, hoods: 'arch', cornice: 'corbel', blade: { text: 'Silver-Smith Jewelry', board: 0x1f2a36, ink: 0xe8e2d2 } },
  },
]

/** Main Street south of the alley, from the owner's drive north: H A Freitag & Son on the west side and the three fronts on the east side. */
export const MAIN_SOUTH_FRONTS: readonly KnownFront[] = [
  {
    at: [106.0, -101.0],
    street: 'Main Street',
    note: 'H A Freitag & Son: a long grey metal building with a stone-faced front',
    style: { wall: 0x9ea3a6, upper: 'paint', ground: 'stone', groundColor: 0x8f877b, trim: 0xe8e8e4, hoods: 'flat', cornice: 'simple', sign: { text: 'H A Freitag & Son', board: 0x1d3f73, ink: 0xffffff } },
  },
  {
    at: [147.16, -67.93],
    street: 'Main Street',
    note: 'Past the car alley: a two-storey buff rock-faced block (the used car office)',
    style: { wall: 0xcdbb94, upper: 'stone', ground: 'stone', groundColor: 0xc9b68e, trim: 0xe6dcc6, hoods: 'flat', cornice: 'simple', windows: 2, sign: { text: 'USED CARS', board: 0xf2efe6, ink: 0xb3241c } },
  },
  {
    at: [148.9, -80.9],
    street: 'Main Street',
    note: 'A one-storey brick shop with a dark awning',
    style: { wall: 0x9c5a48, upper: 'brick', ground: 'glass', groundColor: 0x3d3a36, trim: 0xe4d6bd, hoods: 'flat', cornice: 'corbel', awning: { kind: 'flat', color: 0x2c3440 } },
  },
  {
    at: [150.99, -91.21],
    street: 'Main Street',
    note: 'A one-storey white-sided shop with a red awning',
    style: { wall: 0xeeeeea, upper: 'siding', ground: 'glass', groundColor: 0x5a6068, trim: 0x3a4048, hoods: 'flat', cornice: 'simple', awning: { kind: 'flat', color: 0x6a2a24 } },
  },
]

/** Buildings the footprint data is missing (map coordinates): centre, half sizes along and across Main Street, yaw of the first axis, eave height. */
export const EXTRA_BUILDINGS: readonly { at: [number, number]; half: [number, number]; yaw: number; h: number; roof: string }[] = [
  { at: [147.16, -67.93], half: [7.5, 9], yaw: -1.323, h: 7.2, roof: '#8d8a84' },
  { at: [148.9, -80.9], half: [4.7, 7.5], yaw: -1.323, h: 4.4, roof: '#6f6c68' },
  { at: [150.99, -91.21], half: [5, 7], yaw: -1.323, h: 4.2, roof: '#7a7772' },
]

/** Buildings the lidar measured lower than they stand from the street (eave above the floor, metres). */
export const BUILDING_HEIGHTS: readonly { at: [number, number]; h: number }[] = [
  // The mural building steps down to the river; from West Montello Street it is two full storeys.
  { at: [66.5, 26.8], h: 8.8 },
]

/** The welcome mural on the mural building's river wall: the building's first rectangle and the direction the wall faces. */
export const MURAL = { at: [66.5, 26.8] as [number, number], face: [1, 0] as [number, number] }

/** Every front matched to the owner's photos and video. */
export const ALL_FRONTS: readonly KnownFront[] = [...KNOWN_FRONTS, ...MAIN_STREET_FRONTS, ...EAST_MONTELLO_FRONTS, ...WEST_MONTELLO_DRIVE_FRONTS, ...MAIN_SOUTH_FRONTS]

/** The photographed fronts of the building whose first rectangle is centred at (x, z): one per street it faces, or none. */
export function knownFronts(x: number, z: number): KnownFront[] {
  return ALL_FRONTS.filter((k) => Math.hypot(k.at[0] - x, k.at[1] - z) < 3)
}
