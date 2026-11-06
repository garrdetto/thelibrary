const FIELDS = ['x', 'z', 'h', 'vx', 'vz', 'vf', 'steer', 'steerV', 'av', 'thr', 'brk', 'slip', 'ck', 'cf', 'sp', 'cross']

export function makeCar(api, i) {
  const { center, toTrack, P, S_LINE } = api
  const s = 40 + i * 6.5, lat = ((i % 4) - 1.5) * 2.1
  const c0 = center(s)
  const kinds = [{ tm: true, car: false }, { tm: true, car: true }, null, { tm: false }]
  const car = {
    id: `car${i}`, local: i !== 5, ai: i % 2 === 0, auto: i === 3, isPace: i === 7,
    x: c0.x + c0.nx * lat, z: c0.z + c0.nz * lat, h: Math.atan2(c0.tx, c0.tz),
    vx: 0, vz: 0, vf: 0, steer: 0, av: 0, thr: 0, brk: 0, slip: 0,
    dmg: { f: i * 3, r: i, l: (i * 7) % 11, rt: (i * 5) % 13 },
    cross: 1, boost: i % 3 === 0 ? 1.02 : 1, gripB: 1 + i * 0.01, powB: 1 - i * 0.01,
    m: kinds[i % 4],
  }
  car.tp = toTrack(car.x, car.z)
  car.sp = ((car.tp.s - S_LINE) % P + P) % P
  return car
}

export function control(i, step) {
  const t = step / 120
  return {
    thr: (step + i * 37) % 900 < 760 ? 1 : 0,
    brk: (step + i * 53) % 1100 > 1040 ? 1 : 0,
    steer: Math.sin(t * (0.7 + i * 0.13) + i) * (0.35 + 0.08 * i) + (i === 6 ? 0.6 : 0) - (i === 2 ? 0.45 : 0),
  }
}

export function carScenario(api, log) {
  const cars = Array.from({ length: 8 }, (_, i) => makeCar(api, i))
  const frames = []
  for (let step = 0; step < 2600; step += 1) {
    const dt = step % 500 === 499 ? 0.1 : 1 / 120
    cars.forEach((c, i) => { if (c.local) api.stepCar(c, dt, control(i, step), i === 4 ? 24 : null) })
    for (let a = 0; a < cars.length; a += 1) for (let b = a + 1; b < cars.length; b += 1) api.collidePair(cars[a], cars[b])
    if (step % 20 === 0) frames.push(cars.map((c) => [...FIELDS.map((f) => c[f] ?? null), c.tp.s, c.tp.lat, c.looseT ?? null]))
  }
  return { frames, log: log.slice() }
}
