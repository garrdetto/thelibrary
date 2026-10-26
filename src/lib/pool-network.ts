import type { CueDesign } from './cue-design'
export type PoolPoint = { x: number; y: number }
export type PoolShot = { shotVector: PoolPoint; power: number; english: PoolPoint; cuePosition?: PoolPoint }
export type PoolSnapshot = { number: number; x: number; y: number; pocketed: boolean }[]
export type PoolShotDetails = { scratch: boolean; order: number[]; firstContact: number | null; railAfterContact: boolean; offTable: boolean }
export type PoolMatch = { id: string; players: string[]; turn: string }
export type PoolBridge = {
  sendCueDesign: (design: CueDesign) => Promise<boolean>
  sendAim: (aim: number, pull: number, cuePosition?: PoolPoint) => void
  sendCuePosition: (point: PoolPoint) => void
  placeCue: ((point: PoolPoint) => void) | null
  opponentAim: { aim: number; pull: number } | null
  canShoot: () => boolean
  sendShot: (shot: PoolShot) => void
  sendSettled: (balls: PoolSnapshot, details: PoolShotDetails) => void
  play: ((shot: PoolShot) => void) | null
  sync: ((balls: PoolSnapshot) => void) | null
  reset: (() => void) | null
}
export type PoolStatus = 'available' | 'in-game' | 'away'
export type PoolGame = 'pool' | 'racing'
export type PoolActivity = PoolGame | 'site'
export type PoolPlayer = { username: string; status: PoolStatus; game?: PoolGame | null; playing?: boolean }
export type PoolInvite = { id: string; from: string; expiresAt: number; expiresIn: number }
export type RaceInvite = PoolInvite & { track: 'circuit' | 'oval' }
export type PoolToast = { id: number; message: string; tone: 'info' | 'success' | 'warning' }
export type PoolGroup = 'solids' | 'stripes'
export type PoolTableStatus = 'OPEN' | 'ASSIGNED'
export type PoolSeat = { id: string; username: string; group: PoolGroup | null; remaining: number[] }
export type PoolGameState = {
  roomId: string
  cueDesigns?: Record<string, CueDesign>
  ballInHand: string | null
  ballInHandRegion?: 'kitchen' | 'table' | null
  foul: string | null
  tableStatus: PoolTableStatus
  activeTurnPlayerID: string | null
  players: PoolSeat[]
  eightOnTable: boolean
  winner: string | null
  winnerID: string | null
  result: string
}
export type PoolChatMessage = { id: string; type: 'system' | 'player'; scope: 'lobby' | 'table'; from?: string; text: string; at: number }
