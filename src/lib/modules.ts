export const embeddedModules = [
  { id: 'sandlot3d', title: 'Sandlot Sluggers 3D', src: '/modules/sandlot3d.html' },
  { id: 'maplestreet', title: 'Fox Plains', src: '/modules/maplestreet.html' },
  { id: 'sandlot', title: 'Sandlot Sluggers', src: '/modules/sandlot.html' },
  { id: 'botwreck', title: 'BotWreck 3D', src: '/modules/botwreck.html' },
  { id: 'chess', title: 'Chess', src: '/modules/chess.html' },
  { id: 'checkers', title: 'Checkers', src: '/modules/checkers.html' },
  { id: '2048', title: '2048', src: '/modules/2048.html' },
  { id: 'helicopter', title: 'Chopper Cave', src: '/modules/helicopter.html' },
  { id: 'shorttrack', title: 'Short Track Showdown', src: '/modules/shorttrack.html' },
  { id: 'fairway', title: 'Fairway Nine', src: '/modules/fairway.html' },
  { id: 'alphabet', title: 'Alphabet Sprint', src: '/modules/alphabet.html' },
  { id: 'wpm', title: 'Words Per Minute', src: '/modules/wpm.html' },
  { id: 'tetradrop', title: 'Tetra Drop', src: '/modules/tetradrop.html' },
  { id: 'bubbles', title: 'Bubble Shooter', src: '/modules/bubbles.html' },
  { id: 'memory', title: 'Memory Match', src: '/modules/memory.html' },
  { id: 'simon', title: 'Echo Sequence', src: '/modules/simon.html' },
  { id: 'sudoku', title: 'Sudoku', src: '/modules/sudoku.html' },
  { id: 'minesweeper', title: 'Minesweeper', src: '/modules/minesweeper.html' },
  { id: 'mathrush', title: 'Math Rush', src: '/modules/mathrush.html' },
  { id: 'blockhead', title: 'Blockhead Siege', src: '/modules/blockhead.html' },
  { id: 'songmaker', title: 'Song Maker', src: '/modules/songmaker.html' },
  { id: 'party', title: 'Skill Party', src: '/modules/party.html' },
] as const

export type EmbeddedModuleId = typeof embeddedModules[number]['id']
export type ModuleId = EmbeddedModuleId | 'pool' | 'racing' | 'oval' | 'park'

