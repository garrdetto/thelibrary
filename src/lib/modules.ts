export const embeddedModules = [
  { id: 'sandlot3d', title: 'Sandlot Sluggers 3D', src: '/modules/sandlot3d.html' },
  { id: 'maplestreet', title: 'Fox Plains', src: '/modules/maplestreet.html' },
  { id: 'foxplains2', title: 'Fox Plains 2', src: '/modules/foxplains2.html' },
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
  { id: 'hood', title: 'The Hood', src: '/modules/hood.html' },
  { id: 'alphabet', title: 'Alphabet Sprint', src: '/modules/alphabet.html' },
  { id: 'tetradrop', title: 'Tetra Drop', src: '/modules/tetradrop.html' },
  { id: 'bubbles', title: 'Bubble Shooter', src: '/modules/bubbles.html' },
  { id: 'sudoku', title: 'Sudoku', src: '/modules/sudoku.html' },
  { id: 'minesweeper', title: 'Minesweeper', src: '/modules/minesweeper.html' },
  { id: 'blockhead', title: 'Blockhead Siege', src: '/modules/blockhead.html' },
  { id: 'foodchain', title: 'Food Chain', src: '/modules/foodchain.html' },
  { id: 'keep', title: 'Hold the Keep', src: '/modules/keep.html' },
  { id: 'giant', title: "Giant's Hand", src: '/modules/giant.html' },
  { id: 'cookies', title: 'Cookie Factory', src: '/modules/cookies.html' },
  { id: 'hotdog', title: 'Corner Cart', src: '/modules/hotdog.html' },
  { id: 'pingpong', title: 'Spin Rally', src: '/modules/pingpong.html' },
  { id: 'songmaker', title: 'Song Maker', src: '/modules/songmaker.html' },
  { id: 'party', title: 'Skill Party', src: '/modules/party.html' },
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
}

export const moduleGroups: ModuleSubject[] = ['Strategy', 'Physics', 'Math', 'Precision', 'Logic', 'Creative']

