// Deterministic Thrill Park test scene for graphics screenshots and in-park perf runs.
// Used by scripts/park-shots.mjs (in the browser through the Vite dev server) and runnable in Node:
//   node scripts/park-scene.mjs   prints what was built
export function buildScene(m) {
  const s = m.createPark('sandbox')
  const log = []
  const run = (cmd) => { const r = m.applyCommand(s, cmd, 0); log.push([cmd.t, cmd.ride ?? cmd.preset ?? cmd.kind ?? '', r.ok ? 'ok' : r.error]); return r }
  run({ t: 'park', name: 'Graphics Test Park' })
  for (let y = 36; y <= 91; y += 20) for (let x = 36; x <= 91; x += 20) run({ t: 'clear', x0: x, y0: y, x1: Math.min(91, x + 19), y1: Math.min(91, y + 19) })
  run({ t: 'path', kind: 1, x0: 64, y0: 64, x1: 64, y1: 90 }); run({ t: 'path', kind: 1, x0: 64, y0: 44, x1: 64, y1: 63 })
  run({ t: 'path', kind: 1, x0: 40, y0: 66, x1: 63, y1: 66 }); run({ t: 'path', kind: 1, x0: 65, y0: 66, x1: 88, y1: 66 }); run({ t: 'path', kind: 1, x0: 40, y0: 77, x1: 52, y1: 77 })
  for (let y = 50; y <= 88; y += 6) { run({ t: 'pathAdd', x: 64, y, add: 3 }); run({ t: 'pathAdd', x: 64, y: y + 2, add: 1 }) }
  for (let x = 44; x <= 86; x += 7) run({ t: 'pathAdd', x, y: 66, add: 3 })
  const coaster = run({ t: 'preset', preset: 'coilSpring', x: 42, y: 50, dir: 0 })
  let wooden = { id: 0 }
  for (const [x, y, dir] of [[70, 38, 0], [72, 50, 1], [68, 40, 1], [76, 52, 1], [78, 38, 1], [70, 52, 3], [88, 40, 1], [88, 52, 2]]) { const r = m.applyCommand(s, { t: 'preset', preset: 'knotHollow', x, y, dir }, 0); if (r.ok) { wooden = r; log.push(['preset', 'knotHollow', 'ok', x, y, dir]); break } }
  run({ t: 'flat', ride: 'ferris', x: 58, y: 70, rot: 0 })
  run({ t: 'flat', ride: 'carousel', x: 67, y: 70, rot: 0 })
  run({ t: 'flat', ride: 'topSpin', x: 58, y: 61, rot: 0 })
  run({ t: 'flat', ride: 'zipper', x: 67, y: 59, rot: 0 })
  run({ t: 'flat', ride: 'dropTower', x: 54, y: 75, rot: 0 })
  run({ t: 'flat', ride: 'wavePool', x: 72, y: 78, rot: 0, w: 9, h: 6 })
  run({ t: 'flat', ride: 'tubeSlides', x: 82, y: 70, rot: 0 })
  run({ t: 'flat', ride: 'aquaLoop', x: 77, y: 70, rot: 0 })
  run({ t: 'hotel', kind: 'skylineTower', x: 44, y: 78, w: 4, h: 4, floors: 10 })
  run({ t: 'hotel', kind: 'timberLodge', x: 38, y: 67, w: 4, h: 3, floors: 2 })
  run({ t: 'terrain', op: 'lower', x0: 40, y0: 84, x1: 50, y1: 89 }); run({ t: 'terrain', op: 'lower', x0: 41, y0: 85, x1: 49, y1: 88 })
  run({ t: 'water', op: 'raise', x0: 40, y0: 84, x1: 50, y1: 89 })
  const trees = ['oak', 'pine', 'birch', 'palm', 'bush', 'flowers', 'hedge', 'rock', 'topiary']
  let k = 0
  for (let y = 68; y <= 90; y += 2) for (const x of [61, 62, 66, 67]) run({ t: 'scenery', kind: trees[k++ % trees.length], x, y })
  for (let x = 52; x <= 60; x += 2) run({ t: 'scenery', kind: trees[k++ % trees.length], x, y: 89 })
  for (let i = 0; i < 400; i++) { m.spawnGuest(s, 0); for (let t = 0; t < 4; t++) m.stepPark(s, m.SIM_STEP) }
  for (let t = 0; t < 20 * 60; t++) m.stepPark(s, m.SIM_STEP)
  s.time.dayFraction = 0.45
  return { state: s, log, ids: { coaster: coaster.id, wooden: wooden.id } }
}

if (typeof process !== 'undefined' && process.argv?.[1]?.endsWith('park-scene.mjs')) {
  const m = await import('../server/park/index.mjs')
  const { state, log } = buildScene(m)
  for (const line of log) if (line[2] !== 'ok') console.log(line.join(' '))
  console.log('ok', log.filter(l => l[2] === 'ok').length, 'of', log.length, 'guests', state.guests.length, 'entities', Object.keys(state.entities).length)
}
