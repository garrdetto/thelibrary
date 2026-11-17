#!/usr/bin/env node
// GSPro Bridge for the library's GSPro Analyzer.
// Sits between your launch monitor connector and GSPro's Open Connect port, passes every byte through untouched,
// and copies each shot (with the club GSPro has selected) to your analyzer page. No dependencies: Node 18 or newer.
//
//   node gspro-bridge.mjs --site https://your-site --key gsb_... --save   (first run, remembers the settings)
//   node gspro-bridge.mjs                                                  (later runs)
//   node gspro-bridge.mjs --test                                           (sends one sample shot to the page)
//
// Then point your launch monitor connector at 127.0.0.1 port 9211 (or --listen) instead of GSPro's 921.

import net from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'

const VERSION = '1.0.0'
const home = path.join(os.homedir(), '.gspro-bridge')
const configFile = path.join(home, 'config.json')
const queueFile = path.join(home, 'queue.json')

function parseArgs(argv) {
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

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.tmp`
  fs.writeFileSync(temp, JSON.stringify(value, null, 2))
  fs.renameSync(temp, file)
}

function hostPort(value, fallbackHost) {
  const text = String(value)
  const at = text.lastIndexOf(':')
  return at > 0 ? { host: text.slice(0, at), port: Number(text.slice(at + 1)) } : { host: fallbackHost, port: Number(text) }
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
}

if (args.help || args.h) {
  console.log(`GSPro Bridge ${VERSION}
  --site <url>       analyzer site, e.g. https://example.com
  --key <gsb_...>    bridge key from the GSPro Analyzer page
  --listen <h:port>  where the launch monitor connector connects (default 127.0.0.1:9211)
  --gspro <h:port>   GSPro Open Connect address (default 127.0.0.1:921)
  --handed RH|LH     used until GSPro reports the player's hand
  --no-csv           do not keep a local CSV copy of each shot
  --save             remember these settings in ${configFile}
  --test             send one sample shot and exit`)
  process.exit(0)
}

if (!/^https?:\/\//.test(config.site) || !/^gsb_[a-f0-9]{48}$/.test(config.key)) {
  console.error('Set --site https://... and --key gsb_... (copy both from the Bridge tab of the GSPro Analyzer page). Add --save to remember them.')
  process.exit(1)
}
if (args.save) {
  writeJson(configFile, { site: config.site, key: config.key, listen: config.listen, gspro: config.gspro, handed: config.handed, csv: config.csv })
  console.log(`Saved settings to ${configFile}`)
}

const stamp = () => new Date().toLocaleTimeString()
const log = (...parts) => console.log(`[${stamp()}]`, ...parts)

let queue = readJson(queueFile, [])
if (!Array.isArray(queue)) queue = []
let sending = false
let retryAt = 0
let gsproConnected = false
let monitorClients = 0
let currentClub = null
let handed = config.handed

function persistQueue() {
  try { writeJson(queueFile, queue) } catch (error) { log('Could not save the offline queue:', error.message) }
}

async function post(body) {
  const response = await fetch(`${config.site}/api/gspro/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.key}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  })
  const result = await response.json().catch(() => ({}))
  if (response.status === 401) throw Object.assign(new Error(result.error || 'The site did not accept the bridge key.'), { fatal: true })
  if (!response.ok) throw new Error(result.error || `The site answered ${response.status}.`)
  return result
}

function heartbeat() {
  return { version: VERSION, gsproConnected, monitorConnected: monitorClients > 0, queued: queue.length, listen: config.listen }
}

async function flush() {
  if (sending || !queue.length || Date.now() < retryAt) return
  sending = true
  try {
    const batch = queue.slice(0, 100)
    const result = await post({ shots: batch, heartbeat: heartbeat() })
    const accepted = new Set(result.accepted ?? batch.map(item => item.ref))
    queue = queue.filter(item => !accepted.has(item.ref))
    persistQueue()
    retryAt = 0
    if (queue.length) setImmediate(flush)
  } catch (error) {
    retryAt = Date.now() + (error.fatal ? 60000 : 5000)
    log(`Upload failed (${queue.length} shot${queue.length === 1 ? '' : 's'} waiting): ${error.message}`)
  } finally {
    sending = false
  }
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
  persistQueue()
  keepLocalCopy(item)
  log(`Shot ${payload.ShotNumber ?? ''} ${currentClub ?? '?'}: ${Number(ball.Speed ?? 0).toFixed(1)} mph, ${Number(ball.VLA ?? 0).toFixed(1)}° launch, ${Math.round(Number(ball.TotalSpin ?? ball.BackSpin ?? 0))} rpm`)
  flush()
}

/** Splits a TCP stream into top-level JSON objects (Open Connect messages carry no delimiter). */
function jsonSplitter(onMessage) {
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
    const monitorText = new StringDecoder('utf8')
    const gsproText = new StringDecoder('utf8')
    const readGspro = jsonSplitter(fromGspro)
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
    console.error(error.code === 'EADDRINUSE' ? `Port ${listen.port} is already in use. Pick another with --listen.` : error.message)
    process.exit(1)
  })
  server.listen(listen.port, listen.host, () => {
    log(`GSPro Bridge ${VERSION} listening on ${listen.host}:${listen.port}, relaying to GSPro at ${target.host}:${target.port}`)
    log(`Sending shots to ${config.site}${queue.length ? ` (${queue.length} waiting from last time)` : ''}`)
    log(`Point your launch monitor connector at ${listen.host === '0.0.0.0' ? '127.0.0.1' : listen.host} port ${listen.port}.`)
  })
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
  sendTest().catch(error => { console.error(`Test failed: ${error.message}`); process.exit(1) })
} else {
  startRelay()
  setInterval(() => { flush(); if (!queue.length) post({ heartbeat: heartbeat() }).catch(error => log(`Heartbeat failed: ${error.message}`)) }, 20000)
  post({ heartbeat: heartbeat() }).then(() => log('Analyzer reached. Waiting for shots.')).catch(error => log(`Cannot reach the analyzer yet: ${error.message}`))
  flush()
  const stop = () => { persistQueue(); process.exit(0) }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}
