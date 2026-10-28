/**
 * Build-mode interaction: snapping, ghost previews, local pre-validation and
 * sending BuildOps to the authority.
 *
 *  Tools
 *   buy      click a lot to purchase it
 *   wall     drag along grid lines (vertex snap, axis-locked runs)
 *   room     drag a rectangle → four walls + floor in one gesture
 *   floor    drag a rectangle of cells
 *   door / window / picture   click an existing wall edge
 *   object   place catalog items (R rotates, footprint snaps to cells)
 *   roof     drag a rectangle of vertices (gable X / gable Z / flat)
 *   delete   objects → walls → floors → roofs, whichever is under the cursor
 *
 *  Camera: right-drag orbit, middle/scroll zoom, WASD pan. PageUp/PageDown
 *  (or [ and ]) changes level; walls on the active level are cut down Sims-style.
 */
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CATALOG, footprint } from '../../shared/Catalog';
import {
  BuildOp, floorKey, FloorMat, levelBase, LEVEL_HEIGHT, lotAt, MAX_LEVEL, objectCells, opCost, Opening, RoofStyle,
  validateOp, WallDir, wallKey, WallStyle,
} from '../../shared/BuildRules';
import { noNormalsMRT } from '../core/Engine';
import { Input } from '../core/Input';
import { randomId } from '../core/Storage';
import { buildFurniture } from './Furniture';
import { HouseManager } from './HouseManager';
import { WALL_T } from './Mesher';

export type Tool = 'buy' | 'wall' | 'room' | 'floor' | 'door' | 'window' | 'picture' | 'object' | 'roof' | 'delete';

export interface BuildContext {
  myKey: () => string | null;
  money: () => number;
  send: (op: BuildOp) => void;
  hint: (text: string, ok: boolean) => void;
}

const OK = new THREE.Color(0x45d16a), BAD = new THREE.Color(0xe0453a), DEL = new THREE.Color(0xff8a2a);

export class BuildController {
  tool: Tool = 'buy';
  level = 0;
  rot = 0;
  wallStyle: WallStyle = 'siding_white';
  floorMat: FloorMat = 'oak';
  roofStyle: RoofStyle = 'gable_x';
  roofPitch = 30;
  catalogId = 'sofa';
  active = false;

  readonly controls: OrbitControls;
  private ray = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private hit = new THREE.Vector3();
  private dragStart: { x: number; z: number } | null = null;

  private ghostMat = new THREE.MeshBasicMaterial({ color: OK, transparent: true, opacity: 0.45, depthWrite: false });
  private wallGhost: THREE.InstancedMesh;
  private rectGhost: THREE.Mesh;
  private edgeGhost: THREE.Mesh;
  private objGhost: THREE.Group | null = null;
  private objGhostId = '';
  private cursor: THREE.LineSegments;
  private readonly root = new THREE.Group();

