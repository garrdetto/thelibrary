/** Template entry: boots the shared engine, builds the scene from models/, wires input, physics and HUD, and tears everything down on pagehide. */
import { App, Hud, Input, PhysicsWorld, applyEnvironment, createLighting, createPost, resolveQuality } from '../../engine'
import { config, type Action } from './config'
import { createCrate } from './models/Crate'
import { createGround } from './models/Ground'

declare global {
  interface Window {
    __tlModule?: { app: App; backend: string; tier: string; steps: () => number }
  }
}

async function boot(): Promise<void> {
  const container = document.getElementById('stage')
  if (!container) throw new Error('Missing #stage')
  document.title = `${config.meta.title} · the library`

  const app = await App.create({ container, config: config.engine })
  const quality = resolveQuality(config.engine.quality, app.backend)
  app.setPixelRatioCap(quality.settings.pixelRatioCap)
  app.own(applyEnvironment(app.scene, config.engine.environment))
  const lighting = app.own(createLighting(config.engine.lighting, quality.settings))
  app.graph.add('world', lighting.root)
  app.own(createPost(app, config.engine.post, quality.settings))

  const input = app.own(new Input<Action>(container, config.bindings, config.engine.input))
  const hud = app.own(new Hud(config.engine.hud, config.meta.accent))
  const physics = app.own(await PhysicsWorld.create(config.engine.physics))
  const { rapier, world } = physics

  const ground = app.graph.add('world', createGround(config.ground))
  const half = config.ground.size / 2
  world.createCollider(
    rapier.ColliderDesc.cuboid(half, config.ground.thickness / 2, half).setTranslation(0, ground.position.y, 0),
  )

  const crate = app.graph.add('props', createCrate(config.crate))
  const body = world.createRigidBody(
    rapier.RigidBodyDesc.dynamic()
      .setTranslation(...config.crate.spawn)
      .setLinearDamping(config.control.linearDamping)
      .setAngularDamping(config.control.angularDamping),
  )
  const crateHalf = config.crate.size / 2
  world.createCollider(rapier.ColliderDesc.cuboid(crateHalf, crateHalf, crateHalf).setMass(config.crate.mass), body)
  physics.track(body)

  const status = hud.panel('top-left', config.meta.title)
  hud.stat(status, 'Renderer', app.backend === 'webgpu' ? 'WebGPU' : 'WebGL2')
  hud.stat(status, 'Quality', quality.tier)
  const showRate = hud.stat(status, 'Frame rate', '–')
  hud.panel('bottom-left').textContent = config.hud.controlsHint

  let steps = 0
  app.onFixed((dt) => {
    input.update()
    const push = config.control.pushImpulse
    const x = input.axis('left', 'right') * push
    const z = input.axis('forward', 'back') * push
    if (x || z) body.applyImpulse({ x, y: 0, z }, true)
    if (input.pressed('jump')) body.applyImpulse({ x: 0, y: config.control.jumpImpulse, z: 0 }, true)
    if (input.pressed('debug')) physics.setDebug(physics.debugEnabled ? null : app.graph.layer('fx'))
    physics.step(dt)
    if (body.translation().y < config.crate.respawnBelow) {
      body.setTranslation({ x: config.crate.spawn[0], y: config.crate.spawn[1], z: config.crate.spawn[2] }, true)
      body.setLinvel({ x: 0, y: 0, z: 0 }, true)
      physics.track(body)
    }
    steps++
  })

  app.onFrame((_, alpha) => {
    physics.syncMesh(body, crate, alpha)
    lighting.follow(crate.position)
    showRate(app.frameRate ? `${app.frameRate} fps` : '–')
  })

  app.start()
  window.__tlModule = { app, backend: app.backend, tier: quality.tier, steps: () => steps }
  addEventListener('pagehide', () => app.dispose(), { once: true })
}

boot().catch((error: unknown) => {
  const stage = document.getElementById('stage')
  if (stage) stage.textContent = 'This learning module could not start on this device.'
  console.error(error)
})
