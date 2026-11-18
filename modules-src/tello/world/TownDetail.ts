/**
 * Everything Montello's businesses, schools and parks add to the street scene, built in one pass: parking stripes,
 * curbs and lot lights (Lots.ts), the fuel stations, grocery, bars, club, sheriff's office and freight depot
 * (Businesses.ts), the school's buses and entrance (School.ts), and the ball diamonds, courts and track
 * (BallFields.ts), and the golf course (GolfCourse.ts). Loads the Blender places and fields kits once and writes into merged, chunked meshes.
 */
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Mats } from '../../foxlake/fp/core/Tex'
import type { TelloLand } from '../region'
import { buildBallFields, type FieldsBuilt } from './BallFields'
import { buildBusinesses, type BusinessesBuilt } from './Businesses'
import { buildGolf, type GolfBuilt } from './GolfCourse'
import { Decals } from './Decals'
import { KIT_URL, ModelKit } from './Kit'
import { buildLots, type LotsBuilt } from './Lots'
import { PlaceLayer, placeMats } from './PlaceLayer'
import { buildSchool, type SchoolBuilt } from './School'
import { Signs } from './Signs'
import type { StaticSink } from './Sink'

export interface TownDetail {
  lots: Omit<LotsBuilt, 'plans'>
  businesses: BusinessesBuilt
  school: SchoolBuilt
  fields: FieldsBuilt
  golf: GolfBuilt
  signs: number
}

export async function buildTownDetail(root: TransformNode, mats: Mats, sink: StaticSink, land: TelloLand): Promise<TownDetail> {
  const scene = root.getScene()
  const [places, fields] = await Promise.all([ModelKit.loadOnce(scene, KIT_URL.places), ModelKit.loadOnce(scene, KIT_URL.fields)])
  const M = placeMats(mats)
  const decals = new Decals(land)
  const layer = new PlaceLayer(places, M)
  const fieldLayer = new PlaceLayer(fields, M)
  const signs = new Signs()
  const lots = buildLots(decals, layer, sink, land)
  const businesses = buildBusinesses(layer, signs, sink, land)
  const school = buildSchool(layer, signs, sink, land, lots)
  const built = buildBallFields(decals, fieldLayer, sink, land)
  const golf = buildGolf(decals, fieldLayer, signs, sink, land)
  signs.build(mats, layer.chunks, 'tello-business-signs')
  layer.flush(root, 'tello-places')
  fieldLayer.flush(root, 'tello-fields')
  decals.flush(scene, root, 'tello-decal')
  return { lots: { lots: lots.lots, stalls: lots.stalls, lights: lots.lights }, businesses, school, fields: built, golf, signs: signs.count }
}
