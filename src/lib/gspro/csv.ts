import { normalizeClub } from './clubs'
import type { Handed, ShotInput } from './types'

type Field = Exclude<keyof ShotInput, 'ref' | 'handed'>

const fieldAliases: Record<Field, string[]> = {
  at: ['date', 'datetime', 'time', 'timestamp', 'shottime', 'created', 'date/time'],
  club: ['club', 'clubname', 'clubtype', 'club type'],
  ballSpeed: ['ballspeed', 'ball speed', 'speed', 'ballspeedmph', 'ball speed (mph)'],
  launch: ['vla', 'launchangle', 'launch angle', 'launch', 'verticallaunchangle', 'launch v', 'vertical launch'],
  direction: ['hla', 'launchdirection', 'launch direction', 'direction', 'horizontallaunchangle', 'launch h', 'horizontal launch', 'side angle'],
  totalSpin: ['totalspin', 'total spin', 'spin', 'spinrate', 'spin rate'],
  spinAxis: ['spinaxis', 'spin axis', 'axis', 'spin tilt', 'tilt'],
  carry: ['carry', 'carrydistance', 'carry distance', 'carry (yds)', 'carry yards'],
  clubSpeed: ['clubspeed', 'club speed', 'clubheadspeed', 'club head speed', 'swing speed'],
  attackAngle: ['aoa', 'angleofattack', 'attackangle', 'attack angle', 'angle of attack'],
  path: ['path', 'clubpath', 'club path', 'swing path'],
  face: ['face', 'facetotarget', 'face to target', 'faceangle', 'face angle'],
  dynamicLoft: ['loft', 'dynamicloft', 'dynamic loft'],
  lie: ['lie', 'lieangle', 'lie angle'],
  impactH: ['horizontalfaceimpact', 'impact h', 'impacth', 'face impact horizontal', 'horizontal impact'],
  impactV: ['verticalfaceimpact', 'impact v', 'impactv', 'face impact vertical', 'vertical impact'],
}

const backSpinAliases = ['backspin', 'back spin']
const sideSpinAliases = ['sidespin', 'side spin']

export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const delimiter = (text.split(/\r?\n/, 1)[0].match(/;/g)?.length ?? 0) > (text.split(/\r?\n/, 1)[0].match(/,/g)?.length ?? 0) ? ';' : text.includes('\t') && !text.includes(',') ? '\t' : ','
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { cell += '"'; index++ }
      else if (char === '"') quoted = false
      else cell += char
    } else if (char === '"') quoted = true
    else if (char === delimiter) { row.push(cell); cell = '' }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index++
      row.push(cell); cell = ''
      if (row.some(value => value.trim() !== '')) rows.push(row)
      row = []
    } else cell += char
  }
  row.push(cell)
  if (row.some(value => value.trim() !== '')) rows.push(row)
  return rows
}

const clean = (header: string) => header.toLowerCase().replace(/\s+/g, ' ').trim()
const bare = (header: string) => clean(header).replace(/\s*\(.*?\)\s*/g, '').replace(/[^a-z/ ]/g, '').trim()

export type CsvImport = { shots: ShotInput[]; skipped: number; columns: Partial<Record<Field, string>>; metric: boolean }

