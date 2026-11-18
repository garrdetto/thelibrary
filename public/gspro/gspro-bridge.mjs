#!/usr/bin/env node
// GSPro Bridge for the library's GSPro Analyzer. No dependencies: Node 18 or newer.
//
// 1. Course rounds: watches GSPro's round file (currentRound.dat) and uploads every shot you play on a course, with the
//    hole, lie, distance to the pin, GSPro's own flight and putts. Nothing to change in GSPro or your launch monitor.
// 2. Live relay (optional): listens on 127.0.0.1:9211 and forwards every byte to GSPro's Open Connect port 921 unchanged,
//    copying each launch-monitor shot (with club data) to the page. Only for connectors that let you choose the port.
// 3. ProTee Labs: reads your club lofts from ProTee's bag so tips can compare delivered and static loft.
//
//   node gspro-bridge.mjs --site https://your-site --key gsb_... --save   (first run, remembers the settings)
//   node gspro-bridge.mjs                                                  (later runs)
//   node gspro-bridge.mjs --test                                           (sends one sample shot to the page)
//   node gspro-bridge.mjs --install-startup                                (start by itself when you sign in to Windows)

import net from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { StringDecoder } from 'node:string_decoder'

export const VERSION = '1.2.0'

export function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index++) {
    const item = argv[index]
    if (!item.startsWith('--')) continue
    const [name, inline] = item.slice(2).split('=', 2)
    if (inline !== undefined) args[name] = inline
    else if (argv[index + 1] && !argv[index + 1].startsWith('--')) args[name] = argv[++index]
    else args[name] = true
  }
  return args
}

export function hostPort(value, fallbackHost) {
  const text = String(value)
  const at = text.lastIndexOf(':')
  return at > 0 ? { host: text.slice(0, at), port: Number(text.slice(at + 1)) } : { host: fallbackHost, port: Number(text) }
}

/** Splits a TCP stream into top-level JSON objects (Open Connect messages carry no delimiter). */
export function jsonSplitter(onMessage) {
  let buffer = ''
  return chunk => {
    buffer += chunk
    let depth = 0
    let inString = false
    let escaped = false
    let start = -1
    let consumed = 0
    for (let index = 0; index < buffer.length; index++) {
      const char = buffer[index]
      if (inString) {
        if (escaped) escaped = false
        else if (char === '\\') escaped = true
        else if (char === '"') inString = false
        continue
      }
      if (char === '"') inString = true
      else if (char === '{') { if (depth === 0) start = index; depth++ }
      else if (char === '}' && depth > 0) {
        depth--
        if (depth === 0 && start >= 0) {
          const text = buffer.slice(start, index + 1)
          consumed = index + 1
          start = -1
          try { onMessage(JSON.parse(text)) } catch { /* not JSON; GSPro still receives the bytes */ }
        }
      }
    }
    buffer = depth === 0 ? '' : buffer.slice(consumed)
    if (buffer.length > 1_000_000) buffer = ''
  }
}

const num = (value, places = 2) => {
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n * 10 ** places) / 10 ** places : 0
}
const point = value => ({ x: num(value?.x), y: num(value?.y), z: num(value?.z) })

