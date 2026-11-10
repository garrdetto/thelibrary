export type Slot = 'rod' | 'reel' | 'line' | 'bait' | 'rifle' | 'scope' | 'call' | 'scent' | 'motor' | 'utvKit' | 'jacket' | 'vest' | 'cap' | 'pants' | 'pack'
export type ShopGroup = 'Fishing' | 'Hunting' | 'Boats & vehicles' | 'Clothing'

export interface Item {
  id: string
  name: string
  slot: Slot | 'vehicle'
  group: ShopGroup
  price: number
  blurb: string
}

export const ITEMS: Item[] = [
  { id: 'rod-medium', name: 'Medium spinning rod', slot: 'rod', group: 'Fishing', price: 0, blurb: 'A 6½ ft all-rounder.' },
  { id: 'rod-heavy', name: 'Heavy casting rod', slot: 'rod', group: 'Fishing', price: 380, blurb: '7½ ft of backbone: casts a third farther and turns big fish.' },
  { id: 'reel-spin', name: 'Spinning reel', slot: 'reel', group: 'Fishing', price: 0, blurb: 'The reel that came with the cabin.' },
  { id: 'reel-baitcast', name: 'Low-profile baitcaster', slot: 'reel', group: 'Fishing', price: 260, blurb: 'Faster retrieve: fish come in a quarter quicker.' },
  { id: 'reel-pro', name: 'Tournament reel', slot: 'reel', group: 'Fishing', price: 640, blurb: 'Silky drag smooths out surges and retrieves fastest of all.' },
  { id: 'line-mono', name: '10 lb monofilament', slot: 'line', group: 'Fishing', price: 0, blurb: 'Stretchy and forgiving.' },
  { id: 'line-braid', name: '30 lb braid', slot: 'line', group: 'Fishing', price: 180, blurb: 'Takes far more strain before it snaps.' },
  { id: 'bait-crawler', name: 'Nightcrawlers', slot: 'bait', group: 'Fishing', price: 0, blurb: 'Live bait under a float. Everything eats a worm, perch most of all; mostly smaller fish.' },
  { id: 'bait-minnow', name: 'Fathead minnows', slot: 'bait', group: 'Fishing', price: 60, blurb: 'Live bait under a float. Walleye and perch favorite; bites come sooner and you get longer to set the hook.' },
  { id: 'bait-spinner', name: 'Inline spinners', slot: 'bait', group: 'Fishing', price: 90, blurb: 'A lure: reel it back to draw strikes. Flash for smallmouth and pike, and bigger fish than live bait.' },
  { id: 'bait-bucktail', name: 'Muskie bucktails', slot: 'bait', group: 'Fishing', price: 220, blurb: 'A lure: keep it moving. Rare, sudden strikes, but the best odds of a trophy muskie or pike.' },
  { id: 'rifle-308', name: '.308 bolt rifle', slot: 'rifle', group: 'Hunting', price: 0, blurb: 'A proven deer rifle.' },
  { id: 'rifle-300', name: '.300 magnum', slot: 'rifle', group: 'Hunting', price: 900, blurb: 'Flatter and harder hitting: a larger margin on the vitals.' },
  { id: 'scope-3x9', name: '3–9× scope', slot: 'scope', group: 'Hunting', price: 0, blurb: 'Standard hunting glass.' },
  { id: 'scope-4x16', name: '4–16× scope', slot: 'scope', group: 'Hunting', price: 420, blurb: 'More magnification and a steadier picture.' },
  { id: 'call-grunt', name: 'Grunt call', slot: 'call', group: 'Hunting', price: 150, blurb: 'Press G to grunt: a nearby buck comes looking (once a minute).' },
  { id: 'scent-killer', name: 'Scent eliminator', slot: 'scent', group: 'Hunting', price: 120, blurb: 'Deer notice you a quarter less far away.' },
  { id: 'motor-150', name: '150 hp outboard', slot: 'motor', group: 'Boats & vehicles', price: 0, blurb: 'The bass boat\'s stock motor.' },
  { id: 'motor-250', name: '250 hp outboard', slot: 'motor', group: 'Boats & vehicles', price: 1400, blurb: 'Top speed and hole shot to spare.' },
  { id: 'utv-stock', name: 'Stock UTV engine', slot: 'utvKit', group: 'Boats & vehicles', price: 0, blurb: 'The UTV as it came.' },
  { id: 'utv-turbo', name: 'UTV turbo kit', slot: 'utvKit', group: 'Boats & vehicles', price: 950, blurb: 'More power and top speed on the trails.' },
  { id: 'quad', name: 'Trail quad', slot: 'vehicle', group: 'Boats & vehicles', price: 1800, blurb: 'A nimble four-wheeler, parked at the cabin once bought.' },
  { id: 'jacket-camo', name: 'Woodland camo jacket', slot: 'jacket', group: 'Clothing', price: 0, blurb: 'Breaks up your outline: deer notice you less in cover.' },
  { id: 'jacket-flannel', name: 'Red plaid flannel', slot: 'jacket', group: 'Clothing', price: 120, blurb: 'Classic northwoods wool.' },
  { id: 'jacket-canvas', name: 'Tan canvas coat', slot: 'jacket', group: 'Clothing', price: 160, blurb: 'Waxed duck canvas for wet days on the water.' },
  { id: 'vest-blaze', name: 'Blaze-orange vest', slot: 'vest', group: 'Clothing', price: 0, blurb: 'Seen by hunters, not by deer.' },
  { id: 'vest-fishing', name: 'Fishing vest', slot: 'vest', group: 'Clothing', price: 90, blurb: 'Pockets for tackle: bites come a little sooner.' },
  { id: 'vest-none', name: 'No vest', slot: 'vest', group: 'Clothing', price: 0, blurb: 'Just the jacket.' },
  { id: 'cap-blaze', name: 'Blaze cap', slot: 'cap', group: 'Clothing', price: 0, blurb: 'Blaze-orange ball cap.' },
  { id: 'cap-camo', name: 'Camo cap', slot: 'cap', group: 'Clothing', price: 40, blurb: 'Matches the jacket.' },
  { id: 'cap-bucket', name: 'Bucket hat', slot: 'cap', group: 'Clothing', price: 35, blurb: 'Keeps the sun off on the boat.' },
  { id: 'pants-camo', name: 'Camo cargo pants', slot: 'pants', group: 'Clothing', price: 0, blurb: 'Quiet and tough.' },
  { id: 'pants-jeans', name: 'Work jeans', slot: 'pants', group: 'Clothing', price: 60, blurb: 'Faded denim.' },
  { id: 'pants-waders', name: 'Chest waders', slot: 'pants', group: 'Clothing', price: 220, blurb: 'Wade half again as deep to reach better water.' },
  { id: 'pack-none', name: 'No pack', slot: 'pack', group: 'Clothing', price: 0, blurb: 'Travel light.' },
  { id: 'pack-hunting', name: 'Hunting pack', slot: 'pack', group: 'Clothing', price: 140, blurb: 'Room for a thermos and drag rope: +10% pay for deer.' },
]

