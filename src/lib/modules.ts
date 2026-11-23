export const embeddedModules = [
  { id: 'sandlot3d', title: 'Sandlot Sluggers 3D', src: '/modules/sandlot3d.html' },
  { id: 'maplestreet', title: 'Fox Plains', src: '/modules/maplestreet.html' },
  { id: 'foxlake', title: 'Life Sim', src: '/modules/foxlake.html' },
  { id: 'sandlot', title: 'Sandlot Sluggers', src: '/modules/sandlot.html' },
  { id: 'botwreck', title: 'BotWreck 3D', src: '/modules/botwreck.html' },
  { id: 'chess', title: 'Chess', src: '/modules/chess.html' },
  { id: 'checkers', title: 'Checkers', src: '/modules/checkers.html' },
  { id: '2048', title: '2048', src: '/modules/2048.html' },
  { id: 'helicopter', title: 'Chopper Cave', src: '/modules/helicopter.html' },
  { id: 'shorttrack', title: 'Short Track Showdown', src: '/modules/shorttrack.html' },
  { id: 'fairway', title: 'Fairway Nine', src: '/modules/fairway.html' },
  { id: 'darts', title: 'Darts', src: '/modules/darts.html' },
  { id: 'demoderby', title: 'Demo Derby', src: '/modules/demoderby.html' },
  { id: 'bushleague', title: 'Bush League Baseball', src: '/modules/bushleague.html' },
  { id: 'angler', title: 'Northwoods Angler', src: '/modules/angler.html' },
  { id: 'rackreel', title: 'Rack & Reel', src: '/modules/rackreel.html' },
  { id: 'proskater', title: 'Pro Skater AI', src: '/modules/proskater.html' },
  { id: 'county', title: 'Kestrel County', src: '/modules/county.html' },
  { id: 'trucksim', title: 'Truck Simulator', src: '/modules/trucksim.html' },
  { id: 'hood', title: 'The Hood', src: '/modules/hood.html' },
  { id: 'alphabet', title: 'Alphabet Sprint', src: '/modules/alphabet.html' },
  { id: 'tetradrop', title: 'Tetra Drop', src: '/modules/tetradrop.html' },
  { id: 'bubbles', title: 'Bubble Shooter', src: '/modules/bubbles.html' },
  { id: 'sudoku', title: 'Sudoku', src: '/modules/sudoku.html' },
  { id: 'minesweeper', title: 'Minesweeper', src: '/modules/minesweeper.html' },
  { id: 'recall', title: 'Hero Recall', src: '/modules/recall.html' },
  { id: 'greible', title: 'Greible', src: '/modules/greible.html' },
  { id: 'blockhead', title: 'Blockhead Siege', src: '/modules/blockhead.html' },
  { id: 'foodchain', title: 'Food Chain', src: '/modules/foodchain.html' },
  { id: 'keep', title: 'Hold the Keep', src: '/modules/keep.html' },
  { id: 'giant', title: "Giant's Hand", src: '/modules/giant.html' },
  { id: 'gonefishing', title: 'Polar Swat', src: '/modules/gonefishing.html' },
  { id: 'cookies', title: 'Cookie Factory', src: '/modules/cookies.html' },
  { id: 'hotdog', title: 'Corner Cart', src: '/modules/hotdog.html' },
  { id: 'pingpong', title: 'Spin Rally', src: '/modules/pingpong.html' },
  { id: 'arena', title: 'Vector Arena', src: '/modules/arena.html' },
  { id: 'songmaker', title: 'Song Maker', src: '/modules/songmaker.html' },
  { id: 'party', title: 'Skill Party', src: '/modules/party.html' },
  { id: 'sunvault', title: 'Sun Vault', src: '/modules/sunvault.html' },
  { id: 'beanstalk', title: 'Beanstalk Bounty', src: '/modules/beanstalk.html' },
  { id: 'modollaz', title: "Mo' Dollaz", src: '/modules/modollaz.html' },
  { id: 'bridge', title: 'Bridge Builder', src: '/modules/bridge.html' },
] as const

