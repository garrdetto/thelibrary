/** Camera as a pure state machine producing { position, lookAt } each fixed step: follow, preview fly-over, flight tracking and the green view. */
import { tuning, type CameraSpec } from '../tuning'
import { add, addScaled, headingVector, lerp, sub, UP, type Vec3 } from './Vector'

export type CameraMode = 'follow' | 'preview' | 'tracking' | 'green'

export interface CameraPose {
  position: Vec3
  lookAt: Vec3
}

export interface CameraState {
  mode: CameraMode
  pose: CameraPose
  velocity: CameraPose
  orbitYaw: number
  orbitPitch: number
  previewTime: number
}

export interface CameraInputs {
  ball: Vec3
  pin: Vec3
  aimYaw: number
  orbitDx: number
  orbitDy: number
  /** Points along the hole from tee to green, used by the preview fly-over. */
  route: readonly Vec3[]
  /** Ground height lookup so the camera never dips under a hill. */
  groundAt: (x: number, z: number) => number
}

export function createCameraState(pose: CameraPose): CameraState {
  return { mode: 'follow', pose, velocity: { position: [0, 0, 0], lookAt: [0, 0, 0] }, orbitYaw: 0, orbitPitch: 0, previewTime: 0 }
}

export function setCameraMode(state: CameraState, mode: CameraMode): CameraState {
  if (state.mode === mode) return state
  return { ...state, mode, previewTime: 0, orbitYaw: mode === 'follow' || mode === 'green' ? state.orbitYaw : 0 }
}

/**
 * Critically damped spring toward a target, solved in closed form so it is stable at any step size.
 * The ODE x″ = −2ω x′ − ω²(x − x*) has damping ratio ζ = 1 (no overshoot, fastest settle). With e = x − x*:
 *   k  = (v + ω e) Δt
 *   v′ = (v − ω k) e^(−ωΔt)
 *   x′ = x* + (e + k) e^(−ωΔt)
 * ω (the stiffness, rad/s) sets how quickly the chase closes the gap: about 4/ω seconds to settle.
 */
export function springStep(value: number, velocity: number, target: number, stiffness: number, dt: number): [number, number] {
  const error = value - target
  const k = (velocity + stiffness * error) * dt
  const decay = Math.exp(-stiffness * dt)
  return [target + (error + k) * decay, (velocity - stiffness * k) * decay]
}

function springVec(value: Vec3, velocity: Vec3, target: Vec3, stiffness: number, dt: number): [Vec3, Vec3] {
  const x = springStep(value[0], velocity[0], target[0], stiffness, dt)
  const y = springStep(value[1], velocity[1], target[1], stiffness, dt)
  const z = springStep(value[2], velocity[2], target[2], stiffness, dt)
  return [
    [x[0], y[0], z[0]],
    [x[1], y[1], z[1]],
  ]
}

function routePoint(route: readonly Vec3[], t: number): Vec3 {
  if (route.length === 1) return route[0]
  const scaled = Math.max(0, Math.min(1, t)) * (route.length - 1)
  const index = Math.min(route.length - 2, Math.floor(scaled))
  return lerp(route[index], route[index + 1], scaled - index)
}

function clampAboveGround(position: Vec3, inputs: CameraInputs, clearance: number): Vec3 {
  const floor = inputs.groundAt(position[0], position[2]) + clearance
  return position[1] < floor ? [position[0], floor, position[2]] : position
}

/** Behind the ball on the aim line, rotated by the pointer orbit, looking a fixed distance down the aim. */
export function followPose(inputs: CameraInputs, orbitYaw: number, orbitPitch: number, spec: CameraSpec = tuning.camera): CameraPose {
  const yaw = inputs.aimYaw + orbitYaw
  const forward = headingVector(yaw)
  const back = -spec.followDistance * Math.cos(orbitPitch)
  const height = spec.followHeight + spec.followDistance * Math.sin(orbitPitch)
  const position = clampAboveGround(add(addScaled(inputs.ball, forward, back), [0, height, 0]), inputs, spec.groundClearance)
  return { position, lookAt: addScaled(addScaled(inputs.ball, forward, spec.followLookAhead), UP, spec.lookAtLift) }
}

