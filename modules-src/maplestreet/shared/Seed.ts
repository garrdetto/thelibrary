/**
 * Starter houses for the simulated neighbors, so the neighborhood already has
 * furnished homes, yards and roofs in a mix of styles. Every house is produced
 * as ordinary BuildOps (shared/HousePlans.ts) and run through validateOp,
 * exactly like a player's.
 *
 * SEED_VERSION marks which roster a saved world was seeded with. Loading an
 * older world rebuilds the houses the simulated neighbors already own and
 * moves new neighbors onto lots that are still unowned and empty; lots that
 * players own are never touched.
 */
import { applyOp, emptyBuild, LotBuild, validateOp, WorldState } from './BuildRules';
import { HouseLook, PlanId, planOps, pickWall } from './HousePlans';

export const SEED_VERSION = 2;

interface HouseSpec { lotId: string; owner: string; name: string; plan: PlanId; look?: Partial<HouseLook> }

const H = (lotId: string, surname: string, plan: PlanId, look?: Partial<HouseLook>): HouseSpec =>
  ({ lotId, owner: `npc-${surname.toLowerCase().replace(/[^a-z]/g, '')}`, name: surname, plan, look });

export const NEIGHBOR_HOUSES: HouseSpec[] = [
  H('N2', 'Hendricks', 'classic', { wall: 'siding_white', extras: ['hoop', 'pool'] }),
  H('N4', 'Alvarez', 'colonial', { wall: 'brick_red', extras: ['court'] }),
  H('S2', 'Okafor', 'craftsman', { wall: 'siding_sage', extras: ['swings', 'hoop'] }),
  H('S5', 'Lindqvist', 'modern', { wall: 'stucco_sand', extras: ['pool'] }),
  H('N8', 'Brennan', 'classic', { wall: 'stone', stories: 2 }),
  H('S7', 'Nakamura', 'cape', { wall: 'board_batten', extras: ['hoop', 'garden'] }),
  H('N6', 'Patel', 'ranch', { extras: ['trampoline'] }),
  H('N9', 'Kowalski', 'craftsman', { extras: ['doghouse'] }),
  H('S6', 'Moreau', 'modern', { extras: ['hotTub'] }),
  H('S9', 'Schultz', 'colonial', { extras: ['garden'] }),
  H('S10', 'Ramirez', 'ranch', { extras: ['pool', 'hoop'] }),
  H('N11', 'Whitfield', 'cape'),
  H('N13', 'Takahashi', 'modern', { extras: ['garden'] }),
  H('N15', "O'Neill", 'duplex'),
  H('S11', 'Haugen', 'ranch', { extras: ['swings'] }),
  H('S13', 'Delgado', 'craftsman', { extras: ['hoop'] }),
  H('S15', 'Fischer', 'classic', { stories: 2, extras: ['trampoline'] }),
  H('N16', 'Novak', 'colonial', { extras: ['pool'] }),
  H('N18', 'Castillo', 'ranch', { extras: ['doghouse', 'hoop'] }),
  H('S17', 'Bergstrom', 'cape', { extras: ['swings'] }),
  H('S19', 'Adeyemi', 'duplex', { extras: ['garden'] }),
  H('N21', 'Larsen', 'craftsman', { extras: ['hotTub'] }),
  H('N23', 'Romano', 'classic', { extras: ['pool'] }),
  H('S22', 'Sullivan', 'colonial', { extras: ['hoop'] }),
  H('S24', 'Chen', 'modern'),
  H('N26', 'Weber', 'ranch', { extras: ['garden'] }),
  H('N28', 'Dubois', 'cape', { extras: ['doghouse'] }),
  H('S27', 'Kaminski', 'craftsman', { extras: ['trampoline'] }),
];

function rng(text: string) {
  let seed = 7;
  for (let i = 0; i < text.length; i++) seed = (seed * 31 + text.charCodeAt(i)) % 2147483647;
  seed = seed || 1;
  return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
}

const FLOORS = ['oak', 'walnut', 'herringbone', 'oak'] as const;
const FENCES = ['picket', 'privacy', 'none', 'picket'] as const;

function lookFor(spec: HouseSpec, r: () => number): HouseLook {
  return {
    wall: spec.look?.wall ?? pickWall(spec.plan, r),
    floor: spec.look?.floor ?? FLOORS[Math.floor(r() * FLOORS.length) % FLOORS.length],
    fence: spec.look?.fence ?? FENCES[Math.floor(r() * FENCES.length) % FENCES.length],
    roof: spec.look?.roof,
    stories: spec.look?.stories,
    extras: spec.look?.extras,
  };
}

const isEmpty = (b: LotBuild | undefined) => !b || (!Object.keys(b.walls).length && !Object.keys(b.floors).length && !Object.keys(b.objects).length && !Object.keys(b.roofs).length && !Object.keys(b.pools).length);

/** Builds one simulated neighbor's house on an empty lot they now own. Returns the ops that failed validation. */
export function buildHouse(world: WorldState, spec: HouseSpec): string[] {
  const lot = world.lots[spec.lotId];
  const r = rng(spec.lotId);
  const failed: string[] = [];
  for (const op of planOps(lot, spec.owner, spec.plan, lookFor(spec, r), r)) {
    const reason = validateOp(world, op, spec.owner);
    if (reason) { failed.push(`${op.op}: ${reason}`); continue; }
    applyOp(world, op, spec.owner, spec.name);
  }
  return failed;
}

function settle(world: WorldState, spec: HouseSpec) {
  const lot = world.lots[spec.lotId];
  lot.owner = spec.owner; lot.ownerName = spec.name;
  world.builds[spec.lotId] = emptyBuild();
  for (const f of buildHouse(world, spec)) console.warn(`[seed] ${spec.lotId} ${f}`);
}

export function seedNeighborhood(world: WorldState) {
  for (const spec of NEIGHBOR_HOUSES) {
    const lot = world.lots[spec.lotId];
    if (!lot || lot.owner) continue;
    settle(world, spec);
  }
  world.seedVersion = SEED_VERSION;
}

/**
 * Brings a world saved with an older roster up to date. Returns the lots it
 * changed so the caller can save them.
 */
export function upgradeSeed(world: WorldState): string[] {
  if ((world.seedVersion ?? 1) >= SEED_VERSION) return [];
  const changed: string[] = [];
  for (const spec of NEIGHBOR_HOUSES) {
    const lot = world.lots[spec.lotId];
    if (!lot) continue;
    const ours = lot.owner === spec.owner;
    if (!ours && (lot.owner || !isEmpty(world.builds[spec.lotId]))) continue;
    settle(world, spec);
    changed.push(spec.lotId);
  }
  world.seedVersion = SEED_VERSION;
  return changed;
}