/** A round is identified by the first shot GSPro wrote to the file. */
export function roundKeyOf(rows) {
  return String(rows[0]?.ShotID ?? '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 64)
}

/** Compact course shots from GSPro's currentRound.dat rows (world coordinates in yards). */
export function courseShotsFromRound(rows, seenAt) {
  const round = roundKeyOf(rows)
  return rows.filter(row => row && typeof row.ShotID === 'string' && row.StartingPOS && row.EndingPOS).map(row => {
    const shot = row.activeShot ?? {}
    const data = shot.sd ?? {}
    const ghost = row.GhostData ?? {}
    const flight = (Array.isArray(data.pos) ? data.pos : []).map(p => [num(p.x), num(p.y), num(p.z)])
    const rollRaw = (Array.isArray(data.path) ? data.path : []).map(p => [num(p.time, 3), num(p.pos?.x), num(p.pos?.y), num(p.pos?.z)])
    const every = Math.max(1, Math.ceil(rollRaw.length / 30))
    const roll = rollRaw.filter((_, index) => index % every === 0 || index === rollRaw.length - 1)
    return {
      ref: String(row.ShotID).replace(/[^A-Za-z0-9-]/g, '').slice(0, 64),
      round,
      seenAt,
      player: String(row.PlayerName ?? 'Player').slice(0, 40),
      course: String(row.CourseKey ?? 'unknown').slice(0, 80),
      hole: Math.max(0, Math.round(num(row.Hole))),
      holeShot: Math.max(1, Math.round(num(row.HoleShot))),
      par: Math.max(3, Math.min(6, Math.round(num(row.HolePar)) || 4)),
      clubIndex: Number.isInteger(row.ClubIndex) ? row.ClubIndex : null,
      final: row.HoleResult === 7 || Boolean(shot.holed),
      putt: Boolean(data.isPutt),
      water: Boolean(data.waterhit),
      startSurface: Math.round(num(row.StartingSurface)),
      endSurface: Math.round(num(row.EndingSurface)),
      toPin: num(row.DistanceToPin),
      total: num(row.TotalDistance),
      ball: { speed: num(ghost.sp ?? row.BallSpeed), launch: num(ghost.el), direction: num(ghost.az), totalSpin: num(ghost.ts, 0), backSpin: num(ghost.lmfBS, 0), sideSpin: num(ghost.lmfSS, 0), spinAxis: num(ghost.sa) },
      start: point(row.StartingPOS),
      touchdown: point(data.tdpoint ?? row.EndingPOS),
      end: point(row.EndingPOS),
      flight,
      touchdownTime: num(shot.tdTime ?? data.timetd, 3),
      roll,
      material: typeof ghost.materialHit === 'string' ? ghost.materialHit.slice(0, 40) : null,
    }
  })
}

/** The Windows Startup-folder launcher: starts the bridge minimised, with its saved settings, when you sign in. */
export function startupScript(nodePath, scriptPath) {
  return ['@echo off', `cd /d "${path.win32.dirname(scriptPath)}"`, `start "GSPro Bridge" /min "${nodePath}" "${scriptPath}"`, ''].join('\r\n')
}

/** Club names and static lofts from ProTee Labs' Configs/Bags file (the profile with the most clubs). */
export function parseBag(text) {
  const line = String(text).split(/\r?\n/).find(item => item.startsWith('ClubProfiles='))
  if (!line) return []
  let profiles
  try { profiles = JSON.parse(line.slice('ClubProfiles='.length)) } catch { return [] }
  if (!Array.isArray(profiles) || !profiles.length) return []
  const profile = [...profiles].sort((a, b) => (b.Clubs?.length ?? 0) - (a.Clubs?.length ?? 0))[0]
  return (profile.Clubs ?? [])
    .filter(club => typeof club?.Name === 'string' && Number.isFinite(Number(club.StaticLoft)))
    .map(club => ({ name: club.Name.slice(0, 40), loft: num(club.StaticLoft, 1) }))
    .slice(0, 30)
}

async function main() {
  const home = path.join(os.homedir(), '.gspro-bridge')
  const configFile = path.join(home, 'config.json')
  const queueFile = path.join(home, 'queue.json')
  const courseQueueFile = path.join(home, 'course-queue.json')
  const roundsFile = path.join(home, 'rounds-sent.json')

  const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback } }
  const writeJson = (file, value) => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const temp = `${file}.tmp`
    fs.writeFileSync(temp, JSON.stringify(value))
    fs.renameSync(temp, file)
  }

  const args = parseArgs(process.argv.slice(2))
  const saved = readJson(configFile, {})
  const config = {
    site: String(args.site ?? process.env.GSPRO_BRIDGE_SITE ?? saved.site ?? '').replace(/\/+$/, ''),
    key: String(args.key ?? process.env.GSPRO_BRIDGE_KEY ?? saved.key ?? ''),
    listen: String(args.listen ?? saved.listen ?? '127.0.0.1:9211'),
    gspro: String(args.gspro ?? saved.gspro ?? '127.0.0.1:921'),
    handed: String(args.handed ?? saved.handed ?? 'RH').toUpperCase() === 'LH' ? 'LH' : 'RH',
    csv: args['no-csv'] ? false : saved.csv ?? true,
    relay: args['no-relay'] ? false : args.relay ? true : saved.relay ?? true,
    rounds: args['no-rounds'] ? false : saved.rounds ?? true,
    roundFile: String(args['round-file'] ?? saved.roundFile ?? path.join(os.homedir(), 'AppData', 'LocalLow', 'GSPro', 'GSPro', 'currentRound.dat')),
    bagFile: String(args['protee-bag'] ?? saved.bagFile ?? path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'ProTeeUnited', 'Configs', 'Bags')),
  }

  if (args.help || args.h) {
    console.log(`GSPro Bridge ${VERSION}
  --site <url>         analyzer site, e.g. https://example.com
  --key <gsb_...>      bridge key from the GSPro Analyzer page
  --round-file <path>  GSPro's round file (default ${config.roundFile})
  --no-rounds          do not upload course rounds
  --no-relay           do not run the live Open Connect relay
  --listen <h:port>    where a launch monitor connector connects to the relay (default 127.0.0.1:9211)
  --gspro <h:port>     GSPro Open Connect address (default 127.0.0.1:921)
  --protee-bag <path>  ProTee Labs bag file (default ${config.bagFile})
  --handed RH|LH       used until GSPro reports the player's hand
  --no-csv             do not keep a local CSV copy of relayed shots
  --save               remember these settings in ${configFile}
  --test               send one sample shot and exit
  --install-startup    start the bridge automatically when you sign in to Windows
  --uninstall-startup  stop starting it automatically`)
    return
  }

  const startupFile = path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'GSPro Bridge.cmd')
  if (args['uninstall-startup']) {
    try { fs.unlinkSync(startupFile); console.log('The bridge will no longer start automatically.') } catch { console.log('The bridge was not set to start automatically.') }
    return
  }

  if (!/^https?:\/\//.test(config.site) || !/^gsb_[a-f0-9]{48}$/.test(config.key)) {
    console.error('Set --site https://... and --key gsb_... (copy both from the Bridge tab of the GSPro Analyzer page). Add --save to remember them.')
    process.exit(1)
  }
  if (args.save || args['install-startup']) {
    writeJson(configFile, config)
    console.log(`Saved settings to ${configFile}`)
  }
  if (args['install-startup']) {
    if (process.platform !== 'win32') {
      console.log(`Starting automatically is set up for Windows only. Add this to your system's login items: node "${fileURLToPath(import.meta.url)}"`)
      return
    }
    fs.mkdirSync(path.dirname(startupFile), { recursive: true })
    fs.writeFileSync(startupFile, startupScript(process.execPath, fileURLToPath(import.meta.url)))
    console.log(`The bridge will now start by itself, minimised, each time you sign in to Windows (${startupFile}).`)
    console.log('Run node gspro-bridge.mjs now to start it today. Remove it any time with --uninstall-startup.')
    return
  }

  const log = (...parts) => console.log(`[${new Date().toLocaleTimeString()}]`, ...parts)

  let queue = readJson(queueFile, [])
  if (!Array.isArray(queue)) queue = []
  let courseQueue = readJson(courseQueueFile, [])
  if (!Array.isArray(courseQueue)) courseQueue = []
  let roundsSent = readJson(roundsFile, {})
  if (!roundsSent || typeof roundsSent !== 'object') roundsSent = {}
  let sending = false
  let retryAt = 0
  let gsproConnected = false
  let monitorClients = 0
  let currentClub = null
  let handed = config.handed
  let roundFileFound = false
  let roundMtime = 0
  let bag = null
  let bagMtime = 0
  let bagSent = false

  const persist = () => {
    try { writeJson(queueFile, queue); writeJson(courseQueueFile, courseQueue); writeJson(roundsFile, roundsSent) } catch (error) { log('Could not save the offline queue:', error.message) }
  }

  async function post(body) {
    const response = await fetch(`${config.site}/api/gspro/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    })
    const result = await response.json().catch(() => ({}))
    if (response.status === 401) throw Object.assign(new Error(result.error || 'The site did not accept the bridge key.'), { fatal: true })
    if (!response.ok) throw new Error(result.error || `The site answered ${response.status}.`)
    return result
  }

  const heartbeat = () => ({ version: VERSION, gsproConnected, monitorConnected: monitorClients > 0, queued: queue.length + courseQueue.length, listen: config.relay ? config.listen : 'off', roundFile: roundFileFound })

  async function flush() {
    if (sending || (!queue.length && !courseQueue.length && !(bag && !bagSent)) || Date.now() < retryAt) return
    sending = true
    try {
      const shots = queue.slice(0, 100)
      const course = courseQueue.slice(0, 40)
      const body = { shots, course, heartbeat: heartbeat() }
      if (bag && !bagSent) body.bag = bag
      const result = await post(body)
      const accepted = new Set(result.accepted ?? shots.map(item => item.ref))
      const acceptedCourse = new Set(result.acceptedCourse ?? course.map(item => item.ref))
      queue = queue.filter(item => !accepted.has(item.ref))
      courseQueue = courseQueue.filter(item => !acceptedCourse.has(item.ref))
      if (body.bag) bagSent = true
      if (course.length) log(`Uploaded ${course.length} course shot${course.length === 1 ? '' : 's'}${courseQueue.length ? `, ${courseQueue.length} to go` : ''}.`)
      persist()
      retryAt = 0
      if (queue.length || courseQueue.length) setImmediate(flush)
    } catch (error) {
      retryAt = Date.now() + (error.fatal ? 60000 : 5000)
      log(`Upload failed (${queue.length + courseQueue.length} waiting): ${error.message}`)
    } finally {
      sending = false
    }
  }

  function scanRound() {
    let stat
    try { stat = fs.statSync(config.roundFile) } catch { roundFileFound = false; return }
    roundFileFound = true
    if (stat.mtimeMs === roundMtime) return
    let rows
    try { rows = JSON.parse(fs.readFileSync(config.roundFile, 'utf8')) } catch { return }
    roundMtime = stat.mtimeMs
    if (!Array.isArray(rows) || !rows.length) return
    const key = roundKeyOf(rows)
    const known = key in roundsSent
    const done = new Set(roundsSent[key] ?? [])
    const fresh = courseShotsFromRound(rows, known ? Date.now() : Math.round(stat.mtimeMs)).filter(shot => !done.has(shot.ref))
    if (!fresh.length) return
    courseQueue.push(...fresh)
    roundsSent[key] = [...done, ...fresh.map(shot => shot.ref)]
    const keys = Object.keys(roundsSent)
    if (keys.length > 30) for (const old of keys.slice(0, keys.length - 30)) delete roundsSent[old]
    persist()
    const last = fresh[fresh.length - 1]
    log(known ? `Course shot: hole ${last.hole + 1}, shot ${last.holeShot} (${last.player})` : `Found a round on ${last.course} with ${fresh.length} shots; uploading it.`)
    flush()
  }

  function scanBag() {
    try {
      const stat = fs.statSync(config.bagFile)
      if (stat.mtimeMs === bagMtime) return
      bagMtime = stat.mtimeMs
      const clubs = parseBag(fs.readFileSync(config.bagFile, 'utf8'))
      if (clubs.length) { bag = clubs; bagSent = false; log(`Read ${clubs.length} club lofts from ProTee Labs.`) }
    } catch { /* ProTee Labs not installed */ }
  }

  function csvLine(item) {
    const ball = item.payload.BallData ?? {}
    const club = item.payload.ClubData ?? {}
    const cells = [new Date(item.at).toISOString(), item.club ?? '', ball.Speed, ball.VLA, ball.HLA, ball.TotalSpin, ball.SpinAxis, ball.BackSpin, ball.SideSpin, ball.CarryDistance, club.Speed, club.AngleOfAttack, club.Path, club.FaceToTarget, club.Loft]
    return cells.map(value => value === undefined || value === null ? '' : String(value)).join(',')
  }

  function keepLocalCopy(item) {
    if (!config.csv) return
    const file = path.join(home, `shots-${new Date(item.at).toISOString().slice(0, 10)}.csv`)
    try {
      fs.mkdirSync(home, { recursive: true })
      if (!fs.existsSync(file)) fs.writeFileSync(file, 'Date,Club,Ball Speed,VLA,HLA,Total Spin,Spin Axis,Back Spin,Side Spin,Carry,Club Speed,AoA,Path,Face To Target,Loft\n')
      fs.appendFileSync(file, `${csvLine(item)}\n`)
    } catch (error) {
      log('Could not write the local CSV copy:', error.message)
    }
  }

  function recordShot(payload) {
    const ball = payload.BallData ?? {}
    const item = { ref: crypto.randomUUID().replace(/-/g, ''), at: Date.now(), club: currentClub, handed, payload }
    queue.push(item)
    if (queue.length > 20000) queue = queue.slice(-20000)
    persist()
    keepLocalCopy(item)
    log(`Shot ${payload.ShotNumber ?? ''} ${currentClub ?? '?'}: ${Number(ball.Speed ?? 0).toFixed(1)} mph, ${Number(ball.VLA ?? 0).toFixed(1)}° launch, ${Math.round(Number(ball.TotalSpin ?? ball.BackSpin ?? 0))} rpm`)
    flush()
  }

  function fromMonitor(message) {
    const options = message.ShotDataOptions ?? {}
    if (options.IsHeartBeat) return
    const ball = message.BallData
    if (!ball || options.ContainsBallData === false || !(Number(ball.Speed) > 0)) return
    recordShot(message)
  }

  function fromGspro(message) {
    const player = message.Player
    if (player && typeof player === 'object') {
      if (typeof player.Club === 'string' && player.Club) {
        if (player.Club !== currentClub) log(`GSPro club: ${player.Club}`)
        currentClub = player.Club
      }
      if (player.Handed === 'LH' || player.Handed === 'RH') handed = player.Handed
    }
  }

  function startRelay() {
    const listen = hostPort(config.listen, '127.0.0.1')
    const target = hostPort(config.gspro, '127.0.0.1')
    const server = net.createServer(client => {
      monitorClients++
      log(`Launch monitor connected from ${client.remoteAddress}:${client.remotePort}`)
      const upstream = net.connect(target.port, target.host)
      const pending = []
      let open = false
      upstream.setNoDelay(true)
      client.setNoDelay(true)
      upstream.on('connect', () => {
        open = true
        gsproConnected = true
        log(`Connected to GSPro at ${target.host}:${target.port}`)
        for (const chunk of pending) upstream.write(chunk)
        pending.length = 0
      })
      const readMonitor = jsonSplitter(fromMonitor)
      const readGspro = jsonSplitter(fromGspro)
      const monitorText = new StringDecoder('utf8')
      const gsproText = new StringDecoder('utf8')
      client.on('data', chunk => {
        if (open) upstream.write(chunk)
        else pending.push(chunk)
        readMonitor(monitorText.write(chunk))
      })
      upstream.on('data', chunk => {
        client.write(chunk)
        readGspro(gsproText.write(chunk))
      })
      const close = () => { client.destroy(); upstream.destroy() }
      client.on('close', () => { monitorClients = Math.max(0, monitorClients - 1); log('Launch monitor disconnected'); upstream.destroy() })
      upstream.on('close', () => { if (open) { gsproConnected = false; log('GSPro connection closed') } client.destroy() })
      client.on('error', close)
      upstream.on('error', error => { log(`Cannot reach GSPro at ${target.host}:${target.port} (${error.code ?? error.message}). Is GSPro open with Open Connect running?`); close() })
    })
    server.on('error', error => {
      log(error.code === 'EADDRINUSE' ? `Relay port ${listen.port} is already in use, so the live relay is off. Course rounds still upload.` : `Relay error: ${error.message}`)
    })
    server.listen(listen.port, listen.host, () => log(`Live relay on ${listen.host}:${listen.port} → GSPro ${target.host}:${target.port}`))
  }

  async function sendTest() {
    const payload = {
      DeviceID: 'GSPro Bridge test', Units: 'Yards', ShotNumber: 1, APIversion: '1',
      BallData: { Speed: 148.2, SpinAxis: 4.1, TotalSpin: 2650, BackSpin: 2643, SideSpin: 189, HLA: 1.3, VLA: 12.6, CarryDistance: 0 },
      ClubData: { Speed: 102.4, AngleOfAttack: 1.8, FaceToTarget: 1.2, Lie: 0, Loft: 14.1, Path: -0.9, SpeedAtImpact: 102.4, VerticalFaceImpact: 2, HorizontalFaceImpact: -3, ClosureRate: 0 },
      ShotDataOptions: { ContainsBallData: true, ContainsClubData: true, LaunchMonitorIsReady: true, LaunchMonitorBallDetected: true, IsHeartBeat: false },
    }
    const result = await post({ shots: [{ ref: crypto.randomUUID().replace(/-/g, ''), at: Date.now(), club: 'DR', handed, payload }], heartbeat: heartbeat() })
    console.log(result.added ? 'Test shot sent. It should appear on the Live tab within a few seconds.' : 'The site answered but stored nothing.')
  }

  if (args.test) {
    await sendTest().catch(error => { console.error(`Test failed: ${error.message}`); process.exit(1) })
    return
  }

  log(`GSPro Bridge ${VERSION} sending to ${config.site}${queue.length + courseQueue.length ? ` (${queue.length + courseQueue.length} waiting from last time)` : ''}`)
  scanBag()
  setInterval(scanBag, 60000)
  if (config.rounds) {
    log(fs.existsSync(config.roundFile) ? `Watching GSPro rounds in ${config.roundFile}` : `GSPro's round file isn't there yet (${config.roundFile}); it appears after your first course shot.`)
    scanRound()
    setInterval(scanRound, 3000)
  }
  if (config.relay) startRelay()
  setInterval(() => { flush(); if (!queue.length && !courseQueue.length) post({ heartbeat: heartbeat() }).catch(error => log(`Heartbeat failed: ${error.message}`)) }, 20000)
  post({ heartbeat: heartbeat() }).then(() => log('Analyzer reached.')).catch(error => log(`Cannot reach the analyzer yet: ${error.message}`))
  flush()
  const stop = () => { persist(); process.exit(0) }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
