/**
 * Downtown Montello's storefronts along West and East Montello Street and Main
 * Street: how each front looks, from the owner's own photos of the south side
 * of West Montello Street (one from the corner of West Street facing
 * south-east, one from the east facing back west) and of Main Street (the
 * south-west corner of Montello and Main, and the east side) and the video
 * from the quarry park (the south side of East Montello Street), and the north side of West Montello Street east of
 * West Street, shop by shop (`NORTH_WEST_MONTELLO_FRONTS`). The rest of the block gets a front in the same
 * spirit, picked from its building's seed. Names on signs are the businesses'
 * real names in plain lettering (OpenStreetMap or the photos); no logos.
 *
 * Renderer-free: positions are map coordinates (x east, z north, metres from
 * City Hall), matched to the nearest store building's covering rectangle.
 */

export type UpperFinish = 'brick' | 'stucco' | 'paint' | 'stone' | 'siding' | 'boards'
/** `wall`: the upper storey's finish carries on down to the walk, with only doors (and `panes`) in it. */
export type GroundFinish = 'glass' | 'logs' | 'stone' | 'brick' | 'boards' | 'porch' | 'wall'

export interface Sign {
  text: string
  board: number
  ink: number
  /** Lettered straight on the wall (no board), or a round hanging sign. */
  painted?: boolean
  round?: boolean
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
  /** The front stops at the eave under the roof's overhang instead of rising to a parapet (a long side under a gable). */
  eave?: boolean
  /** On a brick street storey: display windows only over these spans (shares of the front, left to right), plain brick elsewhere. */
  panes?: [number, number][]
  /** How many windows (and the door) across a stone street storey, when it differs from one every metre and a half. */
  groundWindows?: number
  /** The bay window's frame, when it differs from the trim. */
  bayColor?: number
  /** Where the bay window's centre is (a share of the front), when it isn't at an end; and a bowed bay instead of a box. */
  bayAt?: number | number[]
  bayKind?: 'box' | 'curved'
  /** Upper windows placed from the photo: the centre (a share of the front) and the width (metres) of each. */
  windowsAt?: [number, number][]
  /** Shutters beside the upper windows. */
  shutters?: number
  /** Iron grille vents in the frieze over the upper windows. */
  vents?: boolean
  /** The kick plate under the display windows, when it differs from the street storey (rock-faced stone with `kickStone`). */
  kick?: number
  kickStone?: boolean
  /** A vertical-board fascia over the display windows. */
  fascia?: number
  /** Curtains drawn at the sides of the display windows, with a valance. */
  curtains?: number
  /** Concrete steps up to each door. */
  stoop?: boolean
  /** A rock-faced stone foundation course along the bottom of the front. */
  base?: number
  /** Each door's colour, left to right (stair door included), when they differ from the usual dark wood. */
  doorColors?: number[]
  /** Brick for the theatre's piers and parapet when the walls are another colour. */
  brick?: number
  /** A shingled mansard roof over the street storey (the theatre), with a white dormer band. */
  mansardRoof?: number
  /** An oval sign plaque centred on the upper wall, with its frame colour. */
  oval?: Sign & { frame: number }
  /** A house's front porch over this share of the front (0 to 1), and a bay window on the street storey with a little iron balcony over it. */
  porch?: [number, number]
  groundBay?: number
  /** The street storey's height (metres), when it differs from the usual shop height. */
  streetStorey?: number
  /** A stepped parapet rising over the middle of the front, or brick piers rising at both ends with a corbelled band between (the theatre). */
  parapet?: 'stepped' | 'piers'
  /** A marquee over the entrance with this lettering, lit at night. */
  marquee?: string
  /** Put the sign board high on the upper wall instead of over the display windows. */
  signAt?: 'top'
  /** Where the shop entries are, as shares of the front (0 to 1, left to right seen from the street), from the owner's photos. */
  doors?: number[]
  /** The narrow door to the stairs up on a two-storey front: at the left end (the usual), the right end, or none. */
  stairDoor?: 'left' | 'right' | 'none'
  /** Cornice, window hoods, frames and sills. */
  trim: number
  /** Window heads: an arched hood, a flat hood, or plain (the frame and sill only). */
  hoods: 'arch' | 'flat' | 'plain'
  /** The window hoods' colour, when it differs from the trim (or the brick's darker tone). */
  hoodColor?: number
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
  /** The turret as a shingled oriel on carved brackets with a flat crown, rising a little over the cornice, instead of a spired tower. */
  turretKind?: 'spire' | 'oriel'
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
    note: 'Granite Falls Supper Club: red brick with a corbelled frieze and dark recessed panels, an oriel bay at the east end, arched windows, a shingled mansard awning over rock-faced stone',
    style: { wall: 0x9e4a37, upper: 'brick', ground: 'stone', groundColor: 0xcdb895, trim: 0xd9c9ae, hoods: 'arch', hoodColor: 0xc9b89a, cornice: 'corbel', band: 0x5e3428, awning: { kind: 'mansard', color: 0x4b4642 }, sign: { text: 'Granite Falls', board: 0x6e2a20, ink: 0xf3e6c4 }, blade: { text: 'Supper Club', board: 0x1f3a2a, ink: 0xf1e9cf }, bay: true },
  },
  {
    at: [29, -22.1],
    note: 'TamBears: white-painted brick, three tall arched windows, a dentilled top, a dark display window and two white doors, a hanging sign',
    style: { wall: 0xefeeea, upper: 'brick', ground: 'brick', groundColor: 0xedece7, trim: 0xf4f3ef, hoods: 'arch', hoodColor: 0xf7f6f2, cornice: 'corbel', windows: 3, panes: [[0.06, 0.5]], doors: [0.62], stairDoor: 'right', doorColors: [0xf2f1ed, 0xf2f1ed], blade: { text: 'TamBears', board: 0xf3eee2, ink: 0x1b1b1b } },
  },
  {
    at: [22.8, -23.8],
    note: 'The long buff brick block: tall windows under buff arched hoods, a dentilled cornice, dark green storefronts with curtains and a green fascia',
    style: { wall: 0xcbbea4, upper: 'brick', ground: 'glass', groundColor: 0x34443c, kick: 0x34443c, fascia: 0x34443c, curtains: 0xebe7dc, trim: 0x34443c, hoods: 'arch', hoodColor: 0xb9a582, cornice: 'corbel' },
  },
  {
    at: [16.2, -27.3],
    note: 'The same buff block (Gregory Wright Law Offices), the white sign on its green fascia',
    style: { wall: 0xcbbea4, upper: 'brick', ground: 'glass', groundColor: 0x34443c, kick: 0x34443c, fascia: 0x34443c, trim: 0x34443c, hoods: 'arch', hoodColor: 0xb9a582, cornice: 'corbel', sign: { text: 'Law Offices', board: 0xeceae4, ink: 0x2a2f2c } },
  },
  {
    at: [7.1, -24.3],
    note: 'Cream brick with two wide windows under brown arched hoods, a brown bracketed cornice and band, a maroon board fascia over two display windows on a white rock-faced base, the door between them',
    style: { wall: 0xdccab2, upper: 'brick', ground: 'glass', groundColor: 0x5a3430, kick: 0xe7e3db, kickStone: true, fascia: 0x6a3532, trim: 0x6b4632, hoods: 'arch', cornice: 'brackets', band: 0x6b4632, windows: 2, windowWidth: 1.15, doors: [0.5], stairDoor: 'none' },
  },
  {
    at: [-1.8, -32.4],
    note: "Yahooz's building under renovation: two storeys wrapped in house wrap, three windows with dark green shutters, a dark green bracketed cornice and two doors",
    style: { wall: 0xf0f1ef, upper: 'paint', ground: 'wall', trim: 0x2e4640, hoods: 'plain', cornice: 'brackets', windows: 3, windowWidth: 0.9, shutters: 0x2e4640, doors: [0.24, 0.8], doorColors: [0xb78f9c, 0x6a4a34], stairDoor: 'none' },
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
    note: 'The corner building: buff brick with dark red trim, a dark red cornice and iron grille vents in the frieze, and the shingled corner oriel on carved brackets at the West Montello Street corner, its flat crown over the cornice',
    style: { wall: 0xd9c89c, upper: 'brick', ground: 'brick', groundColor: 0xd5c398, trim: 0x6e2723, hoods: 'plain', cornice: 'brackets', turret: 'auto', turretKind: 'oriel', turretColor: 0xe6dcc2, vents: true, base: 0x8b8173, panes: [[0.12, 0.6]], doors: [0.75], stairDoor: 'none', stoop: true },
  },
  {
    at: [92, 2.4],
    street: 'West Montello Street',
    note: "The corner building's north side on West Montello: a red door by the oriel, a big curtained display window, plain buff brick, three windows upstairs under the grille vents and a red door up steps at the river end",
    style: { wall: 0xd9c89c, upper: 'brick', ground: 'brick', groundColor: 0xd5c398, trim: 0x6e2723, hoods: 'plain', cornice: 'brackets', vents: true, base: 0x8b8173, windowsAt: [[0.56, 0.95], [0.74, 0.95], [0.91, 0.95]], panes: [[0.22, 0.5]], curtains: 0xe8e0c8, doors: [0.12, 0.93], doorColors: [0x6e2723, 0x6e2723], stairDoor: 'none', stoop: true },
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
    style: { wall: 0xc9ae7b, upper: 'brick', ground: 'stone', groundColor: 0xd8cfba, trim: 0xe9dfc8, hoods: 'arch', cornice: 'corbel', band: 0x9a8356, awning: { kind: 'panel', color: 0xcfad45 }, doors: [0.47] },
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
    note: 'Montello Theatre: a dark brown board front under a shingled mansard roof with a white dormer band, a cream panel with the oval gold sign between brick piers with corbelled caps under a brick band; the long white wing behind',
    style: { wall: 0xeeebe3, upper: 'stucco', brick: 0x9a4a36, ground: 'boards', groundColor: 0x3d2c22, pierColor: 0x3d2c22, trim: 0xf1ede4, hoods: 'plain', cornice: 'simple', streetStorey: 3.0, parapet: 'piers', mansardRoof: 0x6a4b3c, groundWindows: 4, oval: { text: 'Montello Theatre', board: 0xf3e6c8, ink: 0x7a2e1e, frame: 0xc8952e } },
  },
  {
    at: [203.2, -21.7],
    note: 'The white flat-roofed building set back beside the theatre',
    style: { wall: 0xeeede8, upper: 'paint', ground: 'boards', groundColor: 0xeeede8, pierColor: 0x9a9a96, trim: 0xd8d8d2, hoods: 'flat', cornice: 'simple' },
  },
  {
    at: [195.6, -7.5],
    street: 'East Montello Street',
    note: 'The cream stucco house: a bay window with a red roof and a little iron balcony over it, a front porch on round columns over the east part, brown window frames',
    style: { wall: 0xebdcb4, upper: 'stucco', ground: 'porch', trim: 0x6a4030, hoods: 'plain', cornice: 'simple', house: true, porch: [0.55, 1], groundBay: 0.28, windowsAt: [[0.28, 0.95], [0.72, 1.0]] },
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
    note: 'White-painted brick with a pale blue patterned frieze, two white bay windows, the pools and spas sign and a pale blue board shop front (the first word of the sign is unreadable in the photo)',
    style: { wall: 0xeeeeea, upper: 'brick', ground: 'boards', groundColor: 0xa9c6dc, pierColor: 0xeeeeea, trim: 0xf4f4f0, hoods: 'plain', cornice: 'simple', band: 0x9cbcd6, windowsAt: [[0.3, 1.2], [0.78, 1.2]], bayAt: [0.3, 0.78], bayColor: 0xf4f4f0, groundWindows: 3, doorColors: [0xa9c6dc], sign: { text: 'POOLS & SPAS', board: 0xf4f4f0, ink: 0x1f4f9a } },
  },
  {
    at: [44.1, 22.6],
    street: 'West Montello Street',
    note: 'White-painted brick with a red bay window, a red cap, a black shingled awning over the display windows and a hanging sign (Central Wisconsin Pharmacy)',
    style: { wall: 0xeeece6, upper: 'brick', ground: 'glass', groundColor: 0x2a2c30, kick: 0xeeece6, trim: 0x8e2a2a, hoods: 'plain', cornice: 'simple', band: 0x8e2a2a, windowsAt: [[0.38, 1.3], [0.84, 0.75]], bayAt: 0.38, bayColor: 0x8e2a2a, awning: { kind: 'mansard', color: 0x2b2b2e }, doors: [0.5], stairDoor: 'none', blade: { text: 'Central Wisconsin Pharmacy', board: 0x23395b, ink: 0xffffff } },
  },
  {
    at: [33.9, 21.6],
    street: 'West Montello Street',
    note: 'Oyster Crackers: weathered cream lap siding, a wide window and a narrow one upstairs, an orange band over a yellow-green board front, its sign and a hanging sign',
    style: { wall: 0xe2d6b8, upper: 'siding', ground: 'boards', groundColor: 0xc4c13e, pierColor: 0xb7b43a, fascia: 0xe0862c, trim: 0x8a3a2a, hoods: 'plain', cornice: 'simple', windowsAt: [[0.4, 1.5], [0.8, 0.8]], groundWindows: 3, doorColors: [0x3a6a3a], sign: { text: 'Oyster Crackers', board: 0xf3f0e6, ink: 0x2a2a2a }, blade: { text: 'Oyster Crackers', board: 0xf3f0e6, ink: 0x2a2a2a } },
  },
  {
    at: [72.1, -5.8],
    street: 'West Montello Street',
    note: 'Rivers Edge Saloon & Eatery: white-painted brick, a wide three-part window and a single one upstairs, the name painted in red on the wall over display windows on a tan brick kick wall, a white side door',
    style: { wall: 0xf1f0eb, upper: 'brick', ground: 'brick', groundColor: 0xf1f0eb, kick: 0xb99566, trim: 0x34363a, hoods: 'plain', cornice: 'simple', windowsAt: [[0.4, 2.6], [0.78, 0.9]], panes: [[0.42, 0.9]], doors: [0.12, 0.3], doorColors: [0xf4f4f0, 0x3a3a3a], stairDoor: 'none', sign: { text: 'Rivers Edge', board: 0xf1f0eb, ink: 0xd2452c, painted: true } },
  },
  {
    at: [66.0, -13.7],
    street: 'West Montello Street',
    note: 'The Montello Candy Store: grey-painted brick with two arched windows, a brown bracketed cornice, a red-brown shingled awning over a slate shop front',
    style: { wall: 0x878c8f, upper: 'brick', ground: 'glass', groundColor: 0x3b4d57, trim: 0x5e4334, hoods: 'arch', hoodColor: 0x7a7f82, cornice: 'brackets', windows: 2, windowWidth: 1.1, awning: { kind: 'mansard', color: 0x8a4a3a }, doors: [0.84], stairDoor: 'none', sign: { text: 'The Montello Candy Store', board: 0xf3e9d2, ink: 0x6a1f1a } },
  },
  {
    at: [56.4, -10.0],
    street: 'West Montello Street',
    note: 'Silver-Smith Jewelry: cream Italianate brick, two windows under grey arched hoods, a grey bracketed cornice, a grey-blue shop front on a red brick base with the door in the middle up its steps',
    style: { wall: 0xe9e3d3, upper: 'brick', ground: 'glass', groundColor: 0x8d9aa1, kick: 0x9a4a38, trim: 0xa3acb0, hoods: 'arch', hoodColor: 0xa3acb0, cornice: 'brackets', windows: 2, windowWidth: 1.05, doors: [0.55], stairDoor: 'none', stoop: true, blade: { text: 'Silver-Smith Jewelry', board: 0x1f2a36, ink: 0xe8e2d2 } },
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

/**
 * The north side of West Montello Street going east from West Street, from the owner's photos taken shop by shop:
 * the corner garage set back behind its lot (`CORNER_GARAGE`, dressed in `world/CornerGarage.ts`), the one-storey
 * brick shop at number 19, Artisan's Collective, the grey 1850 building, Weezie's Town Pump, the Battery Shop and the
 * green two-storey front with the red-brown bays. And across West Street, the long two-storey block on its west side.
 */
export const NORTH_WEST_MONTELLO_FRONTS: readonly KnownFront[] = [
  {
    at: [-10, 4.3],
    street: 'West Montello Street',
    note: 'Number 19: a one-storey red brick shop with a corbelled top, a white door and one display window',
    style: { wall: 0xb4613f, upper: 'brick', ground: 'brick', groundColor: 0xad5c3c, trim: 0xf2f0ea, hoods: 'flat', cornice: 'corbel', doors: [0.24], stairDoor: 'none', panes: [[0.44, 0.7]] },
  },
  {
    at: [-4.6, 17],
    street: 'West Montello Street',
    note: "Artisan's Collective: two storeys of buff-orange brick with five plain windows, a blue metal awning over dark display windows and a hanging sign",
    style: { wall: 0xc28a58, upper: 'brick', ground: 'brick', groundColor: 0xbb8455, trim: 0xf2f0ea, hoods: 'flat', cornice: 'corbel', windows: 5, doors: [0.47], stairDoor: 'none', awning: { kind: 'flat', color: 0x2c5fae, span: [0.02, 0.98] }, blade: { text: "Artisan's Collective", board: 0xf3efe6, ink: 0x1b1b1b } },
  },
  {
    at: [6, 17.8],
    street: 'West Montello Street',
    note: 'White-painted brick with four windows in navy frames, a navy bracketed cornice and a weathered wood-shingle awning over big display windows on a red brick kick wall, the white stair door at the east end',
    style: { wall: 0xe8e6df, upper: 'brick', ground: 'glass', groundColor: 0x2d3f5e, kick: 0x8e4a3a, trim: 0x2d3f5e, hoods: 'plain', cornice: 'brackets', band: 0x2d3f5e, windows: 4, windowWidth: 0.9, awning: { kind: 'mansard', color: 0x73695c }, doors: [0.66], stairDoor: 'right', doorColors: [0x2d3f5e, 0xf0eee8] },
  },
  {
    at: [11.7, 22],
    street: 'West Montello Street',
    note: "Weezie's Town Pump: cream brick with a red corbelled frieze, a green oriel bay and one window under a red brick arch, a green board fascia over windows in green frames on tan brick, green doors",
    style: { wall: 0xe4d7b2, upper: 'brick', ground: 'glass', groundColor: 0x2f5e45, kick: 0xc28b5c, fascia: 0x2f5e45, trim: 0x2f5e45, hoods: 'arch', hoodColor: 0x9a3f2c, cornice: 'corbel', band: 0x9a3f2c, windowsAt: [[0.4, 1.3], [0.78, 0.85]], bayAt: 0.4, bayColor: 0x2f5e45, doors: [0.1, 0.25], doorColors: [0x2f5e45, 0xe9e4d8], stairDoor: 'none', blade: { text: "Weezie's Town Pump", board: 0xf1ede2, ink: 0x1f5a3a } },
  },
  {
    at: [19.6, 16.9],
    street: 'West Montello Street',
    note: 'The Battery Shop: a one-storey tan brick front with windows in green frames under its green sign, a white brick false front over it',
    style: { wall: 0xe9e3d3, upper: 'brick', ground: 'brick', groundColor: 0xd8bc8c, trim: 0x2f6b4f, hoods: 'flat', cornice: 'simple', panes: [[0.08, 0.68]], doors: [0.84], sign: { text: 'BATTERY SHOP', board: 0x24694a, ink: 0xffffff } },
  },
  {
    at: [25.4, 20.3],
    street: 'West Montello Street',
    note: 'Dark grey vertical boards with a bowed bay window in natural wood, a red-brown shingled awning with a round hanging sign over a brick and glass shop front, the yellow door (the sign is unreadable in the photo: the name is made up)',
    style: { wall: 0x3f4753, upper: 'boards', ground: 'brick', groundColor: 0x9b5a40, trim: 0x9a6a44, hoods: 'plain', cornice: 'simple', windowsAt: [[0.12, 0.75], [0.56, 1.8]], bayAt: 0.56, bayKind: 'curved', bayColor: 0x9a6a44, awning: { kind: 'mansard', color: 0x7e3b30 }, panes: [[0.22, 0.56], [0.74, 0.95]], doors: [0.1, 0.65], doorColors: [0x2a2c30, 0xd9a531], stairDoor: 'none', blade: { text: 'Mercantile', board: 0x7a2a22, ink: 0xf1e6c8, round: true } },
  },
  {
    at: [-56.7, 1.7],
    street: 'West Street',
    note: 'Across West Street: the long two-storey buff rock-faced block with rows of plain windows under its grey gable',
    style: { wall: 0xd6c9ad, upper: 'stone', ground: 'stone', groundColor: 0xd1c3a5, trim: 0xe9e2d2, hoods: 'flat', cornice: 'simple', eave: true, windows: 8, windowWidth: 0.95, groundWindows: 8 },
  },
  {
    at: [-56.7, 1.7],
    street: 'West Montello Street',
    note: "The same block's end on West Montello Street",
    style: { wall: 0xd6c9ad, upper: 'stone', ground: 'stone', groundColor: 0xd1c3a5, trim: 0xe9e2d2, hoods: 'flat', cornice: 'simple', windows: 3, windowWidth: 0.95, groundWindows: 4 },
  },
]

/**
 * The garage on the north-east corner of West Street and West Montello Street, set back behind its parking lot: tan
 * board-and-batten walls, a brown hip roof over the office end with a door, a window and a bench, two white overhead
 * doors in the bay end, and a red sign on a tall post at the front of the lot (its lettering made up: the photo's is
 * unreadable). `lot` is the paved lot (map ring) from the corner's sidewalks to the garage and around its west end.
 */
export const CORNER_GARAGE = {
  at: [-23.7, 10.1] as [number, number],
  wall: 0xc9ae82,
  trim: 0xf1ece0,
  roof: 0x6b4a35,
  /** Share of the street wall the office takes (under the hip roof), from the West Street end. */
  office: 0.46,
  sign: { at: [-18.5, -3.9] as [number, number], text: ['AUTO', 'REPAIR'], board: 0xa3302a, ink: 0xffffff },
  lot: [-30.5, -6.4, -14, -2.3, -15.8, 7.3, -28.9, 4.2, -30.9, 12.6, -38.9, 10, -33.4, -3.4],
}

/** Buildings dressed outside the storefronts (the corner garage): the finish and colour of their walls all round. */
export function dressedWalls(x: number, z: number): Pick<FrontStyle, 'wall' | 'upper' | 'house'> | undefined {
  if (Math.hypot(CORNER_GARAGE.at[0] - x, CORNER_GARAGE.at[1] - z) < 1) return { wall: CORNER_GARAGE.wall, upper: 'boards' }
  return undefined
}

/** Buildings the footprint data is missing (map coordinates): centre, half sizes along and across Main Street, yaw of the first axis, eave height. */
export const EXTRA_BUILDINGS: readonly { at: [number, number]; half: [number, number]; yaw: number; h: number; roof: string }[] = [
  { at: [147.16, -67.93], half: [7.5, 9], yaw: -1.323, h: 7.2, roof: '#8d8a84' },
  { at: [148.9, -80.9], half: [4.7, 7.5], yaw: -1.323, h: 4.4, roof: '#6f6c68' },
  { at: [150.99, -91.21], half: [5, 7], yaw: -1.323, h: 4.2, roof: '#7a7772' },
]

/** Footprints with no building on the ground (map coordinates of the first block's centre): removed at load. */
export const REMOVED_BUILDINGS: readonly [number, number][] = [
  // The long white block set at an angle on the West Montello Street corner west of downtown (the owner: it isn't there).
  [-77.6, -14.2],
]

/** Buildings the lidar measured lower than they stand from the street (eave above the floor, metres). */
export const BUILDING_HEIGHTS: readonly { at: [number, number]; h: number }[] = [
  // The mural building steps down to the river; from West Montello Street it is two full storeys.
  { at: [66.5, 26.8], h: 8.8 },
  // Yahooz's building is two full storeys; Artisan's Collective, the white and navy building and Weezie's are two storeys from the street (the owner's photos).
  { at: [-1.8, -32.4], h: 6.6 },
  { at: [-4.6, 17], h: 7.6 },
  { at: [6, 17.8], h: 7.2 },
  { at: [11.7, 22], h: 7.0 },
  // The Kwik Trip store stands taller than the lidar's eave under its roof band.
  { at: [283.9, 35.1], h: 3.9 },
]

/** The welcome mural on the mural building's river wall: the building's first rectangle and the direction the wall faces. */
export const MURAL = { at: [66.5, 26.8] as [number, number], face: [1, 0] as [number, number] }

/** Every front matched to the owner's photos and video. */
export const ALL_FRONTS: readonly KnownFront[] = [...KNOWN_FRONTS, ...MAIN_STREET_FRONTS, ...EAST_MONTELLO_FRONTS, ...WEST_MONTELLO_DRIVE_FRONTS, ...MAIN_SOUTH_FRONTS, ...NORTH_WEST_MONTELLO_FRONTS]

/** The photographed fronts of the building whose first rectangle is centred at (x, z): one per street it faces, or none. */
export function knownFronts(x: number, z: number): KnownFront[] {
  return ALL_FRONTS.filter((k) => Math.hypot(k.at[0] - x, k.at[1] - z) < 3)
}
