/** Seeded player-name and nickname generator built from part tables, so any seed gives the same invented name and the pool never runs dry. */
import { Rng } from './random'

export const FIRST_NAMES: readonly string[] = [
  'Biff', 'Moose', 'Dusty', 'Ricky', 'Chet', 'Duke', 'Skip', 'Butch', 'Tank', 'Buck', 'Rusty', 'Bubba', 'Lefty', 'Spud', 'Gus',
  'Hank', 'Dirk', 'Brick', 'Chip', 'Rex', 'Turk', 'Vern', 'Earl', 'Clem', 'Cletus', 'Dewey', 'Floyd', 'Hoss', 'Jimbo', 'Lonnie',
  'Merle', 'Otis', 'Randy', 'Sonny', 'Stubby', 'Wade', 'Wiley', 'Ziggy', 'Boomer', 'Chunk', 'Dutch', 'Fritz', 'Gomer', 'Huck',
  'Jethro', 'Kip', 'Lyle', 'Mitch', 'Norm', 'Ollie', 'Pudge', 'Rollo', 'Stosh', 'Tubby', 'Vito', 'Woody', 'Zeke', 'Arlo', 'Bart',
  'Cooter', 'Dale', 'Elmo', 'Ferris', 'Grady', 'Herb', 'Ike', 'Jasper', 'Kermit', 'Luther', 'Marv', 'Ned', 'Orville', 'Peewee',
  'Quincy', 'Roscoe', 'Shep', 'Thad', 'Ulysses', 'Virgil', 'Waldo', 'Yancy', 'Bo', 'Cash', 'Denny', 'Eddie', 'Fats', 'Gil',
]

const LAST_START: readonly string[] = [
  'Chowder', 'Crotch', 'Wank', 'Butt', 'Belly', 'Pickle', 'Noodle', 'Sweat', 'Stink', 'Grease', 'Knuckle', 'Dumpling', 'Gravy',
  'Sludge', 'Muffin', 'Burrito', 'Booger', 'Funk', 'Mullet', 'Sausage', 'Bacon', 'Cheese', 'Gizzard', 'Lard', 'Nacho', 'Rump',
  'Toot', 'Waffle', 'Wedgie', 'Spittle', 'Dingle', 'Fumble', 'Hiney', 'Keister', 'Plunger', 'Bunion', 'Pants', 'Scratch', 'Belch',
  'Snort', 'Gobble', 'Slop', 'Wiggle', 'Grunt', 'Flab', 'Chug', 'Mud', 'Jiggle', 'Squat', 'Bloat',
]

const LAST_END: readonly string[] = [
  'head', 'field', 'owski', 'bottom', 'berg', 'stein', 'worth', 'ington', 'son', 'man', 'ford', 'ley', 'wick', 'bucket', 'hammer',
  'lump', 'flap', 'britches', 'mouth', 'toes', 'ski', 'baum', 'stadt', 'meyer', 'hauser', 'ton', 'well', 'brook', 'more', 'heimer',
]

const LAST_PLAIN: readonly string[] = [
  'Bobble', 'Doublewide', 'Fumbleton', 'Hotpocket', 'McGoober', 'Pantsload', 'Snodgrass', 'Wafflecone', 'Crumpet', 'Tatertot',
  'Lugnut', 'Tadpole', 'Pudding', 'Fartwell', 'Shortcake', 'Nubbins', 'Butterworth', 'Dinkle', 'Puddles', 'Gumdrop',
]

const NICK_ADJECTIVE: readonly string[] = [
  'Belching', 'Sweaty', 'Itchy', 'Soggy', 'Greasy', 'Wobbly', 'Gassy', 'Lumpy', 'Crusty', 'Grumpy', 'Slippery', 'Saucy', 'Stinky',
  'Moist', 'Hairy', 'Snoring', 'Dancing', 'Flatulent', 'Drowsy', 'Bald', 'Barefoot', 'Chunky', 'Squishy', 'Burping',
]

const NICK_NOUN: readonly string[] = [
  'Buffalo', 'Meatball', 'Walrus', 'Pickle', 'Hambone', 'Possum', 'Biscuit', 'Moose', 'Goose', 'Tater', 'Noodle', 'Badger',
  'Burrito', 'Sasquatch', 'Hog', 'Muffin', 'Weasel', 'Gravy Boat', 'Lawnmower', 'Toad', 'Pretzel', 'Hot Tub', 'Manatee', 'Porkchop',
]

export interface GeneratedName {
  first: string
  last: string
  nickname: string
}

export function lastName(rng: Rng): string {
  if (rng.chance(0.18)) return rng.pick(LAST_PLAIN)
  return rng.pick(LAST_START) + rng.pick(LAST_END)
}

export function nickname(rng: Rng): string {
  return `The ${rng.pick(NICK_ADJECTIVE)} ${rng.pick(NICK_NOUN)}`
}

export function generateName(rng: Rng): GeneratedName {
  return { first: rng.pick(FIRST_NAMES), last: lastName(rng), nickname: nickname(rng) }
}

/** A list of unique full names, reproducible from the seed. */
export function nameList(seed: number, count: number): string[] {
  const rng = new Rng(seed)
  const seen = new Set<string>()
  const names: string[] = []
  let attempts = 0
  while (names.length < count && attempts < count * 50) {
    attempts++
    const name = generateName(rng)
    const full = `${name.first} ${name.last}`
    if (seen.has(full)) continue
    seen.add(full)
    names.push(full)
  }
  return names
}
