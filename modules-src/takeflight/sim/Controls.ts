/**
 * One tick of pilot input. Axes are quantised to 1/127 steps (and levers to whole detents) before the sim sees them, so a replay
 * that stores a byte per axis feeds the model exactly what the live flight did.
 */

export interface ControlInput {
  /** -1..1, +1 full back stick. */
  pitch: number
  /** -1..1, +1 full right. */
  roll: number
  /** -1..1, +1 full right pedal. */
  yaw: number
  /** 0..1 per engine lever (all engines share it in this model). */
  throttle: number
  /** 0..1 each. */
  brakeLeft: number
  brakeRight: number
  /** Flap lever detent index. */
  flaps: number
  /** 1 gear down, 0 up. */
  gear: number
  /** 0..1 speed brake lever. */
  spoilers: number
  /** 1 while reverse thrust is selected. */
  reverse: number
  /** -1, 0 or +1 while the trim switch is held (+1 nose up). */
  trim: number
  /** 1 while the parking brake is set. */
  parkingBrake: number
}

export const INPUT_BYTES = 12

export function createInput(): ControlInput {
  return { pitch: 0, roll: 0, yaw: 0, throttle: 0, brakeLeft: 0, brakeRight: 0, flaps: 0, gear: 1, spoilers: 0, reverse: 0, trim: 0, parkingBrake: 0 }
}

export function copyInput(from: ControlInput, to: ControlInput): ControlInput {
  to.pitch = from.pitch
  to.roll = from.roll
  to.yaw = from.yaw
  to.throttle = from.throttle
  to.brakeLeft = from.brakeLeft
  to.brakeRight = from.brakeRight
  to.flaps = from.flaps
  to.gear = from.gear
  to.spoilers = from.spoilers
  to.reverse = from.reverse
  to.trim = from.trim
  to.parkingBrake = from.parkingBrake
  return to
}

const axisByte = (value: number) => Math.round((value < -1 ? -1 : value > 1 ? 1 : value) * 127)
const unitByte = (value: number) => Math.round((value < 0 ? 0 : value > 1 ? 1 : value) * 255)

/** Writes the input as 12 bytes at `offset`. */
export function encodeInput(input: ControlInput, out: Uint8Array, offset: number): void {
  out[offset] = axisByte(input.pitch) & 0xff
  out[offset + 1] = axisByte(input.roll) & 0xff
  out[offset + 2] = axisByte(input.yaw) & 0xff
  out[offset + 3] = unitByte(input.throttle)
  out[offset + 4] = unitByte(input.brakeLeft)
  out[offset + 5] = unitByte(input.brakeRight)
  out[offset + 6] = Math.max(0, Math.min(15, Math.round(input.flaps)))
  out[offset + 7] = input.gear >= 0.5 ? 1 : 0
  out[offset + 8] = unitByte(input.spoilers)
  out[offset + 9] = input.reverse >= 0.5 ? 1 : 0
  out[offset + 10] = (input.trim > 0.5 ? 1 : input.trim < -0.5 ? -1 : 0) & 0xff
  out[offset + 11] = input.parkingBrake >= 0.5 ? 1 : 0
}

const signedByte = (byte: number) => (byte > 127 ? byte - 256 : byte)

export function decodeInput(bytes: Uint8Array, offset: number, out: ControlInput): ControlInput {
  out.pitch = signedByte(bytes[offset]) / 127
  out.roll = signedByte(bytes[offset + 1]) / 127
  out.yaw = signedByte(bytes[offset + 2]) / 127
  out.throttle = bytes[offset + 3] / 255
  out.brakeLeft = bytes[offset + 4] / 255
  out.brakeRight = bytes[offset + 5] / 255
  out.flaps = bytes[offset + 6]
  out.gear = bytes[offset + 7]
  out.spoilers = bytes[offset + 8] / 255
  out.reverse = bytes[offset + 9]
  out.trim = signedByte(bytes[offset + 10])
  out.parkingBrake = bytes[offset + 11]
  return out
}

const scratch = new Uint8Array(INPUT_BYTES)

/** Rounds `input` in place to exactly what its encoded bytes decode to. */
export function quantizeInput(input: ControlInput): ControlInput {
  encodeInput(input, scratch, 0)
  return decodeInput(scratch, 0, input)
}
