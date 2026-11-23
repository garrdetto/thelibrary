import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NullEngine } from '@babylonjs/core/Engines/nullEngine'
import { Scene } from '@babylonjs/core/scene'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { MaterialLibrary } from '../render/Materials'
import { buildTruckVisual } from '../render/models/TruckVisual'
import { DESIGNS, LOOK_PRICES, TRUCKS, defaultLook, designLook, designOf, fitLook, lookCost, roofAllowed, skirtsAllowed } from '../shared/Catalog'
import type { TruckLook } from '../shared/Catalog'
import { defaultProfile, normalizeLook } from '../shared/Economy'
import { applyAction } from '../shared/Actions'
import { COUNTY } from '../shared/RoadGraph'

const IDS = ['factory', ...DESIGNS.map((design) => design.id)]

test('every design fits every truck, keeps its colours and is recognised again', () => {
  for (const model of TRUCKS) {
    const base = defaultLook(model)
    base.paint.primary = '#123456'
    base.paint.secondary = '#abcdef'
    for (const id of IDS) {
      const look = designLook(model, id, base)
      assert.equal(look.paint.primary, '#123456', `${model.id} ${id} primary`)
      assert.equal(look.paint.secondary, '#abcdef', `${model.id} ${id} secondary`)
      if (!roofAllowed(model)) assert.equal(look.roof, 'none', `${model.id} ${id} roof`)
      if (!skirtsAllowed(model)) assert.equal(look.skirts, false, `${model.id} ${id} skirts`)
      assert.notEqual(designOf(model, look), null, `${model.id} ${id} is a design`)
    }
    assert.equal(designOf(model, defaultLook(model)), 'factory', `${model.id} stock look is factory`)
    const stock = defaultLook(model)
    assert.equal(designOf(model, { ...stock, horn: stock.horn === 'air' ? 'stock' : 'air' }), null, `${model.id} custom look`)
  }
})

test('designs differ from each other on an aero semi', () => {
  const model = TRUCKS.find((truck) => truck.style === 'aero')!
  const looks = IDS.map((id) => JSON.stringify(designLook(model, id)))
  assert.equal(new Set(looks).size, IDS.length)
})

test('fitLook clears parts a dump truck or raised sleeper cannot carry', () => {
  const dump = TRUCKS.find((truck) => truck.style === 'dump')!
  const fitted = fitLook({ ...defaultLook(dump), roof: 'tall', skirts: true }, dump)
  assert.equal(fitted.roof, 'none')
  assert.equal(fitted.skirts, false)
  const raised = TRUCKS.find((truck) => truck.cab === 'raised')
  if (raised) {
    const look = fitLook({ ...defaultLook(raised), roof: 'low', skirts: true }, raised)
    assert.equal(look.roof, 'none')
    assert.equal(look.skirts, true)
  }
})

test('looks saved before grilles, roofs and skirts load with the stock parts', () => {
  for (const model of TRUCKS) {
    const old = JSON.parse(JSON.stringify(defaultLook(model))) as Record<string, unknown>
    delete old.grille
    delete old.roof
    delete old.skirts
    assert.deepEqual(normalizeLook(old, model), defaultLook(model), model.id)
  }
  const dump = TRUCKS.find((truck) => truck.style === 'dump')!
  const sneaky = normalizeLook({ ...defaultLook(dump), roof: 'tall', skirts: true, grille: 'nonsense' }, dump)
  assert.equal(sneaky.roof, 'none')
  assert.equal(sneaky.skirts, false)
  assert.equal(sneaky.grille, 'stock')
})

test('lookCost charges for grilles, roofs and skirts, and the dealer charges the design', () => {
  const model = TRUCKS.find((truck) => truck.style === 'aero' && roofAllowed(truck)) ?? TRUCKS.find((truck) => truck.style === 'aero')!
  const stock = defaultLook(model)
  assert.equal(lookCost(stock, { ...stock, grille: 'mesh' }), LOOK_PRICES.grille.mesh)
  if (roofAllowed(model)) {
    const roof: TruckLook = { ...stock, roof: stock.roof === 'tall' ? 'low' : 'tall' }
    assert.equal(lookCost(stock, roof), LOOK_PRICES.roof[roof.roof])
  }
  const skirts: TruckLook = { ...stock, skirts: !stock.skirts }
  assert.equal(lookCost(stock, skirts), skirts.skirts ? LOOK_PRICES.skirts : 200)
  assert.equal(lookCost(stock, designLook(model, 'factory', stock)), 0)
  for (const id of IDS) {
    const look = designLook(model, id, stock)
    const profile = { ...defaultProfile(), cash: 1_000_000, lot: 2 }
    const result = applyAction(profile, { action: 'buy-truck', model: model.id, look }, { now: 0, world: COUNTY })
    assert.equal(result.ok, true, id)
    assert.equal(result.delta, -(model.price + lookCost(stock, look)), `${id} price`)
    assert.deepEqual(result.profile.trucks.at(-1)!.look, look, `${id} saved`)
  }
})

test('every truck in every design builds and disposes back to the baseline', () => {
  const engine = new NullEngine()
  const scene = new Scene(engine)
  scene.useRightHandedSystem = true
  const parent = new TransformNode('frame-root', scene)
  const mats = new MaterialLibrary(scene)
  const count = () => ({ meshes: scene.meshes.length, nodes: scene.transformNodes.length, geometries: scene.geometries.length, materials: scene.materials.length, textures: scene.textures.length })
  for (const model of TRUCKS) {
    for (const id of IDS) buildTruckVisual(scene, parent, model, designLook(model, id), mats).dispose()
  }
  mats.trim(0)
  const baseline = count()
  for (let round = 0; round < 2; round++) {
    for (const model of TRUCKS) {
      for (const id of IDS) {
        const visual = buildTruckVisual(scene, parent, model, designLook(model, id), mats)
        assert.ok(visual.meshes.length > 5, `${model.id} ${id}`)
        for (const other of IDS) visual.setLook(designLook(model, other))
        visual.dispose()
      }
    }
    mats.trim(0)
    const now = count()
    assert.equal(now.meshes, baseline.meshes, `meshes round ${round}`)
    assert.equal(now.nodes, baseline.nodes, `nodes round ${round}`)
    assert.equal(now.geometries, baseline.geometries, `geometries round ${round}`)
    assert.equal(now.materials, baseline.materials, `materials round ${round}`)
    assert.equal(now.textures, baseline.textures, `textures round ${round}`)
  }
  mats.dispose()
  engine.dispose()
})
