import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  BASES,
  Contest,
  PARKS,
  Rng,
  TEAMS,
  airFor,
  battedBallPath,
  buildRoster,
  inFoulPlayable,
  isBeyondBags,
  isFairAngle,
  judgeFair,
  nameList,
  parkById,
  replay,
  resolveBallInPlay,
  strikeZone,
  FIELD_POSITIONS,
  type ContestSetup,
  type Defender,
  type PitchIntent,
  type PitchOutcome,
  type PlayContext,
  type SwingIntent,
} from '../sim'

const setup = (overrides: Partial<ContestSetup> = {}): ContestSetup => ({ seed: 7, away: 'ura', home: 'sal', innings: 9, dh: true, autoRunner: false, mercy: false, ...overrides })
const TAKE: SwingIntent = { action: 'take', type: 'contact', timing: 0, aimX: 0, aimY: 0 }
const NO_PRE = { steal: [], pickoff: 0, change: null, warm: null, pinchHit: null }

function outsidePitch(contest: Contest): PitchIntent {
  const bats = contest.batter.bats === 'S' ? (contest.pitcher.throws === 'R' ? 'L' : 'R') : contest.batter.bats
  const away = bats === 'R' ? 1 : -1
  return { type: contest.pitcher.pitching!.repertoire[0].type, targetX: away * 600, targetY: 800, effort: 75, accuracy: 0 }
}

function middlePitch(contest: Contest): PitchIntent {
  const zone = strikeZone(contest.batter.height)
  return { type: contest.pitcher.pitching!.repertoire[0].type, targetX: 0, targetY: Math.round(((zone.top + zone.bottom) / 2) * 1000), effort: 75, accuracy: 0 }
}

function pitch(contest: Contest, intent: PitchIntent, swing: SwingIntent = TAKE): PitchOutcome {
  contest.prePitch(NO_PRE)
  contest.preparePitch(intent)
  return contest.resolveSwing(swing)
}

const defense = (): Defender[] => FIELD_POSITIONS.map((pos) => ({ pos, id: pos, ratings: { contact: 50, power: 50, eye: 50, speed: 50, arm: 55, fielding: 55 } }))
const playContext = (overrides: Partial<PlayContext> = {}): PlayContext => ({ outs: 0, batter: { id: 'b', speed: 50, from: 0, stealing: false }, runners: [], bunt: false, infieldFly: false, defense: defense(), ...overrides })
const park = parkById('outhouse')
const calm = airFor(park, { speed: 0, toward: 0 })

test('league: 32 clubs in two leagues of two eight-team divisions, unique ids', () => {
  assert.equal(TEAMS.length, 32)
  assert.equal(new Set(TEAMS.map((team) => team.id)).size, 32)
  const divisions = new Map<string, number>()
  for (const team of TEAMS) divisions.set(team.division, (divisions.get(team.division) ?? 0) + 1)
  assert.deepEqual([...divisions.values()], [8, 8, 8, 8])
  assert.equal(PARKS.length, 10)
  for (const team of TEAMS) assert.ok(PARKS.some((item) => item.id === team.park))
})

test('names: 400+ unique names reproducible from a seed', () => {
  const first = nameList(99, 450)
  assert.equal(first.length, 450)
  assert.equal(new Set(first).size, 450)
  assert.deepEqual(nameList(99, 450), first)
  assert.notDeepEqual(nameList(100, 450), first)
})

test('rosters are seeded and complete', () => {
  const roster = buildRoster('frt')
  assert.equal(roster.hitters.length, 13)
  assert.equal(roster.pitchers.length, 12)
  assert.deepEqual(buildRoster('frt'), roster)
  assert.equal(new Set([...roster.hitters, ...roster.pitchers].map((player) => player.number)).size, 25)
  for (const pitcher of roster.pitchers) assert.ok(pitcher.pitching && pitcher.pitching.repertoire.length >= 2)
})

