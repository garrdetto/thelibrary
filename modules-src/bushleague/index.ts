/** Bush League Baseball entry: boots the shared engine with the tier's broadcast budget (AgX HDR output, post chain, cascaded shadows, adaptive resolution), builds the park, lights, crowd and grass for each contest, binds the screens and hands the contest to the Director; tears everything down on pagehide. */
import * as THREE from 'three/webgpu'
import { App, Input, applyEnvironment, createLighting, createPost, resolveQuality } from '../../engine'
import { createAdaptiveResolution } from '../_shared/adaptive-resolution.js'
import { config, type Action } from './config'
import { LIGHT_PRESETS, TIER_BUDGETS, themeFor, type TimeOfDay } from './looks'
import { Contest, parkById, stringSeed } from './sim'
import { Director, type Scenery } from './systems/Director'
import { Screens, type SetupChoice } from './ui/Screens'
import { Actors } from './view/Actors'
import { createCrowd, type Crowd } from './view/Crowd'
import { createField, type FieldView } from './view/Field'
import { createGrass, type GrassField } from './view/Grass'
import { createStadiumLights, type StadiumLights } from './view/Lights'

declare global {
  interface Window {
    __tlModule?: { app: App; backend: string; tier: string; steps: () => number }
    __bushleague?: { director: Director; start(choice?: Partial<SetupChoice>, seed?: number): Contest; contest(): Contest | null; tick(dt: number): void; scene(): { crowd: number; grass: number; post: boolean; cascades: number }; react(kind: 'homer' | 'final'): void }
  }
}

async function boot(): Promise<void> {
  const container = document.getElementById('stage')
  if (!container) throw new Error('Missing #stage')
  document.title = `${config.meta.title} · the library`
  document.documentElement.style.setProperty('--module-accent', config.meta.accent)

  const app = await App.create({ container, config: config.engine })
  const quality = resolveQuality(config.engine.quality, app.backend)
  const budget = TIER_BUDGETS[quality.tier]
  app.setPixelRatioCap(budget.pixelRatio)
  app.own(applyEnvironment(app.scene, config.engine.environment))
  const rig = app.own(createLighting(config.engine.lighting, quality.settings))
  app.graph.add('world', rig.root)
  rig.follow(new THREE.Vector3(0, 0, -55))
  const post = app.own(createPost(app, { ...config.engine.post, effects: budget.post ?? undefined }, { ...quality.settings, post: !!budget.post }))
  const adaptive = budget.adaptive ? createAdaptiveResolution({ max: budget.pixelRatio, min: 0.75, apply: (ratio) => app.setPixelRatioCap(ratio) }) : null

  const input = app.own(new Input<Action>(container, config.bindings, config.engine.input))
  const actors = new Actors(config.actors)
  app.graph.add('characters', actors.root)
  app.own(actors)
  const screens = new Screens()

  let field: FieldView | null = null
  let lights: StadiumLights | null = null
  let crowd: Crowd | null = null
  let grass: GrassField | null = null

  const dressPark = (contest: Contest, time: TimeOfDay) => {
    lights?.dispose()
    crowd?.dispose()
    grass?.dispose()
    field?.dispose()
    const home = contest.teams[1].roster.team
    const away = contest.teams[0].roster.team
    const theme = themeFor(contest.park.id)
    field = createField(contest.park, config.field, theme, home, away)
    app.graph.add('world', field.root)
    lights = createStadiumLights(app, rig, budget, field.towers, field.lampMaterial)
    const preset = LIGHT_PRESETS[time]
    lights.setPreset(preset)
    if (theme.fogTint && app.scene.fog) (app.scene.fog as THREE.Fog).color.lerp(new THREE.Color(theme.fogTint), 0.35)
    field.signature?.setTimeOfDay(time)
    crowd = createCrowd(field.bowl, budget.crowd, home.colors, away.colors, contest.setup.seed)
    if (crowd) app.graph.add('props', crowd.mesh)
    grass = createGrass(contest.park, budget.grassBlades, theme.grass[0], theme.grass[1], contest.setup.seed)
    if (grass) app.graph.add('props', grass.mesh)
  }

  const scenery: Scenery = {
    excite: (level) => crowd?.excite(level),
    startWave: () => crowd?.startWave(),
    celebrate: (kind) => field?.celebrate(kind),
    scuff: (x, z, radius, strength, angle, length) => field?.dirt.scuff(x, z, radius, strength, angle, length),
  }

  const director = new Director(
    app,
    input,
    actors,
    screens,
    config,
    {
      onContest(contest, choice) {
        dressPark(contest, choice.time)
      },
      onFinal() {
        screens.setHint('')
      },
    },
    scenery,
  )
  const preview = new Contest({ seed: 1, away: 'sal', home: 'frt', innings: 3, dh: true, autoRunner: true, mercy: false, park: parkById('outhouse').id })
  dressPark(preview, 'night')
  actors.bind(preview)
  actors.setScene(preview, 'R')

  let seed = stringSeed(`${Date.now()}`) % 1_000_000
  const start = (choice: SetupChoice, customSeed?: number) => {
    screens.showSetup(false)
    screens.hideFinal()
    seed = customSeed ?? seed + 1
    return director.start(choice, seed)
  }
  screens.bindSetup((choice) => start(choice))
  screens.showSetup(true)
  document.getElementById('rematch-button')?.addEventListener('click', () => {
    screens.hideFinal()
    director.rematch()
  })
  document.getElementById('new-button')?.addEventListener('click', () => {
    screens.hideFinal()
    screens.showSetup(true)
    director.stage = 'idle'
  })

  let frames = 0
  const tick = (dt: number) => {
    director.update(dt)
    actors.update(dt)
    field?.update(dt)
    crowd?.update(dt)
    lights?.update(dt)
  }
  app.onFrame((frameSeconds) => {
    frames++
    tick(Math.min(frameSeconds, 0.1))
    adaptive?.update(frameSeconds)
  })
  app.start()

  window.__tlModule = { app, backend: app.backend, tier: quality.tier, steps: () => frames }
  window.__bushleague = {
    director,
    start: (choice = {}, customSeed) => start({ team: 'frt', opponent: 'sal', side: 'watch', innings: 3, pace: 'rookie', dh: true, autoRunner: true, mercy: false, time: 'night', trail: true, ...choice }, customSeed),
    contest: () => director.contest,
    tick,
    scene: () => ({ crowd: crowd?.mesh.count ?? 0, grass: grass?.mesh.count ?? 0, post: post.enabled, cascades: budget.cascades }),
    react: (kind: 'homer' | 'final') => {
      scenery.celebrate(kind)
      scenery.excite(1)
    },
  }
  addEventListener(
    'pagehide',
    () => {
      director.dispose()
      lights?.dispose()
      crowd?.dispose()
      grass?.dispose()
      field?.dispose()
      app.dispose()
    },
    { once: true },
  )
}

boot().catch((error: unknown) => {
  const stage = document.getElementById('stage')
  if (stage) stage.textContent = 'This learning module could not start on this device.'
  console.error(error)
})