export const ITEM_BY_ID: Record<string, Item> = Object.fromEntries(ITEMS.map((i) => [i.id, i]))

export type Loadout = Record<Slot, string>

export const STARTER: Loadout = {
  rod: 'rod-medium', reel: 'reel-spin', line: 'line-mono', bait: 'bait-crawler', rifle: 'rifle-308', scope: 'scope-3x9', call: '', scent: '', motor: 'motor-150', utvKit: 'utv-stock',
  jacket: 'jacket-camo', vest: 'vest-blaze', cap: 'cap-blaze', pants: 'pants-camo', pack: 'pack-none',
}

export interface TaskDef {
  id: string
  text: string
  reward: number
  goal: number
  match: (e: GameEvent) => boolean
}

export type GameEvent =
  | { type: 'fish'; species: string; trophy: boolean; boat: boolean; legendary: boolean }
  | { type: 'game'; species: string; doe: boolean; stand: boolean; trophy: boolean; legendary: boolean }

export const TASKS: TaskDef[] = [
  { id: 'walleye3', text: 'Catch 3 walleye', reward: 180, goal: 3, match: (e) => e.type === 'fish' && e.species === 'walleye' },
  { id: 'perch5', text: 'Catch 5 yellow perch', reward: 120, goal: 5, match: (e) => e.type === 'fish' && e.species === 'perch' },
  { id: 'pike2', text: 'Catch 2 northern pike', reward: 200, goal: 2, match: (e) => e.type === 'fish' && e.species === 'pike' },
  { id: 'bass2', text: 'Catch 2 smallmouth bass', reward: 200, goal: 2, match: (e) => e.type === 'fish' && e.species === 'smallmouth' },
  { id: 'muskie1', text: 'Land a muskie', reward: 450, goal: 1, match: (e) => e.type === 'fish' && e.species === 'muskie' },
  { id: 'boat3', text: 'Land 3 fish from the boat', reward: 160, goal: 3, match: (e) => e.type === 'fish' && e.boat },
  { id: 'trophyfish', text: 'Catch a trophy-class fish', reward: 400, goal: 1, match: (e) => e.type === 'fish' && e.trophy },
  { id: 'buck1', text: 'Tag a buck', reward: 350, goal: 1, match: (e) => e.type === 'game' && e.species === 'whitetail' && !e.doe },
  { id: 'standbuck', text: 'Tag a deer from a stand or blind', reward: 400, goal: 1, match: (e) => e.type === 'game' && e.species === 'whitetail' && e.stand },
  { id: 'doe1', text: 'Fill an antlerless tag', reward: 150, goal: 1, match: (e) => e.type === 'game' && e.doe },
  { id: 'bear1', text: 'Tag a black bear', reward: 600, goal: 1, match: (e) => e.type === 'game' && e.species === 'blackbear' },
  { id: 'carp5', text: 'Arrow 5 carp bowfishing at night', reward: 260, goal: 5, match: (e) => e.type === 'fish' && e.species === 'carp' },
]