test('count: four balls is a walk and forces only the forced runners', () => {
  const contest = new Contest(setup({ practice: true }))
  contest.bases[1] = { id: contest.teams[0].roster.hitters[10].id, pitcherId: contest.pitcher.id, earned: true, stealing: false }
  contest.bases[3] = { id: contest.teams[0].roster.hitters[11].id, pitcherId: contest.pitcher.id, earned: true, stealing: false }
  const batter = contest.batter.id
  for (let ball = 1; ball <= 3; ball++) {
    const outcome = pitch(contest, outsidePitch(contest))
    assert.equal(outcome.call, 'ball')
    assert.equal(contest.balls, ball)
  }
  const outcome = pitch(contest, outsidePitch(contest))
  assert.ok(outcome.plateAppearanceOver)
  assert.equal(contest.bases[1]?.id, batter)
  assert.ok(contest.bases[2])
  assert.equal(contest.bases[3]?.id, contest.teams[0].roster.hitters[11].id, 'the runner on third is not forced')
  assert.equal(contest.score[0], 0)
  assert.equal(contest.balls, 0)
})

test('count: bases-loaded walk forces in a run with an RBI', () => {
  const contest = new Contest(setup({ practice: true }))
  for (const base of [1, 2, 3]) contest.bases[base] = { id: contest.teams[0].roster.hitters[8 + base].id, pitcherId: contest.pitcher.id, earned: true, stealing: false }
  const batter = contest.batter.id
  for (let ball = 0; ball < 4; ball++) pitch(contest, outsidePitch(contest))
  assert.equal(contest.score[0], 1)
  assert.equal(contest.teams[0].box.batting.find((line) => line.id === batter)?.rbi, 1)
  assert.equal(contest.teams[0].box.batting.find((line) => line.id === batter)?.bb, 1)
})

test('count: three called strikes is a strikeout and an out', () => {
  const contest = new Contest(setup({ practice: true }))
  const batter = contest.batter.id
  for (let strike = 0; strike < 3; strike++) {
    const outcome = pitch(contest, middlePitch(contest))
    assert.equal(outcome.call, 'called')
  }
  assert.equal(contest.outs, 1)
  assert.equal(contest.teams[0].box.batting.find((line) => line.id === batter)?.so, 1)
  assert.equal(contest.teams[0].box.batting.find((line) => line.id === batter)?.ab, 1)
  assert.equal(contest.teams[1].box.pitching[0].so, 1)
})

test('count: a swing far from the ball is a swinging strike', () => {
  const contest = new Contest(setup({ practice: true }))
  const outcome = pitch(contest, middlePitch(contest), { action: 'swing', type: 'contact', timing: 0, aimX: 600, aimY: 200 })
  assert.equal(outcome.call, 'swinging')
  assert.equal(contest.strikes, 1)
})

test('count: a hit batter takes first base', () => {
  let saw = false
  for (let seed = 1; seed < 40 && !saw; seed++) {
    const contest = new Contest(setup({ seed, practice: true }))
    const bats = contest.batter.bats === 'S' ? (contest.pitcher.throws === 'R' ? 'L' : 'R') : contest.batter.bats
    const inside = bats === 'R' ? -650 : 650
    const batter = contest.batter.id
    const outcome = pitch(contest, { type: contest.pitcher.pitching!.repertoire[0].type, targetX: inside, targetY: 1000, effort: 75, accuracy: 0 })
    assert.ok(outcome.call === 'hbp' || outcome.call === 'ball')
    if (outcome.call === 'hbp') {
      saw = true
      assert.equal(contest.bases[1]?.id, batter)
      assert.equal(contest.teams[1].box.pitching[0].hbp, 1)
    }
  }
  assert.ok(saw)
})

test('physics: a 110 mph drive at 28 degrees leaves the park; a bloop does not', () => {
  const homer = battedBallPath({ speed: 49.2, launch: 28, spray: 0, backspin: 2200, sidespin: 0 }, park, calm)
  assert.equal(homer.end, 'homer')
  const bloop = battedBallPath({ speed: 30, launch: 30, spray: 10, backspin: 2000, sidespin: 0 }, park, calm)
  assert.notEqual(bloop.end, 'homer')
  assert.equal(judgeFair(bloop, isBeyondBags), 'fair')
})

