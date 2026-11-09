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
  { id: 'darts', title: 'Oche Darts', src: '/modules/darts.html' },
  { id: 'demoderby', title: 'Demo Derby', src: '/modules/demoderby.html' },
  { id: 'bushleague', title: 'Bush League Baseball', src: '/modules/bushleague.html' },
  { id: 'angler', title: 'Northwoods Angler', src: '/modules/angler.html' },
  { id: 'rackreel', title: 'Rack & Reel', src: '/modules/rackreel.html' },
  { id: 'county', title: 'Kestrel County', src: '/modules/county.html' },
  { id: 'hood', title: 'The Hood', src: '/modules/hood.html' },
  { id: 'alphabet', title: 'Alphabet Sprint', src: '/modules/alphabet.html' },
  { id: 'tetradrop', title: 'Tetra Drop', src: '/modules/tetradrop.html' },
  { id: 'bubbles', title: 'Bubble Shooter', src: '/modules/bubbles.html' },
  { id: 'sudoku', title: 'Sudoku', src: '/modules/sudoku.html' },
  { id: 'minesweeper', title: 'Minesweeper', src: '/modules/minesweeper.html' },
  { id: 'blockhead', title: 'Blockhead Siege', src: '/modules/blockhead.html' },
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
  { id: 'sandlot3d', title: 'Sandlot Sluggers 3D', subject: 'Sports science', group: 'Physics', summary: 'Bat timing, pitch location, fielding coverage and baserunning in full 3D. Draft nine, hit and pitch full innings, steal and bunt across four ballparks, including a dome modeled on American Family Field.', modes: ['Solo', '3D'], image: '/images/modules/sandlot3d.webp', accent: '#f4bf3a' },
  { id: 'maplestreet', title: 'Fox Plains', subject: 'Economics & engineering', group: 'Strategy', summary: 'Pick a plot in a shared, always-open town and build a house wall by wall: rooms, paint, roofs, pools, courts and 60 pieces of furniture. Drive pickups, a muscle coupe and a zero-turn mower, shop downtown, fill up at the gas station, mow striped lawns and manage a capped bank loan.', modes: ['Shared world', 'Solo', 'Online room', '3D'], image: '/images/modules/maplestreet.webp?v=2', accent: '#7cc46a' },
  { id: 'foxplains2', title: 'Fox Plains 2', subject: 'Economics & engineering', group: 'Strategy', summary: 'The same shared Fox Plains town, lots, houses and neighbors, rebuilt on Babylon.js and WebGPU: physically based lighting, a live sky with clouds and stars, soft cascaded shadows, ambient occlusion and street lamps that light the night. Walk and drive anywhere, haul deliveries and mow lawns alongside players in the original.', modes: ['Shared world', 'Solo', '3D'], image: '/images/modules/foxplains2.webp?v=1', accent: '#f2b544' },
  { id: 'sandlot', title: 'Sandlot Sluggers', subject: 'Sports science', group: 'Physics', summary: 'Timing windows, launch angles and team strategy on a neighborhood diamond. Draft a roster and run a full season.', modes: ['Solo', '2 on 1 screen', 'Online room'], image: '/images/modules/sandlot.webp', accent: '#ffb547' },
  { id: 'shorttrack', title: 'Short Track Showdown', subject: 'Friction & banking', group: 'Physics', summary: 'Steering scrub, coast-in corner entry and banked grip at Prison Speedway, with its walled cell house in the infield, on a half-mile bullring, a tight, steep 0.3-mile Dells-style oval, its wider, flatter grass-infield cousin or its dirt twin. Paint your race truck and race AI or friends.', modes: ['Solo', 'Online room'], image: '/images/modules/shorttrack.webp?v=2', accent: '#ff7a1a' },
  { id: 'fairway', title: 'Fairway Nine', subject: 'Projectile motion', group: 'Physics', summary: 'Launch angle, backspin lift, air drag and wind shape every shot across nine original holes, then slope and surface decide where the ball stops. Play a solo round, chase closest to the pin, or host an online room for up to four.', modes: ['Solo', 'Closest to the pin', 'Online room', '3D'], image: '/images/modules/fairway.webp', accent: '#4fd27a' },
  { id: 'darts', title: 'Oche Darts', subject: 'Projectile motion & probability', group: 'Precision', summary: 'A regulation board in a lamp-lit pub corner. Press to aim and flick to throw: your flick speed sets the launch speed, gravity and air drag bend the arc, and a steady release keeps the spread tight. Play 501 and 301 with double-in and double-out, Cricket or Count Up, solo, against four computer levels, pass-and-play for up to four, or in an online room.', modes: ['Solo', 'Computer', '2–4 on 1 screen', 'Online room', '3D'], image: '/images/modules/darts.webp', accent: '#ff4d5e' },
  { id: 'angler', title: 'Northwoods Angler', subject: 'Probability & freshwater ecology', group: 'Math', summary: 'Pick one of five Wisconsin-style lakes, drive a bass boat to a reef, weed bed or channel, drop anchor and let the odds play out. Sixteen real species with real size curves, so a trophy is as rare as it is on the water. The sky, season, weather and moon follow the real clock, and every species has its own record book.', modes: ['Shared lake', 'Solo', 'Idle', '3D'], image: '/images/modules/angler.webp', accent: '#3fb8a8' },
  { id: 'county', title: 'Kestrel County', subject: 'Flight & vehicle dynamics', group: 'Physics', summary: 'A 4 km county in glossy 3D: graded streets, a town of houses and an airport with traffic landing and taking off. Drive any Fox Plains vehicle, then fly a helicopter that feels ground effect and translational lift, or a high-wing trainer that stalls, glides and weathervanes like the real thing.', modes: ['Solo', 'Helicopter', 'Plane', '3D'], image: '/images/modules/county.webp', accent: '#4fb3ff' },
  { id: 'rackreel', title: 'Rack & Reel', subject: 'Wildlife biology & probability', group: 'Precision', summary: 'Two hundred and fifty acres of northern Wisconsin in fall color: pine and maple ridges, a cattail marsh and a lake with an island. Cast for muskie, walleye, pike, smallmouth and perch and play the line tension in, drive the trails in a UTV or run the lake in an aluminum boat, and still-hunt whitetails and black bear with a scoped rifle that sways with every breath. Every animal is weighed or scored the moment it appears, and about one in twelve is a record-book contender.', modes: ['Solo', '3D'], image: '/images/modules/rackreel.webp', accent: '#c99b5a' },
  { id: 'hood', title: 'The Hood', subject: 'Needs, planning & neighborhoods', group: 'Strategy', summary: 'Move a household onto a shared street of player-owned houses. Build rooms wall by wall, design the outside with brick or stone wainscots under siding, trim, shutters, door canopies, porches, pergolas, fences and four kinds of roof, furnish from a 27-piece catalog, and balance six needs as your residents eat, sleep, work and make friends. The town around the street never stops: police, firefighters, paramedics, nurses, prison guards, City Works, the lawn crew, the gas station, the burger place and the resort all run their own vehicles and back one another up on calls, and your residents can take any of those ten careers. Anyone on the street can drop by your yard; they only come inside when you are home and answer the knock.', modes: ['Shared street', 'Practice lot', '3D'], image: '/images/modules/hood.webp', accent: '#e8a33c' },
  { id: 'demoderby', title: 'Demo Derby', subject: 'Momentum & impact', group: 'Physics', summary: 'A county-fair demolition derby on a dirt pad barely bigger than a basketball court. Flat-paint a 1970s full-size wagon or sedan, spray your number on the doors and roof, then trade momentum for damage against a field of local drivers: nose hits cost engine power, backing in protects it, and the last car still moving wins the heat.', modes: ['Solo', '3D'], image: '/images/modules/demoderby.webp', accent: '#ff8c2a' },
  { id: 'bushleague', title: 'Bush League Baseball', subject: 'Pitch physics & probability', group: 'Physics', summary: 'Every pitch breaks by its spin and every fly ball rides drag, Magnus lift, wind and altitude on an original diamond. Pick from 32 cheeky clubs, call your pitches with a three-press meter, time your swing with a contact cursor, and let the full rulebook keep the box score over 3, 6 or 9 innings.', modes: ['Solo', 'Watch', '3D'], image: '/images/modules/bushleague.webp', accent: '#e8b23a' },
  { id: 'botwreck', title: 'BotWreck 3D', subject: 'Engineering', group: 'Physics', summary: 'Pick a robot vehicle frame, then test momentum, impact force and structural failure in a 3D crash lab.', modes: ['Solo', '3D'], image: '/images/modules/botwreck.webp', accent: '#ff5a36' },
  { id: 'pool', title: '8-Ball Pool', subject: 'Geometry', group: 'Math', summary: 'Angles, spin and shot planning across 8-ball and 9-ball. Challenge anyone who is online.', modes: ['Practice', 'Live 1v1'], image: '/images/modules/pool.webp', accent: '#2fd6a3' },
  { id: 'racing', title: 'Max Secure Circuit', subject: 'Motion', group: 'Physics', summary: 'Racing lines and braking points on a twisting road course. Chase lap records or join a live grid of up to 24 cars.', modes: ['Time trial', 'Live grid'], image: '/images/modules/racing.webp', accent: '#39d0ff' },
  { id: 'park', title: 'Thrill Park', subject: 'Systems & economics', group: 'Physics', summary: 'Shape the land, lay paths and design roller coasters whose hills and loops obey real physics. Keep guests happy and the books balanced, alone or with friends online.', modes: ['Scenarios', 'Sandbox', 'Online co-op', 'Versus'], image: '/images/modules/park.webp', accent: '#ffcf4a' },
  { id: 'park2', title: 'Thrill Park 2', subject: 'Systems & economics', group: 'Physics', summary: 'Thrill Park rebuilt on Babylon.js with WebGPU: sky lighting, soft shadows, lamp-lit nights and glowing rides. Same coaster physics, guests and economy, and your saved parks and leaderboard places carry over.', modes: ['Scenarios', 'Sandbox', 'Online co-op', 'Versus', '3D'], image: '/images/modules/park2.webp', accent: '#ff8a3d' },
  { id: 'oval', title: 'Oval Speedway', subject: 'Momentum', group: 'Physics', summary: 'Drafting, momentum and banked turns on a high-speed oval. Pick your lap count and race the pack.', modes: ['Time trial', 'Live grid'], image: '/images/modules/oval.webp', accent: '#ffd23b' },
  { id: 'chess', title: 'Chess', subject: 'Strategy', group: 'Strategy', summary: 'The classic strategy board. Three CPU levels, pass-and-play, or an online room with a friend.', modes: ['CPU', '2 on 1 screen', 'Online room'], image: '/images/modules/chess.webp', accent: '#b388ff' },
  { id: 'checkers', title: 'Checkers', subject: 'Strategy', group: 'Strategy', summary: 'Forced jumps, multi-jump chains and kings. Plan two moves ahead to win the board.', modes: ['CPU', '2 on 1 screen', 'Online room'], image: '/images/modules/checkers.webp', accent: '#ff5a7a' },
  { id: '2048', title: '2048', subject: 'Mathematics', group: 'Math', summary: 'Powers of two on a sliding grid. Merge tiles and plan ahead to build the 2048 tile.', modes: ['Solo'], image: '/images/modules/2048.webp', accent: '#3b8bff' },
  { id: 'helicopter', title: 'Chopper Cave', subject: 'Reaction & control', group: 'Precision', summary: 'Precision flight through a narrowing cave. Feather the climb and dodge the blocks.', modes: ['Solo'], image: '/images/modules/heli.webp', accent: '#5cffb0' },
  { id: 'alphabet', title: 'Alphabet Sprint', subject: 'Touch typing', group: 'Precision', summary: 'Type A to Z perfectly against the clock. A wrong letter stays on screen until you backspace it, so accuracy is speed. Fastest times lead the board.', modes: ['Solo'], image: '/images/modules/alphabet.webp', accent: '#39d0ff' },
  { id: 'songmaker', title: 'Song Maker', subject: 'Composition', group: 'Creative', summary: 'Write or paste your own lyrics, choose a genre, mood and voice, then build a free instrumental right in your browser with no API key, customizing the groove, key, chords, melody, tempo and mix, or have AI sing it with real vocals. Stuck on words? Describe an idea and it drafts lyrics you can edit first. Play songs back and download them.', modes: ['Solo', 'AI'], image: '/images/modules/songmaker.webp', accent: '#ff3b7a' },
  { id: 'lens', title: 'Lens Creator', subject: 'Facial geometry & colour', group: 'Creative', summary: 'Design your own face lens live on your camera or a photo. Face tracking maps 478 points, then you restyle and recolour hair, reshape eyes, nose, jaw and chin, add makeup, props, animated effects and colour grading, and save snapshots, clips or the lens itself.', modes: ['Live camera', 'Photo'], image: '/images/modules/lens.webp', accent: '#ff7ad9' },
  { id: 'tetradrop', title: 'Tetra Drop', subject: 'Spatial reasoning', group: 'Logic', summary: 'The classic falling-block puzzle: rotate and slot seven tetromino shapes to clear lines as the drop speeds up. Hold, hard drop, ghost piece and level scoring.', modes: ['Solo'], image: '/images/modules/tetradrop.webp', accent: '#b388ff' },
  { id: 'bubbles', title: 'Bubble Shooter', subject: 'Angles & planning', group: 'Precision', summary: 'Aim, bank off the walls and pop groups of three or more matching bubbles before the ceiling creeps down. Drop floating clusters for bonus points.', modes: ['Solo'], image: '/images/modules/bubbles.webp', accent: '#ff5a7a' },
  { id: 'sudoku', title: 'Sudoku', subject: 'Deduction', group: 'Logic', summary: 'Fresh puzzles every time with a single solution, three difficulties, pencil marks and mistake checking. Fastest solves on each difficulty lead the board.', modes: ['Solo'], image: '/images/modules/sudoku.webp', accent: '#3b8bff' },
  { id: 'minesweeper', title: 'Minesweeper', subject: 'Probability & deduction', group: 'Logic', summary: 'Read the numbers, flag the mines and clear the field. The first click is always safe, chords open neighbours, and the fastest intermediate clears set the record.', modes: ['Solo'], image: '/images/modules/minesweeper.webp', accent: '#ff7a1a' },
  { id: 'blockhead', title: 'Blockhead Siege', subject: 'Spatial awareness', group: 'Precision', summary: 'Top-down wave survival. Hold off growing hordes of blocky walkers with pistols, shotguns, rifles and barrels you can detonate. Solo, or two players on one keyboard.', modes: ['Solo', '2 on 1 screen'], image: '/images/modules/blockhead.webp', accent: '#ff5a36' },
  { id: 'party', title: 'Skill Party', subject: 'Reaction, aim & recall', group: 'Precision', summary: 'A party arena for up to four players. Pick a character, gather in the lobby and take turns choosing skill contests (reflex draws, target blitz, timing stops, memory flashes, quick math, crowd counts and more). Every result is measured, not rolled, and a running scoreboard crowns the champion.', modes: ['Solo vs CPU', '2–4 on 1 screen', 'Online room'], image: '/images/modules/party.webp', accent: '#ffcf4a' },
]
