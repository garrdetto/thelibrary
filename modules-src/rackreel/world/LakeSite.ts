export interface SitePoint {
  x: number
  z: number
}

export interface StandPlan {
  kind: 'ladder' | 'blind'
  x: number
  z: number
  heading: number
}

/**
 * Where a host world puts the lake gameplay when it is not Bear Paw Lake (Fox Lake: Lake Montello). The dock, the boat,
 * the UTV and the player's start are on the water's edge; `lake` shapes Wild Man's loops (a centre and, for each angle,
 * how far the shore is from it); `stands` are the hunting stands and `wild` says where deer and bear may be.
 */
export interface LakeSiteConfig {
  dock: { start: SitePoint; end: SitePoint; heading: number }
  spawn: SitePoint
  spawnHeading: number
  boat: SitePoint
  boatHeading: number
  utv: SitePoint
  utvHeading: number
  lake: { center: SitePoint; radius(angle: number): number }
  stands: StandPlan[]
  wild(x: number, z: number): boolean
}
