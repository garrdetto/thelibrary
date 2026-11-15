/**
 * Where Fox Lake's two frames sit. Fox Lake is Montello, Wisconsin: Tello's baked map of the real city and the country
 * three miles round it. Rack & Reel's Bear Paw Lake country still stands in its 1024 m square around the scene's
 * origin (its game needs one), sealed by its rim of hills and switched off, and Montello lies far from it, so none of
 * the lake country is ever drawn. The lake gameplay itself runs on Lake Montello (`lake/LakeSite.ts`).
 *
 *   scene  x east, z north, left-handed like every Babylon scene; Montello's map is placed with its middle at
 *          `MONTELLO_AT`, and its heights are moved down so Lake Montello's surface is y = 0 (`lake/Rebase.ts`)
 *   town   the shared world's frame: right-handed, (map.x, y, -map.z), what the Fox Plains builders, the Rapier cars
 *          and every number the shared world sends use; it hangs under a root node at `TOWN_OFFSET` that mirrors z
 *
 *   scene.x = town.x + TOWN_OFFSET.x
 *   scene.y = town.y + TOWN_OFFSET.y
 *   scene.z = TOWN_OFFSET.z - town.z
 *
 * `scripts/montello-places.mjs` keeps its own copy of both constants and a test keeps them equal.
 */
export const TOWN_OFFSET = { x: -4200, y: 0, z: -6600 } as const

/**
 * Where the middle of Montello's baked frame lies in the scene. The frame's middle is map (-408, 492), so the map's
 * origin (City Hall) is at `TOWN_OFFSET`'s x and z, about 7.8 km from Rack & Reel's square: the land Montello draws is
 * more than 1.2 km clear of the square on every side (a test checks it).
 */
export const MONTELLO_AT = { x: -4608, z: -6108 } as const

export interface XYZ {
  x: number
  y: number
  z: number
}

export function townToScene(x: number, y: number, z: number, out: XYZ = { x: 0, y: 0, z: 0 }): XYZ {
  out.x = x + TOWN_OFFSET.x
  out.y = y + TOWN_OFFSET.y
  out.z = TOWN_OFFSET.z - z
  return out
}

export function sceneToTown(x: number, y: number, z: number, out: XYZ = { x: 0, y: 0, z: 0 }): XYZ {
  out.x = x - TOWN_OFFSET.x
  out.y = y - TOWN_OFFSET.y
  out.z = TOWN_OFFSET.z - z
  return out
}

/** A heading (Rack & Reel: forward is (sin h, cos h) in the scene) from a town yaw (forward is (sin y, cos y) in the town), and back. */
export function townYawToHeading(yaw: number): number {
  return wrapAngle(Math.PI - yaw)
}

export function headingToTownYaw(heading: number): number {
  return wrapAngle(Math.PI - heading)
}

export function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a))
}

/** Names of the lake country's own meshes (the sealed square), switched off for good by `RegionCuller`. */
export const LAKE_COUNTRY_MESHES = /^(terrain|water|dock|highway|bridge|weed|cabin|boat|bowboat|utv|treestand|boxblind|deer|bear|antlers|fish-|wildman|wild-|fx-)/

/** The square's reach round the origin that holds those meshes. */
export const LAKE_COUNTRY_REACH = 760
