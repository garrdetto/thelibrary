/* Chassis, weapon and armor catalog for BotWreck Arena. Frames are original designs; the local frame is forward -X,
   left +Z, up +Y. Every slot item is built facing -X from its mounting face; SLOTS rotate it onto the chassis. */

export const SLOTS = {
  front: { label: 'Front', rotY: 0 },
  back: { label: 'Back', rotY: Math.PI },
  left: { label: 'Left', rotY: Math.PI / 2 },
  right: { label: 'Right', rotY: -Math.PI / 2 },
  top: { label: 'Top', rotY: 0 },
};
export const SLOT_ORDER = ['front', 'top', 'left', 'right', 'back'];

export const CHASSIS = {
  dart: {
    name: 'Dart', blurb: 'Light and twitchy. Fast enough to pick its hits, fragile if it gets caught.',
    size: [2.9, 0.5, 1.9], mass: 120, budget: 48, hp: 220, engine: 1150, topSpeed: 12.5, turn: 1.25, wheelR: 0.38, wheelX: 1.0, wheelZ: 0.98,
    stats: { Speed: 0.95, Armor: 0.35, Payload: 0.45 },
  },
  brute: {
    name: 'Brute', blurb: 'Balanced brawler. Room for a big weapon and some plating.',
    size: [3.3, 0.6, 2.2], mass: 190, budget: 68, hp: 300, engine: 1750, topSpeed: 10, turn: 1.0, wheelR: 0.45, wheelX: 1.12, wheelZ: 1.12,
    stats: { Speed: 0.68, Armor: 0.65, Payload: 0.7 },
  },
  bastion: {
    name: 'Bastion', blurb: 'Slow armored slab. Carries everything and shrugs off rams.',
    size: [3.6, 0.75, 2.5], mass: 280, budget: 88, hp: 400, engine: 2500, topSpeed: 8, turn: 0.82, wheelR: 0.52, wheelX: 1.22, wheelZ: 1.27,
    stats: { Speed: 0.42, Armor: 1.0, Payload: 1.0 },
  },
};

/* kind: passive (armor, ram), spin (runs while spun up), fire (triggered strike).
   absorb: share of a hit on this side the part soaks before the chassis takes the rest.
   ramMul: damage multiplier this side deals when it is the face that rams. */
export const ITEMS = {
  none: { name: 'Empty', weight: 0, slots: ['front', 'back', 'left', 'right', 'top'] },
  armor: { name: 'Armor plate', kind: 'passive', weight: 14, hp: 130, absorb: 0.85, ramMul: 1.0, slots: ['front', 'back', 'left', 'right'], blurb: 'Thick steel. Soaks most of a hit on its side.' },
  spikes: { name: 'Spike ram', kind: 'passive', weight: 10, hp: 90, absorb: 0.5, ramMul: 1.8, slots: ['front', 'back', 'left', 'right'], blurb: 'Rams hit almost twice as hard on this side.' },
  wedge: { name: 'Wedge', kind: 'passive', weight: 12, hp: 100, absorb: 0.6, ramMul: 1.15, lift: true, slots: ['front', 'back'], blurb: 'Low ramp. Scoops opponents up and deflects their rams.' },
  saw: { name: 'Buzz saw', kind: 'spin', weight: 12, hp: 40, absorb: 0.4, dps: 28, wear: 5, reach: 0.95, radius: 0.85, slots: ['front', 'left', 'right'], blurb: 'Grinds while it touches. Shreds fast, but the blade chips and breaks easily.' },
  spinner: { name: 'Spinner bar', kind: 'spin', weight: 26, hp: 115, absorb: 0.5, hit: 64, spinUp: 1.8, reach: 1.1, radius: 1.05, slots: ['front'], blurb: 'Stores energy as it spins up, then dumps it in one huge hit.' },
  flipper: { name: 'Flipper', kind: 'fire', weight: 22, hp: 95, absorb: 0.55, hit: 10, cooldown: 2.4, reach: 0.9, radius: 1.0, slots: ['front'], blurb: 'Pneumatic plate. Launches whatever sits on it and can turn bots over.' },
  hammer: { name: 'Hammer', kind: 'fire', weight: 24, hp: 100, absorb: 0.4, hit: 46, cooldown: 1.15, swing: 0.28, reach: 0.9, radius: 1.0, slots: ['top'], blurb: 'Overhead slam onto whatever is in front. Big, slow hits.' },
  axe: { name: 'Axe', kind: 'fire', weight: 16, hp: 70, absorb: 0.4, hit: 28, cooldown: 0.7, swing: 0.2, reach: 0.75, radius: 0.85, slots: ['top'], blurb: 'Lighter, quicker overhead chop.' },
  dome: { name: 'Armor dome', kind: 'passive', weight: 16, hp: 150, absorb: 0.85, ramMul: 1.0, slots: ['top'], blurb: 'Protects the top from hammers and axes.' },
};

export const PAINTS = [0xff5a36, 0x39d0ff, 0xffd23b, 0x3bff8c, 0xb388ff, 0xf2f4f8, 0xff3bd0, 0x2b2f38];
export const AI_NAMES = ['Gristle', 'Sprocket', 'Iron Mule', 'Scrap Heap', 'Torque Wrench', 'Rivetgun', 'Chomp Box', 'Dentmaker', 'Bolt Thrower', 'Sheet Metal'];

export function loadoutWeight(loadout) {
  return Object.values(loadout).reduce((sum, id) => sum + (ITEMS[id]?.weight ?? 0), 0);
}

export function validLoadout(chassisId, loadout) {
  const chassis = CHASSIS[chassisId];
  if (!chassis) return false;
  for (const [slot, id] of Object.entries(loadout)) if (!ITEMS[id] || !ITEMS[id].slots.includes(slot)) return false;
  return loadoutWeight(loadout) <= chassis.budget;
}

export function emptyLoadout() {
  return { front: 'none', back: 'none', left: 'none', right: 'none', top: 'none' };
}

/* AI builds: pick a primary weapon, then fill the rest of the budget with protection in random order. */
export function randomBuild(rand = Math.random) {
  const ids = Object.keys(CHASSIS), chassisId = ids[Math.floor(rand() * ids.length)];
  const budget = CHASSIS[chassisId].budget, loadout = emptyLoadout();
  const primaries = [['front', 'saw'], ['front', 'spinner'], ['front', 'flipper'], ['top', 'hammer'], ['top', 'axe'], ['front', 'wedge'], ['front', 'spikes']];
  const [slot, item] = primaries[Math.floor(rand() * primaries.length)];
  loadout[slot] = item;
  if (slot === 'top' && rand() < 0.7) loadout.front = rand() < 0.5 ? 'wedge' : 'spikes';
  const extras = [['left', 'armor'], ['right', 'armor'], ['back', 'spikes'], ['back', 'armor'], ['left', 'saw'], ['right', 'saw'], ['top', 'dome'], ['back', 'wedge']].sort(() => rand() - 0.5);
  for (const [s, id] of extras) {
    if (loadout[s] !== 'none') continue;
    const next = { ...loadout, [s]: id };
    if (loadoutWeight(next) <= budget) Object.assign(loadout, next);
  }
  if (!validLoadout(chassisId, loadout)) return { chassisId, loadout: { ...emptyLoadout(), [slot]: item } };
  return { chassisId, loadout };
}
