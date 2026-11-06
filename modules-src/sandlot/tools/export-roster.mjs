#!/usr/bin/env node
/**
 * Prints the Sandlot Sluggers roster (ROSTER in modules-src/sandlot/index.html) as JSON: id, nick, height, bats,
 * throws and look (colors, body, hair, accessories and costume fit). tools/build-kids.py runs it so the Blender
 * sprites always follow the game's own data.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8')
const start = html.indexOf('const ROSTER = [')
if (start < 0) throw new Error('ROSTER not found in index.html')
let depth = 0
let end = html.indexOf('[', start)
for (; end < html.length; end++) {
  const ch = html[end]
  if (ch === '[') depth++
  else if (ch === ']' && --depth === 0) break
}
const roster = vm.runInNewContext(`(${html.slice(html.indexOf('[', start), end + 1)})`)
const BASE_HEIGHT = { tiny: 3.9, average: 4.4, lanky: 4.95, stocky: 4.55 }
const out = roster.map((k) => ({
  id: k.id, nick: k.nick, age: k.age, bats: k.bats, throws: k.throws, sig: k.sig || null, quirk: k.quirk || null, look: k.look,
  height: BASE_HEIGHT[k.look.body] + (k.age - 10) * 0.08 + (k.look.acc.includes('tall') ? 0.25 : 0),
}))
process.stdout.write(JSON.stringify({ kids: out }, null, 1))
