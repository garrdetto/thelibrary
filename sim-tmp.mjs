import { build } from 'esbuild'
const r = await build({ stdin: { contents: "export * from './modules-src/rackreel/systems/BowRoutes'; export { Terrain } from './modules-src/rackreel/world/Terrain'", resolveDir: '.', loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' })
const m = await import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'))
const T = new m.Terrain()
const dock = m.dockLine(T)
const launch = m.findLaunch(T, dock.start, dock.end)
console.log('dock', dock, 'launch', launch)
const clear = { points: [launch.boat], segments: [[dock.start, dock.end]] }
let t0 = Date.now()
const loops = m.buildLoops(T, clear)
console.log('loops ms', Date.now() - t0, Object.fromEntries(Object.entries(loops).map(([k, v]) => [k, v.length])))
for (const [k, loop] of Object.entries(loops)) { let mn = 9, mx = 0, dk = 99; for (const p of loop) { const d = T.depthAt(p.x, p.z); mn = Math.min(mn, d); mx = Math.max(mx, d); dk = Math.min(dk, m.clearanceDistance(p, clear)) } console.log(k, 'depth', mn.toFixed(2), mx.toFixed(2), 'clear', dk.toFixed(1)) }
const ap = new m.Autopilot(T, loops, launch)
ap.depart()
let t = 0, log = []
const run = (secs, label) => { let maxV = 0, badDeep = 0, minDepthFast = 99, grounded = 0; let arrived = null
  for (let i = 0; i < secs * 30; i++) { const e = ap.update(1/30, false); t += 1/30; maxV = Math.max(maxV, ap.speed); const d = T.depthAt(ap.x, ap.z); if (ap.speed > 4) { minDepthFast = Math.min(minDepthFast, d) } if (d < 0.3) { grounded++; if (grounded < 4) console.log('  aground', ap.x.toFixed(1), ap.z.toFixed(1), 'v', ap.speed.toFixed(1), 'h', ap.heading.toFixed(2), 'legs', JSON.stringify(ap.currentLegs.map(l => [Math.round(l.to.x), Math.round(l.to.z), l.plane]))) } if (e.arrived) { arrived = e.arrived + ' at v=' + ap.speed.toFixed(2); if (label !== 'loop') break } }
  console.log(label, 'maxV', maxV.toFixed(2), 'minDepth@speed', minDepthFast.toFixed(2), 'grounded frames', grounded, 'arrived', arrived, 'mode', ap.mode, 'v', ap.speed.toFixed(2)) }
run(120, 'depart')
run(30, 'loop'); console.log('cruise v', ap.speed.toFixed(2)); ap.setting = 2; run(20, 'loop'); console.log('push v', ap.speed.toFixed(2)); ap.setting = 1
console.log('->', ap.switchRoute(), ap.currentLegs.map(l => l.plane)); run(200, 'island')
console.log('->', ap.switchRoute(), ap.currentLegs.map(l => l.plane)); run(200, 'bay')
run(20, 'loop')
ap.headHome(); console.log('home legs', ap.currentLegs.map(l => l.plane)); run(300, 'home')
