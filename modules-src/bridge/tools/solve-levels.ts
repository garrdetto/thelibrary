import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { designCost, designProblem } from '../shared/Design'
import type { Level } from '../shared/Design'
import { LEVEL_COUNT, configCode, levelShape, referenceDesign } from '../shared/Levels'
import type { ReferenceConfig } from '../shared/Levels'
import { Sim } from '../shared/Sim'

const only = process.argv.slice(2).map(Number).filter(Boolean)
const results: string[] = []
for (let index = 1; index <= LEVEL_COUNT; index++) {
  if (only.length && !only.includes(index)) { results.push(''); continue }
  const shape = levelShape(index)
  const level = { ...shape, budget: 1e12 } as Level
  const configs: { code: string; cost: number; config: ReferenceConfig }[] = []
  for (const side of ['below', 'above', 'both'] as const) {
    for (const depth of [1, 2, 3, 4]) {
      for (const frame of shape.materials.includes('steel') ? ['wood', 'steel'] as const : ['wood'] as const) {
        for (const road of shape.materials.includes('heavy') ? ['road', 'heavy'] as const : ['road'] as const) {
          for (const brace of ['single', 'cross'] as const) {
            const config: ReferenceConfig = { side, depth, frame, road, brace }
            const design = referenceDesign(shape, config)
            if (designProblem(level, design)) continue
            const code = configCode(config)
            const cost = designCost(design)
            if (!configs.some(c => c.cost === cost && c.code.slice(1) === code.slice(1))) configs.push({ code, cost, config })
          }
        }
      }
    }
  }
  configs.sort((a, b) => a.cost - b.cost)
  let found = ''
  let tries = 0
  for (const c of configs) {
    tries++
    const sim = new Sim(level, referenceDesign(shape, c.config))
    const status = sim.run(200)
    if (status === 'passed' && sim.maxStress < 0.9) { found = c.code; console.log(index, shape.name, c.code, c.cost, `peak ${sim.maxStress.toFixed(2)}`, `tries ${tries}`); break }
  }
  if (!found) console.log(index, shape.name, 'NO SOLUTION', configs.length)
  results.push(found)
}
if (!only.length) writeFileSync(join(import.meta.dirname, '../shared/Reference.ts'), `export const REFERENCE: string[] = ${JSON.stringify(results)}\n`)