function number(value: string | undefined) {
  if (value === undefined) return null
  const trimmed = value.trim().replace(/[^0-9.,+\-eE]/g, '')
  if (!trimmed) return null
  const parsed = Number(trimmed.includes(',') && !trimmed.includes('.') ? trimmed.replace(',', '.') : trimmed.replace(/,/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

/** Signed angle that may be written as "3.2 R" / "L 1.5". */
function angle(value: string | undefined) {
  if (value === undefined) return null
  const parsed = number(value)
  if (parsed === null) return null
  return /\bL\b|left|^\s*L/i.test(value) ? -Math.abs(parsed) : /\bR\b|right|^\s*R/i.test(value) ? Math.abs(parsed) : parsed
}

export function importCsv(text: string, handed: Handed = 'RH', now = Date.now()): CsvImport {
  const rows = parseCsvRows(text.replace(/^﻿/, ''))
  const headerIndex = rows.findIndex(row => row.some(cell => /ball ?speed/i.test(cell)))
  if (headerIndex < 0) return { shots: [], skipped: rows.length, columns: {}, metric: false }
  const headers = rows[headerIndex]
  const columns: Partial<Record<Field, string>> = {}
  const indexOf: Partial<Record<Field, number>> = {}
  for (const field of Object.keys(fieldAliases) as Field[]) {
    const aliases = fieldAliases[field]
    const found = headers.findIndex(header => aliases.includes(clean(header)) || aliases.includes(bare(header)) || aliases.includes(bare(header).replace(/ /g, '')))
    if (found >= 0) { indexOf[field] = found; columns[field] = headers[found] }
  }
  const back = headers.findIndex(header => backSpinAliases.includes(bare(header)) || backSpinAliases.includes(bare(header).replace(/ /g, '')))
  const side = headers.findIndex(header => sideSpinAliases.includes(bare(header)) || sideSpinAliases.includes(bare(header).replace(/ /g, '')))
  const speedHeader = indexOf.ballSpeed === undefined ? '' : headers[indexOf.ballSpeed]
  const carryHeader = indexOf.carry === undefined ? '' : headers[indexOf.carry]
  const metricSpeed = /m\/s|kph|km\/h/i.test(speedHeader)
  const kph = /kph|km\/h/i.test(speedHeader)
  const metricCarry = /\(m\)|meter|metre|\bm\b/i.test(carryHeader)
  const shots: ShotInput[] = []
  let skipped = 0
  rows.slice(headerIndex + 1).forEach((row, index) => {
    const get = (field: Field) => indexOf[field] === undefined ? undefined : row[indexOf[field]!]
    let ballSpeed = number(get('ballSpeed'))
    const launch = number(get('launch'))
    if (ballSpeed === null || launch === null || ballSpeed <= 0) { skipped++; return }
    if (metricSpeed) ballSpeed = kph ? ballSpeed * 0.621371 : ballSpeed * 2.23694
    let totalSpin = number(get('totalSpin'))
    let spinAxis = angle(get('spinAxis'))
    const backSpin = back >= 0 ? number(row[back]) : null
    const sideSpin = side >= 0 ? angle(row[side]) : null
    if (totalSpin === null && backSpin !== null) totalSpin = Math.hypot(backSpin, sideSpin ?? 0)
    if (spinAxis === null && backSpin !== null && sideSpin !== null) spinAxis = (Math.atan2(sideSpin, backSpin) * 180) / Math.PI
    let carry = number(get('carry'))
    if (carry !== null && metricCarry) carry = carry / 0.9144
    let clubSpeed = number(get('clubSpeed'))
    if (clubSpeed !== null && metricSpeed) clubSpeed = kph ? clubSpeed * 0.621371 : clubSpeed * 2.23694
    const stamp = get('at') ? Date.parse(get('at')!) : NaN
    shots.push({
      ref: `csv:${index}`,
      at: Number.isFinite(stamp) ? stamp : now + index,
      club: normalizeClub(get('club')),
      handed,
      ballSpeed,
      launch,
      direction: angle(get('direction')) ?? 0,
      totalSpin: totalSpin ?? 0,
      spinAxis: spinAxis ?? 0,
      carry: carry !== null && carry > 0 ? carry : null,
      clubSpeed: clubSpeed !== null && clubSpeed > 0 ? clubSpeed : null,
      attackAngle: number(get('attackAngle')),
      path: angle(get('path')),
      face: angle(get('face')),
      dynamicLoft: number(get('dynamicLoft')),
      lie: number(get('lie')),
      impactH: number(get('impactH')),
      impactV: number(get('impactV')),
    })
  })
  return { shots, skipped, columns, metric: metricSpeed || metricCarry }
}
