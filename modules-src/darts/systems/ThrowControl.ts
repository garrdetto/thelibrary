/** The pure parts of the throw controls, kept apart from the DOM so the tests can drive them: placing the target by tapping or dragging the board (`grabsTarget`, `startAimDrag`, `dragAim`), and what the Throw button, Space or Enter on the button does at each stage of the height and side meters (`throwStep`, `throwButtonText`). */

export interface BoardPoint {
  x: number
  y: number
}

/** A drag of the target in progress: the target sits at `anchor` moved by however far the pointer has travelled from `origin` (board metres). */
export interface AimDrag {
  anchor: BoardPoint
  origin: BoardPoint
}

/** Whether a press lands close enough to the target to pick it up instead of moving it there; both points and the radius are in CSS pixels. */
export function grabsTarget(target: BoardPoint | null, press: BoardPoint, radiusPx: number): boolean {
  return !!target && Math.hypot(target.x - press.x, target.y - press.y) <= radiusPx
}

/** Starts moving the target with a press at `press` (board metres). Grabbing keeps the target where it is and moves it by the drag, so the finger never has to cover it; otherwise the target jumps under the press and then follows the drag. */
export function startAimDrag(aim: BoardPoint, press: BoardPoint, grab: boolean): AimDrag {
  return { anchor: grab ? { x: aim.x, y: aim.y } : { x: press.x, y: press.y }, origin: { x: press.x, y: press.y } }
}

/** Where the target is while the pointer is at `point` (board metres) during a drag. */
export function dragAim(drag: AimDrag, point: BoardPoint): BoardPoint {
  return { x: drag.anchor.x + point.x - drag.origin.x, y: drag.anchor.y + point.y - drag.origin.y }
}

export type ThrowPhase = 'idle' | 'charging' | 'sweeping'

/** `charge` starts the height meter, `lock` fixes the height and starts the side meter (cross meter), `throw` throws. */
export type ThrowStep = 'none' | 'charge' | 'lock' | 'throw'

/** What pressing or letting go of Throw does. A press starts the height meter, or stops the side meter and throws while it sweeps; letting go of the same button or key that started the height meter (`owner`) locks the height (cross meter) or throws (classic). Anything else does nothing, so a second finger or key never doubles a step. */
export function throwStep(phase: ThrowPhase, action: 'press' | 'release', cross: boolean, owner: boolean): ThrowStep {
  if (action === 'press') return phase === 'idle' ? 'charge' : phase === 'sweeping' ? 'throw' : 'none'
  return phase === 'charging' && owner ? (cross ? 'lock' : 'throw') : 'none'
}

export interface ThrowButtonText {
  label: string
  sub: string
  aria: string
}

/** The Throw button's words for each stage. */
export function throwButtonText(phase: ThrowPhase, cross: boolean): ThrowButtonText {
  if (phase === 'sweeping') return { label: 'Stop', sub: 'Tap', aria: 'Stop the side meter and throw' }
  if (phase === 'charging') return { label: 'Throw', sub: 'Let go', aria: cross ? 'Let go in the green to lock the height' : 'Let go in the green to throw' }
  return {
    label: 'Throw',
    sub: 'Hold',
    aria: cross ? 'Throw: hold to swing the height meter, let go in the green, then press again in the green to stop the side meter' : 'Throw: hold to swing the meter and let go in the green',
  }
}
