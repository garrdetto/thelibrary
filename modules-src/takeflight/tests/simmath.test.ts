import { test } from 'node:test'
import assert from 'node:assert/strict'
import { acos, asin, atan, atan2, cos, exp, ln, pow, sin, tanh } from '../sim/SimMath'

function close(actual: number, expected: number, tolerance: number, label: string): void {
  const scale = Math.max(1, Math.abs(expected))
  assert.ok(Math.abs(actual - expected) <= tolerance * scale, `${label}: ${actual} vs ${expected}`)
}

test('trigonometry matches Math to 1e-9 across many turns', () => {
  for (let x = -60; x <= 60; x += 0.0137) {
    close(sin(x), Math.sin(x), 1e-9, `sin(${x})`)
    close(cos(x), Math.cos(x), 1e-9, `cos(${x})`)
  }
})

test('inverse trigonometry matches Math', () => {
  for (let x = -40; x <= 40; x += 0.0071) close(atan(x), Math.atan(x), 1e-10, `atan(${x})`)
  for (let y = -3; y <= 3; y += 0.37) for (let x = -3; x <= 3; x += 0.41) close(atan2(y, x), Math.atan2(y, x), 1e-10, `atan2(${y},${x})`)
  for (let x = -1; x <= 1; x += 0.0093) {
    close(asin(x), Math.asin(x), 1e-9, `asin(${x})`)
    close(acos(x), Math.acos(x), 1e-9, `acos(${x})`)
  }
})

test('exp, ln, pow and tanh match Math', () => {
  for (let x = -50; x <= 50; x += 0.0391) close(exp(x), Math.exp(x), 1e-12, `exp(${x})`)
  for (let x = 1e-6; x < 1e6; x *= 1.37) close(ln(x), Math.log(x), 1e-12, `ln(${x})`)
  for (let b = 0.1; b < 3; b += 0.17) for (let e = -6; e < 6; e += 0.53) close(pow(b, e), Math.pow(b, e), 1e-11, `pow(${b},${e})`)
  for (let x = -8; x <= 8; x += 0.07) close(tanh(x), Math.tanh(x), 1e-12, `tanh(${x})`)
})