export function isEmbeddedModuleId(value: string): value is EmbeddedModuleId {
  return embeddedModules.some(item => item.id === value)
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
  { id: 'sandlot', title: 'Sandlot Sluggers', subject: 'Sports science', group: 'Physics', summary: 'Timing windows, launch angles and team strategy on a neighborhood diamond. Draft a roster and run a full season.', modes: ['Solo', '2 on 1 screen', 'Online room'], image: '/images/modules/sandlot.webp', accent: '#ffb547' },
  { id: 'shorttrack', title: 'Short Track Showdown', subject: 'Friction & banking', group: 'Physics', summary: 'Steering scrub, coast-in corner entry and banked grip at Prison Speedway, with its walled cell house in the infield, on a half-mile bullring, a tight, steep 0.3-mile Dells-style oval, its wider, flatter grass-infield cousin or its dirt twin. Paint your race truck and race AI or friends.', modes: ['Solo', 'Online room'], image: '/images/modules/shorttrack.webp?v=2', accent: '#ff7a1a' },
  { id: 'fairway', title: 'Fairway Nine', subject: 'Projectile motion', group: 'Physics', summary: 'Launch angle, backspin lift, air drag and wind shape every shot across nine original holes, then slope and surface decide where the ball stops. Play a solo round, chase closest to the pin, or host an online room for up to four.', modes: ['Solo', 'Closest to the pin', 'Online room', '3D'], image: '/images/modules/fairway.webp', accent: '#4fd27a' },
  { id: 'botwreck', title: 'BotWreck 3D', subject: 'Engineering', group: 'Physics', summary: 'Pick a robot vehicle frame, then test momentum, impact force and structural failure in a 3D crash lab.', modes: ['Solo', '3D'], image: '/images/modules/botwreck.webp', accent: '#ff5a36' },
  { id: 'pool', title: '8-Ball Pool', subject: 'Geometry', group: 'Math', summary: 'Angles, spin and shot planning across 8-ball and 9-ball. Challenge anyone who is online.', modes: ['Practice', 'Live 1v1'], image: '/images/modules/pool.webp', accent: '#2fd6a3' },
  { id: 'racing', title: 'Max Secure Circuit', subject: 'Motion', group: 'Physics', summary: 'Racing lines and braking points on a twisting road course. Chase lap records or join a live grid of up to 24 cars.', modes: ['Time trial', 'Live grid'], image: '/images/modules/racing.webp', accent: '#39d0ff' },
  { id: 'park', title: 'Thrill Park', subject: 'Systems & economics', group: 'Physics', summary: 'Shape the land, lay paths and design roller coasters whose hills and loops obey real physics. Keep guests happy and the books balanced, alone or with friends online.', modes: ['Scenarios', 'Sandbox', 'Online co-op', 'Versus'], image: '/images/modules/park.webp', accent: '#ffcf4a' },
  { id: 'oval', title: 'Oval Speedway', subject: 'Momentum', group: 'Physics', summary: 'Drafting, momentum and banked turns on a high-speed oval. Pick your lap count and race the pack.', modes: ['Time trial', 'Live grid'], image: '/images/modules/oval.webp', accent: '#ffd23b' },
  { id: 'chess', title: 'Chess', subject: 'Strategy', group: 'Strategy', summary: 'The classic strategy board. Three CPU levels, pass-and-play, or an online room with a friend.', modes: ['CPU', '2 on 1 screen', 'Online room'], image: '/images/modules/chess.webp', accent: '#b388ff' },
  { id: 'checkers', title: 'Checkers', subject: 'Strategy', group: 'Strategy', summary: 'Forced jumps, multi-jump chains and kings. Plan two moves ahead to win the board.', modes: ['CPU', '2 on 1 screen', 'Online room'], image: '/images/modules/checkers.webp', accent: '#ff5a7a' },
  { id: '2048', title: '2048', subject: 'Mathematics', group: 'Math', summary: 'Powers of two on a sliding grid. Merge tiles and plan ahead to build the 2048 tile.', modes: ['Solo'], image: '/images/modules/2048.webp', accent: '#3b8bff' },
  { id: 'helicopter', title: 'Chopper Cave', subject: 'Reaction & control', group: 'Precision', summary: 'Precision flight through a narrowing cave. Feather the climb and dodge the blocks.', modes: ['Solo'], image: '/images/modules/heli.webp', accent: '#5cffb0' },
  { id: 'alphabet', title: 'Alphabet Sprint', subject: 'Touch typing', group: 'Precision', summary: 'Type A to Z perfectly against the clock. A wrong letter stays on screen until you backspace it, so accuracy is speed. Fastest times lead the board.', modes: ['Solo'], image: '/images/modules/alphabet.webp', accent: '#39d0ff' },
  { id: 'wpm', title: 'Words Per Minute', subject: 'Touch typing', group: 'Precision', summary: 'One minute, one flowing paragraph of random words. Every correct word counts toward your words-per-minute score, and accuracy is tracked beside it.', modes: ['Solo'], image: '/images/modules/wpm.webp', accent: '#ff9f3b' },
  { id: 'tetradrop', title: 'Tetra Drop', subject: 'Spatial reasoning', group: 'Logic', summary: 'The classic falling-block puzzle: rotate and slot seven tetromino shapes to clear lines as the drop speeds up. Hold, hard drop, ghost piece and level scoring.', modes: ['Solo'], image: '/images/modules/tetradrop.webp', accent: '#b388ff' },
  { id: 'bubbles', title: 'Bubble Shooter', subject: 'Angles & planning', group: 'Precision', summary: 'Aim, bank off the walls and pop groups of three or more matching bubbles before the ceiling creeps down. Drop floating clusters for bonus points.', modes: ['Solo'], image: '/images/modules/bubbles.webp', accent: '#ff5a7a' },
  { id: 'memory', title: 'Memory Match', subject: 'Working memory', group: 'Logic', summary: 'Flip cards two at a time and remember where each symbol hides. Clear the whole grid as fast as you can; your time goes on the board.', modes: ['Solo'], image: '/images/modules/memory.webp', accent: '#2fd6a3' },
  { id: 'simon', title: 'Echo Sequence', subject: 'Sequence recall', group: 'Logic', summary: 'Watch the pads light up, then echo the pattern back. Every round adds one more step; the longest sequence you can hold in your head is your score.', modes: ['Solo'], image: '/images/modules/simon.webp', accent: '#f4cf3c' },
  { id: 'sudoku', title: 'Sudoku', subject: 'Deduction', group: 'Logic', summary: 'Fresh puzzles every time with a single solution, three difficulties, pencil marks and mistake checking. Fastest solves on each difficulty lead the board.', modes: ['Solo'], image: '/images/modules/sudoku.webp', accent: '#3b8bff' },
  { id: 'minesweeper', title: 'Minesweeper', subject: 'Probability & deduction', group: 'Logic', summary: 'Read the numbers, flag the mines and clear the field. The first click is always safe, chords open neighbours, and the fastest intermediate clears set the record.', modes: ['Solo'], image: '/images/modules/minesweeper.webp', accent: '#ff7a1a' },
  { id: 'mathrush', title: 'Math Rush', subject: 'Mental arithmetic', group: 'Math', summary: 'Sixty seconds of rapid-fire arithmetic that scales up as you answer. Streaks multiply points; a wrong answer resets the streak.', modes: ['Solo'], image: '/images/modules/mathrush.webp', accent: '#5cffb0' },
  { id: 'blockhead', title: 'Blockhead Siege', subject: 'Spatial awareness', group: 'Precision', summary: 'Top-down wave survival. Hold off growing hordes of blocky walkers with pistols, shotguns, rifles and barrels you can detonate. Solo, or two players on one keyboard.', modes: ['Solo', '2 on 1 screen'], image: '/images/modules/blockhead.webp', accent: '#ff5a36' },
  { id: 'songmaker', title: 'Song Maker', subject: 'Composition', group: 'Creative', summary: 'Write or paste your own lyrics, choose a genre, mood and voice, and AI turns them into a finished song with real sung vocals. Stuck on words? Describe an idea and it drafts lyrics you can edit first. Play songs back and download them as MP3.', modes: ['Solo', 'AI'], image: '/images/modules/songmaker.webp', accent: '#ff3b7a' },
  { id: 'party', title: 'Skill Party', subject: 'Reaction, aim & recall', group: 'Precision', summary: 'A party arena for up to four players. Pick a character, gather in the lobby and take turns choosing skill contests (reflex draws, target blitz, timing stops, memory flashes, quick math, crowd counts and more). Every result is measured, not rolled, and a running scoreboard crowns the champion.', modes: ['Solo vs CPU', '2–4 on 1 screen', 'Online room'], image: '/images/modules/party.webp', accent: '#ffcf4a' },
]
