/**
 * The bigger Buy catalog: furniture, appliances, hobbies, things for babies and kids, lighting, decor and the yard.
 * Every item has its own procedural model in `src/models/FurnitureMore.ts`. Names are original; no brands.
 */
import type { ActionDef, Category, GuestRule, ObjectDef, Placement, Pose } from './Catalog'
import type { LifeStage } from './Family'
import type { Need } from './Needs'

type Gains = Partial<Record<Need, number>>
type Opts = { money?: number; guest?: GuestRule; ages?: [LifeStage, LifeStage] }

function act(id: string, label: string, minutes: number, gains: Gains, pose: Pose = 'stand', opts: Opts = {}): ActionDef {
  return { id, label, minutes, gains, pose, guest: opts.guest ?? 'yes', ...(opts.money !== undefined ? { money: opts.money } : {}), ...(opts.ages ? { ages: opts.ages } : {}) }
}

function item(id: string, name: string, category: Category, price: number, w: number, d: number, height: number, place: Placement, color: string, accent: string, actions: ActionDef[] = [], extra: { seats?: number; flat?: boolean } = {}): ObjectDef {
  return { id, name, category, price, w, d, height, place, color, accent, actions, ...extra }
}

const LITTLE: [LifeStage, LifeStage] = ['baby', 'toddler']
const TODDLER_KID: [LifeStage, LifeStage] = ['toddler', 'child']
const TODDLER_UP: [LifeStage, LifeStage] = ['toddler', 'adult']
const TEEN_UP: [LifeStage, LifeStage] = ['teen', 'adult']

const relax = (fun = 0.25, energy = 0.1) => act('sit', 'Relax', 45, { energy, fun }, 'sit')
const nap = (energy = 0.18, minutes = 75) => act('nap', 'Nap', minutes, { energy }, 'lie', { guest: 'ask' })
const sleep = (energy: number, ages?: [LifeStage, LifeStage]) => act('sleep', 'Sleep', 480, { energy }, 'lie', { guest: 'ask', ages })
const sitDown = (label = 'Sit down', fun = 0.06, energy = 0.08, social = 0) => act('sit', label, 35, { energy, fun, ...(social ? { social } : {}) }, 'sit')
const dress = act('dress', 'Change outfit', 6, { hygiene: 0.4, fun: 0.4 })

