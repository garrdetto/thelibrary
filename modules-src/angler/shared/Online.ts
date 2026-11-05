/** Shared lakes: the message protocol between the page and the AnglerLake Durable Object, lake instance sizes, crew seats, invite codes and the crowd count. Renderer-free so the Worker and the tests use it too. */
import type { BoatKind, BoatPaint } from './Boats'
import type { Look } from './Wardrobe'
import { lakeIds } from './Lakes'
import type { LakeId } from './Lakes'

/** Boats one lake instance fills before new arrivals go to the next instance. */
export const BOATS_PER_INSTANCE = 16
/** Hard connection cap per instance (boats plus invited crew). */
export const INSTANCE_CAPACITY = 40
export const INSTANCES_PER_LAKE = 8
/** Anglers per boat, captain included. */
export const CREW_SIZE = 4
/** Boats within this many metres count toward the crowd penalty. */
export const CROWD_RADIUS = 80
/** Boats within this many metres can be boarded without an invite code. */
export const BOARD_RADIUS = 18
export const POSITION_HZ = 4

export const PHASES = ['off', 'cast', 'wait', 'bite', 'fight', 'land', 'show', 'release', 'snap'] as const
export type RemotePhase = (typeof PHASES)[number]

export interface Gear {
  boat: BoatKind
  paint: BoatPaint
  look: Look
}

/** x, z, heading (radians), speed (m/s), anchored (0 or 1). */
export type Position = [number, number, number, number, number]

export interface PeerView {
  id: string
  name: string
  member: boolean
  gear: Gear
  pos: Position
  phase: RemotePhase
  /** Species and length (inches) while holding a fish up. */
  fish?: { species: string; length: number }
  /** Id of the captain whose boat this angler is on (their own id when captaining). */
  boat: string
  seat: number
  locked: boolean
}

export type ClientMessage =
  | { t: 'gear'; gear?: Gear }
  | { t: 'p'; d: Position }
  | { t: 'f'; phase: RemotePhase; fish?: { species: string; length: number } }
  | { t: 'board'; boat: string }
  | { t: 'leave' }
  | { t: 'lock'; locked: boolean }
  | { t: 'kick'; id: string }

export type ServerMessage =
  | { t: 'welcome'; id: string; lake: LakeId; instance: number; peers: PeerView[] }
  | { t: 'join'; peer: PeerView }
  | { t: 'gone'; id: string }
  | { t: 'gear'; id: string; gear: Gear }
  | { t: 'pos'; d: [string, ...Position][] }
  | { t: 'f'; id: string; phase: RemotePhase; fish?: { species: string; length: number } }
  | { t: 'seat'; id: string; boat: string; seat: number; pos: Position }
  | { t: 'lock'; id: string; locked: boolean }
  | { t: 'catch'; id: string; name: string; species: string; weight: number; length: number; tier: string }
  | { t: 'notice'; text: string }

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function peerCode(random: () => number): string {
  let out = ''
  for (let i = 0; i < 4; i++) out += CODE_CHARS[Math.floor(random() * CODE_CHARS.length) % CODE_CHARS.length]
  return out
}

/** Six characters for the library chat's room invites: lake digit, instance digit, then the captain's peer id. */
export function inviteCode(lake: LakeId, instance: number, boat: string): string {
  return `${lakeIds.indexOf(lake)}${instance}${boat}`
}

export function parseInvite(code: string): { lake: LakeId; instance: number; boat: string } | null {
  const m = /^([0-9])([0-9])([A-Z0-9]{4})$/.exec(code.trim().toUpperCase())
  if (!m) return null
  const lake = lakeIds[Number(m[1])]
  const instance = Number(m[2])
  if (!lake || instance >= INSTANCES_PER_LAKE) return null
  return { lake, instance, boat: m[3] }
}

export const instanceName = (lake: LakeId, instance: number) => `${lake}:${instance}`

/** First free seat on a boat (seat 0 is the captain's), or -1 when the boat is full. */
export function freeSeat(taken: number[]): number {
  for (let s = 1; s < CREW_SIZE; s++) if (!taken.includes(s)) return s
  return -1
}

/** How many other boats are fishing close enough to share the fish (the Catch rules turn it into 0.9^n activity). */
export function crowdAt(x: number, z: number, boats: { x: number; z: number }[]): number {
  let n = 0
  for (const b of boats) if (Math.hypot(b.x - x, b.z - z) < CROWD_RADIUS) n++
  return Math.min(16, n)
}
