import { z } from 'zod'
import { BUILDING_KINDS, EDIT_LIMITS, LIGHT_STYLES, WALL_STYLES, WORLD_EDITS_VERSION, WORLD_ID } from '../../modules-src/tello/edits/WorldEdits'
import type { WorldEdits } from '../../modules-src/tello/edits/WorldEdits'
import { ROOF } from '../../modules-src/tello/data/MapData'

export const WORLD_COORD_LIMIT = 9000
const YAW_LIMIT = 100
const BUILDING_SIDE_LIMIT = 600
const ID_LIST_LIMIT = EDIT_LIMITS.pts
const SEED_LIMIT = Number.MAX_SAFE_INTEGER
const TIME_LIMIT = 8.64e15

const roofValues = Object.values(ROOF) as number[]
const roofMin = Math.min(...roofValues)
const roofMax = Math.max(...roofValues)

export const worldEditIdPattern = /^[A-Za-z0-9:_-]{1,64}$/

const range = (min: number, max: number) => z.number().min(min).max(max)
const coord = range(-WORLD_COORD_LIMIT, WORLD_COORD_LIMIT)
const height = range(EDIT_LIMITS.minHeight, EDIT_LIMITS.maxHeight)
const radius = range(0, EDIT_LIMITS.radius)
const falloff = range(0, EDIT_LIMITS.falloff)
const width = range(0, EDIT_LIMITS.width)
const yaw = range(-YAW_LIMIT, YAW_LIMIT)
const editId = z.string().regex(worldEditIdPattern, 'Use 1 to 64 letters, numbers, colons, dashes or underscores.')
const idList = z.array(editId).max(ID_LIST_LIMIT)
const name = z.string().max(EDIT_LIMITS.name)
const colour = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Colours are #rrggbb.')
const flat = z.array(coord).max(EDIT_LIMITS.pts).refine(points => points.length % 2 === 0, 'Points come in x, z pairs.')
const roadKind = z.literal([0, 1, 2, 3, 4, 5])
const buildingKind = z.enum(BUILDING_KINDS)
const roof = z.number().int().min(roofMin).max(roofMax)
const curveFit = z.enum(['arcs', 'spline'])

const shape = z.discriminatedUnion('k', [
  z.object({ k: z.literal('path'), pts: flat, r: radius }),
  z.object({ k: z.literal('area'), ring: flat }),
])

const opBase = {
  id: editId,
  ts: z.number().int().min(0).max(TIME_LIMIT),
  on: z.boolean().optional(),
  note: z.string().max(EDIT_LIMITS.note).optional(),
}

const terrainOp = z.object({
  ...opBase,
  type: z.literal('terrain'),
  mode: z.enum(['raise', 'lower', 'flatten', 'smooth', 'grade', 'noise']),
  shape,
  falloff,
  amount: range(-EDIT_LIMITS.amount, EDIT_LIMITS.amount).optional(),
  height: height.optional(),
  heights: z.array(height).max(EDIT_LIMITS.pts / 2).optional(),
  strength: range(0, 1).optional(),
  size: radius.optional(),
  carry: z.boolean().optional(),
})

const waterOp = z.object({
  ...opBase,
  type: z.literal('water'),
  mode: z.enum(['fill', 'level', 'paint', 'drain']),
  at: z.tuple([coord, coord]).optional(),
  level: height.optional(),
  shape: shape.optional(),
  dig: range(0, EDIT_LIMITS.amount).optional(),
  fill: z.boolean().optional(),
})

const riverOp = z.object({
  ...opBase,
  type: z.literal('river'),
  pts: flat,
  curve: radius,
  fit: curveFit.optional(),
  w: falloff,
  depth: range(0, EDIT_LIMITS.amount),
  bank: falloff,
  levels: z.tuple([height, height]),
})

const sidewalks = z.object({ left: z.boolean(), right: z.boolean(), w: width, gap: width })
const grading = z.object({ shoulder: width, falloff, smooth: radius })

const roadOp = z.object({
  ...opBase,
  type: z.literal('road'),
  pts: flat,
  curve: radius,
  fit: curveFit.optional(),
  w: width,
  k: roadKind,
  n: name,
  walk: sidewalks.nullable().optional(),
  grade: grading.nullable().optional(),
  replaces: idList.optional(),
})

const roadRemoveOp = z.object({ ...opBase, type: z.literal('roadRemove'), ids: idList })

const roadSetOp = z.object({
  ...opBase,
  type: z.literal('roadSet'),
  ref: editId,
  w: width.optional(),
  k: roadKind.optional(),
  n: name.optional(),
})

const buildingRemoveOp = z.object({ ...opBase, type: z.literal('buildingRemove'), ids: idList })

