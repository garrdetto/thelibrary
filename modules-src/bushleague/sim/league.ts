/** The 32 original clubs of the Bush Leagues and the parks they call home. Every name, color scheme and park is invented for this learning module. */
import type { Park, Team } from './types'

const FT = 0.3048

function park(id: string, name: string, feet: readonly number[], heightFeet: readonly number[], options: Partial<Pick<Park, 'altitude' | 'gravity' | 'dome' | 'backstop' | 'foulSide' | 'wind'>> = {}): Park {
  return {
    id,
    name,
    fence: feet.map((value) => value * FT),
    height: heightFeet.map((value) => value * FT),
    backstop: options.backstop ?? 18,
    foulSide: options.foulSide ?? 14,
    altitude: options.altitude ?? 150,
    gravity: options.gravity ?? 9.81,
    dome: options.dome ?? false,
    wind: options.wind ?? { speed: 2, toward: 0 },
  }
}

export const PARKS: readonly Park[] = [
  park('sandlot', 'Sandlot Classic', [318, 360, 395, 360, 318], [8, 8, 8, 8, 8], { backstop: 15, foulSide: 11, altitude: 260, wind: { speed: 2.5, toward: 10 } }),
  park('outhouse', 'The Outhouse', [325, 372, 402, 370, 322], [10, 10, 12, 10, 10], { altitude: 210, wind: { speed: 3, toward: -15 } }),
  park('uranus', 'Uranus Orbital Dome', [330, 380, 410, 380, 330], [12, 12, 12, 12, 12], { dome: true, gravity: 9.1, altitude: 0, wind: { speed: 0, toward: 0 } }),
  park('hellfire', 'Hellfire Yard', [335, 385, 415, 385, 335], [9, 9, 9, 9, 9], { altitude: 1600, wind: { speed: 3.5, toward: 0 } }),
  park('bayou', 'Bayou Butt Bowl', [320, 365, 398, 370, 326], [8, 8, 10, 8, 8], { altitude: 2, foulSide: 17, wind: { speed: 1.5, toward: 180 } }),
  park('deli', 'Grand Salami Deli Park', [310, 368, 400, 368, 330], [37, 15, 10, 10, 8], { altitude: 40, wind: { speed: 2.5, toward: -40 } }),
  park('carnival', 'Climax Carnival Field', [328, 375, 404, 375, 328], [8, 8, 8, 8, 8], { altitude: 300, wind: { speed: 2.2, toward: 25 } }),
  park('plumbing', 'The Plumbing Supply Co. Yard', [332, 380, 408, 374, 315], [10, 10, 12, 10, 24], { altitude: 180, wind: { speed: 2.4, toward: 30 } }),
  park('oasis', 'Sweaty Palms Oasis', [330, 376, 407, 376, 330], [8, 8, 8, 8, 8], { altitude: 340, wind: { speed: 3, toward: -5 } }),
  park('gutter', 'Gutter Bowl', [315, 360, 392, 360, 315], [14, 14, 14, 14, 14], { altitude: 20, foulSide: 10, backstop: 14, wind: { speed: 2, toward: 160 } }),
]

export function parkById(id: string): Park {
  return PARKS.find((item) => item.id === id) ?? PARKS[0]
}

interface TeamSeed {
  city: string
  name: string
  abbr: string
  colors: [string, string, string]
  park: string
  parkName: string
}

const LOWBROW_EAST: TeamSeed[] = [
  { city: 'Uranus', name: 'Astronauts', abbr: 'URA', colors: ['#1d2b6b', '#7fd6ff', '#f2f2f2'], park: 'uranus', parkName: 'Uranus Orbital Dome' },
  { city: 'Butte', name: 'Cheeks', abbr: 'BUT', colors: ['#c2185b', '#ffd1dc', '#3b1020'], park: 'sandlot', parkName: 'Cheek-to-Cheek Field' },
  { city: 'Fartsville', name: 'Thunder', abbr: 'FRT', colors: ['#4b7d2a', '#d8e35a', '#1d2a12'], park: 'outhouse', parkName: 'The Outhouse' },
  { city: 'Climax', name: 'Closers', abbr: 'CLX', colors: ['#d4145a', '#fbb03b', '#2a0b1d'], park: 'carnival', parkName: 'Climax Carnival Field' },
  { city: 'Intercourse', name: 'Buggy Whips', abbr: 'INT', colors: ['#2b2b2b', '#c9a227', '#f4efe1'], park: 'sandlot', parkName: 'Hitching Post Park' },
  { city: 'Boring', name: 'Bores', abbr: 'BOR', colors: ['#7a7a7a', '#bcbcbc', '#3a3a3a'], park: 'gutter', parkName: 'Beige Field' },
  { city: 'Hell', name: 'Hot Flashes', abbr: 'HEL', colors: ['#b71c1c', '#ff9800', '#1a0505'], park: 'hellfire', parkName: 'Hellfire Yard' },
  { city: 'Wet', name: 'Willies', abbr: 'WET', colors: ['#0277bd', '#80deea', '#01304a'], park: 'bayou', parkName: 'Soggy Bottom Park' },
]

