export const embeddedModules = [
  { id: 'sandlot3d', title: 'Sandlot Sluggers 3D', src: '/modules/sandlot3d.html' },
  { id: 'maplestreet', title: 'Maple Street', src: '/modules/maplestreet.html' },
  { id: 'sandlot', title: 'Sandlot Sluggers', src: '/modules/sandlot.html' },
  { id: 'botwreck', title: 'BotWreck 3D', src: '/modules/botwreck.html' },
  { id: 'chess', title: 'Chess', src: '/modules/chess.html' },
  { id: 'checkers', title: 'Checkers', src: '/modules/checkers.html' },
  { id: '2048', title: '2048', src: '/modules/2048.html' },
  { id: 'helicopter', title: 'Chopper Cave', src: '/modules/helicopter.html' },
  { id: 'shorttrack', title: 'Short Track Showdown', src: '/modules/shorttrack.html' },
] as const

export type EmbeddedModuleId = typeof embeddedModules[number]['id']
export type ModuleId = EmbeddedModuleId | 'pool' | 'racing' | 'oval' | 'park'

export function isEmbeddedModuleId(value: string): value is EmbeddedModuleId {
  return embeddedModules.some(item => item.id === value)
}

export type ModuleSubject = 'Strategy' | 'Physics' | 'Math' | 'Precision'

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

export const moduleGroups: ModuleSubject[] = ['Strategy', 'Physics', 'Math', 'Precision']

export const learningModules: LearningModule[] = [
  { id: 'sandlot3d', title: 'Sandlot Sluggers 3D', subject: 'Sports science', group: 'Physics', summary: 'Bat timing, pitch location, fielding coverage and baserunning in full 3D. Draft nine, hit and pitch full innings, steal and bunt across four ballparks, including a dome modeled on American Family Field.', modes: ['Solo', '3D'], image: '/images/modules/sandlot3d.webp', accent: '#f4bf3a' },
  { id: 'maplestreet', title: 'Maple Street', subject: 'Economics & engineering', group: 'Strategy', summary: 'Pick a plot in a shared, always-open town and build a house wall by wall: rooms, paint, roofs, pools, courts and 60 pieces of furniture. Drive pickups, a muscle coupe and a zero-turn mower, shop downtown, fill up at the gas station, mow striped lawns and manage a capped bank loan.', modes: ['Shared world', 'Solo', 'Online room', '3D'], image: '/images/modules/maplestreet.webp?v=2', accent: '#7cc46a' },
  { id: 'sandlot', title: 'Sandlot Sluggers', subject: 'Sports science', group: 'Physics', summary: 'Timing windows, launch angles and team strategy on a neighborhood diamond. Draft a roster and run a full season.', modes: ['Solo', '2 on 1 screen', 'Online room'], image: '/images/modules/sandlot.webp', accent: '#ffb547' },
  { id: 'shorttrack', title: 'Short Track Showdown', subject: 'Friction & banking', group: 'Physics', summary: 'Steering scrub, coast-in corner entry and banked grip on a half-mile bullring, a tight, steep 0.3-mile Dells-style oval, its wider, flatter grass-infield cousin or its dirt twin. Paint your race truck and race AI or friends.', modes: ['Solo', 'Online room'], image: '/images/modules/shorttrack.webp?v=2', accent: '#ff7a1a' },
  { id: 'botwreck', title: 'BotWreck 3D', subject: 'Engineering', group: 'Physics', summary: 'Pick a robot vehicle frame, then test momentum, impact force and structural failure in a 3D crash lab.', modes: ['Solo', '3D'], image: '/images/modules/botwreck.webp', accent: '#ff5a36' },
  { id: 'pool', title: '8-Ball Pool', subject: 'Geometry', group: 'Math', summary: 'Angles, spin and shot planning across 8-ball and 9-ball. Challenge anyone who is online.', modes: ['Practice', 'Live 1v1'], image: '/images/modules/pool.webp', accent: '#2fd6a3' },
  { id: 'racing', title: 'Max Secure Circuit', subject: 'Motion', group: 'Physics', summary: 'Racing lines and braking points on a twisting road course. Chase lap records or join a live grid of up to 24 cars.', modes: ['Time trial', 'Live grid'], image: '/images/modules/racing.webp', accent: '#39d0ff' },
  { id: 'park', title: 'Thrill Park', subject: 'Systems & economics', group: 'Physics', summary: 'Shape the land, lay paths and design roller coasters whose hills and loops obey real physics. Keep guests happy and the books balanced, alone or with friends online.', modes: ['Scenarios', 'Sandbox', 'Online co-op', 'Versus'], image: '/images/modules/park.webp', accent: '#ffcf4a' },
  { id: 'oval', title: 'Oval Speedway', subject: 'Momentum', group: 'Physics', summary: 'Drafting, momentum and banked turns on a high-speed oval. Pick your lap count and race the pack.', modes: ['Time trial', 'Live grid'], image: '/images/modules/oval.webp', accent: '#ffd23b' },
  { id: 'chess', title: 'Chess', subject: 'Strategy', group: 'Strategy', summary: 'The classic strategy board. Three CPU levels, pass-and-play, or an online room with a friend.', modes: ['CPU', '2 on 1 screen', 'Online room'], image: '/images/modules/chess.webp', accent: '#b388ff' },
  { id: 'checkers', title: 'Checkers', subject: 'Strategy', group: 'Strategy', summary: 'Forced jumps, multi-jump chains and kings. Plan two moves ahead to win the board.', modes: ['CPU', '2 on 1 screen', 'Online room'], image: '/images/modules/checkers.webp', accent: '#ff5a7a' },
  { id: '2048', title: '2048', subject: 'Mathematics', group: 'Math', summary: 'Powers of two on a sliding grid. Merge tiles and plan ahead to build the 2048 tile.', modes: ['Solo'], image: '/images/modules/2048.webp', accent: '#3b8bff' },
  { id: 'helicopter', title: 'Chopper Cave', subject: 'Reaction & control', group: 'Precision', summary: 'Precision flight through a narrowing cave. Feather the climb and dodge the blocks.', modes: ['Solo'], image: '/images/modules/heli.webp', accent: '#5cffb0' },
]
