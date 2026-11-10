import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseControls } from '../ui/Controls'

test('control hints become keycaps and labels', () => {
  assert.deepEqual(parseControls('E — go bowfishing with Wisco Wild Man'), [{ keys: ['E'], text: 'Go bowfishing with Wisco Wild Man' }])
  assert.deepEqual(parseControls('Hold left-click to draw · L lights · W/S speed · Space hold · F flats · E take me in'), [
    { keys: ['LMB'], text: 'Hold to draw' },
    { keys: ['L'], text: 'Lights' },
    { keys: ['W', 'S'], text: 'Speed' },
    { keys: ['Space'], text: 'Hold' },
    { keys: ['F'], text: 'Flats' },
    { keys: ['E'], text: 'Take me in' },
  ])
  assert.deepEqual(parseControls('Hold R or right-click to reel · ease off when he runs'), [{ keys: ['R', 'RMB'], text: 'Hold to reel' }, { keys: [], text: 'ease off when he runs' }])
  assert.deepEqual(parseControls('Right-click to aim · Shift to hold your breath'), [{ keys: ['RMB'], text: 'Aim' }, { keys: ['Shift'], text: 'Hold your breath' }])
  assert.deepEqual(parseControls('Press 2 for the rifle · E to climb down'), [{ keys: ['2'], text: 'The rifle' }, { keys: ['E'], text: 'Climb down' }])
  assert.deepEqual(parseControls('Click the view for mouse look · arrow keys also look around'), [{ keys: ['LMB'], text: 'Mouse look' }, { keys: ['←', '↑', '↓', '→'], text: 'Also look around' }])
  assert.deepEqual(parseControls('Climbing up…'), [{ keys: [], text: 'Climbing up…' }])
  assert.deepEqual(parseControls('Watch the bobber… R to reel in'), [{ keys: [], text: 'Watch the bobber… R to reel in' }])
  assert.deepEqual(parseControls(''), [])
})