export const TASK_BY_ID: Record<string, TaskDef> = Object.fromEntries(TASKS.map((t) => [t.id, t]))
export const ACTIVE_TASKS = 3
export const PLAY_PAY_PER_MINUTE = 3
export const FISH_COOLDOWN_MS = 8000
export const GAME_COOLDOWN_MS = 20000

export interface Profile {
  cash: number
  owned: string[]
  loadout: Loadout
  tasks: { id: string; progress: number }[]
  taskCursor: number
  stats: { fish: number; deer: number; bears: number; records: number; earned: number }
  lastFishAt: number
  lastGameAt: number
  /** True once the player has made their character. Everyone starts unverified, old saves included. */
  verified: boolean
}

export function defaultProfile(): Profile {
  const p: Profile = { cash: 250, owned: ITEMS.filter((i) => i.price === 0).map((i) => i.id), loadout: { ...STARTER }, tasks: [], taskCursor: 0, stats: { fish: 0, deer: 0, bears: 0, records: 0, earned: 0 }, lastFishAt: 0, lastGameAt: 0, verified: false }
  refillTasks(p)
  return p
}

export function normalizeProfile(raw: unknown): Profile {
  const base = defaultProfile()
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Partial<Profile>
  const owned = Array.isArray(r.owned) ? r.owned.filter((id): id is string => typeof id === 'string' && id in ITEM_BY_ID) : []
  for (const id of base.owned) if (!owned.includes(id)) owned.push(id)
  const loadout = { ...base.loadout }
  if (r.loadout && typeof r.loadout === 'object') {
    for (const slot of Object.keys(loadout) as Slot[]) {
      const id = (r.loadout as Record<string, unknown>)[slot]
      if (typeof id === 'string' && (id === '' || (owned.includes(id) && ITEM_BY_ID[id]?.slot === slot))) loadout[slot] = id
    }
  }
  const tasks = Array.isArray(r.tasks) ? r.tasks.filter((t) => t && typeof t.id === 'string' && t.id in TASK_BY_ID).map((t) => ({ id: t.id, progress: Math.max(0, Math.floor(Number(t.progress) || 0)) })).slice(0, ACTIVE_TASKS) : []
  const s = (r.stats ?? {}) as Partial<Profile['stats']>
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  const p: Profile = {
    cash: Math.max(0, Math.floor(num(r.cash ?? base.cash))),
    owned,
    loadout,
    tasks,
    taskCursor: Math.max(0, Math.floor(num(r.taskCursor))),
    stats: { fish: num(s.fish), deer: num(s.deer), bears: num(s.bears), records: num(s.records), earned: num(s.earned) },
    lastFishAt: num(r.lastFishAt),
    lastGameAt: num(r.lastGameAt),
    verified: r.verified === true,
  }
  refillTasks(p)
  return p
}

export function refillTasks(p: Profile): void {
  let guard = 0
  while (p.tasks.length < ACTIVE_TASKS && guard++ < 50) {
    const def = TASKS[p.taskCursor % TASKS.length]
    p.taskCursor++
    if (!p.tasks.some((t) => t.id === def.id)) p.tasks.push({ id: def.id, progress: 0 })
  }
}

const FISH_BASE: Record<string, number> = { muskie: 90, walleye: 30, pike: 40, smallmouth: 34, perch: 12, carp: 16 }

