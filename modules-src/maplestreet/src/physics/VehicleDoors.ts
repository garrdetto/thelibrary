/**
 * Opening doors for the enclosed built-in vehicles. Each door is its own
 * leaf (painted panel, window, handle) hinged at its front edge, sitting just
 * proud of the body side, so it can swing out on its hinge: the driver's door
 * opens when someone gets in or out, and "Open doors" opens them all.
 * Open-air vehicles (golf cart, four-wheeler, mowers, trailer) have none.
 *
 * Coordinates are chassis space: +X forward, +Y up, +Z right. Each entry is
 * the right-hand door; the left one is its mirror.
 */
import * as THREE from 'three/webgpu';

export interface DoorSpec {
  /** Hinge (front edge) and rear edge, along X. */
  front: number; back: number;
  /** Bottom of the panel, the beltline (top of the panel) and the top of the window frame. */
  bottom: number; belt: number; top: number;
  /** Outer face of the body side (|z|). */
  side: number;
  /** How far the top of the window frame leans back at the hinge (windscreen pillar). */
  rake?: number;
}

export const DOOR_SPECS: Partial<Record<string, DoorSpec[]>> = {
  truck: [{ front: 1.12, back: -0.3, bottom: -0.26, belt: 0.64, top: 1.3, side: 0.93, rake: 0.32 }],
  hdtruck: [
    { front: 1.3, back: 0.36, bottom: -0.28, belt: 1.0, top: 1.76, side: 1.02, rake: 0.42 },
    { front: 0.32, back: -0.8, bottom: -0.28, belt: 1.0, top: 1.76, side: 1.02 },
  ],
  sedan: [
    { front: 0.86, back: -0.18, bottom: -0.2, belt: 0.44, top: 0.86, side: 0.9, rake: 0.36 },
    { front: -0.22, back: -0.98, bottom: -0.2, belt: 0.44, top: 0.86, side: 0.9 },
  ],
  coupe: [{ front: 0.7, back: -0.95, bottom: -0.2, belt: 0.48, top: 0.94, side: 0.97, rake: 0.5 }],
};

const OPEN_ANGLE = 1.15;
const SWING_RATE = 3.2;
const glass = new THREE.MeshStandardMaterial({ color: 0x1b2630, metalness: 0.2, roughness: 0.05, transparent: true, opacity: 0.55 });
const chrome = new THREE.MeshStandardMaterial({ color: 0xdadada, metalness: 1, roughness: 0.12 });
const trim = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.6 });

interface Leaf { pivot: THREE.Group; side: 1 | -1; front: boolean; angle: number }

function leafMesh(spec: DoorSpec, paint: THREE.Material, side: 1 | -1) {
  const g = new THREE.Group();
  const len = spec.front - spec.back, t = 0.05;
  const add = (mat: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
  };
  const panelH = spec.belt - spec.bottom;
  add(paint, len, panelH, t, -len / 2, spec.bottom + panelH / 2);
  const frameH = spec.top - spec.belt, rake = Math.min(spec.rake ?? 0, len * 0.45);
  const winLen = len - rake - 0.08;
  add(glass, winLen, frameH - 0.06, t * 0.4, -rake - 0.04 - winLen / 2, spec.belt + frameH / 2 - 0.02);
  add(paint, winLen + 0.06, 0.05, t, -rake - 0.04 - winLen / 2, spec.top - 0.025);
  add(paint, 0.06, frameH, t, -len + 0.03, spec.belt + frameH / 2);
  if (rake > 0) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.06, Math.hypot(rake, frameH), t), paint);
    pillar.position.set(-rake / 2 - 0.02, spec.belt + frameH / 2, 0);
    pillar.rotation.z = Math.atan2(rake, frameH);
    pillar.castShadow = true;
    g.add(pillar);
  }
  add(trim, len, 0.03, t * 1.1, -len / 2, spec.belt);
  add(chrome, 0.2, 0.03, 0.03, -len + 0.22, spec.belt - 0.16, side * (t / 2 + 0.012));
  return g;
}

export class VehicleDoors {
  readonly group = new THREE.Group();
  private leaves: Leaf[] = [];
  private driverSide: 1 | -1;
  private allOpen = false;
  private driverHold = 0;

  /** Doors for this kind, or null when it has none. */
  static for(kind: string, paint: THREE.Material, seatZ: number): VehicleDoors | null {
    const specs = DOOR_SPECS[kind];
    return specs?.length ? new VehicleDoors(specs, paint, seatZ) : null;
  }

  private constructor(specs: DoorSpec[], paint: THREE.Material, seatZ: number) {
    this.driverSide = seatZ > 0 ? 1 : -1;
    specs.forEach((spec, i) => {
      for (const side of [1, -1] as const) {
        const pivot = new THREE.Group();
        pivot.position.set(spec.front, 0, side * (spec.side + 0.03));
        pivot.add(leafMesh(spec, paint, side));
        this.group.add(pivot);
        this.leaves.push({ pivot, side, front: i === 0, angle: 0 });
      }
    });
  }

  get anyOpen() { return this.allOpen || this.driverHold > 0 || this.leaves.some(l => l.angle > 0.02); }
  get isOpen() { return this.allOpen; }

  /** Swing the driver's door open for a moment (getting in or out), then shut it. */
  pulseDriver(seconds = 1.1) { this.driverHold = Math.max(this.driverHold, seconds); }

  /** Open or close every door and leave it that way. */
  setAll(open: boolean) { this.allOpen = open; }

  /** Per render frame. `speed` (m/s) closes doors left open once the vehicle drives off. */
  update(dt: number, speed = 0) {
    if (Math.abs(speed) > 2) this.allOpen = false;
    this.driverHold = Math.max(0, this.driverHold - dt);
    for (const l of this.leaves) {
      const want = this.allOpen || (this.driverHold > 0 && l.front && l.side === this.driverSide) ? OPEN_ANGLE : 0;
      const step = SWING_RATE * dt * (want > l.angle ? 1 : 1.4);
      l.angle += Math.max(-step, Math.min(step, want - l.angle));
      l.pivot.rotation.y = l.side * l.angle;
    }
  }
}