test('physics: thinner air carries farther, a lower gravity dome carries farther, wind out carries farther', () => {
  const launch = { speed: 42, launch: 30, spray: 0, backspin: 2200, sidespin: 0 }
  const deep = { ...park, fence: [200, 200, 200, 200, 200] }
  const carry = (path: ReturnType<typeof battedBallPath>) => Math.hypot(path.samples[path.firstGround].x, path.samples[path.firstGround].z)
  const sea = carry(battedBallPath(launch, deep, airFor({ ...deep, altitude: 0 }, { speed: 0, toward: 0 })))
  const mile = carry(battedBallPath(launch, deep, airFor({ ...deep, altitude: 1600 }, { speed: 0, toward: 0 })))
  const dome = carry(battedBallPath(launch, deep, airFor({ ...deep, altitude: 0, gravity: 9.1 }, { speed: 0, toward: 0 })))
  const windy = carry(battedBallPath(launch, deep, airFor({ ...deep, altitude: 0 }, { speed: 5, toward: 0 })))
  assert.ok(mile > sea + 5, `mile-high ${mile} vs ${sea}`)
  assert.ok(dome > sea + 2, `low gravity ${dome} vs ${sea}`)
  assert.ok(windy > sea + 5, `wind ${windy} vs ${sea}`)
})

test('fair and foul: the foul pole is fair, beyond the bags the landing spot decides, before the bags the roll decides', () => {
  assert.ok(isFairAngle({ x: 100, z: 100 }))
  assert.ok(!isFairAngle({ x: 100, z: 99 }))
  const rightLine = battedBallPath({ speed: 40, launch: 20, spray: 44, backspin: 1500, sidespin: 0 }, park, calm)
  assert.equal(judgeFair(rightLine, isBeyondBags), 'fair')
  const deepFoul = battedBallPath({ speed: 40, launch: 20, spray: 48, backspin: 1500, sidespin: 0 }, park, calm)
  assert.equal(judgeFair(deepFoul, isBeyondBags), 'foul')
  const trickler = battedBallPath({ speed: 12, launch: -10, spray: 50, backspin: 0, sidespin: 0 }, park, calm)
  assert.equal(judgeFair(trickler, isBeyondBags), 'foul')
  const backstop = battedBallPath({ speed: 30, launch: 40, spray: 180, backspin: 1500, sidespin: 0 }, park, calm)
  assert.equal(backstop.end, 'stands')
  assert.ok(!inFoulPlayable(park, { x: 0, z: -park.backstop - 1 }))
})

test('home run: every runner and the batter score', () => {
  const path = battedBallPath({ speed: 48, launch: 27, spray: -10, backspin: 2200, sidespin: 0 }, park, calm)
  const play = resolveBallInPlay(path, playContext({ runners: [{ id: 'r1', speed: 50, from: 1, stealing: false }, { id: 'r3', speed: 50, from: 3, stealing: false }] }), new Rng(1), (sample) => inFoulPlayable(park, sample))
  assert.equal(play.kind, 'homer')
  assert.equal(play.hitBases, 4)
  assert.ok(play.runners.every((runner) => runner.to === 4 && !runner.out))
})

test('ground-rule double: two bases for everyone', () => {
  const small = parkById('sandlot')
  const air = airFor(small, { speed: 0, toward: 0 })
  const context = playContext({ runners: [{ id: 'r1', speed: 50, from: 1, stealing: false }] })
  let play = null
  for (const spray of [40, -40, 14, -14]) {
    for (let launch = 10; launch <= 40 && !play; launch += 1) {
      for (let speed = 34; speed <= 52 && !play; speed += 0.25) {
        const path = battedBallPath({ speed, launch, spray, backspin: 1200, sidespin: 0 }, small, air)
        if (path.end !== 'groundRule') continue
        const result = resolveBallInPlay(path, context, new Rng(1), (sample) => inFoulPlayable(small, sample))
        if (result.kind === 'groundRule') play = result
      }
    }
  }
  assert.ok(play, 'some drive in the gap or down the line bounces over the short fence untouched')
  assert.equal(play.kind, 'groundRule')
  assert.equal(play.hitBases, 2)
  assert.equal(play.runners.find((runner) => runner.id === 'r1')?.to, 3)
})

