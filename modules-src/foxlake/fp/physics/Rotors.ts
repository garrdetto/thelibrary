/**
 * A helicopter's spinning rotors. The model (modules-src/foxlake/tools/build-helicopter.py) carries them as nodes
 * named `rotor-main` and `rotor-tail`; the asset pipeline quantizes their meshes, which moves each node's origin off
 * the hub, so each is hung under a pivot placed at its hub from the tuning (`flight.rotors`, model frame) and the
 * pivot turns: the main rotor about its up axis, the tail fan about its side axis. The model loads after the view is
 * made, so the nodes are looked for until they turn up.
 */
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { FlightTuning } from '../../../maplestreet/shared/Vehicles'

/** Full-speed turn rates (rad/s): about 400 rpm for the main rotor, the tail fan much faster. */
const MAIN_RATE = 42
const TAIL_RATE = 160

export class Rotors {
  private main: TransformNode | null = null
  private tail: TransformNode | null = null
  private found = false

  constructor(private readonly root: TransformNode, private readonly flight: FlightTuning) {}

  private hang(node: TransformNode, at: { x: number; y: number; z: number }): TransformNode {
    const pivot = new TransformNode(`${node.name}-pivot`, node.getScene())
    pivot.parent = node.parent
    pivot.position.set(at.x, at.y, at.z)
    pivot.computeWorldMatrix(true)
    node.computeWorldMatrix(true)
    node.setParent(pivot)
    return pivot
  }

  private find(): void {
    for (const n of this.root.getDescendants(false)) {
      if (!(n instanceof TransformNode)) continue
      if (!this.main && n.name.startsWith('rotor-main')) this.main = this.hang(n, this.flight.rotors.main)
      else if (!this.tail && n.name.startsWith('rotor-tail')) this.tail = this.hang(n, this.flight.rotors.tail)
    }
    this.found = !!this.main && !!this.tail
  }

  /** Turns the rotors for `dt` seconds at `spool` (0 stopped, 1 flying). */
  update(dt: number, spool: number): void {
    if (!this.found) this.find()
    if (spool <= 0) return
    if (this.main) this.main.rotation.y = (this.main.rotation.y + MAIN_RATE * spool * dt) % (Math.PI * 2)
    if (this.tail) this.tail.rotation.z = (this.tail.rotation.z + TAIL_RATE * spool * dt) % (Math.PI * 2)
  }
}
