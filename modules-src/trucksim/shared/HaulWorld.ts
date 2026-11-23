/**
 * The world jobs are drawn from: its sites, their work zones, its truck lots and how far a truck drives between two zones. The county
 * (`shared/WorldLayout.ts` + `shared/RoadGraph.ts`) is the first; Life Sim can supply Montello's places as another, and jobs,
 * procedures and pay work the same in both because nothing in `shared/Jobs.ts` or `game/Procedures.ts` reads the county
 * constants directly.
 */
import type { RoutePath } from './RoadGraph'
import type { LotSpec, Site, Zone, ZoneKind } from './WorldLayout'

export interface HaulWorld {
  /** Stable id, part of every job id and the server profile key (`county`, later `montello`). */
  readonly id: string
  readonly sites: readonly Site[]
  readonly zones: readonly Zone[]
  /** The player truck lots, each with its own `index` (unique across every world). */
  readonly lots: readonly LotSpec[]
  lot(index: number): LotSpec | undefined
  zone(id: string): Zone | undefined
  site(id: string): Site | undefined
  zonesOfKind(kind: ZoneKind): Zone[]
  /** Metres a truck drives from one zone to another on the road network. */
  routeDistance(from: Zone, to: Zone): number
  /** The drive between two points on this world's roads (the GPS line). */
  route(fromX: number, fromZ: number, toX: number, toZ: number): RoutePath
}
