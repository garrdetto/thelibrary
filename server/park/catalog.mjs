export const FLAT_RIDES = {
  carousel: { name: 'Carousel', category: 'gentle', size: [3, 3], cost: 1800, upkeep: 40, capacity: 16, rideTime: 22, loadTime: 8, price: 1, stats: { e: 1.62, i: 0.74, n: 0.55 }, height: 9, description: 'Painted horses circle under a striped canopy.' },
  teacups: { name: 'Spinning Cups', category: 'gentle', size: [3, 3], cost: 2200, upkeep: 45, capacity: 18, rideTime: 24, loadTime: 8, price: 1.2, stats: { e: 1.94, i: 1.35, n: 2.6 }, height: 5, description: 'Cups spin on a turntable. Dizzying in the best way.' },
  ferris: { name: 'Big Wheel', category: 'gentle', size: [4, 2], cost: 3000, upkeep: 55, capacity: 16, rideTime: 40, loadTime: 12, price: 1.2, stats: { e: 2.15, i: 0.62, n: 0.42 }, height: 17, description: 'Slow rotation and the best view of your park.' },
  swings: { name: 'Chair Swing', category: 'gentle', size: [3, 3], cost: 2600, upkeep: 50, capacity: 16, rideTime: 26, loadTime: 8, price: 1.3, stats: { e: 2.42, i: 2.04, n: 1.62 }, height: 11, description: 'Chairs fly outward as the crown spins faster.' },
  bumper: { name: 'Bumper Cars', category: 'gentle', size: [4, 4], cost: 3200, upkeep: 60, capacity: 12, rideTime: 32, loadTime: 10, price: 1.4, stats: { e: 2.66, i: 1.82, n: 0.51 }, height: 6, description: 'Electric cars, sparks overhead and plenty of bumping.' },
  ship: { name: 'Swinging Ship', category: 'thrill', size: [5, 3], cost: 3600, upkeep: 70, capacity: 20, rideTime: 30, loadTime: 10, price: 1.6, stats: { e: 3.24, i: 3.84, n: 3.42 }, height: 14, description: 'A galleon that swings higher with every pass.' },
  dropTower: { name: 'Drop Tower', category: 'thrill', size: [3, 3], cost: 6500, upkeep: 110, capacity: 12, rideTime: 26, loadTime: 10, price: 2.2, stats: { e: 4.38, i: 6.42, n: 3.05 }, height: 38, description: 'A slow climb and a sudden plunge.' },
  topSpin: { name: 'Twister Arm', category: 'thrill', size: [4, 3], cost: 5200, upkeep: 95, capacity: 16, rideTime: 30, loadTime: 10, price: 2, stats: { e: 4.05, i: 6.1, n: 5.7 }, height: 14, description: 'A gondola flips end over end between two arms.' },
  karts: { name: 'Go-Karts', category: 'thrill', size: [6, 4], cost: 4200, upkeep: 80, capacity: 8, rideTime: 45, loadTime: 10, price: 2, stats: { e: 3.4, i: 2.9, n: 0.9 }, height: 3, description: 'A twisting kart circuit. Guests race each other for bragging rights.' },
  pool: { name: 'Swimming Pool', category: 'water', size: [5, 4], cost: 3400, upkeep: 60, capacity: 24, rideTime: 70, loadTime: 10, price: 1.5, stats: { e: 2.3, i: 0.6, n: 0.2 }, height: 2, description: 'A sparkling pool with loungers. Very popular on hot days.' },
  waterslide: { name: 'Waterslide', category: 'water', size: [4, 4], cost: 5600, upkeep: 90, capacity: 10, rideTime: 30, loadTime: 8, price: 2.2, stats: { e: 3.9, i: 3.3, n: 1.8 }, height: 14, description: 'Spiral tubes from a tall tower splash down into a plunge pool.' },
}

export const COASTER_STYLES = {
  steel: { name: 'Steel Looper', cost: 2200, pieceCost: 90, upkeep: 150, maxHeight: 84, loops: true, steep: true, seats: 4, excitementBonus: 0, intensityBonus: 0, track: '#d6332f', support: '#e8e4da', train: '#2a5bd7', description: 'Smooth tubular steel track with vertical loops.' },
  wooden: { name: 'Wooden Coaster', cost: 2000, pieceCost: 75, upkeep: 140, maxHeight: 64, loops: false, steep: true, seats: 4, excitementBonus: 0.45, intensityBonus: 0.5, track: '#8a6a4a', support: '#b48a5e', train: '#c83c2e', description: 'Classic lattice structure with a rattling ride.' },
  junior: { name: 'Junior Coaster', cost: 1200, pieceCost: 45, upkeep: 70, maxHeight: 28, loops: false, steep: false, seats: 2, excitementBonus: 0.2, intensityBonus: -0.6, track: '#f2b632', support: '#3c78c8', train: '#3fb06b', description: 'Low and gentle. Families love it.' },
  inverted: { name: 'Suspended Looper', cost: 2800, pieceCost: 110, upkeep: 180, maxHeight: 84, loops: true, steep: true, seats: 4, excitementBonus: 0.35, intensityBonus: 0.45, track: '#2e2e36', support: '#3a8f87', train: '#f2c94c', description: 'Riders hang beneath the rail, feet dangling.' },
}

