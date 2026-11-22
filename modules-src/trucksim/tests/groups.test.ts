import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CG as LifeSimCG, MASK as LifeSimMask } from '../../foxlake/fp/physics/Physics'
import { CG, MASK } from '../sim/PhysicsHost'

test('collision groups match Life Sim so trucks can join its town physics', () => {
  assert.deepEqual(CG, LifeSimCG)
  assert.equal(MASK.vehicle, LifeSimMask.vehicle)
  assert.equal(MASK.trailer, LifeSimMask.trailer)
  assert.equal(MASK.wheelRay, LifeSimMask.wheelRay)
  assert.equal(MASK.ground, LifeSimMask.ground)
  assert.equal(MASK.static, LifeSimMask.static)
})