  constructor(private camera: THREE.PerspectiveCamera, private input: Input, scene: THREE.Scene, private houses: HouseManager, private ctx: BuildContext) {
    this.controls = new OrbitControls(camera, input.canvas);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.minDistance = 6; this.controls.maxDistance = 140;
    this.controls.mouseButtons = { LEFT: null as unknown as THREE.MOUSE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    this.controls.enabled = false;

    this.wallGhost = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.ghostMat, 256);
    this.wallGhost.count = 0; this.wallGhost.frustumCulled = false;
    this.rectGhost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.ghostMat);
    this.edgeGhost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.ghostMat);
    const sq = new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
    this.cursor = new THREE.LineSegments(sq, noNormalsMRT(new THREE.LineBasicMaterial({ color: 0xffffff })));
    this.root.add(this.wallGhost, this.rectGhost, this.edgeGhost, this.cursor);
    this.root.visible = false;
    scene.add(this.root);
  }

  enter(focus: THREE.Vector3) {
    this.active = true;
    this.root.visible = true;
    this.controls.enabled = true;
    this.controls.target.copy(focus);
    this.camera.position.copy(focus).add(new THREE.Vector3(-18, 22, 18));
    this.controls.update();
    this.applyView();
  }

  exit() {
    this.active = false;
    this.root.visible = false;
    this.controls.enabled = false;
    this.dragStart = null;
    this.houses.setView({ cutLevel: null, showRoofs: true });
  }

  setTool(t: Tool) { this.tool = t; this.dragStart = null; this.applyView(); }
  setLevel(l: number) { this.level = THREE.MathUtils.clamp(l, 0, MAX_LEVEL); this.applyView(); }

  private applyView() {
    const roofTool = this.tool === 'roof';
    this.houses.setView({ cutLevel: roofTool ? null : this.level, cutHeight: 1.1, showRoofs: roofTool });
  }

  // ---------------------------------------------------------------- frame

  update(dt: number) {
    if (!this.active || !this.houses.world) return;
    const inp = this.input;

    // Camera pan with WASD relative to view.
    const pan = new THREE.Vector3(inp.axis(['KeyA'], ['KeyD']), 0, -inp.axis(['KeyS'], ['KeyW']));
    if (pan.lengthSq()) {
      const yaw = Math.atan2(this.camera.position.x - this.controls.target.x, this.camera.position.z - this.controls.target.z);
      pan.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).multiplyScalar(dt * 28);
      this.controls.target.add(pan); this.camera.position.add(pan);
    }
    this.controls.update();

    if (inp.wasPressed('PageUp') || inp.wasPressed('BracketRight')) this.setLevel(this.level + 1);
    if (inp.wasPressed('PageDown') || inp.wasPressed('BracketLeft')) this.setLevel(this.level - 1);
    if (inp.wasPressed('KeyR')) this.rot = (this.rot + 1) % 4;
    if (inp.wasPressed('Escape')) this.dragStart = null;

    // Pointer → snapped grid point on the active level's floor plane.
    this.plane.constant = -levelBase(this.level);
    this.ray.setFromCamera(new THREE.Vector2(inp.pointer.ndcX, inp.pointer.ndcY), this.camera);
    if (!this.ray.ray.intersectPlane(this.plane, this.hit)) return;
    const overUI = (document.elementFromPoint(inp.pointer.x, inp.pointer.y) as HTMLElement | null)?.closest('.ui');
    const x = this.hit.x, z = this.hit.z, y = levelBase(this.level);

    this.wallGhost.count = 0;
    this.rectGhost.visible = this.edgeGhost.visible = false;
    if (this.objGhost) this.objGhost.visible = false;
    this.cursor.position.set(Math.floor(x) + 0.5, y + 0.02, Math.floor(z) + 0.5);

    const op = this.previewOp(x, z, y);
    const click = !overUI && inp.mouseClicked(0);
    const release = inp.mouseReleased(0);
    const dragTool = ['wall', 'room', 'floor', 'roof'].includes(this.tool);

    if (dragTool) {
      if (click) this.dragStart = this.tool === 'floor' ? { x: Math.floor(x), z: Math.floor(z) } : { x: Math.round(x), z: Math.round(z) };
      if (release && this.dragStart) { if (op) this.commit(op); this.dragStart = null; }
    } else if (click && op) {
      this.commit(op);
    }
  }

  private commit(ops: BuildOp | BuildOp[]) {
    for (const op of Array.isArray(ops) ? ops : [ops]) this.ctx.send(op);
  }

  // ---------------------------------------------------------------- previews

  /** Builds the op(s) the cursor would perform, draws the ghost, and reports validity. */
  private previewOp(x: number, z: number, y: number): BuildOp | BuildOp[] | null {
    const world = this.houses.world!;
    const me = this.ctx.myKey() ?? '';
    const lot = lotAt(world, x, z);
    const lotId = lot?.id ?? '';
    const check = (ops: BuildOp[], label: string) => {
      let cost = 0;
      for (const op of ops) {
        const r = validateOp(world, op, me);
        if (r) { this.paint(false); this.ctx.hint(r, false); return false; }
        cost += opCost(world, op);
      }
      if (cost > this.ctx.money()) { this.paint(false); this.ctx.hint(`${label} — $${cost.toLocaleString()} (not enough money)`, false); return false; }
      this.paint(true, this.tool === 'delete');
      this.ctx.hint(`${label} — ${cost >= 0 ? '$' + cost.toLocaleString() : 'refund $' + (-cost).toLocaleString()}`, true);
      return true;
    };

    switch (this.tool) {
      case 'buy': {
        if (!lot) { this.ctx.hint('Hover a lot to buy it', false); return null; }
        this.rectBox(lot.x, y - 0.2, lot.z, lot.x + lot.w, y - 0.1, lot.z + lot.d);
        const op: BuildOp = { op: 'buyLot', lotId };
        return check([op], `Buy lot ${lot.id}`) ? op : null;
      }
      case 'wall': {
        const segs = this.dragSegments(x, z);
        if (!lot || !segs.length) { this.ctx.hint('Drag along grid lines to place walls', true); return null; }
        const fresh = segs.filter(s => !world.builds[lotId]?.walls[wallKey(this.level, s.dir, s.gx, s.gz)]);
        this.drawWallGhost(segs, y);
        if (!fresh.length) { this.paint(false); this.ctx.hint('Walls already there', false); return null; }
        const op: BuildOp = { op: 'walls', lotId, level: this.level, style: this.wallStyle, segs: fresh };
        return check([op], `${fresh.length} m of wall`) && this.dragStart ? op : null;
      }
      case 'room': {
        if (!lot) return null;
        const s = this.dragStart ?? { x: Math.round(x), z: Math.round(z) };
        const ex = Math.round(x), ez = Math.round(z);
        const x0 = Math.min(s.x, ex), x1 = Math.max(s.x, ex), z0 = Math.min(s.z, ez), z1 = Math.max(s.z, ez);
        if (!this.dragStart || x1 - x0 < 1 || z1 - z0 < 1) { this.ctx.hint('Drag a rectangle to build a room (walls + floor)', true); return null; }
        const segs: { gx: number; gz: number; dir: WallDir }[] = [];
        for (let i = x0; i < x1; i++) segs.push({ gx: i, gz: z0, dir: 'x' }, { gx: i, gz: z1, dir: 'x' });
        for (let j = z0; j < z1; j++) segs.push({ gx: x0, gz: j, dir: 'z' }, { gx: x1, gz: j, dir: 'z' });
        const fresh = segs.filter(sg => !world.builds[lotId]?.walls[wallKey(this.level, sg.dir, sg.gx, sg.gz)]);
        this.drawWallGhost(segs, y);
        this.rectBox(x0, y - 0.03, z0, x1, y, z1);
        const ops: BuildOp[] = [{ op: 'floor', lotId, level: this.level, mat: this.floorMat, x0, z0, x1: x1 - 1, z1: z1 - 1 }];
        if (fresh.length) ops.unshift({ op: 'walls', lotId, level: this.level, style: this.wallStyle, segs: fresh });
        return check(ops, `Room ${x1 - x0}×${z1 - z0} m`) ? ops : null;
      }
      case 'floor': {
        if (!lot) return null;
        const s = this.dragStart ?? { x: Math.floor(x), z: Math.floor(z) };
        const ex = Math.floor(x), ez = Math.floor(z);
        const x0 = Math.min(s.x, ex), x1 = Math.max(s.x, ex), z0 = Math.min(s.z, ez), z1 = Math.max(s.z, ez);
        this.rectBox(x0, y - 0.03, z0, x1 + 1, y + 0.01, z1 + 1);
        const op: BuildOp = { op: 'floor', lotId, level: this.level, mat: this.floorMat, x0, z0, x1, z1 };
        return check([op], `${(x1 - x0 + 1) * (z1 - z0 + 1)} m² of ${this.floorMat}`) && this.dragStart ? op : null;
      }
      case 'door': case 'window': case 'picture': {
        if (!lot) return null;
        const e = this.nearestEdge(x, z);
        this.edgeBox(e.gx, e.gz, e.dir, y, LEVEL_HEIGHT);
        const op: BuildOp = { op: 'opening', lotId, key: wallKey(this.level, e.dir, e.gx, e.gz), opening: this.tool as Opening };
        return check([op], `Add ${this.tool}`) ? op : null;
      }
      case 'object': {
        const item = CATALOG[this.catalogId];
        const { w, d } = footprint(item, this.rot);
        const gx = Math.round(x - w / 2), gz = Math.round(z - d / 2);
        this.showObjectGhost(gx + w / 2, y - (this.level === 0 && !world.builds[lotId]?.floors[floorKey(0, gx, gz)] ? levelBase(0) : 0), gz + d / 2);
        if (!lot) { this.paint(false); return null; }
        const op: BuildOp = { op: 'object', lotId, obj: { id: randomId(16), catalogId: item.id, gx, gz, rot: this.rot, level: this.level } };
        return check([op], `${item.name}`) ? op : null;
      }
      case 'roof': {
        if (!lot) return null;
        const s = this.dragStart ?? { x: Math.round(x), z: Math.round(z) };
        const ex = Math.round(x), ez = Math.round(z);
        const x0 = Math.min(s.x, ex), x1 = Math.max(s.x, ex), z0 = Math.min(s.z, ez), z1 = Math.max(s.z, ez);
        const top = levelBase(this.level) + LEVEL_HEIGHT;
        if (!this.dragStart || x1 <= x0 || z1 <= z0) { this.ctx.hint('Drag over the walls to roof them', true); return null; }
        this.rectBox(x0 - 0.45, top, z0 - 0.45, x1 + 0.45, top + 0.3, z1 + 0.45);
        const op: BuildOp = { op: 'roof', lotId, roof: { id: randomId(16), x0, z0, x1, z1, level: this.level, style: this.roofStyle, pitchDeg: this.roofPitch } };
        return check([op], `${this.roofStyle.replace('_', ' ')} roof`) ? op : null;
      }
      case 'delete': return this.previewDelete(x, z, y, lotId, check);
    }
    return null;
  }

  private previewDelete(x: number, z: number, y: number, lotId: string, check: (ops: BuildOp[], label: string) => boolean): BuildOp | null {
    const b = this.houses.world!.builds[lotId];
    if (!b) return null;
    const cx = Math.floor(x), cz = Math.floor(z);
    for (const id in b.objects) {
      const o = b.objects[id];
      if (o.level !== this.level || !objectCells(o).cells.some(([a, c]) => a === cx && c === cz)) continue;
      const { w, d } = footprint(CATALOG[o.catalogId], o.rot);
      this.rectBox(o.gx, y, o.gz, o.gx + w, y + CATALOG[o.catalogId].h, o.gz + d);
      const op: BuildOp = { op: 'removeObject', lotId, id };
      return check([op], `Sell ${CATALOG[o.catalogId].name}`) ? op : null;
    }
    const e = this.nearestEdge(x, z);
    const k = wallKey(this.level, e.dir, e.gx, e.gz);
    if (b.walls[k] && e.dist < 0.3) {
      this.edgeBox(e.gx, e.gz, e.dir, y, LEVEL_HEIGHT);
      const op: BuildOp = { op: 'removeWall', lotId, key: k };
      return check([op], 'Demolish wall') ? op : null;
    }
    if (b.floors[floorKey(this.level, cx, cz)]) {
      this.rectBox(cx, y - 0.05, cz, cx + 1, y + 0.02, cz + 1);
      const op: BuildOp = { op: 'removeFloor', lotId, level: this.level, x0: cx, z0: cz, x1: cx, z1: cz };
      return check([op], 'Remove floor tile') ? op : null;
    }
    for (const id in b.roofs) {
      const r = b.roofs[id];
      if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) {
        const top = levelBase(r.level) + LEVEL_HEIGHT;
        this.rectBox(r.x0, top, r.z0, r.x1, top + 0.3, r.z1);
        const op: BuildOp = { op: 'removeRoof', lotId, id };
        return check([op], 'Remove roof') ? op : null;
      }
    }
    this.ctx.hint('Nothing to delete here', false);
    return null;
  }

  // ---------------------------------------------------------------- helpers

  private dragSegments(x: number, z: number) {
    const segs: { gx: number; gz: number; dir: WallDir }[] = [];
    const end = { x: Math.round(x), z: Math.round(z) };
    const s = this.dragStart ?? end;
    if (Math.abs(end.x - s.x) >= Math.abs(end.z - s.z)) {
      for (let i = Math.min(s.x, end.x); i < Math.max(s.x, end.x); i++) segs.push({ gx: i, gz: s.z, dir: 'x' });
    } else {
      for (let j = Math.min(s.z, end.z); j < Math.max(s.z, end.z); j++) segs.push({ gx: s.x, gz: j, dir: 'z' });
    }
    if (!this.dragStart) { this.cursor.position.set(end.x, levelBase(this.level) + 0.02, end.z); }
    return segs.slice(0, 200);
  }

  private nearestEdge(x: number, z: number): { gx: number; gz: number; dir: WallDir; dist: number } {
    const cx = Math.floor(x), cz = Math.floor(z), fx = x - cx, fz = z - cz;
    const c = [
      { gx: cx, gz: cz, dir: 'z' as WallDir, dist: fx },
      { gx: cx + 1, gz: cz, dir: 'z' as WallDir, dist: 1 - fx },
      { gx: cx, gz: cz, dir: 'x' as WallDir, dist: fz },
      { gx: cx, gz: cz + 1, dir: 'x' as WallDir, dist: 1 - fz },
    ];
    return c.reduce((a, b) => (b.dist < a.dist ? b : a));
  }

  private drawWallGhost(segs: { gx: number; gz: number; dir: WallDir }[], y: number) {
    const m = new THREE.Matrix4(), h = 1.1;
    segs.forEach((s, i) => {
      if (i >= 256) return;
      const sx = s.dir === 'x' ? 1 : WALL_T, sz = s.dir === 'z' ? 1 : WALL_T;
      m.makeScale(sx, h, sz).setPosition(s.dir === 'x' ? s.gx + 0.5 : s.gx, y + h / 2, s.dir === 'z' ? s.gz + 0.5 : s.gz);
      this.wallGhost.setMatrixAt(i, m);
    });
    this.wallGhost.count = Math.min(256, segs.length);
    this.wallGhost.instanceMatrix.needsUpdate = true;
  }

  private rectBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    this.rectGhost.visible = true;
    this.rectGhost.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    this.rectGhost.scale.set(Math.max(0.05, x1 - x0), Math.max(0.02, y1 - y0), Math.max(0.05, z1 - z0));
  }

  private edgeBox(gx: number, gz: number, dir: WallDir, y: number, h: number) {
    this.edgeGhost.visible = true;
    this.edgeGhost.position.set(dir === 'x' ? gx + 0.5 : gx, y + h / 2, dir === 'z' ? gz + 0.5 : gz);
    this.edgeGhost.scale.set(dir === 'x' ? 1 : WALL_T + 0.06, h, dir === 'z' ? 1 : WALL_T + 0.06);
  }

  private showObjectGhost(cx: number, y: number, cz: number) {
    if (this.objGhostId !== this.catalogId) {
      if (this.objGhost) this.root.remove(this.objGhost);
      this.objGhost = buildFurniture(this.catalogId);
      this.objGhost.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.material = this.ghostMat; m.castShadow = false; } });
      this.root.add(this.objGhost);
      this.objGhostId = this.catalogId;
    }
    this.objGhost!.visible = true;
    this.objGhost!.position.set(cx, y, cz);
    this.objGhost!.rotation.y = -this.rot * (Math.PI / 2);
  }

  private paint(ok: boolean, del = false) {
    this.ghostMat.color.copy(!ok ? BAD : del ? DEL : OK);
  }
}