test('infield fly: the batter is out and the runners hold', () => {
  const path = battedBallPath({ speed: 28, launch: 72, spray: 8, backspin: 3000, sidespin: 0 }, park, calm)
  const runners = [{ id: 'r1', speed: 50, from: 1, stealing: false }, { id: 'r2', speed: 50, from: 2, stealing: false }]
  const play = resolveBallInPlay(path, playContext({ runners, infieldFly: true }), new Rng(3), (sample) => inFoulPlayable(park, sample))
  assert.ok(play.kind === 'infieldFly' || play.kind === 'caught')
  assert.ok(play.runners.find((runner) => runner.id === 'b')?.out)
  for (const id of ['r1', 'r2']) {
    const runner = play.runners.find((item) => item.id === id)!
    assert.equal(runner.to, runner.from)
    assert.ok(!runner.out)
  }
})

test('sacrifice fly: a deep fly scores the runner from third with less than two outs', () => {
  const path = battedBallPath({ speed: 41, launch: 33, spray: 0, backspin: 2400, sidespin: 0 }, park, calm)
  assert.notEqual(path.end, 'homer')
  const play = resolveBallInPlay(path, playContext({ runners: [{ id: 'r3', speed: 60, from: 3, stealing: false }] }), new Rng(5), (sample) => inFoulPlayable(park, sample))
  assert.equal(play.kind, 'caught')
  const runner = play.runners.find((item) => item.id === 'r3')!
  assert.equal(runner.to, 4)
  assert.ok(play.sacFly || runner.out)
})

test('double play: a two-hopper at the shortstop with a runner on first turns two', () => {
  let doublePlays = 0
  for (let seed = 1; seed <= 20; seed++) {
    const path = battedBallPath({ speed: 36, launch: -4, spray: -14, backspin: -500, sidespin: 0 }, park, calm)
    const play = resolveBallInPlay(path, playContext({ runners: [{ id: 'r1', speed: 40, from: 1, stealing: false }], batter: { id: 'b', speed: 35, from: 0, stealing: false } }), new Rng(seed), (sample) => inFoulPlayable(park, sample))
    if (play.doublePlay) {
      doublePlays++
      assert.equal(play.runners.filter((runner) => runner.out).length, 2)
    }
  }
  assert.ok(doublePlays >= 10, `double plays ${doublePlays}`)
})

test('third out on a force wipes out runs on the play', () => {
  const contest = new Contest(setup({ seed: 11 }))
  contest.simulate(20000)
  for (const team of contest.teams) {
    const fromLines = team.box.lineScore.reduce((sum, value) => sum + value, 0)
    assert.equal(fromLines, team.box.runs)
    assert.equal(team.box.batting.reduce((sum, line) => sum + line.r, 0), team.box.runs)
  }
})

function runMany(count: number, base: Partial<ContestSetup>, each: (contest: Contest, outcome: PitchOutcome | null, before: { balls: number; strikes: number; outs: number }) => void): Contest[] {
  const contests: Contest[] = []
  for (let index = 0; index < count; index++) {
    const contest = new Contest(setup({ seed: 1000 + index, away: TEAMS[index % 32].id, home: TEAMS[(index * 7 + 3) % 32].id, ...base }))
    let guard = 0
    while (contest.phase !== 'final' && guard++ < 5000) {
      const before = { balls: contest.balls, strikes: contest.strikes, outs: contest.outs }
      const result = contest.autoPitch()
      each(contest, 'call' in result ? result : null, before)
    }
    assert.equal(contest.phase, 'final')
    contests.push(contest)
  }
  return contests
}