const buildingSetOp = z.object({
  ...opBase,
  type: z.literal('buildingSet'),
  ref: editId,
  k: buildingKind.optional(),
  h: height.optional(),
  ridge: height.optional(),
  roof: roof.optional(),
  rc: colour.optional(),
  n: name.optional(),
  dx: coord.optional(),
  dz: coord.optional(),
  yaw: yaw.optional(),
  f: height.optional(),
})

const buildingOp = z.object({
  ...opBase,
  type: z.literal('building'),
  x: coord,
  z: coord,
  w: range(0, BUILDING_SIDE_LIMIT),
  d: range(0, BUILDING_SIDE_LIMIT),
  yaw,
  k: buildingKind,
  h: height,
  ridge: height,
  roof,
  rc: colour.optional(),
  n: name.optional(),
  level: z.boolean().optional(),
})

const lotOp = z.object({
  ...opBase,
  type: z.literal('lot'),
  ring: flat,
  n: name.optional(),
  stripes: z.boolean().optional(),
  f: height.optional(),
})

const lotRemoveOp = z.object({ ...opBase, type: z.literal('lotRemove'), ids: idList })

const lotSetOp = z.object({
  ...opBase,
  type: z.literal('lotSet'),
  ref: editId,
  ring: flat.optional(),
  f: height.optional(),
  n: name.optional(),
  stripes: z.boolean().optional(),
})

const lotClipOp = z.object({
  ...opBase,
  type: z.literal('lotClip'),
  ids: z.union([idList, z.literal('all')]),
  margin: width,
})

const treeWeight = range(0, 100)
const treeHeight = range(0, EDIT_LIMITS.treeHeight)

const treesOp = z.object({
  ...opBase,
  type: z.literal('trees'),
  mode: z.enum(['add', 'remove']),
  shape,
  density: range(0, EDIT_LIMITS.density).optional(),
  mix: z.tuple([treeWeight, treeWeight, treeWeight]).optional(),
  height: z.tuple([treeHeight, treeHeight]).optional(),
  seed: range(-SEED_LIMIT, SEED_LIMIT).optional(),
  floor: z.boolean().optional(),
})

const railOp = z.object({
  ...opBase,
  type: z.literal('rail'),
  pts: flat,
  side: z.union([z.literal(-1), z.literal(1)]),
})

const railCutOp = z.object({ ...opBase, type: z.literal('railCut'), shape })

const lightsOp = z.object({
  ...opBase,
  type: z.literal('lights'),
  style: z.enum(LIGHT_STYLES),
  pts: flat,
  yaw: z.array(yaw).max(EDIT_LIMITS.pts / 2),
  h: range(0, EDIT_LIMITS.lightHeight),
})

const lightCutOp = z.object({ ...opBase, type: z.literal('lightCut'), shape })

const wallOp = z.object({
  ...opBase,
  type: z.literal('wall'),
  pts: flat,
  h: range(0, EDIT_LIMITS.wallHeight),
  th: range(0, EDIT_LIMITS.wallHeight),
  style: z.enum(WALL_STYLES),
  posts: falloff,
  cap: z.boolean(),
  closed: z.boolean().optional(),
})

export const editOpSchema = z.discriminatedUnion('type', [
  terrainOp, waterOp, riverOp,
  roadOp, roadRemoveOp, roadSetOp,
  buildingOp, buildingRemoveOp, buildingSetOp,
  lotOp, lotRemoveOp, lotSetOp, lotClipOp,
  treesOp, railOp, railCutOp, lightsOp, lightCutOp, wallOp,
])

export const worldEditsSchema = z.object({
  v: z.literal(WORLD_EDITS_VERSION),
  world: z.literal(WORLD_ID),
  base: z.string().max(64).optional(),
  ops: z.array(editOpSchema).max(EDIT_LIMITS.ops),
})

export type WorldEditsInput = z.infer<typeof worldEditsSchema>

export type WorldEditsCheck = { ok: true; edits: WorldEdits } | { ok: false; error: string }

export function describeWorldEditsIssue(error: z.ZodError): string {
  const issue = error.issues[0]
  if (!issue) return 'The world edits are not valid.'
  const [head, index, ...rest] = issue.path
  if (head === 'ops' && typeof index === 'number') return `Edit ${index + 1}${rest.length ? ` (${rest.join('.')})` : ''}: ${issue.message}`
  return `${issue.path.length ? issue.path.join('.') : 'The document'}: ${issue.message}`
}

export function checkWorldEdits(input: unknown): WorldEditsCheck {
  const result = worldEditsSchema.safeParse(input)
  if (!result.success) return { ok: false, error: describeWorldEditsIssue(result.error) }
  const edits: WorldEdits = result.data
  return { ok: true, edits }
}