export function payoutFor(e: GameEvent, sizeShare: number, loadout: Loadout): number {
  const share = Math.max(0, Math.min(1.5, sizeShare))
  if (e.type === 'fish') {
    const base = FISH_BASE[e.species] ?? 20
    return Math.round(base * (1 + share * 1.5) * (e.trophy ? 2 : 1) * (e.legendary ? 3 : 1))
  }
  const base = e.species === 'blackbear' ? 260 : e.doe ? 60 : 180
  const pack = loadout.pack === 'pack-hunting' ? 1.1 : 1
  return Math.round(base * (e.doe ? 1 : 1 + share * 1.5) * (e.trophy ? 1.8 : 1) * (e.legendary ? 3 : 1) * pack)
}

export interface EarnResult {
  paid: number
  completed: { id: string; text: string; reward: number }[]
}

export function applyEvent(p: Profile, e: GameEvent, sizeShare: number, now: number): EarnResult {
  const cooldown = e.type === 'fish' ? FISH_COOLDOWN_MS : GAME_COOLDOWN_MS
  const last = e.type === 'fish' ? p.lastFishAt : p.lastGameAt
  if (now - last < cooldown) return { paid: 0, completed: [] }
  if (e.type === 'fish') p.lastFishAt = now
  else p.lastGameAt = now
  let paid = payoutFor(e, sizeShare, p.loadout)
  const completed: EarnResult['completed'] = []
  for (const t of [...p.tasks]) {
    const def = TASK_BY_ID[t.id]
    if (!def.match(e)) continue
    t.progress++
    if (t.progress >= def.goal) {
      paid += def.reward
      completed.push({ id: def.id, text: def.text, reward: def.reward })
      p.tasks.splice(p.tasks.indexOf(t), 1)
    }
  }
  refillTasks(p)
  if (e.type === 'fish') p.stats.fish++
  else if (e.species === 'blackbear') p.stats.bears++
  else p.stats.deer++
  if (e.legendary) p.stats.records++
  p.cash += paid
  p.stats.earned += paid
  return { paid, completed }
}

export function applyPlaytime(p: Profile, minutes: number): number {
  const paid = Math.floor(Math.max(0, Math.min(2, minutes)) * PLAY_PAY_PER_MINUTE)
  p.cash += paid
  p.stats.earned += paid
  return paid
}

export function purchase(p: Profile, itemId: string): string | null {
  const item = ITEM_BY_ID[itemId]
  if (!item) return 'That item is not in the catalog.'
  if (p.owned.includes(itemId)) return 'You already own that.'
  if (p.cash < item.price) return `You need $${(item.price - p.cash).toLocaleString()} more.`
  p.cash -= item.price
  p.owned.push(itemId)
  if (item.slot !== 'vehicle') p.loadout[item.slot] = itemId
  return null
}

export function equip(p: Profile, slot: Slot, itemId: string): string | null {
  if (itemId === '' && (slot === 'call' || slot === 'scent')) {
    p.loadout[slot] = ''
    return null
  }
  const item = ITEM_BY_ID[itemId]
  if (!item || item.slot !== slot) return 'That does not go there.'
  if (!p.owned.includes(itemId)) return 'Buy it first.'
  p.loadout[slot] = itemId
  return null
}

export interface GearEffects {
  castRange: number
  reelSpeed: number
  surge: number
  lineStrength: number
  biteRate: number
  baitBias: Record<string, number>
  bait: BaitStyle
  vitalScale: number
  scopeZoom: number
  scopeSteady: number
  detection: number
  wadeDepth: number
  boatPower: number
  utvPower: number
  call: boolean
}

const BAIT_BIAS: Record<string, Record<string, number>> = {
  'bait-crawler': { perch: 1.6, smallmouth: 1.1, walleye: 1.0, pike: 0.7, muskie: 0.4 },
  'bait-minnow': { walleye: 1.9, perch: 1.4, pike: 1.0, smallmouth: 1.0, muskie: 0.6 },
  'bait-spinner': { smallmouth: 2.0, pike: 1.7, walleye: 0.8, perch: 0.6, muskie: 1.0 },
  'bait-bucktail': { muskie: 4.0, pike: 2.0, smallmouth: 0.6, walleye: 0.4, perch: 0.15 },
}

/**
 * How each bait fishes. Live bait sits under a float: leave it still, wait out the nibbles and
 * set the hook when the float goes under. Lures only draw strikes while they are being reeled
 * back, and the strike gives a short window to set the hook.
 */
export interface BaitStyle {
  kind: 'live' | 'lure'
  /** Scales how long a fish mouths live bait before it takes the float under. */
  nibbleScale: number
  /** Seconds to set the hook once the fish has it. */
  hookWindow: number
  /** How quickly fish find it: live bait while it sits still, a lure while it moves. */
  rate: number
  /** Multiplier on the 2% trophy-fish odds (record odds are never changed). */
  trophyOdds: number
  hint: string
}