export type EmbeddedModuleId = typeof embeddedModules[number]['id']
export type ModuleId = EmbeddedModuleId | 'pool' | 'racing' | 'oval' | 'park' | 'park2' | 'lens'

export const withdrawnModuleIds: ReadonlySet<ModuleId> = new Set<ModuleId>()

export function isModuleAvailable(id: string): boolean {
  return !withdrawnModuleIds.has(id as ModuleId)
}

export function isEmbeddedModuleId(value: string): value is EmbeddedModuleId {
  return isModuleAvailable(value) && embeddedModules.some(item => item.id === value)
}

export type ModuleSubject = 'Strategy' | 'Physics' | 'Math' | 'Precision' | 'Logic' | 'Creative'

export type LearningModule = {
  id: ModuleId
  title: string
  subject: string
  group: ModuleSubject
  summary: string
  modes: string[]
  image: string
  accent: string
  mobile?: true
}

export const moduleGroups: ModuleSubject[] = ['Strategy', 'Physics', 'Math', 'Precision', 'Logic', 'Creative']

export const learningModules: LearningModule[] = [
  { id: 'sandlot3d', title: 'Sandlot Sluggers 3D', subject: 'Sports science', group: 'Physics', summary: 'Hit, pitch, field and run the bases in full 3D across four ballparks.', modes: ['Solo', '3D'], image: '/images/modules/sandlot3d.webp?v=2', accent: '#f4bf3a', mobile: true },
  { id: 'maplestreet', title: 'Fox Plains', subject: 'Economics & engineering', group: 'Strategy', summary: 'Build a house, drive, mow lawns and shop in a shared, always-open town.', modes: ['Shared world', 'Solo', 'Online room', '3D'], image: '/images/modules/maplestreet.webp?v=2', accent: '#7cc46a' },
  { id: 'foxlake', title: 'Life Sim', subject: 'Economics, engineering & wildlife biology', group: 'Strategy', summary: 'Live in Montello, Wisconsin: shared lots and neighbors, gas stations, a grocery, bars and a dealership, and Lake Montello for fishing, hunting and bowfishing with Wisco Wild Man. One wallet for the town and the lake.', modes: ['Shared world', 'Solo', '3D', 'Fishing & hunting'], image: '/images/modules/foxlake.webp?v=1', accent: '#7fae5a' },
  { id: 'sandlot', title: 'Sandlot Sluggers', subject: 'Sports science', group: 'Physics', summary: 'Draft a roster and play a full season on a neighborhood diamond.', modes: ['Solo', '2 on 1 screen', 'Online room'], image: '/images/modules/sandlot.webp', accent: '#ffb547' },
  { id: 'shorttrack', title: 'Short Track Showdown', subject: 'Friction & banking', group: 'Physics', summary: 'Paint your ride and race AI or friends on five short ovals, asphalt or dirt.', modes: ['Solo', 'Online room'], image: '/images/modules/shorttrack.webp?v=4', accent: '#ff7a1a', mobile: true },
  { id: 'fairway', title: 'Fairway Nine', subject: 'Projectile motion', group: 'Physics', summary: 'Nine original holes where launch, spin, drag and wind shape every shot.', modes: ['Solo', 'Closest to the pin', 'Online room', '3D'], image: '/images/modules/fairway.webp', accent: '#4fd27a', mobile: true },
  { id: 'darts', title: 'Darts', subject: 'Projectile motion & probability', group: 'Precision', summary: 'Aim, time the power meter and throw: 501, 301, Cricket or Count Up.', modes: ['Solo', 'Computer', '2–4 on 1 screen', 'Teams', 'Tournament', 'Online room', '3D'], image: '/images/modules/darts.webp', accent: '#ff4d5e', mobile: true },
  { id: 'angler', title: 'Northwoods Angler', subject: 'Probability & freshwater ecology', group: 'Math', summary: 'Anchor on five Wisconsin-style lakes and chase record fish of sixteen species.', modes: ['Shared lake', 'Solo', 'Idle', '3D'], image: '/images/modules/angler.webp', accent: '#3fb8a8', mobile: true },
  { id: 'county', title: 'Kestrel County', subject: 'Flight & vehicle dynamics', group: 'Physics', summary: 'Drive a 4 km county, then fly a helicopter or trainer plane from its airport.', modes: ['Solo', 'Helicopter', 'Plane', '3D'], image: '/images/modules/county.webp', accent: '#4fb3ff' },
  { id: 'trucksim', title: 'Truck Simulator', subject: 'Logistics, physics & economics', group: 'Strategy', summary: 'Haul real loads across an open county, grow a fleet and build your own truck lot.', modes: ['Open world', 'Shared lots', 'Solo', '3D'], image: '/images/modules/trucksim.webp', accent: '#f2a33a' },
  { id: 'rackreel', title: 'Rack & Reel', subject: 'Wildlife biology & probability', group: 'Precision', summary: 'Fish, drive the trails and hunt whitetails and bear in northern Wisconsin.', modes: ['Solo', 'Party', '3D'], image: '/images/modules/rackreel.webp', accent: '#c99b5a' },
  { id: 'hood', title: 'The Hood', subject: 'Needs, planning & neighborhoods', group: 'Strategy', summary: 'Move onto a shared street, build and furnish a house and care for your residents.', modes: ['Shared street', 'Practice lot', '3D'], image: '/images/modules/hood.webp', accent: '#e8a33c' },
  { id: 'demoderby', title: 'Demo Derby', subject: 'Momentum & impact', group: 'Physics', summary: 'Paint a 1970s wagon or sedan and be the last car moving at the county fair.', modes: ['Solo', '3D'], image: '/images/modules/demoderby.webp', accent: '#ff8c2a' },
  { id: 'bushleague', title: 'Bush League Baseball', subject: 'Pitch physics & probability', group: 'Physics', summary: 'Call pitches, time swings and play full innings with 32 original clubs.', modes: ['Solo', 'Watch', '3D'], image: '/images/modules/bushleague.webp', accent: '#e8b23a' },
  { id: 'proskater', title: 'Pro Skater AI', subject: 'Momentum & rotation', group: 'Physics', summary: 'Pump ramps, flip, grab and grind across three parks with story chapters.', modes: ['Story', 'Blitz', 'Showdown', 'Free skate', '3D'], image: '/images/modules/proskater.webp', accent: '#ff7a1a', mobile: true },
  { id: 'botwreck', title: 'BotWreck 3D', subject: 'Engineering', group: 'Physics', summary: 'Pick a robot frame and test impact force in a 3D crash lab.', modes: ['Solo', '3D'], image: '/images/modules/botwreck.webp', accent: '#ff5a36' },
  { id: 'pool', title: '8-Ball Pool', subject: 'Geometry', group: 'Math', summary: 'Angles, spin and shot planning in 8-ball and 9-ball.', modes: ['Practice', 'Live 1v1'], image: '/images/modules/pool.webp', accent: '#2fd6a3', mobile: true },
  { id: 'racing', title: 'Max Secure Circuit', subject: 'Motion', group: 'Physics', summary: 'Racing lines and braking points on a twisting road course.', modes: ['Time trial', 'Live grid'], image: '/images/modules/racing.webp', accent: '#39d0ff' },
  { id: 'park', title: 'Thrill Park', subject: 'Systems & economics', group: 'Physics', summary: 'Shape the land, build coasters and keep guests happy, solo or online.', modes: ['Scenarios', 'Sandbox', 'Online co-op', 'Versus'], image: '/images/modules/park.webp?v=2', accent: '#ffcf4a' },
  { id: 'park2', title: 'Thrill Park 2', subject: 'Systems & economics', group: 'Physics', summary: 'Thrill Park with richer lighting and glowing rides; your parks carry over.', modes: ['Scenarios', 'Sandbox', 'Online co-op', 'Versus', '3D'], image: '/images/modules/park2.webp?v=2', accent: '#ff8a3d' },
  { id: 'oval', title: 'Oval Speedway', subject: 'Momentum', group: 'Physics', summary: 'Drafting and banked turns on a high-speed oval.', modes: ['Time trial', 'Live grid'], image: '/images/modules/oval.webp', accent: '#ffd23b' },
  { id: 'chess', title: 'Chess', subject: 'Strategy', group: 'Strategy', summary: 'The classic strategy board against the CPU, a friend or online.', modes: ['CPU', '2 on 1 screen', 'Online room'], image: '/images/modules/chess.webp', accent: '#b388ff', mobile: true },
  { id: 'checkers', title: 'Checkers', subject: 'Strategy', group: 'Strategy', summary: 'Forced jumps, multi-jump chains and kings.', modes: ['CPU', '2 on 1 screen', 'Online room'], image: '/images/modules/checkers.webp', accent: '#ff5a7a', mobile: true },
  { id: '2048', title: '2048', subject: 'Mathematics', group: 'Math', summary: 'Merge powers of two on a sliding grid to reach 2048.', modes: ['Solo'], image: '/images/modules/2048.webp', accent: '#3b8bff', mobile: true },
  { id: 'helicopter', title: 'Chopper Cave', subject: 'Reaction & control', group: 'Precision', summary: 'Feather the climb through a narrowing cave.', modes: ['Solo'], image: '/images/modules/heli.webp', accent: '#5cffb0', mobile: true },
  { id: 'alphabet', title: 'Alphabet Sprint', subject: 'Touch typing', group: 'Precision', summary: 'Type A to Z perfectly, as fast as you can.', modes: ['Solo'], image: '/images/modules/alphabet.webp', accent: '#39d0ff' },
  { id: 'songmaker', title: 'Song Maker', subject: 'Composition', group: 'Creative', summary: 'Turn your lyrics into a song with a custom instrumental or AI vocals.', modes: ['Solo', 'AI'], image: '/images/modules/songmaker.webp', accent: '#ff3b7a', mobile: true },
  { id: 'lens', title: 'Lens Creator', subject: 'Facial geometry & colour', group: 'Creative', summary: 'Design a face lens live on your camera or a photo.', modes: ['Live camera', 'Photo'], image: '/images/modules/lens.webp', accent: '#ff7ad9', mobile: true },
  { id: 'tetradrop', title: 'Tetra Drop', subject: 'Spatial reasoning', group: 'Logic', summary: 'Rotate and slot falling blocks to clear lines.', modes: ['Solo'], image: '/images/modules/tetradrop.webp', accent: '#b388ff', mobile: true },
  { id: 'bubbles', title: 'Bubble Shooter', subject: 'Angles & planning', group: 'Precision', summary: 'Aim, bank and pop groups of matching bubbles.', modes: ['Solo'], image: '/images/modules/bubbles.webp', accent: '#ff5a7a', mobile: true },
  { id: 'sudoku', title: 'Sudoku', subject: 'Deduction', group: 'Logic', summary: 'Fresh single-solution puzzles in three difficulties.', modes: ['Solo'], image: '/images/modules/sudoku.webp', accent: '#3b8bff', mobile: true },
  { id: 'minesweeper', title: 'Minesweeper', subject: 'Probability & deduction', group: 'Logic', summary: 'Read the numbers, flag the mines and clear the field.', modes: ['Solo'], image: '/images/modules/minesweeper.webp', accent: '#ff7a1a', mobile: true },
  { id: 'recall', title: 'Hero Recall', subject: 'Visual memory', group: 'Logic', summary: 'Study twenty shuffled hero cards for five seconds, then match all ten pairs against the clock.', modes: ['Solo'], image: '/images/modules/recall.webp', accent: '#9b6bff', mobile: true },
  { id: 'greible', title: 'Greible', subject: 'Vocabulary & deduction', group: 'Logic', summary: 'Find the hidden 6, 7 or 8-letter word from colour clues, against the clock.', modes: ['Solo', '6 letters', '7 letters', '8 letters'], image: '/images/modules/greible.webp', accent: '#5fd068', mobile: true },
  { id: 'blockhead', title: 'Blockhead Siege', subject: 'Spatial awareness', group: 'Precision', summary: 'Top-down wave survival, solo or two on one keyboard.', modes: ['Solo', '2 on 1 screen'], image: '/images/modules/blockhead.webp', accent: '#ff5a36' },
  { id: 'foodchain', title: 'Food Chain', subject: 'Ecology & reaction', group: 'Precision', summary: 'Eat smaller fish, dodge bigger ones and grow.', modes: ['Solo'], image: '/images/modules/foodchain.webp', accent: '#3fd0c9' },
  { id: 'keep', title: 'Hold the Keep', subject: 'Gravity & momentum', group: 'Physics', summary: 'Grab and fling raiders to defend your keep, wave after wave.', modes: ['Solo'], image: '/images/modules/keep.webp', accent: '#f4b63a' },
  { id: 'giant', title: "Giant's Hand", subject: 'Projectile motion', group: 'Physics', summary: 'Toss and juggle tiny villagers for ninety seconds.', modes: ['Solo'], image: '/images/modules/giant.webp', accent: '#7fd85a' },
  { id: 'gonefishing', title: 'Polar Swat', subject: 'Launch angle & restitution', group: 'Physics', summary: 'A polar bear swats fish out of an ice hole: time the paw, find the launch angle and send them skipping across the lake.', modes: ['Solo', 'Original or WICS colours'], image: '/images/modules/gonefishing.webp', accent: '#4fb8ff', mobile: true },
  { id: 'cookies', title: 'Cookie Factory', subject: 'Exponential growth', group: 'Math', summary: 'Bake, reinvest and grow your output in five minutes.', modes: ['Solo'], image: '/images/modules/cookies.webp', accent: '#f2a541', mobile: true },
  { id: 'sunvault', title: 'Sun Vault', subject: 'Probability & expected value', group: 'Math', summary: 'Spin a five-reel temple vault and see how weighted reels set the long-run return.', modes: ['Solo', 'Play credits'], image: '/images/modules/sunvault.webp', accent: '#f8c64c', mobile: true },
  { id: 'beanstalk', title: 'Beanstalk Bounty', subject: 'Probability & branching growth', group: 'Math', summary: 'Spin a five-reel beanstalk where sprout wilds climb and spread vines, and see how chance compounds across the reels.', modes: ['Solo', 'Play credits'], image: '/images/modules/beanstalk.webp', accent: '#6fd36a', mobile: true },
  { id: 'modollaz', title: "Mo' Dollaz", subject: 'Probability & collection features', group: 'Math', summary: 'Spin five reels of cash where a money bag grabs every bill it can reach, and see how rare bonus rounds carry most of the long-run return.', modes: ['Solo', 'Play credits'], image: '/images/modules/modollaz.webp', accent: '#3ddc84', mobile: true },
  { id: 'hotdog', title: 'Corner Cart', subject: 'Supply, demand & pricing', group: 'Strategy', summary: 'Run a hot-dog cart for thirty days and grow your cash.', modes: ['Solo'], image: '/images/modules/hotdog.webp', accent: '#ff7a3d' },
  { id: 'bridge', title: 'Bridge Builder', subject: 'Trusses, tension & compression', group: 'Physics', summary: 'Lay road and beams joined flat, at 45° or at 90°, then send cars, buses, tankers and crane trucks across 100 levels.', modes: ['Solo', '100 levels'], image: '/images/modules/bridge.webp', accent: '#ff9f1c', mobile: true },
  { id: 'pingpong', title: 'Spin Rally', subject: 'Spin & the Magnus effect', group: 'Physics', summary: 'Table tennis where topspin, backspin and sidespin really curve the ball.', modes: ['Solo vs CPU', '2 on 1 screen', 'Online room'], image: '/images/modules/pingpong.webp', accent: '#ff5a36' },
  { id: 'arena', title: 'Vector Arena', subject: 'Gravity, collisions & level design', group: 'Physics', summary: 'A symmetrical sci-fi arena with 1v1 duels, 2v2 squads, a scored training range and Rolling Siege, where wheelchair raiders with bats never stop coming.', modes: ['Solo', 'Online', '3D'], image: '/images/modules/arena.webp', accent: '#38e1ff' },
  { id: 'party', title: 'Skill Party', subject: 'Reaction, aim & recall', group: 'Precision', summary: 'Skill contests for up to four players with a running scoreboard.', modes: ['Solo vs CPU', '2–4 on 1 screen', 'Online room'], image: '/images/modules/party.webp', accent: '#ffcf4a', mobile: true },
]
