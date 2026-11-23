/**
 * Control bindings: which keys and which gamepad, yoke or HOTAS axes and buttons drive each control, with per-axis inversion,
 * deadzone and response curve. Defaults cover keyboard and the standard gamepad layout; any axis or button of any connected
 * device can be bound from the controls panel. Bindings are a per-device convenience, so they live in this browser's storage
 * (read and written defensively); a missing or damaged entry falls back to the defaults.
 */
import { z } from 'zod'

export type AxisAction = 'pitch' | 'roll' | 'yaw' | 'throttle' | 'brakeLeft' | 'brakeRight'
export type ButtonAction = 'flapsDown' | 'flapsUp' | 'gear' | 'brakes' | 'parkingBrake' | 'trimUp' | 'trimDown' | 'view' | 'lights' | 'pause' | 'spoilers' | 'reverse' | 'throttleUp' | 'throttleDown'
export type KeyAction = ButtonAction | 'pitchUp' | 'pitchDown' | 'rollLeft' | 'rollRight' | 'yawLeft' | 'yawRight' | 'throttleIdle' | 'throttleFull' | 'hud' | 'devOverlay' | 'lookBack'

const axisBinding = z.object({
  /** Gamepad id substring ('' = any device). */
  device: z.string(),
  axis: z.number().int().min(0).max(31),
  invert: z.boolean(),
  /** 0..0.5 of travel ignored around centre (or at the low end for one-way axes). */
  deadzone: z.number().min(0).max(0.5),
  /** 1 linear, up to 3 for a softer centre. */
  curve: z.number().min(1).max(3),
  /** Throttle and brake levers report -1..1; `unit` maps that to 0..1. */
  unit: z.boolean(),
})

const buttonBinding = z.object({ device: z.string(), button: z.number().int().min(0).max(63) })

export const bindingsSchema = z.object({
  version: z.literal(1),
  keys: z.record(z.string(), z.array(z.string())),
  axes: z.record(z.string(), z.array(axisBinding)),
  buttons: z.record(z.string(), z.array(buttonBinding)),
  /** Keyboard stick speed: share of full travel per second while a key is held. */
  keyRate: z.number().min(0.5).max(6),
  /** Mouse flies the stick (yoke mode) when true. */
  mouseYoke: z.boolean(),
})

export type AxisBinding = z.infer<typeof axisBinding>
export type ButtonBinding = z.infer<typeof buttonBinding>
export type Bindings = z.infer<typeof bindingsSchema>

export const AXIS_ACTIONS: AxisAction[] = ['pitch', 'roll', 'yaw', 'throttle', 'brakeLeft', 'brakeRight']
export const BUTTON_ACTIONS: ButtonAction[] = ['throttleUp', 'throttleDown', 'flapsDown', 'flapsUp', 'gear', 'brakes', 'parkingBrake', 'trimUp', 'trimDown', 'view', 'lights', 'pause', 'spoilers', 'reverse']

export const ACTION_LABELS: Record<AxisAction | KeyAction, string> = {
  pitch: 'Pitch (stick back = up)',
  roll: 'Roll',
  yaw: 'Rudder',
  throttle: 'Throttle',
  brakeLeft: 'Left brake',
  brakeRight: 'Right brake',
  flapsDown: 'Flaps down a notch',
  flapsUp: 'Flaps up a notch',
  gear: 'Landing gear',
  brakes: 'Wheel brakes',
  parkingBrake: 'Parking brake',
  trimUp: 'Trim nose up',
  trimDown: 'Trim nose down',
  view: 'Next camera',
  lights: 'Landing lights',
  pause: 'Pause',
  spoilers: 'Speed brakes',
  reverse: 'Reverse thrust',
  pitchUp: 'Nose up',
  pitchDown: 'Nose down',
  rollLeft: 'Roll left',
  rollRight: 'Roll right',
  yawLeft: 'Rudder left',
  yawRight: 'Rudder right',
  throttleUp: 'Throttle up',
  throttleDown: 'Throttle down',
  throttleIdle: 'Throttle idle',
  throttleFull: 'Throttle full',
  hud: 'Full or minimal HUD',
  devOverlay: 'Performance overlay',
  lookBack: 'Look around (hold)',
}