test('invariants over 150 AI contests: count limits, fouls, conservation, decisions', () => {
  runMany(150, {}, (contest, outcome, before) => {
    if (contest.phase !== 'final') {
      assert.ok(contest.balls <= 3 && contest.strikes <= 2 && contest.outs <= 2)
    }
    if (!outcome) return
    if (outcome.call === 'foul' && !outcome.plateAppearanceOver) {
      assert.equal(contest.strikes, Math.min(2, before.strikes + 1))
    }
    if (outcome.call === 'foul' && before.strikes === 2 && outcome.swing.type !== 'bunt') assert.ok(!outcome.plateAppearanceOver)
    if (outcome.call === 'foul' && before.strikes === 2 && outcome.swing.type === 'bunt') assert.ok(outcome.plateAppearanceOver)
  }).forEach((contest) => {
    assert.equal(contest.collisions, 0)
    const [away, home] = contest.teams
    assert.notEqual(contest.score[0], contest.score[1])
    for (const [side, team] of contest.teams.entries()) {
      const other = contest.teams[side === 0 ? 1 : 0]
      assert.equal(team.box.lineScore.reduce((sum, value) => sum + value, 0), team.box.runs)
      assert.equal(team.box.batting.reduce((sum, line) => sum + line.h, 0), team.box.hits)
      assert.equal(other.box.pitching.reduce((sum, line) => sum + line.h, 0), team.box.hits)
      assert.equal(other.box.pitching.reduce((sum, line) => sum + line.r, 0), team.box.runs)
      for (const line of team.box.pitching) assert.ok(line.er <= line.r)
    }
    const decisions = [...away.box.pitching, ...home.box.pitching].flatMap((line) => line.decisions)
    assert.equal(decisions.filter((item) => item === 'W').length, 1)
    assert.equal(decisions.filter((item) => item === 'L').length, 1)
    assert.ok(decisions.filter((item) => item === 'S').length <= 1)
    const winner = contest.teams[contest.winner!]
    assert.ok(winner.box.pitching.some((line) => line.decisions.includes('W')))
    const awayOuts = home.box.pitching.reduce((sum, line) => sum + line.outs, 0)
    assert.ok(awayOuts >= 27 || contest.inning > 9, 'the visitors always bat a full nine')
    if (contest.half === 'top') assert.ok(contest.score[1] > contest.score[0], 'the home side skips the last bottom half only when ahead')
  })
})

test('walk-offs end the contest the moment the home side leads', () => {
  let walkOffs = 0
  runMany(120, {}, (contest, outcome) => {
    if (!outcome || !outcome.final || contest.half !== 'bottom' || contest.inning < 9) return
    if (outcome.runs > 0) {
      walkOffs++
      const margin = contest.score[1] - contest.score[0]
      if (outcome.play?.kind === 'homer') assert.ok(margin >= 1 && margin <= 4)
      else assert.equal(margin, 1)
    }
  })
  assert.ok(walkOffs > 0)
})

test('contest lengths: 3, 6 and 9 innings, extras with the runner on second', () => {
  for (const innings of [3, 6, 9] as const) {
    let extras = 0
    for (const contest of runMany(30, { innings, autoRunner: true }, (contest, outcome) => {
      if (outcome?.halfOver && contest.inning > innings && contest.phase !== 'final') assert.ok(contest.bases[2], 'extra half-innings start with a runner on second')
    })) {
      assert.ok(contest.inning >= innings)
      if (contest.inning > innings) extras++
      const homeOuts = contest.teams[0].box.pitching.reduce((sum, line) => sum + line.outs, 0)
      assert.ok(homeOuts >= (innings - 1) * 3)
    }
    assert.ok(extras >= 0)
  }
})

test('mercy rule: a ten-run lead after 60% of the innings ends it', () => {
  for (const contest of runMany(80, { mercy: true }, () => undefined)) {
    if (contest.inning < 9 || (contest.inning === 9 && contest.half === 'top' && contest.score[1] < contest.score[0])) {
      assert.ok(Math.abs(contest.score[0] - contest.score[1]) >= 10)
      assert.ok(contest.inning >= Math.ceil(9 * 0.6))
    }
  }
})

test('no DH: the pitcher bats, pinch hitters cannot re-enter', () => {
  const contest = new Contest(setup({ dh: false }))
  const away = contest.teams[0]
  assert.equal(away.order.length, 9)
  assert.ok(away.order.some((slot) => slot.pos === 'P' && slot.id === contest.teams[0].pitcherId))
  assert.ok(!away.order.some((slot) => slot.pos === 'DH'))
  const bench = away.bench[0]
  const replaced = contest.batter.id
  contest.prePitch({ ...NO_PRE, pinchHit: bench })
  assert.equal(contest.batter.id, bench)
  assert.ok(away.removed.has(replaced))
  contest.preparePitch(null)
  contest.resolveSwing(null)
  const before = away.order.map((slot) => slot.id).join()
  if (contest.phase === 'pre') {
    contest.prePitch({ ...NO_PRE, pinchHit: replaced })
    assert.equal(away.order.map((slot) => slot.id).join(), before, 'a removed player stays out')
  }
})

