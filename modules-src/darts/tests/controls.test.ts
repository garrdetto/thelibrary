import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { config } from '../config'
import { CAMERA_EYE, CAMERA_LOOK_AT, fitFov } from '../render/CameraFit'
import { BULL_HEIGHT, RADII } from '../shared/Board'
import { METER } from '../shared/Physics'
import { dragAim, grabsTarget, startAimDrag, throwButtonText, throwStep, type ThrowPhase } from '../systems/ThrowControl'
import { meterLayout, type Box, type MeterLayout } from '../ui/MeterLayout'

const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps

test('tapping the board puts the target under the tap and dragging moves it with the pointer', () => {
  const aim = { x: 0, y: 0.103 }
  const press = { x: 0.05, y: -0.02 }
  const jump = startAimDrag(aim, press, false)
  assert.deepEqual(dragAim(jump, press), press)
  const moved = dragAim(jump, { x: 0.07, y: -0.01 })
  assert.ok(near(moved.x, 0.07) && near(moved.y, -0.01))
})

test('pressing near the target picks it up where it is and moves it by the drag, so the finger need not cover it', () => {
  const aim = { x: 0, y: 0.103 }
  const press = { x: 0.012, y: 0.09 }
  const grab = startAimDrag(aim, press, true)
  const still = dragAim(grab, press)
  assert.ok(near(still.x, aim.x) && near(still.y, aim.y))
  const moved = dragAim(grab, { x: 0.017, y: 0.08 })
  assert.ok(near(moved.x, 0.005) && near(moved.y, 0.093))
  assert.equal(aim.x, 0)
})

test('a press within the grab radius of the target grabs it; further away, or with no target on screen, it jumps', () => {
  const radius = config.gesture.grabRadiusPx
  assert.equal(radius, 40)
  assert.ok(grabsTarget({ x: 200, y: 300 }, { x: 200 + radius, y: 300 }, radius))
  assert.ok(grabsTarget({ x: 200, y: 300 }, { x: 224, y: 324 }, radius))
  assert.ok(!grabsTarget({ x: 200, y: 300 }, { x: 230, y: 330 }, radius))
  assert.ok(!grabsTarget(null, { x: 200, y: 300 }, radius))
})

test('cross meter: hold Throw to charge, let go to lock the height, press again to stop the side meter and throw', () => {
  let phase: ThrowPhase = 'idle'
  assert.equal(throwStep(phase, 'release', true, false), 'none')
  assert.equal(throwStep(phase, 'press', true, false), 'charge')
  phase = 'charging'
  assert.equal(throwStep(phase, 'press', true, false), 'none', 'a second finger or Space while charging does nothing')
  assert.equal(throwStep(phase, 'release', true, false), 'none', 'letting go of a key that did not start the charge does nothing')
  assert.equal(throwStep(phase, 'release', true, true), 'lock')
  phase = 'sweeping'
  assert.equal(throwStep(phase, 'release', true, false), 'none')
  assert.equal(throwStep(phase, 'press', true, false), 'throw')
  phase = 'idle'
  assert.equal(throwStep(phase, 'release', true, true), 'none', 'letting go of the press that threw does not start anything')
})

test('classic meter: hold Throw to charge and let go to throw', () => {
  assert.equal(throwStep('idle', 'press', false, false), 'charge')
  assert.equal(throwStep('charging', 'release', false, true), 'throw')
  assert.equal(throwStep('charging', 'release', false, false), 'none')
})

test('the Throw button says what the next press does', () => {
  assert.deepEqual([throwButtonText('idle', true).label, throwButtonText('idle', true).sub], ['Throw', 'Hold'])
  assert.deepEqual([throwButtonText('charging', true).label, throwButtonText('charging', true).sub], ['Throw', 'Let go'])
  assert.deepEqual([throwButtonText('sweeping', true).label, throwButtonText('sweeping', true).sub], ['Stop', 'Tap'])
  assert.match(throwButtonText('idle', true).aria, /side meter/)
  assert.doesNotMatch(throwButtonText('idle', false).aria, /side meter/)
})

interface View {
  width: number
  height: number
  bullX: number
  bullY: number
  radius: number
  top: number
}

/** The board as `index.ts` frames it: the same eye, look point and fitted field of view, projected to CSS pixels. */
function view(width: number, height: number): View {
  const camera = new THREE.PerspectiveCamera(fitFov(width / height), width / height, 0.05, 60)
  camera.position.set(...CAMERA_EYE)
  camera.lookAt(new THREE.Vector3(...CAMERA_LOOK_AT))
  camera.updateMatrixWorld()
  camera.updateProjectionMatrix()
  const toScreen = (x: number, y: number) => {
    const point = new THREE.Vector3(x, y, 0).project(camera)
    return { x: ((point.x + 1) / 2) * width, y: ((1 - point.y) / 2) * height }
  }
  const radius = RADII.board / 1000
  const bull = toScreen(0, BULL_HEIGHT)
  const edge = toScreen(radius, BULL_HEIGHT)
  const top = toScreen(0, BULL_HEIGHT + radius)
  return { width, height, bullX: bull.x, bullY: bull.y, radius: edge.x - bull.x, top: top.y }
}