const LOWBROW_WEST: TeamSeed[] = [
  { city: 'Skidmark', name: 'Speedsters', abbr: 'SKD', colors: ['#6d4c41', '#ffcc80', '#2b1c16'], park: 'gutter', parkName: 'Brake Dust Bowl' },
  { city: 'Big', name: 'Dumpers', abbr: 'DMP', colors: ['#5d4037', '#ffb74d', '#1b100c'], park: 'outhouse', parkName: 'The Dump' },
  { city: 'Sack Lunch', name: 'Sluggers', abbr: 'SAK', colors: ['#a1887f', '#ff7043', '#2e1f1a'], park: 'deli', parkName: 'Brown Bag Park' },
  { city: 'Dingleberry', name: 'Dingers', abbr: 'DNG', colors: ['#6a1b9a', '#ce93d8', '#1f0a2b'], park: 'carnival', parkName: 'Berry Patch Field' },
  { city: 'Moist', name: 'Towelettes', abbr: 'MST', colors: ['#00897b', '#e0f2f1', '#002b26'], park: 'oasis', parkName: 'Damp Dunes' },
  { city: 'Balk', name: 'Naked', abbr: 'BNK', colors: ['#f5c6a5', '#8d5524', '#2b1608'], park: 'sandlot', parkName: 'Birthday Suit Park' },
  { city: 'Jock Itch', name: 'Jackals', abbr: 'JCK', colors: ['#c0ca33', '#5d4037', '#1f2205'], park: 'gutter', parkName: 'Locker Room Yard' },
  { city: 'Swamp Butt', name: 'Gators', abbr: 'SWB', colors: ['#33691e', '#aed581', '#0f1f07'], park: 'bayou', parkName: 'Bayou Butt Bowl' },
]

const GUTTER_NORTH: TeamSeed[] = [
  { city: 'Backdoor', name: 'Sliders', abbr: 'BDS', colors: ['#283593', '#ff5252', '#0c1033'], park: 'sandlot', parkName: 'Back Alley Park' },
  { city: 'Grand', name: 'Salamis', abbr: 'SAL', colors: ['#c62828', '#ffeb3b', '#3e0a0a'], park: 'deli', parkName: 'Grand Salami Deli Park' },
  { city: "Plumber's", name: 'Crackers', abbr: 'PLM', colors: ['#1565c0', '#90a4ae', '#0b1f3a'], park: 'plumbing', parkName: 'The Plumbing Supply Co. Yard' },
  { city: 'Beer Gut', name: 'Bombers', abbr: 'BGB', colors: ['#f9a825', '#fffde7', '#3d2a00'], park: 'outhouse', parkName: 'Keg Stand Stadium' },
  { city: 'Wedgie', name: 'Warriors', abbr: 'WDG', colors: ['#ad1457', '#f8bbd0', '#2d0617'], park: 'carnival', parkName: 'Tighty Park' },
  { city: 'Mullet', name: 'Mafia', abbr: 'MUL', colors: ['#4e342e', '#d7ccc8', '#000000'], park: 'gutter', parkName: 'Business Front Park' },
  { city: 'Drunk', name: 'Uncles', abbr: 'DRU', colors: ['#e65100', '#ffe0b2', '#2b1100'], park: 'gutter', parkName: 'Last Call Grounds' },
  { city: 'Sweaty', name: 'Palms', abbr: 'SWP', colors: ['#00838f', '#ffca28', '#00252a'], park: 'oasis', parkName: 'Sweaty Palms Oasis' },
]

const GUTTER_SOUTH: TeamSeed[] = [
  { city: 'Pitch', name: 'Slaps', abbr: 'PSL', colors: ['#d81b60', '#ffffff', '#33001a'], park: 'hellfire', parkName: 'Slap Shot Yard' },
  { city: 'Hot Dog', name: 'Water', abbr: 'HDW', colors: ['#ef6c00', '#fff176', '#3a1a00'], park: 'gutter', parkName: 'Gutter Bowl' },
  { city: 'Muffin', name: 'Tops', abbr: 'MUF', colors: ['#8e24aa', '#ffccbc', '#22062a'], park: 'deli', parkName: 'Bakery Box Park' },
  { city: 'Gassy', name: 'Gulls', abbr: 'GUL', colors: ['#546e7a', '#fafafa', '#1a2329'], park: 'bayou', parkName: 'Low Tide Park' },
  { city: 'Cocktail', name: 'Weenies', abbr: 'CKW', colors: ['#bf360c', '#ffd180', '#2d0c02'], park: 'deli', parkName: 'Toothpick Field' },
  { city: 'Spit', name: 'Swappers', abbr: 'SPT', colors: ['#00acc1', '#e1f5fe', '#002a30'], park: 'oasis', parkName: 'Dugout Drool Yard' },
  { city: 'Toe Jam', name: 'Toucans', abbr: 'TJT', colors: ['#fdd835', '#43a047', '#1b1b00'], park: 'oasis', parkName: 'Flip Flop Field' },
  { city: 'Hung', name: 'Jury', abbr: 'HNG', colors: ['#37474f', '#ffd54f', '#0e1417'], park: 'plumbing', parkName: 'Courthouse Yard' },
]

function makeTeams(seeds: TeamSeed[], league: Team['league'], division: string): Team[] {
  return seeds.map((seed) => ({
    id: seed.abbr.toLowerCase(),
    city: seed.city,
    name: seed.name,
    abbr: seed.abbr,
    league,
    division,
    colors: { primary: seed.colors[0], secondary: seed.colors[1], accent: seed.colors[2] },
    park: seed.park,
    parkName: seed.parkName,
  }))
}

export const TEAMS: readonly Team[] = [
  ...makeTeams(LOWBROW_EAST, 'Lowbrow', 'Lowbrow East'),
  ...makeTeams(LOWBROW_WEST, 'Lowbrow', 'Lowbrow West'),
  ...makeTeams(GUTTER_NORTH, 'Gutter', 'Gutter North'),
  ...makeTeams(GUTTER_SOUTH, 'Gutter', 'Gutter South'),
]

export function teamById(id: string): Team {
  const team = TEAMS.find((item) => item.id === id)
  if (!team) throw new Error(`Unknown team ${id}`)
  return team
}

export function teamFullName(team: Team): string {
  return `${team.city} ${team.name}`
}
