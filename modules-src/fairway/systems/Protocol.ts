/** Typed PeerJS message union for online rooms, validated with Zod on receipt because peers are untrusted. */
import { z } from 'zod'
import { tuning, type ClubId } from '../tuning'
import type { MatchState, Placement, PlayerSeat } from './Match'
import type { ShotParams } from './BallFlight'

const clubIds = tuning.clubs.map((club) => club.id) as [ClubId, ...ClubId[]]
const finite = z.number().finite()
const vec3 = z.tuple([finite, finite, finite])
const id = z.string().min(1).max(64)
const name = z.string().trim().min(1).max(24)
const lie = z.enum(['tee', 'fairway', 'rough', 'green', 'bunker', 'path'])
const seat = z.object({ id, name })

const paramsSchema = z.object({
  hole: z.number().int().min(0).max(tuning.holes.length - 1),
  origin: vec3,
  yaw: finite,
  club: z.enum(clubIds),
  power: finite.min(0).max(1),
  curve: finite.min(-1).max(1),
  spin: finite.min(-1).max(1),
  lie,
  teeShot: z.boolean(),
  wind: z.tuple([finite, finite]),
})

const playerSchema = seat.extend({
  strokes: z.array(z.number().int().min(0).max(99).nullable()).max(9),
  ball: vec3,
  lie,
  teeShot: z.boolean(),
  holed: z.boolean(),
  pickedUp: z.boolean(),
  pinDistances: z.array(finite.nullable()).max(9),
  holeInOne: z.boolean(),
})

const stateSchema = z.object({
  mode: z.enum(['solo', 'pin', 'online']),
  holes: z.array(z.number().int().min(0).max(tuning.holes.length - 1)).min(1).max(9),
  windSeeds: z.array(z.number().int().min(0)).max(9),
  matchSeed: z.number().int().min(0),
  holeIndex: z.number().int().min(0).max(8),
  players: z.array(playerSchema).max(tuning.match.maxPlayers),
  current: id.nullable(),
  finished: z.boolean(),
  shotNumber: z.number().int().min(0),
})

const placementSchema = z.object({ id, name, place: z.number().int().min(1).max(tuning.match.maxPlayers), total: z.number().int().min(0) })

export const messageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), playerId: id, name }),
  z.object({ type: z.literal('roster'), hostId: id, players: z.array(seat).max(tuning.match.maxPlayers) }),
  z.object({ type: z.literal('start'), holes: z.array(z.number().int()).min(1).max(9), seeds: z.array(z.number().int().min(0)).max(9), matchSeed: z.number().int().min(0), players: z.array(seat).max(tuning.match.maxPlayers) }),
  z.object({ type: z.literal('shot'), playerId: id, params: paramsSchema, seed: z.number().int().min(0) }),
  z.object({ type: z.literal('state'), state: stateSchema }),
  z.object({ type: z.literal('turn'), playerId: id }),
  z.object({ type: z.literal('finish'), placements: z.array(placementSchema).max(tuning.match.maxPlayers) }),
])

export type FairwayMessage =
  | { type: 'hello'; playerId: string; name: string }
  | { type: 'roster'; hostId: string; players: PlayerSeat[] }
  | { type: 'start'; holes: number[]; seeds: number[]; matchSeed: number; players: PlayerSeat[] }
  | { type: 'shot'; playerId: string; params: ShotParams; seed: number }
  | { type: 'state'; state: MatchState }
  | { type: 'turn'; playerId: string }
  | { type: 'finish'; placements: Placement[] }

/**
 * Validates an incoming peer message. Anything that does not match the union exactly (unknown type, out-of-range
 * numbers, too many players) is dropped by returning null, so a bad peer can never corrupt local state.
 */
export function parseMessage(raw: unknown): FairwayMessage | null {
  const result = messageSchema.safeParse(raw)
  return result.success ? (result.data as FairwayMessage) : null
}