export const BAIT_STYLE: Record<string, BaitStyle> = {
  'bait-crawler': { kind: 'live', nibbleScale: 1.35, hookWindow: 1.7, rate: 1, trophyOdds: 0.75, hint: 'Nightcrawler under a float: let it sit, wait out the nibbles, set the hook when the float goes under. Reeling it moves the worm away.' },
  'bait-minnow': { kind: 'live', nibbleScale: 0.7, hookWindow: 2.2, rate: 1.25, trophyOdds: 1, hint: 'Minnow under a float: bites come sooner and the fish runs with it, so you get longer to set the hook.' },
  'bait-spinner': { kind: 'lure', nibbleScale: 0, hookWindow: 1.0, rate: 1.4, trophyOdds: 1.25, hint: 'Spinner: hold R or left-click to work it back in. Fish only hit it while it is moving. Click the instant it strikes.' },
  'bait-bucktail': { kind: 'lure', nibbleScale: 0, hookWindow: 0.8, rate: 0.8, trophyOdds: 1.75, hint: 'Bucktail: keep it moving with R or left-click. Strikes are rarer, sudden and short, but the fish run big.' },
}

export function gearEffects(l: Loadout): GearEffects {
  return {
    castRange: l.rod === 'rod-heavy' ? 1.33 : 1,
    reelSpeed: l.reel === 'reel-pro' ? 1.45 : l.reel === 'reel-baitcast' ? 1.25 : 1,
    surge: l.reel === 'reel-pro' ? 0.6 : 1,
    lineStrength: l.line === 'line-braid' ? 1.8 : 1,
    biteRate: (BAIT_STYLE[l.bait] ?? BAIT_STYLE['bait-crawler']).rate * (l.vest === 'vest-fishing' ? 1.1 : 1),
    baitBias: BAIT_BIAS[l.bait] ?? BAIT_BIAS['bait-crawler'],
    bait: BAIT_STYLE[l.bait] ?? BAIT_STYLE['bait-crawler'],
    vitalScale: l.rifle === 'rifle-300' ? 1.25 : 1,
    scopeZoom: l.scope === 'scope-4x16' ? 1.7 : 1,
    scopeSteady: l.scope === 'scope-4x16' ? 0.7 : 1,
    detection: (l.scent === 'scent-killer' ? 0.75 : 1) * (l.jacket === 'jacket-camo' ? 0.85 : 1),
    wadeDepth: l.pants === 'pants-waders' ? 1.6 : 1.05,
    boatPower: l.motor === 'motor-250' ? 1.3 : 1,
    utvPower: l.utvKit === 'utv-turbo' ? 1.3 : 1,
    call: l.call === 'call-grunt',
  }
}

export type LookSlot = 'jacket' | 'vest' | 'cap' | 'pants' | 'pack'
export type Look = Record<LookSlot, string>

/**
 * What the character creator offers. Only looks: gear that changes how the hunt goes (the camo
 * jacket's cover aside, which everyone starts with), like waders or the fishing vest, stays in the
 * catalog. Whatever is picked is given free and worn.
 */
export const CHARACTER_CHOICES: Record<LookSlot, string[]> = {
  jacket: ['jacket-camo', 'jacket-flannel', 'jacket-canvas'],
  vest: ['vest-blaze', 'vest-none'],
  cap: ['cap-blaze', 'cap-camo', 'cap-bucket'],
  pants: ['pants-camo', 'pants-jeans'],
  pack: ['pack-none'],
}

export const LOOK_SLOTS: LookSlot[] = ['jacket', 'vest', 'cap', 'pants', 'pack']

export function lookOf(p: Profile): Look {
  return { jacket: p.loadout.jacket, vest: p.loadout.vest, cap: p.loadout.cap, pants: p.loadout.pants, pack: p.loadout.pack }
}

/** Makes the character: checks every pick, gives and wears it, and marks the profile verified. */
export function createCharacter(p: Profile, look: Look): string | null {
  for (const slot of LOOK_SLOTS) if (!CHARACTER_CHOICES[slot].includes(look[slot])) return 'That outfit is not offered when making a character.'
  for (const slot of LOOK_SLOTS) {
    const id = look[slot]
    if (!p.owned.includes(id)) p.owned.push(id)
    p.loadout[slot] = id
  }
  p.verified = true
  return null
}