export const MORE_ITEMS: readonly ObjectDef[] = [
  // Seating
  item('loveseat', 'Petite Loveseat', 'seating', 520, 2, 1, 0.85, 'indoor', '#b6705a', '#efe3cf', [relax(0.24), nap()], { seats: 2 }),
  item('sofa-long', 'Big Sky Three-Seater', 'seating', 1350, 3, 1, 0.85, 'indoor', '#4a5560', '#d8cfc0', [relax(0.28), nap(0.2)], { seats: 3 }),
  item('sofa-leather', 'Saddle Leather Sofa', 'seating', 1650, 2, 1, 0.85, 'indoor', '#6b3f26', '#8a5636', [relax(0.32, 0.12), nap(0.2)], { seats: 2 }),
  item('recliner', 'Lazy Day Recliner', 'seating', 690, 1, 1, 1.0, 'indoor', '#5b4a3e', '#7a6553', [relax(0.3, 0.14), nap(0.22)]),
  item('bean-bag', 'Squish Bean Bag', 'seating', 120, 1, 1, 0.55, 'indoor', '#e86f9a', '#c4527c', [act('sit', 'Flop down', 40, { fun: 0.32, energy: 0.08 }, 'sit', { ages: TODDLER_UP })]),
  item('rocking-chair', 'Porch Rocker', 'seating', 260, 1, 1, 1.05, 'any', '#8a6440', '#c9b28d', [act('sit', 'Rock a while', 40, { fun: 0.3, energy: 0.1 }, 'sit', { ages: TODDLER_UP })]),
  item('bar-stool', 'Counter Stool', 'seating', 95, 1, 1, 0.8, 'indoor', '#2f3136', '#b98a55', [sitDown()]),
  item('armchair-velvet', 'Velvet Club Chair', 'seating', 560, 1, 1, 1.0, 'indoor', '#2f6b5e', '#c9a75c', [relax(0.26, 0.11)]),
  item('chaise', 'Reading Chaise', 'seating', 880, 2, 1, 0.8, 'indoor', '#c7b299', '#8a6440', [relax(0.3, 0.12), nap(0.2)]),
  item('futon', 'Fold-Down Futon', 'seating', 480, 2, 1, 0.75, 'indoor', '#3a4a5c', '#b98a55', [relax(0.2), sleep(0.22)], { seats: 2 }),
  item('papasan', 'Papasan Chair', 'seating', 210, 1, 1, 0.8, 'indoor', '#c9a36b', '#d86b4a', [relax(0.28, 0.1)]),

  // Beds
  item('bed-queen', 'Low Platform Queen', 'beds', 1600, 2, 2, 0.5, 'indoor', '#3e3a36', '#7da0c4', [sleep(0.33), nap(0.26, 90)], { seats: 2 }),
  item('bed-canopy', 'Four-Poster Canopy Bed', 'beds', 2900, 2, 2, 2.2, 'indoor', '#5a3a26', '#e8d6c0', [sleep(0.36), nap(0.28, 90)], { seats: 2 }),
  item('bunk-bed', 'Twin Bunk Beds', 'beds', 780, 1, 2, 1.7, 'indoor', '#d2b48c', '#d8574a', [sleep(0.27), nap(0.21, 90)], { seats: 2 }),
  item('bed-cottage', 'Cottage Twin Bed', 'beds', 420, 1, 2, 0.6, 'indoor', '#f2efe7', '#e8a0b4', [sleep(0.27), nap(0.2, 90)]),

  // Tables, desks and storage
  item('coffee-table', 'Walnut Coffee Table', 'surfaces', 240, 2, 1, 0.45, 'indoor', '#7a5034', '#c9b28d'),
  item('end-table', 'Round End Table', 'surfaces', 110, 1, 1, 0.6, 'any', '#b98a55', '#7c532f'),
  item('desk', 'Writing Desk', 'surfaces', 380, 1, 1, 0.76, 'indoor', '#9b6a3d', '#30343a', [
    act('study', 'Study', 45, { fun: 0.35 }, 'sit', { guest: 'no' }),
    act('journal', 'Write in a journal', 35, { fun: 0.55, social: 0.1 }, 'sit', { guest: 'no', ages: TEEN_UP }),
  ]),
  item('dining-round', 'Round Bistro Table', 'surfaces', 420, 2, 2, 0.76, 'indoor', '#c08a52', '#7c532f'),
  item('console-table', 'Entry Console', 'surfaces', 260, 2, 1, 0.8, 'indoor', '#3e3a36', '#c9a75c'),
  item('dresser', 'Six-Drawer Dresser', 'surfaces', 450, 2, 1, 0.95, 'indoor', '#9b6a3d', '#d8c38a', [dress]),
  item('wardrobe', 'Tall Wardrobe', 'surfaces', 520, 1, 1, 2.0, 'indoor', '#7c532f', '#d8c38a', [dress]),
  item('display-cabinet', 'Glass Display Cabinet', 'surfaces', 480, 1, 1, 1.8, 'indoor', '#5a3a26', '#cfe3ef'),

  // Kitchen
  item('fridge-steel', 'French-Door Fridge', 'kitchen', 1350, 1, 1, 1.95, 'indoor', '#c9ced3', '#5b6168', [
    act('snack', 'Grab a snack', 12, { hunger: 1.9 }, 'stand', { guest: 'ask' }),
    act('meal', 'Have a cold meal', 35, { hunger: 2.2 }, 'stand', { money: -0.4, guest: 'ask' }),
  ]),
  item('range-pro', 'Pro Six-Burner Range', 'kitchen', 1800, 2, 1, 0.92, 'indoor', '#c9ced3', '#1b1b1d', [act('cook', 'Cook a big dinner', 50, { hunger: 2.8, fun: 0.3 }, 'stand', { money: -0.6, guest: 'no', ages: TEEN_UP })]),
  item('microwave', 'Microwave Cart', 'kitchen', 180, 1, 1, 1.25, 'indoor', '#f5f1e8', '#2c2c2c', [act('heat', 'Heat up leftovers', 10, { hunger: 2.0 }, 'stand', { money: -0.15, guest: 'ask' })]),
  item('coffee-bar', 'Barista Coffee Bar', 'kitchen', 420, 1, 1, 1.2, 'indoor', '#f5f1e8', '#7a5034', [act('coffee', 'Brew coffee', 10, { energy: 0.9, fun: 0.1 }, 'stand', { money: -0.1, ages: TEEN_UP })]),
  item('dishwasher', 'Quiet Dishwasher', 'kitchen', 520, 1, 1, 0.92, 'indoor', '#f5f1e8', '#c9ced3', [act('load', 'Load the dishwasher', 10, { hygiene: 0.4 }, 'stand', { guest: 'no' })]),
  item('island', 'Kitchen Island', 'kitchen', 720, 2, 1, 0.92, 'indoor', '#f5f1e8', '#b98a55', [act('prep', 'Make a salad', 20, { hunger: 1.6, fun: 0.1 }, 'stand', { money: -0.2, guest: 'ask' })]),
  item('pantry', 'Pantry Cabinet', 'kitchen', 300, 1, 1, 2.0, 'indoor', '#efe8da', '#b98a55', [act('cereal', 'Grab some cereal', 12, { hunger: 1.5 }, 'stand', { guest: 'ask' })]),
  item('cabinet', 'Upper-and-Lower Cabinet', 'kitchen', 220, 1, 1, 2.1, 'indoor', '#f5f1e8', '#b98a55'),

  // Bathroom
  item('bathtub', 'Soaking Tub', 'bathroom', 950, 2, 1, 0.6, 'indoor', '#f7f7f5', '#c7ced4', [act('bath', 'Take a bath', 40, { hygiene: 3.2, fun: 0.25, energy: 0.05 }, 'lie', { guest: 'ask', ages: TODDLER_UP })]),
  item('clawfoot', 'Clawfoot Tub', 'bathroom', 1700, 2, 1, 0.75, 'indoor', '#f7f7f5', '#c9a75c', [act('bath', 'Take a bubble bath', 45, { hygiene: 3.4, fun: 0.45, energy: 0.06 }, 'lie', { guest: 'ask', ages: TODDLER_UP })]),
  item('vanity-double', 'Double Vanity', 'bathroom', 780, 2, 1, 0.9, 'indoor', '#ffffff', '#7a5034', [act('wash', 'Wash up', 10, { hygiene: 2.4 }, 'stand')], { seats: 2 }),
  item('shower-rain', 'Rainfall Shower', 'bathroom', 1200, 1, 1, 2.2, 'indoor', '#e6eef2', '#7fb2cc', [act('shower', 'Take a rain shower', 22, { hygiene: 5, fun: 0.2 }, 'stand', { guest: 'ask' })]),
  item('towel-warmer', 'Heated Towel Rack', 'bathroom', 140, 1, 1, 1.1, 'indoor', '#c9ced3', '#efe3cf'),

  // Electronics
  item('tv-big', 'Cinema Wall TV', 'electronics', 1900, 2, 1, 1.5, 'indoor', '#1b1b1d', '#5a8fd8', [act('watch', 'Watch a movie', 70, { fun: 1.6 }, 'stand')]),
  item('game-console', 'Game Console Corner', 'electronics', 480, 1, 1, 0.9, 'indoor', '#2f3136', '#7fc4ff', [act('game', 'Play video games', 50, { fun: 1.5, social: 0.1 }, 'sit')]),
  item('gaming-pc', 'Gaming Rig', 'electronics', 2200, 1, 1, 1.3, 'indoor', '#3a3a40', '#ff4fa3', [
    act('work', 'Freelance work', 120, { fun: -0.1, energy: -0.05 }, 'sit', { money: 1.4, guest: 'no', ages: TEEN_UP }),
    act('play', 'Play online games', 50, { fun: 1.4, social: 0.4 }, 'sit', { guest: 'no' }),
  ]),
  item('jukebox', 'Neon Jukebox', 'electronics', 950, 1, 1, 1.6, 'indoor', '#c44e3f', '#ffd166', [act('dance', 'Dance', 30, { fun: 1.3, energy: -0.1, social: 0.2 }, 'stand', { ages: TODDLER_UP })]),
  item('arcade', 'Retro Arcade Cabinet', 'electronics', 1100, 1, 1, 1.8, 'indoor', '#3a2a5c', '#ff4fa3', [act('arcade', 'Play arcade games', 40, { fun: 1.3 }, 'stand')]),
  item('record-player', 'Record Console', 'electronics', 640, 2, 1, 0.8, 'indoor', '#7a5034', '#1b1b1d', [
    act('listen', 'Listen to records', 40, { fun: 0.9, energy: 0.05 }, 'stand'),
    act('dance', 'Dance', 30, { fun: 1.1, energy: -0.08, social: 0.15 }, 'stand', { ages: TODDLER_UP }),
  ]),

  // Hobbies and fitness
  item('piano', 'Upright Piano', 'hobbies', 2400, 2, 1, 1.3, 'indoor', '#2a1d16', '#f2efe7', [act('piano', 'Play the piano', 45, { fun: 1.0 }, 'sit')]),
  item('guitar', 'Acoustic Guitar Stand', 'hobbies', 380, 1, 1, 1.0, 'indoor', '#b98a55', '#2f3136', [act('guitar', 'Strum the guitar', 40, { fun: 0.95 }, 'stand')]),
  item('drums', 'Drum Kit', 'hobbies', 1200, 2, 1, 1.1, 'indoor', '#c44e3f', '#c9ced3', [act('drums', 'Play the drums', 35, { fun: 1.3, energy: -0.1 }, 'sit')]),
  item('easel', 'Painting Easel', 'hobbies', 260, 1, 1, 1.7, 'any', '#c9a36b', '#3a6fa8', [act('paint', 'Paint a picture', 50, { fun: 0.95 }, 'stand')]),
  item('chess', 'Chess Table', 'hobbies', 450, 2, 1, 0.75, 'any', '#7a5034', '#f2efe7', [act('chess', 'Play chess', 45, { fun: 0.7, social: 0.5 }, 'sit')], { seats: 2 }),
  item('pool-table', 'Billiards Table', 'hobbies', 1800, 2, 2, 0.85, 'indoor', '#2e6b3e', '#5a3a26', [act('billiards', 'Shoot pool', 45, { fun: 1.1, social: 0.3 }, 'stand')], { seats: 2 }),
  item('foosball', 'Foosball Table', 'hobbies', 520, 2, 1, 0.9, 'indoor', '#7a5034', '#3a6fa8', [act('foosball', 'Play foosball', 30, { fun: 1.0, social: 0.4 }, 'stand')], { seats: 2 }),
  item('ping-pong', 'Ping-Pong Table', 'hobbies', 650, 2, 2, 0.76, 'any', '#2a5aa8', '#f2efe7', [act('pingpong', 'Play ping-pong', 30, { fun: 1.1, social: 0.3, energy: -0.08 }, 'stand')], { seats: 2 }),
  item('treadmill', 'Treadmill', 'hobbies', 900, 1, 2, 1.4, 'indoor', '#2f3136', '#5bd77d', [act('run', 'Go for a run', 30, { fun: 0.4, energy: -0.25, hygiene: -0.2 }, 'stand', { ages: TEEN_UP })]),
  item('weights', 'Weight Bench', 'hobbies', 520, 1, 2, 1.2, 'any', '#2f3136', '#c44e3f', [act('lift', 'Lift weights', 30, { fun: 0.5, energy: -0.2, hygiene: -0.2 }, 'stand', { ages: TEEN_UP })]),
  item('yoga-mat', 'Yoga Mat', 'hobbies', 60, 1, 2, 0.02, 'any', '#7a5aa8', '#c9b8e8', [act('yoga', 'Do yoga', 30, { fun: 0.4, energy: 0.12, hygiene: -0.05 }, 'stand')]),
  item('telescope', 'Brass Telescope', 'hobbies', 680, 1, 1, 1.5, 'any', '#b08a3c', '#2f3136', [act('stargaze', 'Look through the telescope', 40, { fun: 0.9 }, 'stand')]),
  item('aquarium', 'Reef Aquarium', 'hobbies', 1100, 2, 1, 1.3, 'indoor', '#2f3136', '#3fb8a8', [act('fish', 'Watch the fish', 30, { fun: 0.6, energy: 0.05 }, 'stand', { ages: TODDLER_UP })]),
  item('bookshelf-wide', 'Library Wall Shelf', 'hobbies', 640, 2, 1, 2.0, 'indoor', '#5a3a26', '#3a6fa8', [act('read', 'Read a book', 50, { fun: 0.8 }, 'stand')]),

  // Babies and kids
  item('crib', 'Cozy Crib', 'kids', 340, 1, 1, 1.0, 'indoor', '#f2efe7', '#9fc6dc', [
    act('sleep', 'Sleep', 480, { energy: 0.35 }, 'lie', { guest: 'ask', ages: LITTLE }),
    act('nap', 'Nap', 90, { energy: 0.3 }, 'lie', { guest: 'ask', ages: LITTLE }),
  ]),
  item('high-chair', 'Wooden High Chair', 'kids', 150, 1, 1, 1.0, 'indoor', '#c9a36b', '#f2efe7', [act('eat', 'Eat in the high chair', 25, { hunger: 2.6 }, 'sit', { money: -0.15, ages: LITTLE })]),
  item('potty', 'Potty Trainer', 'kids', 40, 1, 1, 0.35, 'indoor', '#9fc6dc', '#ffffff', [act('potty', 'Use the potty', 10, { bladder: 10, hygiene: 0.5 }, 'sit', { ages: ['toddler', 'toddler'] })]),
  item('play-mat', 'Activity Play Mat', 'kids', 70, 2, 2, 0.03, 'indoor', '#7fc4ff', '#ffd166', [act('roll', 'Roll around', 30, { fun: 1.4, social: 0.2 }, 'sit', { ages: LITTLE })], { flat: true }),
  item('toy-box', 'Toy Chest', 'kids', 90, 1, 1, 0.55, 'indoor', '#d8a23c', '#c44e3f', [act('toys', 'Play with toys', 40, { fun: 1.4 }, 'stand', { ages: TODDLER_KID })]),
  item('blocks', 'Building Blocks', 'kids', 45, 1, 1, 0.3, 'any', '#3a6fa8', '#d8a23c', [act('blocks', 'Build a block tower', 35, { fun: 1.2 }, 'stand', { ages: ['baby', 'child'] })]),
  item('rocking-horse', 'Rocking Horse', 'kids', 130, 1, 1, 0.8, 'indoor', '#c9a36b', '#c44e3f', [act('ride', 'Ride the rocking horse', 30, { fun: 1.3 }, 'sit', { ages: TODDLER_KID })]),
  item('teddy', 'Giant Teddy Bear', 'kids', 85, 1, 1, 0.9, 'indoor', '#a8754f', '#5b3a28', [act('cuddle', 'Cuddle the teddy', 25, { fun: 0.8, social: 0.6 }, 'stand', { ages: ['baby', 'child'] })]),
  item('dollhouse', 'Dollhouse', 'kids', 240, 1, 1, 1.0, 'indoor', '#f2b8c6', '#7a5034', [act('dolls', 'Play house', 40, { fun: 1.2, social: 0.15 }, 'stand', { ages: TODDLER_KID })]),
  item('kids-table', 'Tea Party Table', 'kids', 140, 2, 1, 0.5, 'indoor', '#f2efe7', '#e86f9a', [act('tea', 'Have a tea party', 30, { fun: 1.0, social: 0.6 }, 'sit', { ages: TODDLER_KID })], { seats: 2 }),
  item('chalkboard', 'Chalkboard Easel', 'kids', 75, 1, 1, 1.1, 'any', '#7a5034', '#2f3136', [act('chalk', 'Draw with chalk', 35, { fun: 1.1 }, 'stand', { ages: TODDLER_KID })]),
  item('bed-racecar', 'Speedster Kids Bed', 'kids', 560, 1, 2, 0.7, 'indoor', '#d8392b', '#2f3136', [sleep(0.32, ['child', 'teen']), act('nap', 'Nap', 90, { energy: 0.24 }, 'lie', { guest: 'ask', ages: ['child', 'teen'] })]),

  // Lighting
  item('table-lamp', 'Ceramic Table Lamp', 'lighting', 70, 1, 1, 0.75, 'indoor', '#3fb8a8', '#fff1d0'),
  item('tripod-lamp', 'Tripod Floor Lamp', 'lighting', 150, 1, 1, 1.6, 'indoor', '#7a5034', '#f4ead6'),
  item('paper-lantern', 'Paper Lantern Lamp', 'lighting', 85, 1, 1, 1.3, 'indoor', '#3a3a3a', '#efe3cf'),
  item('torchiere', 'Brass Torchiere', 'lighting', 130, 1, 1, 1.8, 'indoor', '#b08a3c', '#ffe7b0'),
  item('candles', 'Candle Cluster', 'lighting', 35, 1, 1, 0.35, 'any', '#efe3cf', '#ffcf7a'),
  item('lamp-post', 'Garden Lamp Post', 'lighting', 240, 1, 1, 2.6, 'outdoor', '#2f3136', '#ffe2a8'),
  item('path-lantern', 'Path Lantern', 'lighting', 60, 1, 1, 0.6, 'outdoor', '#2f3136', '#ffe2a8'),
  item('tiki-torch', 'Tiki Torch', 'lighting', 45, 1, 1, 1.7, 'outdoor', '#8a6440', '#ff9a3c'),

  // Decor
  item('grandfather-clock', 'Grandfather Clock', 'decor', 780, 1, 1, 2.1, 'indoor', '#5a3a26', '#d8c38a'),
  item('floor-mirror', 'Leaning Floor Mirror', 'decor', 190, 1, 1, 1.8, 'indoor', '#c9a75c', '#cfe3ef', [act('primp', 'Check the mirror', 6, { hygiene: 0.6, fun: 0.4 }, 'stand')]),
  item('sculpture', 'Abstract Sculpture', 'decor', 640, 1, 1, 1.4, 'any', '#e8e1d3', '#c44e3f'),
  item('floor-vase', 'Floor Vase', 'decor', 95, 1, 1, 1.0, 'indoor', '#3a6fa8', '#c9a36b'),
  item('globe', 'Antique Globe', 'decor', 210, 1, 1, 1.0, 'indoor', '#7a5034', '#c9b06b', [act('spin', 'Spin the globe', 8, { fun: 0.5 }, 'stand', { ages: TODDLER_UP })]),
  item('palm', 'Potted Palm', 'decor', 140, 1, 1, 1.9, 'any', '#c9a36b', '#4f8f45'),
  item('cactus', 'Barrel Cactus', 'decor', 45, 1, 1, 0.6, 'any', '#c47a55', '#6a9c4c'),
  item('fig', 'Fiddle-Leaf Fig', 'decor', 110, 1, 1, 1.7, 'indoor', '#e8e1d3', '#3f7a35'),
  item('rug-round', 'Round Jute Rug', 'decor', 150, 2, 2, 0.02, 'indoor', '#c9a36b', '#8a6440', [], { flat: true }),
  item('rug-runner', 'Hall Runner', 'decor', 80, 1, 2, 0.02, 'indoor', '#3a5a8a', '#e9d6b4', [], { flat: true }),
  item('rug-shag', 'Shag Rug', 'decor', 220, 2, 2, 0.03, 'indoor', '#efe8da', '#d9cdb8', [], { flat: true }),
  item('folding-screen', 'Folding Screen', 'decor', 260, 2, 1, 1.7, 'indoor', '#c9a36b', '#efe3cf'),
  item('fireplace', 'Stone Fireplace', 'decor', 1500, 2, 1, 1.4, 'indoor', '#8a8178', '#ff8a3c', [act('warm', 'Warm up by the fire', 30, { fun: 0.6, energy: 0.1, social: 0.1 }, 'stand', { ages: TODDLER_UP })]),
  item('coat-tree', 'Coat Tree', 'decor', 60, 1, 1, 1.8, 'indoor', '#5a3a26', '#3a6fa8'),

  // Yard and play
  item('swing-set', 'Backyard Swing Set', 'outdoor', 480, 2, 1, 2.1, 'outdoor', '#3a6fa8', '#d8a23c', [act('swing', 'Swing', 40, { fun: 1.4 }, 'sit', { ages: TODDLER_UP })], { seats: 2 }),
  item('slide', 'Climbing Slide', 'outdoor', 620, 2, 2, 1.8, 'outdoor', '#e86f9a', '#ffd166', [act('slide', 'Go down the slide', 30, { fun: 1.5, energy: -0.1 }, 'stand', { ages: TODDLER_KID })]),
  item('trampoline', 'Trampoline', 'outdoor', 560, 2, 2, 0.9, 'outdoor', '#2f3136', '#3fb8a8', [act('jump', 'Jump on the trampoline', 30, { fun: 1.5, energy: -0.15 }, 'stand')]),
  item('sandbox', 'Sandbox', 'outdoor', 180, 2, 2, 0.3, 'outdoor', '#a87a4a', '#e9d6a4', [act('sand', 'Build a sand castle', 40, { fun: 1.3, hygiene: -0.1 }, 'sit', { ages: TODDLER_KID })]),
  item('playhouse', 'Backyard Playhouse', 'outdoor', 900, 2, 2, 2.0, 'outdoor', '#f2e3c6', '#c44e3f', [act('pretend', 'Play pretend', 40, { fun: 1.3, social: 0.2 }, 'stand', { ages: TODDLER_KID })]),
  item('soccer-goal', 'Soccer Goal', 'outdoor', 240, 2, 1, 1.3, 'outdoor', '#f2f2f0', '#e8e8e8', [act('soccer', 'Kick a ball around', 35, { fun: 1.2, energy: -0.12, hygiene: -0.08 }, 'stand')]),
  item('hot-tub', 'Cedar Hot Tub', 'outdoor', 3200, 2, 2, 0.9, 'outdoor', '#8a5d38', '#5ab8d8', [act('soak', 'Soak in the hot tub', 40, { hygiene: 0.8, fun: 0.9, social: 0.4, energy: 0.1 }, 'sit')], { seats: 4 }),
  item('pool', 'Backyard Pool', 'outdoor', 6500, 3, 4, 0.3, 'outdoor', '#d8d2c4', '#3fa8d8', [act('swim', 'Go for a swim', 40, { fun: 1.4, hygiene: 0.4, energy: -0.1 }, 'lie')], { seats: 4 }),
  item('fire-pit', 'Stone Fire Pit', 'outdoor', 650, 2, 2, 0.6, 'outdoor', '#7d7468', '#ff8a3c', [act('smores', 'Roast marshmallows', 35, { fun: 0.8, social: 0.5, hunger: 0.4 }, 'sit')], { seats: 4 }),
  item('hammock', 'Rope Hammock', 'outdoor', 280, 2, 1, 1.4, 'outdoor', '#7a5a3e', '#e8dcc8', [act('sway', 'Sway in the hammock', 40, { fun: 0.5, energy: 0.08 }, 'lie'), nap(0.22, 90)]),
  item('adirondack', 'Adirondack Chair', 'outdoor', 210, 1, 1, 0.95, 'outdoor', '#d8cfc0', '#8a6440', [sitDown('Sit and relax', 0.25, 0.1)]),
  item('patio-set', 'Umbrella Patio Set', 'outdoor', 780, 2, 2, 2.2, 'outdoor', '#2f3136', '#3fb8a8', [sitDown('Sit in the shade', 0.3, 0.06, 0.4)], { seats: 4 }),
  item('lounger', 'Sun Lounger', 'outdoor', 260, 1, 2, 0.5, 'outdoor', '#f2f2f0', '#3a6fa8', [act('sun', 'Sunbathe', 45, { fun: 0.5, energy: 0.1 }, 'lie')]),
  item('fountain', 'Tiered Fountain', 'outdoor', 1400, 2, 2, 1.6, 'outdoor', '#cfccc4', '#7fc4ff', [act('wish', 'Toss a coin and wish', 6, { fun: 0.5 }, 'stand', { ages: TODDLER_UP })]),
  item('bird-bath', 'Bird Bath', 'outdoor', 95, 1, 1, 0.9, 'outdoor', '#cfccc4', '#7fc4ff', [act('birds', 'Watch the birds', 20, { fun: 0.45, energy: 0.05 }, 'stand', { ages: TODDLER_UP })]),
  item('outdoor-kitchen', 'Outdoor Kitchen', 'outdoor', 1900, 2, 1, 1.0, 'outdoor', '#8a8178', '#2f3136', [act('feast', 'Cook a backyard feast', 50, { hunger: 2.8, fun: 0.5, social: 0.3 }, 'stand', { money: -0.6, guest: 'no', ages: TEEN_UP })]),
  item('veggie-patch', 'Vegetable Patch', 'outdoor', 220, 2, 2, 0.5, 'outdoor', '#5a3d27', '#5aa04a', [
    act('tend', 'Tend the vegetables', 40, { fun: 0.55 }, 'stand'),
    act('harvest', 'Pick some vegetables', 15, { hunger: 1.0, fun: 0.2 }, 'stand'),
  ]),
  item('apple-tree', 'Apple Tree', 'outdoor', 260, 1, 1, 4.5, 'outdoor', '#6b4a2f', '#4f8a3f', [act('apple', 'Pick an apple', 10, { hunger: 1.4, fun: 0.2 }, 'stand')]),
  item('spruce', 'Blue Spruce', 'outdoor', 140, 1, 1, 5.0, 'outdoor', '#5a3d27', '#3d6b5a'),
  item('birch', 'Paper Birch', 'outdoor', 150, 1, 1, 5.5, 'outdoor', '#efeae0', '#7aa84f'),
  item('hedge', 'Boxwood Hedge', 'outdoor', 55, 1, 1, 0.9, 'outdoor', '#3f6b35', '#4f8a3f'),
  item('garden-gnome', 'Garden Gnome', 'outdoor', 30, 1, 1, 0.45, 'outdoor', '#c44e3f', '#3a6fa8'),
  item('shed', 'Garden Shed', 'outdoor', 1100, 2, 2, 2.4, 'outdoor', '#8a6a48', '#3a3d42'),
  item('mailbox', 'Post Mailbox', 'outdoor', 60, 1, 1, 1.2, 'outdoor', '#2f3136', '#c44e3f'),
]