const linear = (axis: number, invert = false, unit = false): AxisBinding => ({ device: '', axis, invert, deadzone: 0.08, curve: 1.4, unit })

export function defaultBindings(): Bindings {
  return {
    version: 1,
    keys: {
      pitchUp: ['ArrowDown', 'KeyS'],
      pitchDown: ['ArrowUp', 'KeyW'],
      rollLeft: ['ArrowLeft', 'KeyA'],
      rollRight: ['ArrowRight', 'KeyD'],
      yawLeft: ['KeyQ', 'Numpad0'],
      yawRight: ['KeyE', 'NumpadEnter'],
      throttleUp: ['PageUp', 'Equal', 'NumpadAdd'],
      throttleDown: ['PageDown', 'Minus', 'NumpadSubtract'],
      throttleIdle: ['F1'],
      throttleFull: ['F4'],
      flapsDown: ['KeyF', 'F8'],
      flapsUp: ['KeyR', 'F7'],
      gear: ['KeyG'],
      brakes: ['Space', 'Period'],
      parkingBrake: ['KeyP'],
      trimUp: ['BracketRight', 'End'],
      trimDown: ['BracketLeft', 'Home'],
      view: ['KeyC'],
      lights: ['KeyL'],
      pause: ['Escape'],
      spoilers: ['Slash'],
      reverse: ['KeyV'],
      hud: ['KeyH'],
      devOverlay: ['Backquote'],
      lookBack: ['ShiftLeft'],
    },
    axes: {
      roll: [linear(0)],
      pitch: [linear(1)],
      yaw: [linear(2)],
      throttle: [],
      brakeLeft: [],
      brakeRight: [],
    },
    buttons: {
      flapsDown: [{ device: '', button: 0 }],
      flapsUp: [{ device: '', button: 1 }],
      gear: [{ device: '', button: 2 }],
      view: [{ device: '', button: 3 }],
      brakes: [{ device: '', button: 6 }],
      parkingBrake: [{ device: '', button: 8 }],
      trimUp: [{ device: '', button: 13 }],
      trimDown: [{ device: '', button: 12 }],
      pause: [{ device: '', button: 9 }],
      throttleUp: [{ device: '', button: 5 }, { device: '', button: 7 }],
      throttleDown: [{ device: '', button: 4 }],
      lights: [],
      spoilers: [],
      reverse: [],
    },
    keyRate: 2.2,
    mouseYoke: false,
  }
}

const STORAGE_KEY = 'takeflight-bindings-v1'

export function loadBindings(): Bindings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultBindings()
    const parsed = bindingsSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) return defaultBindings()
    const defaults = defaultBindings()
    return { ...defaults, ...parsed.data, keys: { ...defaults.keys, ...parsed.data.keys }, axes: { ...defaults.axes, ...parsed.data.axes }, buttons: { ...defaults.buttons, ...parsed.data.buttons } }
  } catch {
    return defaultBindings()
  }
}

export function saveBindings(bindings: Bindings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings))
  } catch {
    // storage blocked: bindings last for this visit only
  }
}

/** Applies deadzone, curve and inversion to a raw axis value. `unit` axes return 0..1, others -1..1. */
export function shapeAxis(raw: number, binding: AxisBinding): number {
  let value = binding.invert ? -raw : raw
  if (binding.unit) {
    value = (value + 1) / 2
    if (value < binding.deadzone) return 0
    const t = (value - binding.deadzone) / (1 - binding.deadzone)
    return Math.min(1, Math.pow(t, binding.curve))
  }
  const magnitude = Math.abs(value)
  if (magnitude < binding.deadzone) return 0
  const t = Math.min(1, (magnitude - binding.deadzone) / (1 - binding.deadzone))
  return Math.sign(value) * Math.pow(t, binding.curve)
}
