import { test } from 'node:test'
import assert from 'node:assert/strict'
import { designCost, designProblem } from '../shared/Design'
import { getLevel, referenceFor } from '../shared/Levels'
import { Sim } from '../shared/Sim'

for (let index = 1; index <= 25; index++) {
  test(`level ${index} can be solved within budget`, () => {
    const level = getLevel(index)
    const design = referenceFor(index)
    assert.equal(designProblem(level, design), null)
    assert.ok(designCost(design) < level.budget)
    const sim = new Sim(level, design)
    assert.equal(sim.run(200), 'passed', sim.reason)
    assert.equal(sim.breaks, 0)
  })
}
