// Extracts the original Straight Rail Setup Lab page from the owner's StraightRailSetupLab.exe without running it.
// The exe is a Go launcher whose page lives in an embed.FS: a slice of { name string; data string; hash [16]byte }
// (48 bytes each on amd64). We find the struct that points at a known file name, walk the slice while the names stay
// under web/, and copy every file byte for byte.
//
//   node modules-src/railsetup/tools/extract-exe.mjs <StraightRailSetupLab.exe>
//
// Writes modules-src/railsetup/original/ (the page, kin.js, fonts, version), the gzip pieces of car.glb in
// modules-src/railsetup/original/car/, and original/MANIFEST.json with the size and SHA-256 of every original file.
// three.js r128 and its loaders are not copied: they are the npm package three@0.128.0 (`three-r128`), byte for byte,
// which tests/original.test.ts checks against the manifest.
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

const exe = process.argv[2]
if (!exe) {
  console.error('usage: node modules-src/railsetup/tools/extract-exe.mjs <StraightRailSetupLab.exe>')
  process.exit(1)
}
const out = resolve(import.meta.dirname, '../original')
const PIECE = 16 * 1024 * 1024
const FROM_NPM = new Set(['web/lib/three.min.js', 'web/lib/GLTFLoader.js', 'web/lib/OrbitControls.js'])

const raw = readFileSync(exe)
const peOff = raw.readUInt32LE(0x3c)
if (raw.toString('latin1', peOff, peOff + 4) !== 'PE\0\0') throw new Error('not a PE file')
const sections = raw.readUInt16LE(peOff + 6)
const optSize = raw.readUInt16LE(peOff + 20)
const opt = peOff + 24
if (raw.readUInt16LE(opt) !== 0x20b) throw new Error('expected a 64-bit PE')
const imageBase = raw.readBigUInt64LE(opt + 24)
const secs = []
for (let i = 0; i < sections; i++) {
  const s = opt + optSize + i * 40
  secs.push({ va: imageBase + BigInt(raw.readUInt32LE(s + 12)), vsize: raw.readUInt32LE(s + 8), ptr: raw.readUInt32LE(s + 20), rsize: raw.readUInt32LE(s + 16) })
}
const va2off = (va) => {
  for (const s of secs) {
    const span = BigInt(Math.min(s.vsize, s.rsize))
    if (va >= s.va && va < s.va + span) return s.ptr + Number(va - s.va)
  }
  return -1
}
const off2va = (off) => {
  for (const s of secs) if (off >= s.ptr && off < s.ptr + s.rsize) return s.va + BigInt(off - s.ptr)
  return -1n
}
const bytesAt = (ptr, len) => {
  const o = va2off(ptr)
  if (o < 0 || len < 0n || len > 400_000_000n || o + Number(len) > raw.length) return null
  return raw.subarray(o, o + Number(len))
}
const entryAt = (off) => {
  if (off < 0 || off + 48 > raw.length) return null
  const np = raw.readBigUInt64LE(off), nl = raw.readBigUInt64LE(off + 8), dp = raw.readBigUInt64LE(off + 16), dl = raw.readBigUInt64LE(off + 24)
  if (nl <= 0n || nl >= 512n) return null
  const nameBytes = bytesAt(np, nl)
  if (!nameBytes) return null
  const name = nameBytes.toString('utf8')
  if (!name.startsWith('web') || /[^\x20-\x7e]/.test(name)) return null
  const data = dp === 0n && dl === 0n ? Buffer.alloc(0) : bytesAt(dp, dl)
  if (!data) return null
  return { name, data }
}

const anchor = Buffer.from('web/kin.js')
let structOff = -1
for (let i = raw.indexOf(anchor); i >= 0 && structOff < 0; i = raw.indexOf(anchor, i + 1)) {
  const va = off2va(i)
  if (va < 0n) continue
  const needle = Buffer.alloc(16)
  needle.writeBigUInt64LE(va, 0)
  needle.writeBigUInt64LE(BigInt(anchor.length), 8)
  structOff = raw.indexOf(needle)
}
if (structOff < 0) throw new Error('embedded page not found')
let lo = structOff
while (entryAt(lo - 48)) lo -= 48
const entries = []
for (let o = lo, e; (e = entryAt(o)); o += 48) entries.push(e)

const sha = (b) => createHash('sha256').update(b).digest('hex')
rmSync(out, { recursive: true, force: true })
const manifest = { source: 'StraightRailSetupLab.exe', exeSha256: sha(raw), files: {}, car: null }
for (const { name, data } of entries) {
  if (name.endsWith('/')) continue
  const rel = name.slice('web/'.length)
  manifest.files[rel] = { bytes: data.length, sha256: sha(data), from: FROM_NPM.has(name) ? 'three-r128' : rel === 'car.glb' ? 'car' : 'original' }
  if (rel === 'car.glb') {
    const gz = gzipSync(data, { level: 9 })
    const pieces = []
    mkdirSync(join(out, 'car'), { recursive: true })
    for (let i = 0; i * PIECE < gz.length; i++) {
      const file = `car.glb.gz.${i}`
      writeFileSync(join(out, 'car', file), gz.subarray(i * PIECE, (i + 1) * PIECE))
      pieces.push(file)
    }
    manifest.car = { bytes: data.length, sha256: sha(data), gzBytes: gz.length, gzSha256: sha(gz), pieces }
  } else if (!FROM_NPM.has(name)) {
    const dest = join(out, rel)
    if (!dest.startsWith(out)) throw new Error(`unsafe name ${name}`)
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, data)
  }
}
writeFileSync(join(out, 'MANIFEST.json'), JSON.stringify(manifest, null, 1) + '\n')
console.log(`${Object.keys(manifest.files).length} files from ${exe}; car.glb ${manifest.car.bytes} bytes as ${manifest.car.pieces.length} gzip pieces (${manifest.car.gzBytes} bytes)`)
