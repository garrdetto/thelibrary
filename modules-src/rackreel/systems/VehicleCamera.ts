/**
 * The driving camera's yaw: it turns with the vehicle, so the view always looks the way the vehicle is headed. The
 * mouse and arrow keys still look around; `LOOK_HOLD` seconds after the last look the view eases back behind the
 * vehicle (`RETURN_SECONDS` is the time constant of that pan). Renderer-free: Game feeds it the camera yaw it finds
 * each frame and writes back the yaw it returns.
 */

/** Seconds after the last mouse or arrow-key look before the view starts back toward the vehicle's heading. */
export const LOOK_HOLD = 1.1
/** Time constant (seconds) of the pan back: about two thirds of the way in this long, nearly all of it in three. */
export const RETURN_SECONDS = 0.9
/** A camera turn smaller than this between frames is not counted as looking around. */
const LOOK_EPSILON = 1e-4

export function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a))
}

export class VehicleCamera {
  private lastYaw = 0
  private lastHeading = 0
  private sinceLook = Infinity
  private active = false

  /** Starts following, with the view straight behind the vehicle. */
  reset(heading: number): void {
    this.lastYaw = heading
    this.lastHeading = heading
    this.sinceLook = Infinity
    this.active = true
  }

  /** Stops following (out of the vehicle, anchored, on deck): the next `follow` starts from wherever the camera is. */
  release(): void {
    this.active = false
  }

  /** How far the view is turned from the vehicle's heading (radians). */
  get offset(): number {
    return wrapAngle(this.lastYaw - this.lastHeading)
  }

  /**
   * `yaw` is the camera's yaw now (after this frame's mouse and arrow-key look), `heading` the vehicle's. Returns the
   * yaw to use: the vehicle's turn since last frame added, and any look-around offset easing back toward zero.
   */
  follow(yaw: number, heading: number, dt: number): number {
    if (!this.active) {
      this.active = true
      this.lastYaw = yaw
      this.lastHeading = heading
      this.sinceLook = 0
    }
    const looked = wrapAngle(yaw - this.lastYaw)
    if (Math.abs(looked) > LOOK_EPSILON) this.sinceLook = 0
    else this.sinceLook += dt
    let offset = wrapAngle(this.lastYaw - this.lastHeading + looked)
    if (this.sinceLook >= LOOK_HOLD) offset *= Math.exp(-dt / RETURN_SECONDS)
    if (Math.abs(offset) < 1e-4) offset = 0
    const out = yaw + wrapAngle(heading + offset - yaw)
    this.lastYaw = out
    this.lastHeading = heading
    return out
  }
}