test('the camera frames the board larger than before and keeps all of it in view', () => {
  for (const [width, height] of [[1440, 900], [844, 390], [390, 844], [1024, 768], [768, 1024]]) {
    const board = view(width, height)
    const share = (board.radius * 2) / Math.min(width, height)
    assert.ok(share > 0.85, `${width}×${height}: the board fills ${share.toFixed(3)} of the short side`)
    assert.ok(board.top >= 0, `${width}×${height}: the top of the board is in view`)
    assert.ok(board.bullY + board.radius <= height, `${width}×${height}: the bottom of the board is in view`)
  }
  assert.ok(config.camera.minFov <= fitFov(16 / 9) && fitFov(16 / 9) < 12, 'landscape views are no longer held at the old 12° limit')
})

/** The Throw button's box from overlay.css: a `--throw-size` circle 16 px in from the bottom-right corner. */
function throwBox(width: number, height: number, size: number): Box {
  return { left: width - 16 - size, top: height - 16 - size, right: width - 16, bottom: height - 16 }
}

function footprint(layout: MeterLayout, narrow: boolean): Box {
  const bar = narrow ? 22 : 34
  const center = layout.left + bar / 2
  const half = Math.max(bar / 2, layout.half)
  return { left: center - half, right: center + half, top: layout.top - layout.height / 2, bottom: layout.top + layout.height / 2 }
}

const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
const sideScale = (2 * METER.sideRange) / (config.gesture.chargeHigh - config.gesture.chargeLow)

test('the meter goes beside the board on a computer and a landscape phone, clear of the board and the Throw button', () => {
  for (const [width, height, size] of [[1440, 900, 108], [844, 390, 96], [1024, 768, 108], [1280, 720, 108]]) {
    for (const cross of [true, false]) {
      const board = view(width, height)
      const avoid = throwBox(width, height, size)
      const layout = meterLayout({ width, height, bullX: board.bullX, bullY: board.bullY, boardRadius: board.radius, cross, narrow: false, sideScale, avoid })
      const box = footprint(layout, false)
      const where = `${width}×${height} ${cross ? 'cross' : 'classic'}`
      assert.equal(layout.spot, 'side', where)
      assert.ok(box.left >= board.bullX + board.radius, `${where}: meter clear of the board`)
      assert.ok(box.right <= width && box.top >= 50 && box.bottom <= height, `${where}: meter on screen below the top bar`)
      assert.ok(!overlaps(box, avoid), `${where}: meter clear of the Throw button`)
      assert.ok(layout.height >= 140, `${where}: meter tall enough to read`)
    }
  }
})

test('on a tall phone the meter sits above the board on the right, clear of the board and the Throw button', () => {
  for (const [width, height] of [[390, 844], [412, 915], [360, 780]]) {
    for (const cross of [true, false]) {
      const board = view(width, height)
      const avoid = throwBox(width, height, 100)
      const layout = meterLayout({ width, height, bullX: board.bullX, bullY: board.bullY, boardRadius: board.radius, cross, narrow: true, sideScale, avoid })
      const box = footprint(layout, true)
      const where = `${width}×${height} ${cross ? 'cross' : 'classic'}`
      assert.equal(layout.spot, 'above', where)
      assert.ok(box.bottom <= board.top, `${where}: meter above the board`)
      assert.ok(box.left >= width / 2 && box.right <= width && box.top >= 56, `${where}: meter in the top right, below the top bar`)
      assert.ok(!overlaps(box, avoid), `${where}: meter clear of the Throw button`)
      assert.ok(layout.tight, `${where}: no label on a phone`)
    }
  }
})

test('with no room beside or above the board the meter keeps to the right edge, on screen and clear of the Throw button', () => {
  for (const [width, height, narrow] of [[375, 667, true], [768, 1024, false]] as const) {
    const board = view(width, height)
    const avoid = throwBox(width, height, narrow ? 100 : 108)
    const layout = meterLayout({ width, height, bullX: board.bullX, bullY: board.bullY, boardRadius: board.radius, cross: true, narrow, sideScale, avoid })
    const box = footprint(layout, narrow)
    assert.equal(layout.spot, 'edge')
    assert.ok(box.left >= 0 && box.right <= width - 9 && box.top >= 0 && box.bottom <= height, `${width}×${height}: on screen`)
    assert.ok(!overlaps(box, avoid), `${width}×${height}: clear of the Throw button`)
    assert.ok(layout.height >= 140)
  }
  const tablet = view(768, 1024)
  const layout = meterLayout({ width: 768, height: 1024, bullX: tablet.bullX, bullY: tablet.bullY, boardRadius: tablet.radius, cross: true, narrow: false, sideScale, avoid: throwBox(768, 1024, 108) })
  assert.ok(footprint(layout, false).left >= tablet.bullX + tablet.radius * (RADII.doubleOuter / RADII.board) - 0.5, 'a tablet keeps the meter over the number ring only')
})
