export type Handed = 'RH' | 'LH'

export type ShotSource = 'bridge' | 'csv' | 'test'

/** One stored shot, normalized to mph, yards, degrees, rpm and millimetres. Positive angles point right of target. */
export type GsproShot = {
  id: number
  sessionId: string
  createdAt: number
  source: ShotSource
  club: string | null
  handed: Handed
  ballSpeed: number
  launch: number
  direction: number
  totalSpin: number
  spinAxis: number
  carry: number | null
  clubSpeed: number | null
  attackAngle: number | null
  path: number | null
  face: number | null
  dynamicLoft: number | null
  lie: number | null
  impactH: number | null
  impactV: number | null
  excluded: boolean
}

export type GsproSession = {
  id: string
  label: string
  source: ShotSource
  startedAt: number
  lastShotAt: number
  shotCount: number
  open: boolean
}

export type BridgeStatus = {
  hasKey: boolean
  keyHint: string | null
  createdAt: number | null
  lastSeenAt: number | null
  version: string | null
  gsproConnected: boolean
  monitorConnected: boolean
  queued: number
  listen: string | null
}

/** Shot fields sent by the bridge or a CSV import before the server stores them. */
export type ShotInput = {
  ref: string
  at: number
  club: string | null
  handed: Handed
  ballSpeed: number
  launch: number
  direction: number
  totalSpin: number
  spinAxis: number
  carry: number | null
  clubSpeed: number | null
  attackAngle: number | null
  path: number | null
  face: number | null
  dynamicLoft: number | null
  lie: number | null
  impactH: number | null
  impactV: number | null
}