/** High, tilted view over the putt: above and a little behind the ball, looking just past it toward the pin. */
export function greenPose(inputs: CameraInputs, orbitYaw: number, spec: CameraSpec = tuning.camera): CameraPose {
  const toPin = sub(inputs.pin, inputs.ball)
  const distance = Math.hypot(toPin[0], toPin[2])
  const yaw = (distance > spec.minHeadingDistance ? Math.atan2(toPin[0], toPin[2]) : inputs.aimYaw) + orbitYaw
  const forward = headingVector(yaw)
  const position = add(addScaled(inputs.ball, forward, -spec.greenBack - distance * spec.greenBackPerMetre), [0, spec.greenHeight + distance * spec.greenHeightPerMetre, 0])
  return { position, lookAt: addScaled(inputs.ball, forward, spec.greenTiltLookAhead + distance * spec.greenLookPerMetre) }
}

/**
 * Advances the camera one fixed step. Preview flies along the route from tee to green over previewSeconds, then hands
 * over to follow. Tracking chases the ball from behind its direction of travel through the critically damped spring,
 * so fast drives stay smooth. Follow and green snap toward their poses through a stiffer spring.
 */
export function stepCamera(state: CameraState, inputs: CameraInputs, dt: number, spec: CameraSpec = tuning.camera): CameraState {
  const orbitYaw = state.orbitYaw + inputs.orbitDx * spec.orbitSensitivity
  const orbitPitch = Math.max(spec.pitchRange[0], Math.min(spec.pitchRange[1], state.orbitPitch + inputs.orbitDy * spec.orbitPitchSensitivity))
  let target: CameraPose
  let stiffness = spec.followStiffness
  let previewTime = state.previewTime
  let mode = state.mode
  switch (state.mode) {
    case 'preview': {
      previewTime += dt
      const t = previewTime / spec.previewSeconds
      if (t >= 1) {
        mode = 'follow'
        target = followPose(inputs, orbitYaw, orbitPitch, spec)
        break
      }
      const eased = t * t * (3 - 2 * t)
      const focus = routePoint(inputs.route, eased)
      const ahead = routePoint(inputs.route, Math.min(1, eased + spec.previewLead))
      const heading = Math.atan2(ahead[0] - focus[0], ahead[2] - focus[2]) || inputs.aimYaw
      const back = headingVector(heading)
      const position = clampAboveGround(add(addScaled(focus, back, -spec.previewBack), [0, spec.previewHeight, 0]), inputs, spec.previewClearance)
      return { ...state, previewTime, orbitYaw, orbitPitch, pose: { position, lookAt: ahead }, velocity: { position: [0, 0, 0], lookAt: [0, 0, 0] } }
    }
    case 'tracking': {
      const travel = sub(inputs.ball, state.pose.lookAt)
      const heading = Math.hypot(travel[0], travel[2]) > spec.minHeadingDistance ? Math.atan2(travel[0], travel[2]) : inputs.aimYaw
      const back = headingVector(heading)
      const position = clampAboveGround(add(addScaled(inputs.ball, back, -spec.trackingDistance), [0, spec.trackingHeight, 0]), inputs, spec.trackingClearance)
      target = { position, lookAt: inputs.ball }
      stiffness = spec.trackingStiffness
      break
    }
    case 'green':
      target = greenPose(inputs, orbitYaw, spec)
      break
    case 'follow':
      target = followPose(inputs, orbitYaw, orbitPitch, spec)
      break
  }
  const [position, positionVelocity] = springVec(state.pose.position, state.velocity.position, target.position, stiffness, dt)
  const [lookAt, lookVelocity] = springVec(state.pose.lookAt, state.velocity.lookAt, target.lookAt, stiffness, dt)
  return { mode, previewTime, orbitYaw, orbitPitch, pose: { position, lookAt }, velocity: { position: positionVelocity, lookAt: lookVelocity } }
}