export const learningModules: LearningModule[] = [
  { id: 'sandlot3d', title: 'Sandlot Sluggers 3D', subject: 'Sports science', group: 'Physics', summary: 'Hit, pitch, field and run the bases in full 3D across four ballparks.', modes: ['Solo', '3D'], image: '/images/modules/sandlot3d.webp?v=2', accent: '#f4bf3a' },
  { id: 'maplestreet', title: 'Fox Plains', subject: 'Economics & engineering', group: 'Strategy', summary: 'Build a house, drive, mow lawns and shop in a shared, always-open town.', modes: ['Shared world', 'Solo', 'Online room', '3D'], image: '/images/modules/maplestreet.webp?v=2', accent: '#7cc46a' },
  { id: 'foxplains2', title: 'Fox Plains 2', subject: 'Economics & engineering', group: 'Strategy', summary: 'The shared Fox Plains town rebuilt with richer lighting, sky and shadows.', modes: ['Shared world', 'Solo', '3D'], image: '/images/modules/foxplains2.webp?v=1', accent: '#f2b544' },
  { id: 'sandlot', title: 'Sandlot Sluggers', subject: 'Sports science', group: 'Physics', summary: 'Draft a roster and play a full season on a neighborhood diamond.', modes: ['Solo', '2 on 1 screen', 'Online room'], image: '/images/modules/sandlot.webp', accent: '#ffb547' },
  { id: 'shorttrack', title: 'Short Track Showdown', subject: 'Friction & banking', group: 'Physics', summary: 'Paint your ride and race AI or friends on five short ovals, asphalt or dirt.', modes: ['Solo', 'Online room'], image: '/images/modules/shorttrack.webp?v=3', accent: '#ff7a1a' },
  { id: 'fairway', title: 'Fairway Nine', subject: 'Projectile motion', group: 'Physics', summary: 'Nine original holes where launch, spin, drag and wind shape every shot.', modes: ['Solo', 'Closest to the pin', 'Online room', '3D'], image: '/images/modules/fairway.webp', accent: '#4fd27a' },
  { id: 'darts', title: 'Darts', subject: 'Projectile motion & probability', group: 'Precision', summary: 'Aim, time the power meter and throw: 501, 301, Cricket or Count Up.', modes: ['Solo', 'Computer', '2–4 on 1 screen', 'Online room', '3D'], image: '/images/modules/darts.webp', accent: '#ff4d5e' },
  { id: 'angler', title: 'Northwoods Angler', subject: 'Probability & freshwater ecology', group: 'Math', summary: 'Anchor on five Wisconsin-style lakes and chase record fish of sixteen species.', modes: ['Shared lake', 'Solo', 'Idle', '3D'], image: '/images/modules/angler.webp', accent: '#3fb8a8' },
  { id: 'county', title: 'Kestrel County', subject: 'Flight & vehicle dynamics', group: 'Physics', summary: 'Drive a 4 km county, then fly a helicopter or trainer plane from its airport.', modes: ['Solo', 'Helicopter', 'Plane', '3D'], image: '/images/modules/county.webp', accent: '#4fb3ff' },
  { id: 'rackreel', title: 'Rack & Reel', subject: 'Wildlife biology & probability', group: 'Precision', summary: 'Fish, drive the trails and hunt whitetails and bear in northern Wisconsin.', modes: ['Solo', 'Party', '3D'], image: '/images/modules/rackreel.webp', accent: '#c99b5a' },
  { id: 'hood', title: 'The Hood', subject: 'Needs, planning & neighborhoods', group: 'Strategy', summary: 'Move onto a shared street, build and furnish a house and care for your residents.', modes: ['Shared street', 'Practice lot', '3D'], image: '/images/modules/hood.webp', accent: '#e8a33c' },
  { id: 'demoderby', title: 'Demo Derby', subject: 'Momentum & impact', group: 'Physics', summary: 'Paint a 1970s wagon or sedan and be the last car moving at the county fair.', modes: ['Solo', '3D'], image: '/images/modules/demoderby.webp', accent: '#ff8c2a' },
  { id: 'bushleague', title: 'Bush League Baseball', subject: 'Pitch physics & probability', group: 'Physics', summary: 'Call pitches, time swings and play full innings with 32 original clubs.', modes: ['Solo', 'Watch', '3D'], image: '/images/modules/bushleague.webp', accent: '#e8b23a' },
  { id: 'proskater', title: 'Pro Skater AI', subject: 'Momentum & rotation', group: 'Physics', summary: 'Pump ramps, flip, grab and grind across three parks with story chapters.', modes: ['Story', 'Blitz', 'Showdown', 'Free skate', '3D'], image: '/images/modules/proskater.webp', accent: '#ff7a1a' },
  { id: 'botwreck', title: 'BotWreck 3D', subject: 'Engineering', group: 'Physics', summary: 'Pick a robot frame and test impact force in a 3D crash lab.', modes: ['Solo', '3D'], image: '/images/modules/botwreck.webp', accent: '#ff5a36' },
  { id: 'pool', title: '8-Ball Pool', subject: 'Geometry', group: 'Math', summary: 'Angles, spin and shot planning in 8-ball and 9-ball.', modes: ['Practice', 'Live 1v1'], image: '/images/modules/pool.webp', accent: '#2fd6a3' },
  { id: 'racing', title: 'Max Secure Circuit', subject: 'Motion', group: 'Physics', summary: 'Racing lines and braking points on a twisting road course.', modes: ['Time trial', 'Live grid'], image: '/images/modules/racing.webp', accent: '#39d0ff' },
  { id: 'park', title: 'Thrill Park', subject: 'Systems & economics', group: 'Physics', summary: 'Shape the land, build coasters and keep guests happy, solo or online.', modes: ['Scenarios', 'Sandbox', 'Online co-op', 'Versus'], image: '/images/modules/park.webp?v=2', accent: '#ffcf4a' },
  { id: 'park2', title: 'Thrill Park 2', subject: 'Systems & economics', group: 'Physics', summary: 'Thrill Park with richer lighting and glowing rides; your parks carry over.', modes: ['Scenarios', 'Sandbox', 'Online co-op', 'Versus', '3D'], image: '/images/modules/park2.webp?v=2', accent: '#ff8a3d' },
  { id: 'oval', title: 'Oval Speedway', subject: 'Momentum', group: 'Physics', summary: 'Drafting and banked turns on a high-speed oval.', modes: ['Time trial', 'Live grid'], image: '/images/modules/oval.webp', accent: '#ffd23b' },
  { id: 'chess', title: 'Chess', subject: 'Strategy', group: 'Strategy', summary: 'The classic strategy board against the CPU, a friend or online.', modes: ['CPU', '2 on 1 screen', 'Online room'], image: '/images/modules/chess.webp', accent: '#b388ff' },
  { id: 'checkers', title: 'Checkers', subject: 'Strategy', group: 'Strategy', summary: 'Forced jumps, multi-jump chains and kings.', modes: ['CPU', '2 on 1 screen', 'Online room'], image: '/images/modules/checkers.webp', accent: '#ff5a7a' },
  { id: '2048', title: '2048', subject: 'Mathematics', group: 'Math', summary: 'Merge powers of two on a sliding grid to reach 2048.', modes: ['Solo'], image: '/images/modules/2048.webp', accent: '#3b8bff' },
  { id: 'helicopter', title: 'Chopper Cave', subject: 'Reaction & control', group: 'Precision', summary: 'Feather the climb through a narrowing cave.', modes: ['Solo'], image: '/images/modules/heli.webp', accent: '#5cffb0' },
  { id: 'alphabet', title: 'Alphabet Sprint', subject: 'Touch typing', group: 'Precision', summary: 'Type A to Z perfectly, as fast as you can.', modes: ['Solo'], image: '/images/modules/alphabet.webp', accent: '#39d0ff' },
  { id: 'songmaker', title: 'Song Maker', subject: 'Composition', group: 'Creative', summary: 'Turn your lyrics into a song with a custom instrumental or AI vocals.', modes: ['Solo', 'AI'], image: '/images/modules/songmaker.webp', accent: '#ff3b7a' },
  { id: 'lens', title: 'Lens Creator', subject: 'Facial geometry & colour', group: 'Creative', summary: 'Design a face lens live on your camera or a photo.', modes: ['Live camera', 'Photo'], image: '/images/modules/lens.webp', accent: '#ff7ad9' },
  { id: 'tetradrop', title: 'Tetra Drop', subject: 'Spatial reasoning', group: 'Logic', summary: 'Rotate and slot falling blocks to clear lines.', modes: ['Solo'], image: '/images/modules/tetradrop.webp', accent: '#b388ff' },
  { id: 'bubbles', title: 'Bubble Shooter', subject: 'Angles & planning', group: 'Precision', summary: 'Aim, bank and pop groups of matching bubbles.', modes: ['Solo'], image: '/images/modules/bubbles.webp', accent: '#ff5a7a' },
  { id: 'sudoku', title: 'Sudoku', subject: 'Deduction', group: 'Logic', summary: 'Fresh single-solution puzzles in three difficulties.', modes: ['Solo'], image: '/images/modules/sudoku.webp', accent: '#3b8bff' },
  { id: 'minesweeper', title: 'Minesweeper', subject: 'Probability & deduction', group: 'Logic', summary: 'Read the numbers, flag the mines and clear the field.', modes: ['Solo'], image: '/images/modules/minesweeper.webp', accent: '#ff7a1a' },
  { id: 'blockhead', title: 'Blockhead Siege', subject: 'Spatial awareness', group: 'Precision', summary: 'Top-down wave survival, solo or two on one keyboard.', modes: ['Solo', '2 on 1 screen'], image: '/images/modules/blockhead.webp', accent: '#ff5a36' },
  { id: 'foodchain', title: 'Food Chain', subject: 'Ecology & reaction', group: 'Precision', summary: 'Eat smaller fish, dodge bigger ones and grow.', modes: ['Solo'], image: '/images/modules/foodchain.webp', accent: '#3fd0c9' },
  { id: 'keep', title: 'Hold the Keep', subject: 'Gravity & momentum', group: 'Physics', summary: 'Grab and fling raiders to defend your keep, wave after wave.', modes: ['Solo'], image: '/images/modules/keep.webp', accent: '#f4b63a' },
  { id: 'giant', title: "Giant's Hand", subject: 'Projectile motion', group: 'Physics', summary: 'Toss and juggle tiny villagers for ninety seconds.', modes: ['Solo'], image: '/images/modules/giant.webp', accent: '#7fd85a' },
  { id: 'cookies', title: 'Cookie Factory', subject: 'Exponential growth', group: 'Math', summary: 'Bake, reinvest and grow your output in five minutes.', modes: ['Solo'], image: '/images/modules/cookies.webp', accent: '#f2a541' },
  { id: 'hotdog', title: 'Corner Cart', subject: 'Supply, demand & pricing', group: 'Strategy', summary: 'Run a hot-dog cart for thirty days and grow your cash.', modes: ['Solo'], image: '/images/modules/hotdog.webp', accent: '#ff7a3d' },
  { id: 'pingpong', title: 'Spin Rally', subject: 'Spin & the Magnus effect', group: 'Physics', summary: 'Table tennis where topspin, backspin and sidespin really curve the ball.', modes: ['Solo vs CPU', '2 on 1 screen', 'Online room'], image: '/images/modules/pingpong.webp', accent: '#ff5a36' },
  { id: 'party', title: 'Skill Party', subject: 'Reaction, aim & recall', group: 'Precision', summary: 'Skill contests for up to four players with a running scoreboard.', modes: ['Solo vs CPU', '2–4 on 1 screen', 'Online room'], image: '/images/modules/party.webp', accent: '#ffcf4a' },
]
