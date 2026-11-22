import { test } from 'node:test'
import assert from 'node:assert/strict'
import { beamProblem, designCost, designProblem, levelPoints, starsFor } from '../shared/Design'
import type { Beam } from '../shared/Design'
import { CHAPTERS, LEVEL_COUNT, getLevel } from '../shared/Levels'
import { REFERENCE } from '../shared/Reference'
import { Sim } from '../shared/Sim'
import { Editor } from '../ui/Editor'

test('there are 100 levels in ten chapters with unique names', () => {
  assert.equal(LEVEL_COUNT, 100)
  assert.equal(CHAPTERS.length, 10)
  assert.equal(REFERENCE.length, 100)
  const names = new Set<string>()
  for (let i = 1; i <= LEVEL_COUNT; i++) {
    const level = getLevel(i)
    assert.ok(level.name && !names.has(level.name), `level ${i} name`)
    names.add(level.name)
    assert.ok(level.budget > 0)
    assert.ok(level.vehicles.length >= 1)
    assert.ok(level.anchors.some(([x, y]) => x === 0 && y === 0) && level.anchors.some(([x, y]) => x === level.span && y === 0))
  }
})

test('materials unlock along the way', () => {
  assert.deepEqual(getLevel(1).materials.sort(), ['road', 'wood'])
  assert.ok(getLevel(11).materials.includes('steel'))
  assert.ok(getLevel(21).materials.includes('cable'))
  assert.ok(getLevel(31).materials.includes('heavy'))
})

test('beams run flat, at 45 degrees or at 90 degrees', () => {
  const level = getLevel(12)
  const beam = (x1: number, y1: number, x2: number, y2: number, m: Beam['m'] = 'wood'): Beam => ({ x1, y1, x2, y2, m })
  assert.equal(beamProblem(level, beam(1, 0, 2, 0)), null)
  assert.equal(beamProblem(level, beam(1, 0, 2, 1)), null)
  assert.equal(beamProblem(level, beam(1, 0, 1, 2)), null)
  assert.match(beamProblem(level, beam(1, 0, 3, 1)) ?? '', /45/)
  assert.match(beamProblem(level, beam(1, 0, 4, 0)) ?? '', /2 squares/)
  assert.match(beamProblem(level, beam(1, 0, 2, 1, 'road')) ?? '', /flat/)
  assert.match(beamProblem(getLevel(3), beam(1, 0, 2, 1, 'steel')) ?? '', /isn't available/)
})

test('the ship channel stays clear', () => {
  const level = getLevel(31)
  assert.ok(level.zones.length)
  const zone = level.zones[0]
  const x = zone.x1 + 1
  assert.match(beamProblem(level, { x1: x, y1: 0, x2: x, y2: -1, m: 'wood' }) ?? '', /channel/)
  assert.equal(beamProblem(level, { x1: x, y1: 0, x2: x, y2: 1, m: 'wood' }), null)
})

test('a long beam is split where it passes an existing joint', () => {
  const level = getLevel(4)
  const editor = new Editor(level)
  editor.place(editor.plan([0, 0], 1, 0, 'road'))
  const plan = editor.plan([0, 0], 2, 0, 'road')
  assert.equal(plan.problem, null)
  assert.equal(plan.beams.length, 2)
  assert.deepEqual(plan.beams.map(b => [b.x1, b.x2]), [[0, 1], [1, 2]])
})

test('a beam that ends on the middle of a long beam joins it there', () => {
  const editor = new Editor(getLevel(2))
  editor.place(editor.plan([0, 0], 2, 0, 'road'))
  assert.equal(editor.beams.length, 1)
  editor.place(editor.plan([0, -1], 1, 0, 'wood'))
  assert.equal(editor.beams.length, 3)
  assert.ok(editor.beams.some(b => b.m === 'road' && b.x1 === 0 && b.x2 === 1))
  assert.ok(editor.beams.some(b => b.m === 'road' && b.x1 === 1 && b.x2 === 2))
})

test('stars and points follow the budget', () => {
  const level = getLevel(10)
  assert.equal(starsFor(level, level.budget + 1), 0)
  assert.equal(starsFor(level, level.budget), 1)
  assert.equal(starsFor(level, level.budget * 0.9), 2)
  assert.equal(starsFor(level, level.budget * 0.8), 3)
  assert.equal(levelPoints(level, level.budget * 0.5), 350)
})

test('a bare road with no supports collapses', () => {
  const level = getLevel(4)
  const beams: Beam[] = Array.from({ length: level.span }, (_, x) => ({ x1: x, y1: 0, x2: x + 1, y2: 0, m: 'road' }))
  assert.equal(designProblem(level, { beams }), null)
  const sim = new Sim(level, { beams })
  assert.equal(sim.run(60), 'failed')
  assert.ok(sim.breaks > 0)
})

test('a gap in the road drops the vehicle', () => {
  const level = getLevel(1)
  const sim = new Sim(level, { beams: [{ x1: 0, y1: 0, x2: 1, y2: 0, m: 'road' }] })
  assert.equal(sim.run(60), 'failed')
})

test('a single long road plank carries the first car', () => {
  const level = getLevel(1)
  const design = { beams: [{ x1: 0, y1: 0, x2: 2, y2: 0, m: 'road' as const }] }
  assert.ok(designCost(design) <= level.budget)
  assert.equal(new Sim(level, design).run(60), 'passed')
})