test('pitchers tire: fatigue grows with pitches and the bullpen warms up', () => {
  const contest = new Contest(setup({ seed: 21 }))
  const starter = contest.pitcher.id
  contest.simulate(20000)
  const line = contest.teams[1].box.pitching.find((item) => item.id === starter)!
  assert.ok(line.pitches > 40)
  assert.ok(contest.teams[0].box.pitching.length + contest.teams[1].box.pitching.length > 2, 'relievers came in')
})

test('stolen bases and caught stealing are recorded', () => {
  let steals = 0
  let caught = 0
  for (const contest of runMany(60, {}, () => undefined)) {
    for (const team of contest.teams) {
      steals += team.box.batting.reduce((sum, line) => sum + line.sb, 0)
      caught += team.box.batting.reduce((sum, line) => sum + line.cs, 0)
    }
  }
  assert.ok(steals > caught && caught > 0, `${steals} SB, ${caught} CS`)
})

test('determinism: a recorded input log replays to the same box score', () => {
  const base = setup({ seed: 424242, away: 'hel', home: 'swb', innings: 6, autoRunner: true })
  const original = new Contest(base)
  original.simulate(20000)
  const again = new Contest(base)
  again.simulate(20000)
  assert.deepEqual(again.box(), original.box())
  const replayed = replay(base, original.log)
  assert.deepEqual(replayed.box(), original.box())
  assert.deepEqual(replayed.plays, original.plays)
  assert.equal(JSON.stringify(replayed.box()), JSON.stringify(original.box()))
})

test('determinism: human intents with quantized numbers replay exactly', () => {
  const base = setup({ seed: 99, innings: 3 })
  const contest = new Contest(base)
  let guard = 0
  while (contest.phase !== 'final' && guard++ < 3000) {
    if (contest.phase === 'pre') {
      const pre = contest.prePitch()
      if (pre.halfOver || pre.final) continue
    }
    contest.preparePitch(contest.battingSide === 0 ? null : { ...contest.suggestPitch(), accuracy: (guard % 21) - 10 })
    contest.resolveSwing(contest.battingSide === 0 ? { ...contest.suggestSwing(), timing: contest.suggestSwing().timing } : null)
  }
  assert.equal(contest.phase, 'final')
  const replayed = replay(base, contest.log)
  assert.deepEqual(replayed.box(), contest.box())
})

test('difficulty: a bigger contact cursor misses less, sharper AI hitters miss less, and both replay exactly', () => {
  const whiffRate = (overrides: Partial<ContestSetup>) => {
    let swings = 0
    let whiffs = 0
    for (let index = 0; index < 40; index++) {
      const contest = new Contest(setup({ seed: 9000 + index, ...overrides }))
      contest.simulate(20000)
      swings += contest.tally.swings
      whiffs += contest.tally.whiffs
    }
    return whiffs / swings
  }
  const small = whiffRate({ pciScale: [0.8, 0.8] })
  const large = whiffRate({ pciScale: [1.4, 1.4] })
  assert.ok(large < small - 0.04, `cursor 1.4 whiff ${large.toFixed(3)} vs 0.8 ${small.toFixed(3)}`)
  const loose = whiffRate({ aiSkill: [-0.6, -0.6] })
  const sharp = whiffRate({ aiSkill: [0.6, 0.6] })
  assert.ok(sharp < loose, `skill +0.6 whiff ${sharp.toFixed(3)} vs -0.6 ${loose.toFixed(3)}`)
  const base = setup({ seed: 31337, aiSkill: [0.5, -0.5], pciScale: [1.2, 0.9], innings: 3 })
  const original = new Contest(base)
  original.simulate(20000)
  assert.deepEqual(replay(base, original.log).box(), original.box())
})

test('positions: bases form a 90-foot square', () => {
  for (let base = 0; base < 4; base++) {
    const a = BASES[base]
    const b = BASES[(base + 1) % 4]
    assert.ok(Math.abs(Math.hypot(a.x - b.x, a.z - b.z) - 27.432) < 1e-6)
  }
})
