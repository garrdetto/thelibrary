/**
 * Opening doors, hood and trunk for published vehicles. Their models are one
 * solid mesh, so the editor marks each part as a box in chassis space
 * (`CustomVehicleSpec.parts`); here every triangle whose centre falls inside a
 * box is moved out of the body into its own leaf, hinged where that part
 * hinges: doors at their front edge (right side mirrored to the left, outer
 * skin only), the hood at its back edge, the trunk or tailgate at its front
 * edge, or a pickup tailgate (`drop`) at its bottom edge, folding down.
 * `PartRig` swings them with the same calls as the built-in doors.
 */
import * as THREE from 'three/webgpu';
import type { PartBox, VehicleParts } from '../../shared/CustomVehicles';

const DOOR_OPEN = 1.15, HOOD_OPEN = 0.9, TRUNK_OPEN = 1.05, TAILGATE_OPEN = 1.5, SWING_RATE = 3.2;

type Region = { kind: 'door'; box: PartBox; side: 1 | -1; front: boolean } | { kind: 'hood' | 'trunk'; box: PartBox };

interface Leaf { pivot: THREE.Group; region: Region; angle: number }

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

function regionsOf(parts: VehicleParts): Region[] {
  const out: Region[] = [];
  parts.doors.forEach((box, i) => { for (const side of [1, -1] as const) out.push({ kind: 'door', box, side, front: i === 0 }); });
  if (parts.hood) out.push({ kind: 'hood', box: parts.hood });
  if (parts.trunk) out.push({ kind: 'trunk', box: parts.trunk });
  return out;
}

function contains(r: Region, p: THREE.Vector3, halfWidth: number) {
  const b = r.box;
  if (p.x < b.back || p.x > b.front || p.y < b.bottom || p.y > b.top) return false;
  if (r.kind === 'door') return Math.sign(p.z) === r.side && Math.abs(p.z) >= halfWidth * 0.55;
  // The hood stays between the fenders; a trunk lid, hatch or tailgate spans the whole back.
  return Math.abs(p.z) <= halfWidth * (r.kind === 'hood' ? 0.72 : 0.97);
}

/**
 * A plain float, non-indexed copy: compressed models keep quantized (normalized
 * integer) or interleaved attributes, which can't be transformed in place.
 */
function flatFloat(src: THREE.BufferGeometry) {
  const out = new THREE.BufferGeometry();
  const index = src.index;
  const n = index ? index.count : src.getAttribute('position').count;
  for (const name of Object.keys(src.attributes)) {
    const a = src.getAttribute(name) as THREE.BufferAttribute;
    const size = a.itemSize, arr = new Float32Array(n * size);
    for (let i = 0; i < n; i++) {
      const v = index ? index.getX(i) : i;
      arr[i * size] = a.getX(v);
      if (size > 1) arr[i * size + 1] = a.getY(v);
      if (size > 2) arr[i * size + 2] = a.getZ(v);
      if (size > 3) arr[i * size + 3] = a.getW(v);
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  for (const g of src.groups) out.addGroup(g.start, g.count, g.materialIndex);
  return out;
}

/** Copies the listed triangles of a non-indexed geometry, positions already in chassis space. */
function pick(src: THREE.BufferGeometry, tris: number[]) {
  const out = new THREE.BufferGeometry();
  for (const name of Object.keys(src.attributes)) {
    const a = src.getAttribute(name) as THREE.BufferAttribute;
    const arr = new (a.array.constructor as Float32ArrayConstructor)(tris.length * 3 * a.itemSize);
    tris.forEach((t, i) => arr.set((a.array as Float32Array).subarray(t * 3 * a.itemSize, (t + 1) * 3 * a.itemSize), i * 3 * a.itemSize));
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize, a.normalized));
  }
  return out;
}

/**
 * Splits every mesh under `body` (the vehicle's body group, chassis frame) by the
 * part boxes and returns the rig that swings the cut-out leaves; null if nothing was cut.
 */
