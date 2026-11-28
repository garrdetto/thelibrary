import { test } from 'node:test'
import assert from 'node:assert/strict'
import { snapshotSchema } from '../sim/files'
import { hardpointsSchema } from '../sim/hardpoints'
import { INPUT_IDS } from '../sim/inputs'
import fixture from './fixtures/page-parity.json'

type Case = { inputs: Record<string, string>; adj: Record<string, Record<string, number>>; radj: Record<string, number>; hp: unknown }
const fx = fixture as unknown as { hp0: unknown; cases: Case[] }

test('the account keeps every input of a setup saved by the original page (string values, NaN summaries)', () => {
  const c = fx.cases[fx.cases.length - 1]
  const page = { name: 'Heavy track, 3 in stagger', inputs: c.inputs, adj: c.adj, radj: c.radj, out: JSON.parse(JSON.stringify({ roll: 1.2, lltd: NaN, cross: 52, LF: 700 })) }
  const body = JSON.stringify({ action: 'save', setup: page })
  assert.ok(body.length < 64_000, 'fits the route body limit')
  const saved = snapshotSchema.parse(JSON.parse(body).setup)
  assert.deepEqual(Object.keys(c.inputs).sort(), [...INPUT_IDS].sort(), 'the page has exactly the inputs the account accepts')
  for (const [id, v] of Object.entries(c.inputs)) if (v !== '') assert.equal(saved.inputs[id], Number(v), id)
  assert.deepEqual(saved.adj, c.adj)
  assert.deepEqual(saved.radj, c.radj)
  assert.equal(saved.out?.lltd, null)
})

test('the account keeps the page\'s hardpoints as loaded (corners with shock points, rear with the J-Bar)', () => {
  for (const hp of [fx.hp0, ...fx.cases.map(c => c.hp).filter(Boolean)]) {
    const kept = hardpointsSchema.parse(JSON.parse(JSON.stringify(hp)))
    assert.deepEqual(kept, hp)
  }
})