export const COASTER_PRESETS = {
  zephyr: { name: 'Little Zephyr', style: 'junior', station: 3, description: 'A gentle family coaster with two small hills.', pieces: [{ c: 0, s: 0 }, { c: 0, s: 1, sp: 'chain' }, { c: 0, s: 1, sp: 'chain' }, { c: 0, s: 0, sp: 'chain' }, { c: 1, s: 0 }, { c: 0, s: -1 }, { c: 0, s: -1 }, { c: 0, s: 0 }, { c: 1, s: 0 }, { c: 0, s: 0 }, { c: 0, s: 1 }, { c: 0, s: 0 }, { c: 0, s: -1 }, { c: 0, s: 0 }] },
  ridge: { name: 'Thunder Ridge', style: 'steel', station: 3, description: 'One huge chain hill, a screaming drop and a floating camelback.', pieces: [{ c: 0, s: 0 }, { c: 0, s: 1, sp: 'chain' }, { c: 0, s: 2, sp: 'chain' }, { c: 0, s: 2, sp: 'chain' }, { c: 0, s: 2, sp: 'chain' }, { c: 0, s: 1, sp: 'chain' }, { c: 0, s: 0, sp: 'chain' }, { c: 2, s: 0 }, { c: 0, s: -1 }, { c: 0, s: -2 }, { c: 0, s: -2 }, { c: 0, s: -2 }, { c: 0, s: -1 }, { c: 0, s: 0 }, { c: 0, s: 0 }, { c: 0, s: 1 }, { c: 0, s: 1 }, { c: 0, s: 0 }, { c: 0, s: -1 }, { c: 0, s: -1 }, { c: 0, s: 0 }, { c: 0, s: 0, sp: 'brakes' }, { c: 2, s: 0 }] },
  comet: { name: 'Loop Comet', style: 'steel', station: 3, description: 'A tall drop feeds a full vertical loop.', pieces: [{ c: 0, s: 0 }, { c: 0, s: 1, sp: 'chain' }, { c: 0, s: 2, sp: 'chain' }, { c: 0, s: 2, sp: 'chain' }, { c: 0, s: 2, sp: 'chain' }, { c: 0, s: 1, sp: 'chain' }, { c: 0, s: 0, sp: 'chain' }, { c: 2, s: 0 }, { c: 0, s: -1 }, { c: 0, s: -2 }, { c: 0, s: -2 }, { c: 0, s: -2 }, { c: 0, s: -1 }, { c: 0, s: 0 }, { c: 0, s: 0, sp: 'loop' }, { c: 0, s: 0 }, { c: 0, s: 1 }, { c: 0, s: 1 }, { c: 0, s: 0 }, { c: 0, s: 0, sp: 'brakes' }, { c: 2, s: 0 }] },
  rattler: { name: 'Timber Rattler', style: 'wooden', station: 3, description: 'A wooden out-and-back with bouncy camelback hills.', pieces: [{ c: 0, s: 0 }, { c: 0, s: 1, sp: 'chain' }, { c: 0, s: 2, sp: 'chain' }, { c: 0, s: 2, sp: 'chain' }, { c: 0, s: 1, sp: 'chain' }, { c: 0, s: 0, sp: 'chain' }, { c: 0, s: -1 }, { c: 0, s: -2 }, { c: 0, s: -2 }, { c: 0, s: -1 }, { c: 0, s: 0 }, { c: 0, s: 1 }, { c: 0, s: 0 }, { c: 0, s: -1 }, { c: 0, s: 0 }, { c: 2, s: 0 }, { c: 0, s: 0 }, { c: 2, s: 0 }] },
}

export const STALLS = {
  burger: { name: 'Burger Grill', cost: 520, upkeep: 25, price: 3, item: 'burger', kind: 'food', hunger: -150, thirst: 25, color: '#d9572b', sign: 'BURGERS' },
  pizza: { name: 'Pizza Slice', cost: 560, upkeep: 25, price: 2.8, item: 'pizza', kind: 'food', hunger: -140, thirst: 20, color: '#e0a72e', sign: 'PIZZA' },
  fries: { name: 'Fry Shack', cost: 420, upkeep: 20, price: 2, item: 'fries', kind: 'food', hunger: -100, thirst: 40, color: '#e6c33b', sign: 'FRIES' },
  drinks: { name: 'Soda Stand', cost: 420, upkeep: 20, price: 1.5, item: 'drink', kind: 'drink', hunger: 0, thirst: -160, color: '#3a8ed6', sign: 'DRINKS' },
  coffee: { name: 'Coffee Cart', cost: 460, upkeep: 20, price: 1.6, item: 'coffee', kind: 'drink', hunger: -10, thirst: -120, energy: 50, color: '#7b5236', sign: 'COFFEE' },
  icecream: { name: 'Ice Cream', cost: 480, upkeep: 20, price: 1.8, item: 'icecream', kind: 'food', hunger: -60, thirst: -50, color: '#f08fb3', sign: 'ICE CREAM' },
  balloon: { name: 'Balloon Cart', cost: 380, upkeep: 15, price: 1.5, item: 'balloon', kind: 'gift', happiness: 25, color: '#b04cd6', sign: 'BALLOONS' },
  umbrella: { name: 'Umbrella Stand', cost: 400, upkeep: 15, price: 2, item: 'umbrella', kind: 'gift', happiness: 10, color: '#2e9f8f', sign: 'UMBRELLAS' },
  toilet: { name: 'Restrooms', cost: 650, upkeep: 30, price: 0, item: 'toilet', kind: 'service', color: '#6f7d8c', sign: 'RESTROOMS' },
  info: { name: 'Info Kiosk', cost: 500, upkeep: 20, price: 0.8, item: 'map', kind: 'gift', happiness: 5, color: '#4a6fd1', sign: 'INFO' },
}

