/**
 * Repairs the Meshy golfer's skin weights in place (see `golfer-weights.ts` for why), so the replay swing no longer
 * drags trousers and shirt into sheets. Run it after `scripts/blender/gspro/fit-golf.py` whenever the golfer is replaced,
 * then `pnpm assets` to rebuild `public/models/gspro/golfer.glb`. Running it twice changes nothing.
 *
 *   pnpm exec tsx scripts/gspro/fix-golfer-weights.ts [assets-src/models/gspro/golfer.glb]
 */
import { readGolferSkin } from './golfer-skin'
import { repairGolferWeights } from './golfer-weights'

const path = process.argv[2] ?? 'assets-src/models/gspro/golfer.glb'
const golfer = await readGolferSkin(path)
if (!golfer.primitives.length) throw new Error(`${path} has no skinned mesh.`)
for (const { primitive, positions, indices, joints, weights } of golfer.primitives) {
  const result = repairGolferWeights({ positions, indices, joints, weights, boneNames: golfer.boneNames, bonePositions: golfer.bonePositions })
  const jointAccessor = primitive.getAttribute('JOINTS_0')!
  const weightAccessor = primitive.getAttribute('WEIGHTS_0')!
  jointAccessor.setArray(golfer.boneNames.length <= 256 ? Uint8Array.from(result.joints) : result.joints).setNormalized(false)
  weightAccessor.setArray(result.weights).setNormalized(false)
  const arms = result.labels.reduce((total, label) => total + (label === 0 ? 0 : 1), 0)
  console.log(`${path}: ${result.changedVertices} of ${positions.length / 3} vertices reweighted, ${result.filledVertices} refilled from neighbours, ${arms} on the arms`)
}
await golfer.io.write(path, golfer.document)