export function cutParts(body: THREE.Object3D, parts: VehicleParts | undefined, halfWidth: number): PartRig | null {
  if (!parts) return null;
  const regions = regionsOf(parts);
  if (!regions.length) return null;
  body.updateMatrixWorld(true);
  const toBody = body.matrixWorld.clone().invert();
  const meshes: THREE.Mesh[] = [];
  body.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && !(m as unknown as { isSkinnedMesh?: boolean }).isSkinnedMesh) meshes.push(m); });
  const pieces = regions.map(() => [] as THREE.Mesh[]);

  for (const mesh of meshes) {
    const m = new THREE.Matrix4().multiplyMatrices(toBody, mesh.matrixWorld);
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const flat = flatFloat(mesh.geometry).applyMatrix4(m);
    const pos = flat.getAttribute('position') as THREE.BufferAttribute;
    const count = pos.count / 3;
    const groups = flat.groups.length ? flat.groups : [{ start: 0, count: pos.count, materialIndex: 0 }];
    const keep: number[][] = mats.map(() => []);
    const moved = regions.map(() => mats.map(() => [] as number[]));
    let cut = false;
    for (const g of groups) {
      for (let t = g.start / 3; t < Math.min(count, (g.start + g.count) / 3); t++) {
        _a.fromBufferAttribute(pos, t * 3); _b.fromBufferAttribute(pos, t * 3 + 1); _c.fromBufferAttribute(pos, t * 3 + 2);
        const centre = _a.add(_b).add(_c).multiplyScalar(1 / 3);
        const r = regions.findIndex(reg => contains(reg, centre, halfWidth));
        const mi = Math.min(mats.length - 1, g.materialIndex ?? 0);
        if (r >= 0) { moved[r][mi].push(t); cut = true; } else keep[mi].push(t);
      }
    }
    if (!cut) continue;
    // Replace the mesh with the part that stays: one mesh per material, in chassis space under the body.
    const parent = mesh.parent!;
    parent.remove(mesh);
    mats.forEach((mat, mi) => {
      if (!keep[mi].length) return;
      const rest = new THREE.Mesh(pick(flat, keep[mi]), mat);
      rest.castShadow = mesh.castShadow; rest.receiveShadow = mesh.receiveShadow;
      body.add(rest);
    });
    regions.forEach((_, r) => mats.forEach((mat, mi) => {
      if (!moved[r][mi].length) return;
      const leaf = new THREE.Mesh(pick(flat, moved[r][mi]), mat);
      leaf.castShadow = true; leaf.receiveShadow = true;
      leaf.userData.keep = true;
      pieces[r].push(leaf);
    }));
  }

  const leaves: Leaf[] = [];
  regions.forEach((region, r) => {
    if (!pieces[r].length) return;
    const box = new THREE.Box3();
    for (const p of pieces[r]) { p.geometry.computeBoundingBox(); box.union(p.geometry.boundingBox!); }
    const hinge = region.kind === 'door' ? new THREE.Vector3(box.max.x, 0, region.side > 0 ? box.max.z : box.min.z)
      : region.kind === 'hood' ? new THREE.Vector3(box.min.x, box.max.y, 0)
      : region.box.drop ? new THREE.Vector3(box.min.x, box.min.y, 0)
      : new THREE.Vector3(box.max.x, box.max.y, 0);
    const pivot = new THREE.Group();
    pivot.position.copy(hinge);
    for (const p of pieces[r]) { p.geometry.translate(-hinge.x, -hinge.y, -hinge.z); pivot.add(p); }
    body.add(pivot);
    leaves.push({ pivot, region, angle: 0 });
  });
  return leaves.length ? new PartRig(leaves, body) : null;
}

/** Swings a published vehicle's cut-out parts; the same calls as the built-in `VehicleDoors`. */
export class PartRig {
  private allOpen = false;
  private hood = false;
  private trunk = false;
  private driverHold = 0;
  /** Seconds the car has been moving: driving away closes everything, a bump while parked doesn't. */
  private moving = 0;
  /** Left-hand drive: the driver's door is on −z. */
  private readonly driverSide: 1 | -1 = -1;

  constructor(private readonly leaves: Leaf[], readonly group: THREE.Object3D) {}

  get hasHood() { return this.leaves.some(l => l.region.kind === 'hood'); }
  get hasTrunk() { return this.leaves.some(l => l.region.kind === 'trunk'); }
  get hasDoors() { return this.leaves.some(l => l.region.kind === 'door'); }
  get isOpen() { return this.allOpen; }
  get hoodOpen() { return this.hood; }
  get trunkOpen() { return this.trunk; }
  get anyOpen() { return this.allOpen || this.hood || this.trunk || this.driverHold > 0 || this.leaves.some(l => l.angle > 0.02); }

  pulseDriver(seconds = 1.1) { this.driverHold = Math.max(this.driverHold, seconds); }
  setAll(open: boolean) { this.allOpen = open; }
  setHood(open: boolean) { this.hood = open; }
  setTrunk(open: boolean) { this.trunk = open; }

  /** Per render frame. Driving off (half a second above walking pace) closes everything. */
  update(dt: number, speed = 0) {
    this.moving = Math.abs(speed) > 2 ? this.moving + dt : 0;
    if (this.moving > 0.5) { this.allOpen = false; this.hood = false; this.trunk = false; }
    this.driverHold = Math.max(0, this.driverHold - dt);
    for (const l of this.leaves) {
      const r = l.region;
      const want = r.kind === 'door'
        ? (this.allOpen || (this.driverHold > 0 && r.front && r.side === this.driverSide) ? DOOR_OPEN : 0)
        : r.kind === 'hood' ? (this.hood ? HOOD_OPEN : 0) : (this.trunk ? (r.box.drop ? TAILGATE_OPEN : TRUNK_OPEN) : 0);
      const step = SWING_RATE * dt * (want > l.angle ? 1 : 1.4);
      l.angle += Math.max(-step, Math.min(step, want - l.angle));
      if (r.kind === 'door') l.pivot.rotation.y = r.side * l.angle;
      else l.pivot.rotation.z = r.kind === 'hood' || r.box.drop ? l.angle : -l.angle;
    }
  }
}