export const SCENERY = {
  oak: { name: 'Oak Tree', cost: 25, height: 9 },
  pine: { name: 'Pine Tree', cost: 25, height: 11 },
  birch: { name: 'Birch Tree', cost: 25, height: 10 },
  palm: { name: 'Palm Tree', cost: 35, height: 9 },
  bush: { name: 'Shrub', cost: 12, height: 2 },
  flowers: { name: 'Flower Bed', cost: 18, height: 1 },
  hedge: { name: 'Hedge', cost: 15, height: 2 },
  rock: { name: 'Boulder', cost: 20, height: 3 },
  fountain: { name: 'Fountain', cost: 220, height: 4 },
  statue: { name: 'Statue', cost: 160, height: 6 },
  topiary: { name: 'Topiary', cost: 60, height: 4 },
}

export const PATH_ADDITIONS = {
  1: { id: 'bench', name: 'Bench', cost: 40 },
  2: { id: 'bin', name: 'Litter Bin', cost: 30 },
  3: { id: 'lamp', name: 'Lamp Post', cost: 25 },
}

export const STAFF = {
  handyman: { name: 'Handyman', wage: 50, color: '#3e9b4f' },
  mechanic: { name: 'Mechanic', wage: 80, color: '#2f6fc0' },
  entertainer: { name: 'Entertainer', wage: 55, color: '#e85d9b' },
}

export const SURFACES = ['grass', 'sand', 'dirt', 'rock', 'snow']

export const COSTS = { path: 12, queue: 14, terrain: 6, water: 12, paint: 1, demolishRefund: 0.5 }

export const SCENARIOS = {
  meadowbrook: { name: 'Meadowbrook Fields', difficulty: 'Beginner', size: 64, seed: 1101, terrain: 'meadow', cash: 15000, loan: 10000, maxLoan: 30000, objective: { type: 'guests', guests: 250, rating: 600, year: 1 }, description: 'Rolling meadows with a lazy stream. A gentle place to open your first park.' },
  pineRidge: { name: 'Pine Ridge Hollow', difficulty: 'Intermediate', size: 64, seed: 2207, terrain: 'forest', cash: 12000, loan: 10000, maxLoan: 25000, objective: { type: 'guests', guests: 450, rating: 650, year: 2 }, description: 'A wooded valley between steep ridges. Clear space wisely; guests love the trees.' },
  harbor: { name: 'Harbor Point', difficulty: 'Intermediate', size: 64, seed: 3319, terrain: 'coast', cash: 14000, loan: 12000, maxLoan: 30000, objective: { type: 'value', value: 60000, year: 2 }, description: 'A sandy headland surrounded by sea. Build a seaside pier park worth showing off.' },
  redMesa: { name: 'Red Mesa Canyon', difficulty: 'Advanced', size: 64, seed: 4423, terrain: 'canyon', cash: 20000, loan: 15000, maxLoan: 40000, objective: { type: 'coasters', count: 4, excitement: 6, year: 2 }, description: 'Dramatic mesas and dry gulches. Use the drops to build four exciting coasters.' },
  frostpeak: { name: 'Frostpeak Lodge', difficulty: 'Advanced', size: 64, seed: 5531, terrain: 'alpine', cash: 10000, loan: 10000, maxLoan: 20000, objective: { type: 'guests', guests: 700, rating: 700, year: 3 }, description: 'A snowy alpine plateau with a frozen lake. Short on cash, long on scenery.' },
  sandbox: { name: 'Open Sandbox', difficulty: 'Sandbox', size: 64, seed: 9001, terrain: 'flat', cash: 500000, loan: 0, maxLoan: 0, objective: { type: 'none' }, description: 'Flat land and deep pockets. Build anything you like.' },
  twinValleys: { name: 'Twin Valleys', difficulty: 'Versus', size: 96, seed: 7717, terrain: 'versus', cash: 15000, loan: 8000, maxLoan: 25000, objective: { type: 'versus' }, description: 'Each tycoon gets an identical valley. The highest company value when time runs out wins.', versus: true },
}

export const PARK_COLORS = ['#e2513d', '#3d7fe2', '#3db86b', '#e2b23d']
