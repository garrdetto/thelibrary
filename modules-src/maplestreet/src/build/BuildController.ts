/**
 * Build / Buy mode, modelled on how The Sims 4 builds:
 *
 *  Build tools   room · wall (full, half, picket, privacy, railing) · floor ·
 *                paint (one side; Shift paints the whole room) · door ·
 *                window · picture window · roof (gable, hip, flat; auto-roof) ·
 *                pool · buy lot
 *  Buy           place catalog items with `,` `.` to rotate; wall décor snaps
 *                to the nearest wall and faces into the room automatically
 *  Utilities     Move (H) · Eyedropper (E) · Design tool (R) · Sledgehammer (K)
 *                Undo Ctrl+Z · Redo Ctrl+Y · Delete sells the held item
 *  Camera        WASD pan · arrow keys orbit/tilt · right-drag orbit · wheel zoom
 *  Levels        PageUp / PageDown (or ] [) · Home cycles walls up/cutaway/down
 *
 * Every gesture is pre-validated with the same shared rules the authority
 * uses, so the ghost turns red with the real reason before you click.
 */
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CATALOG, footprint } from '../../shared/Catalog';
import {
  applyOp, backEdge, BuildOp, floorKey, FloorMat, LEVEL_HEIGHT, levelBase, LotBuild, lotAt, LotState, MAX_LEVEL, objectCells, opCost,
  Opening, PlacedObject, RoofStyle, sideFinish, validateOp, WALL_HEIGHT, WallDir, WallFinish, wallKey, wallKindOf, WallKind, WallStyle, WorldState,
} from '../../shared/BuildRules';
import { noNormalsMRT } from '../core/Engine';
import { Input } from '../core/Input';
import { randomId } from '../core/Storage';
import { OPENING_LABEL } from './Openings';
import { buildFurniture } from './Furniture';
import { HouseManager } from './HouseManager';
import { greedyRects, WALL_T } from './Mesher';

export type OpeningTool = Exclude<Opening, 'none'>;
export const OPENING_TOOLS: OpeningTool[] = ['door', 'glassdoor', 'french', 'slider', 'garage', 'window', 'tall', 'picture', 'clerestory', 'frosted'];
export type Tool = 'buy' | 'room' | 'wall' | 'floor' | 'paint' | OpeningTool | 'roof' | 'pool' | 'object' | 'move' | 'eyedropper' | 'design' | 'sledge';
export type WallView = 'up' | 'cut' | 'down';

export interface BuildContext {
  myKey: () => string | null;
  money: () => number;
  /** Sends one gesture to the authority; returns its sequence number. */
  send: (ops: BuildOp[]) => number;
  hint: (text: string, ok: boolean) => void;
  /** A message that should outlive the per-frame hover hint (undo, redo, auto-roof). */
  notice: (text: string) => void;
  /** Tool, level, selection or undo history changed: refresh the panel. */
  changed: () => void;
}

interface Entry { ops: BuildOp[]; inverse: BuildOp[]; seq: number; label: string }
type Seg = { gx: number; gz: number; dir: WallDir };

const OK = new THREE.Color(0x45d16a), BAD = new THREE.Color(0xe0453a), DEL = new THREE.Color(0xff8a2a), PICK = new THREE.Color(0x4fb3ff);
const DRAG_TOOLS: Tool[] = ['wall', 'room', 'floor', 'roof', 'pool'];
const UNDO_LIMIT = 60;

export class BuildController {
  tool: Tool = 'buy';
  level = 0;
  rot = 0;
  wallKind: WallKind = 'full';
  wallStyle: WallStyle = 'siding_white';
  finish: WallFinish = 'paint_white';
  floorMat: FloorMat = 'oak';
  roofStyle: RoofStyle = 'gable_x';
  roofPitch = 30;
  catalogId = 'sofa';
  tint = 0;
  wallView: WallView = 'cut';
  active = false;

  readonly controls: OrbitControls;
  private ray = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private hit = new THREE.Vector3();
  private dragStart: { x: number; z: number } | null = null;
  private holding: { lotId: string; obj: PlacedObject } | null = null;
  private undoStack: Entry[] = [];
  private redoStack: Entry[] = [];

  private ghostMat = new THREE.MeshBasicMaterial({ color: OK, transparent: true, opacity: 0.45, depthWrite: false });
  private wallGhost: THREE.InstancedMesh;
  private rectGhost: THREE.Mesh;
  private edgeGhost: THREE.Mesh;
  private objGhost: THREE.Group | null = null;
  private objGhostId = '';
  private cursor: THREE.LineSegments;
  private readonly root = new THREE.Group();
  private sph = new THREE.Spherical();

  constructor(private camera: THREE.PerspectiveCamera, private input: Input, scene: THREE.Scene, private houses: HouseManager, private ctx: BuildContext) {
    this.controls = new OrbitControls(camera, input.canvas);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.minDistance = 5; this.controls.maxDistance = 150;
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
    this.camera.position.copy(focus).add(new THREE.Vector3(-20, 24, 20));
    this.controls.update();
    this.applyView();
  }

  exit() {
    this.active = false;
    this.root.visible = false;
    this.controls.enabled = false;
    this.dragStart = null;
    this.holding = null;
    this.houses.setView({ cutLevel: null, showRoofs: true });
  }

  setTool(t: Tool) {
    this.tool = t;
    this.dragStart = null;
    if (t !== 'move') this.holding = null;
    this.applyView();
    this.ctx.changed();
  }
  setLevel(l: number) { this.level = THREE.MathUtils.clamp(l, 0, MAX_LEVEL); this.applyView(); this.ctx.changed(); }
  setWallView(v: WallView) { this.wallView = v; this.applyView(); this.ctx.changed(); }
  cycleWallView() { this.setWallView(this.wallView === 'up' ? 'cut' : this.wallView === 'cut' ? 'down' : 'up'); }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  private applyView() {
    if (!this.active) return;
    const cutHeight = this.wallView === 'up' ? 99 : this.wallView === 'cut' ? 1.1 : 0.22;
    this.houses.setView({ cutLevel: this.level, cutHeight, showRoofs: this.tool === 'roof' || this.wallView === 'up' });
  }

  // ---------------------------------------------------------------- frame

  update(dt: number) {
    if (!this.active || !this.houses.world) return;
    const inp = this.input;
    const ctrl = inp.isDown('ControlLeft') || inp.isDown('ControlRight') || inp.isDown('MetaLeft') || inp.isDown('MetaRight');
    const shift = inp.isDown('ShiftLeft') || inp.isDown('ShiftRight');

    // WASD pans relative to the view; arrows orbit (←/→) and tilt (↑ raises the camera over the top).
    const pan = ctrl ? new THREE.Vector3() : new THREE.Vector3(inp.axis(['KeyA'], ['KeyD']), 0, -inp.axis(['KeyS'], ['KeyW']));
    if (pan.lengthSq()) {
      const yaw = Math.atan2(this.camera.position.x - this.controls.target.x, this.camera.position.z - this.controls.target.z);
      const dist = this.camera.position.distanceTo(this.controls.target);
      pan.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).multiplyScalar(dt * (12 + dist * 0.6) * (shift ? 2 : 1));
      this.controls.target.add(pan); this.camera.position.add(pan);
    }
    const orbit = inp.axis(['ArrowLeft'], ['ArrowRight']), tilt = inp.axis(['ArrowDown'], ['ArrowUp']);
    if (orbit || tilt) {
      const off = this.camera.position.clone().sub(this.controls.target);
      this.sph.setFromVector3(off);
      this.sph.theta += orbit * 1.7 * dt;
      this.sph.phi = THREE.MathUtils.clamp(this.sph.phi - tilt * 1.1 * dt, 0.12, this.controls.maxPolarAngle);
      off.setFromSpherical(this.sph);
      this.camera.position.copy(this.controls.target).add(off);
    }
    this.controls.update();

    if (inp.wasPressed('PageUp') || inp.wasPressed('BracketRight')) this.setLevel(this.level + 1);
    if (inp.wasPressed('PageDown') || inp.wasPressed('BracketLeft')) this.setLevel(this.level - 1);
    if (inp.wasPressed('Home')) this.cycleWallView();
    if (inp.wasPressed('Period')) { this.rot = (this.rot + 1) % 4; if (this.holding) this.holding.obj.rot = this.rot; }
    if (inp.wasPressed('Comma')) { this.rot = (this.rot + 3) % 4; if (this.holding) this.holding.obj.rot = this.rot; }
    const undoKey = inp.chord('KeyZ'), redoKey = inp.chord('KeyY');
    if (undoKey) { if (undoKey.shift) this.redo(); else this.undo(); }
    if (redoKey) this.redo();
    if (!ctrl && !undoKey && !redoKey) {
      if (inp.wasPressed('KeyH')) this.setTool('move');
      if (inp.wasPressed('KeyE')) this.setTool('eyedropper');
      if (inp.wasPressed('KeyR')) this.setTool('design');
      if (inp.wasPressed('KeyK')) this.setTool('sledge');
    }
    if (inp.wasPressed('Escape')) { this.dragStart = null; this.holding = null; }
    if ((inp.wasPressed('Delete') || inp.wasPressed('Backspace')) && this.holding) {
      const h = this.holding;
      this.holding = null;
      this.commit([{ op: 'removeObject', lotId: h.lotId, id: h.obj.id }], `Sell ${CATALOG[h.obj.catalogId].name}`);
    }

    // Pointer → snapped grid point on the active level's floor plane.
    this.plane.constant = -levelBase(this.level);
    this.ray.setFromCamera(new THREE.Vector2(inp.pointer.ndcX, inp.pointer.ndcY), this.camera);
    if (!this.ray.ray.intersectPlane(this.plane, this.hit)) return;
    const overUI = (document.elementFromPoint(inp.pointer.x, inp.pointer.y) as HTMLElement | null)?.closest('.ui');
    const x = this.hit.x, z = this.hit.z, y = levelBase(this.level);

    this.wallGhost.count = 0;
    this.rectGhost.visible = this.edgeGhost.visible = false;
    if (this.objGhost) this.objGhost.visible = false;
    this.cursor.visible = true;
    this.cursor.position.set(Math.floor(x) + 0.5, y + 0.02, Math.floor(z) + 0.5);

    const pv = this.preview(x, z, y, shift);
    const click = !overUI && inp.mouseClicked(0);
    const release = inp.mouseReleased(0);

    if (DRAG_TOOLS.includes(this.tool)) {
      if (click) this.dragStart = this.tool === 'floor' || this.tool === 'pool' ? { x: Math.floor(x), z: Math.floor(z) } : { x: Math.round(x), z: Math.round(z) };
      if (release && this.dragStart) { if (pv?.ops) this.commit(pv.ops, pv.label); this.dragStart = null; }
    } else if (click && pv) {
      if (pv.action) pv.action();
      else if (pv.ops) this.commit(pv.ops, pv.label);
    }
  }

  // ---------------------------------------------------------------- commit, undo, redo

  private commit(ops: BuildOp[], label: string) {
    const inverse = this.invert(ops);
    const seq = this.ctx.send(ops);
    if (inverse) {
      this.undoStack.push({ ops, inverse, seq, label });
      if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
      this.redoStack = [];
    }
    this.ctx.changed();
  }

  undo() {
    const e = this.undoStack.pop();
    if (!e) return this.ctx.notice('Nothing to undo');
    e.seq = this.ctx.send(e.inverse);
    this.redoStack.push(e);
    this.ctx.notice(`Undo: ${e.label}`);
    this.ctx.changed();
  }

  redo() {
    const e = this.redoStack.pop();
    if (!e) return this.ctx.notice('Nothing to redo');
    e.seq = this.ctx.send(e.ops);
    this.undoStack.push(e);
    this.ctx.notice(`Redo: ${e.label}`);
    this.ctx.changed();
  }

  /** The authority refused a gesture: forget it so Undo never replays a ghost. */
  rejected(seq: number) {
    this.undoStack = this.undoStack.filter(e => e.seq !== seq);
    this.redoStack = this.redoStack.filter(e => e.seq !== seq);
    this.ctx.changed();
  }

  /**
   * Ops that exactly reverse `ops`, computed against a scratch copy of the lot
   * so multi-op gestures (a room is walls + floor) invert step by step.
   */
  private invert(ops: BuildOp[]): BuildOp[] | null {
    const world = this.houses.world!;
    if (ops.some(o => o.op === 'buyLot')) return null;
    const scratch: WorldState = { lots: {}, builds: {}, version: 0 };
    const me = this.ctx.myKey() ?? '';
    const out: BuildOp[][] = [];
    for (const op of ops) {
      const lotId = (op as { lotId: string }).lotId;
      if (!scratch.lots[lotId]) {
        if (!world.lots[lotId]) return null;
        scratch.lots[lotId] = { ...world.lots[lotId] };
        scratch.builds[lotId] = structuredClone(world.builds[lotId]);
      }
      const b = scratch.builds[lotId];
      if (validateOp(scratch, op, me)) return null;
      out.push(inverseOf(b, op));
      applyOp(scratch, op, me, '');
    }
    return out.reverse().flat();
  }

  // ---------------------------------------------------------------- previews

  /** Draws the ghost for the hovered gesture and returns what a click would do. */
  private preview(x: number, z: number, y: number, shift: boolean): { ops?: BuildOp[]; label: string; action?: () => void } | null {
    const world = this.houses.world!;
    const me = this.ctx.myKey() ?? '';
    const lot = lotAt(world, x, z);
    const lotId = lot?.id ?? '';
    const b = lot ? world.builds[lot.id] : null;
    const check = (ops: BuildOp[], label: string, del = false) => {
      const scratch = ops.length > 1 ? this.scratchFor(lotId) : world;
      let cost = 0;
      for (const op of ops) {
        const r = validateOp(scratch, op, me);
        if (r) { this.paint(BAD); this.ctx.hint(r, false); return null; }
        cost += opCost(scratch, op);
        if (ops.length > 1) applyOp(scratch, op, me, '');
      }
      if (cost > this.ctx.money()) { this.paint(BAD); this.ctx.hint(`${label} — $${cost.toLocaleString()} (not enough money)`, false); return null; }
      this.paint(del ? DEL : OK);
      this.ctx.hint(`${label} — ${cost > 0 ? '$' + cost.toLocaleString() : cost < 0 ? 'refund $' + (-cost).toLocaleString() : 'free'}`, true);
      return { ops, label };
    };
    const rect = (snap: (v: number) => number) => {
      const s = this.dragStart ?? { x: snap(x), z: snap(z) };
      const ex = snap(x), ez = snap(z);
      return { x0: Math.min(s.x, ex), x1: Math.max(s.x, ex), z0: Math.min(s.z, ez), z1: Math.max(s.z, ez) };
    };

    switch (this.tool) {
      case 'buy': {
        if (!lot) { this.ctx.hint('Hover a lot to buy it', false); return null; }
        this.rectBox(lot.x, -0.1, lot.z, lot.x + lot.w, 0.05, lot.z + lot.d);
        if (lot.owner) { this.paint(lot.owner === me ? OK : BAD); this.ctx.hint(lot.owner === me ? `Lot ${lot.id} is your home` : `Lot ${lot.id} belongs to ${lot.ownerName ?? 'a neighbor'}`, lot.owner === me); return null; }
        return check([{ op: 'buyLot', lotId }], `Buy lot ${lot.id} (${lot.w}×${lot.d} m)`);
      }
      case 'wall': {
        const segs = this.dragSegments(x, z);
        if (!lot || !segs.length) { this.ctx.hint(`Drag along the grid lines to build ${this.wallKind === 'full' ? 'walls' : this.wallKind === 'half' ? 'half walls' : 'a fence'}`, true); return null; }
        const fresh = segs.filter(s => !b?.walls[wallKey(this.level, s.dir, s.gx, s.gz)]);
        this.drawWallGhost(segs, y, WALL_HEIGHT[this.wallKind]);
        if (!fresh.length) { this.paint(BAD); this.ctx.hint('Already built there', false); return null; }
        if (!this.dragStart) return null;
        return check([{ op: 'walls', lotId, level: this.level, style: this.wallStyle, kind: this.wallKind, segs: fresh }], `${fresh.length} m of ${this.wallKind === 'full' ? 'wall' : this.wallKind === 'half' ? 'half wall' : `${this.wallKind} fence`}`);
      }
      case 'room': {
        if (!lot) return null;
        const r = rect(Math.round);
        if (!this.dragStart || r.x1 - r.x0 < 1 || r.z1 - r.z0 < 1) { this.ctx.hint('Drag a rectangle: four walls and a floor in one go', true); return null; }
        const segs: Seg[] = [];
        for (let i = r.x0; i < r.x1; i++) segs.push({ gx: i, gz: r.z0, dir: 'x' }, { gx: i, gz: r.z1, dir: 'x' });
        for (let j = r.z0; j < r.z1; j++) segs.push({ gx: r.x0, gz: j, dir: 'z' }, { gx: r.x1, gz: j, dir: 'z' });
        const fresh = segs.filter(sg => !b?.walls[wallKey(this.level, sg.dir, sg.gx, sg.gz)]);
        this.drawWallGhost(segs, y, LEVEL_HEIGHT);
        this.rectBox(r.x0, y - 0.03, r.z0, r.x1, y, r.z1);
        const ops: BuildOp[] = [];
        if (fresh.length) ops.push({ op: 'walls', lotId, level: this.level, style: this.wallStyle, kind: 'full', segs: fresh });
        ops.push({ op: 'floor', lotId, level: this.level, mat: this.floorMat, x0: r.x0, z0: r.z0, x1: r.x1 - 1, z1: r.z1 - 1 });
        return check(ops, `Room ${r.x1 - r.x0}×${r.z1 - r.z0} m`);
      }
      case 'floor': {
        if (!lot) return null;
        const r = rect(Math.floor);
        this.rectBox(r.x0, y - 0.03, r.z0, r.x1 + 1, y + 0.01, r.z1 + 1);
        if (!this.dragStart) { this.ctx.hint(`Drag to lay ${this.floorMat}`, true); return null; }
        return check([{ op: 'floor', lotId, level: this.level, mat: this.floorMat, ...r }], `${(r.x1 - r.x0 + 1) * (r.z1 - r.z0 + 1)} m² of ${this.floorMat}`);
      }
      case 'pool': {
        if (!lot) return null;
        const r = rect(Math.floor);
        this.rectBox(r.x0, -0.4, r.z0, r.x1 + 1, 0.05, r.z1 + 1);
        if (!this.dragStart) { this.ctx.hint('Drag out a pool (2×2 m up to 14×14 m)', true); return null; }
        return check([{ op: 'pool', lotId, pool: { id: randomId(16), x0: r.x0, z0: r.z0, x1: r.x1 + 1, z1: r.z1 + 1 } }], `Pool ${r.x1 - r.x0 + 1}×${r.z1 - r.z0 + 1} m`);
      }
      case 'door': case 'window': case 'picture': case 'slider': case 'french': case 'glassdoor': case 'tall': case 'clerestory': case 'frosted': case 'garage': {
        if (!lot) return null;
        const e = this.nearestEdge(x, z);
        this.edgeBox(e.gx, e.gz, e.dir, y, LEVEL_HEIGHT);
        return check([{ op: 'opening', lotId, key: wallKey(this.level, e.dir, e.gx, e.gz), opening: this.tool }], `Add ${OPENING_LABEL[this.tool]}`);
      }
      case 'paint': {
        if (!lot || !b) return null;
        const e = this.nearestEdge(x, z);
        const key = wallKey(this.level, e.dir, e.gx, e.gz);
        const w = b.walls[key];
        if (!w || e.dist > 0.45) { this.ctx.hint('Point at a wall — the side you hover gets painted (Shift = whole room)', true); return null; }
        const side: 'A' | 'B' = e.dir === 'x' ? (z < e.gz ? 'A' : 'B') : (x < e.gx ? 'A' : 'B');
        const sides = shift ? this.roomSides(b, lot, e, side) : [{ key, side }];
        for (const s of sides) { const wl = b.walls[s.key]; this.edgeBox(wl.gx, wl.gz, wl.dir, y, WALL_HEIGHT[wallKindOf(wl)] + 0.05); }
        if (sides.length > 1) this.drawWallGhost(sides.map(s => b.walls[s.key]), y, LEVEL_HEIGHT);
        const ops: BuildOp[] = sides.map(s => ({ op: 'paint', lotId, key: s.key, side: s.side, finish: this.finish }));
        return check(ops, sides.length > 1 ? `Paint room (${sides.length} walls)` : 'Paint wall');
      }
      case 'object': return this.previewObject(world, lot, x, z, y, check);
      case 'roof': {
        if (!lot) return null;
        const r = rect(Math.round);
        const top = levelBase(this.level) + LEVEL_HEIGHT;
        if (!this.dragStart || r.x1 <= r.x0 || r.z1 <= r.z0) { this.ctx.hint('Drag over the walls to roof them — or use Auto-roof', true); return null; }
        this.rectBox(r.x0 - 0.45, top, r.z0 - 0.45, r.x1 + 0.45, top + 0.3, r.z1 + 0.45);
        return check([{ op: 'roof', lotId, roof: { id: randomId(16), ...r, level: this.level, style: this.roofStyle, pitchDeg: this.roofPitch } }], `${this.roofStyle.replace('_', ' ')} roof`);
      }
      case 'move': return this.previewMove(lot, b, x, z, y, check);
      case 'eyedropper': return this.previewEyedropper(lot, b, x, z, y);
      case 'design': {
        if (!lot || !b) return null;
        const o = this.objectAt(b, x, z);
        if (!o) { this.ctx.hint('Click an item to recolor it with the selected swatch', true); return null; }
        this.boxAround(o, y);
        if (!CATALOG[o.catalogId].tintable) { this.paint(BAD); this.ctx.hint(`${CATALOG[o.catalogId].name} comes in one look`, false); return null; }
        return check([{ op: 'tint', lotId, id: o.id, tint: this.tint }], `Recolor ${CATALOG[o.catalogId].name}`);
      }
      case 'sledge': return this.previewDelete(b, lotId, x, z, y, check);
    }
    return null;
  }

  private previewObject(world: WorldState, lot: LotState | null, x: number, z: number, y: number, check: (ops: BuildOp[], label: string, del?: boolean) => { ops: BuildOp[]; label: string } | null) {
    const item = CATALOG[this.catalogId];
    if (!item) return null;
    const { gx, gz, rot } = this.placement(world.builds[lot?.id ?? ''], item.id, x, z, this.rot);
    const { w, d } = footprint(item, rot);
    const b = lot ? world.builds[lot.id] : null;
    const onGround = this.level === 0 && !b?.floors[floorKey(0, gx, gz)];
    this.showObjectGhost(gx + w / 2, y - (onGround ? levelBase(0) : 0), gz + d / 2, rot);
    if (!lot) { this.paint(BAD); this.ctx.hint(`${item.name} — place it on your lot`, false); return null; }
    const obj: PlacedObject = { id: randomId(16), catalogId: item.id, gx, gz, rot, level: this.level };
    if (item.tintable && this.tint) obj.tint = this.tint;
    return check([{ op: 'object', lotId: lot.id, obj }], item.name);
  }

  private previewMove(lot: LotState | null, b: LotBuild | null, x: number, z: number, y: number, check: (ops: BuildOp[], label: string, del?: boolean) => { ops: BuildOp[]; label: string } | null) {
    const world = this.houses.world!;
    if (this.holding) {
      const h = this.holding;
      const item = CATALOG[h.obj.catalogId];
      const p = this.placement(world.builds[h.lotId], item.id, x, z, h.obj.rot);
      const { w, d } = footprint(item, p.rot);
      const hb = world.builds[h.lotId];
      const onGround = this.level === 0 && !hb.floors[floorKey(0, p.gx, p.gz)];
      this.showObjectGhost(p.gx + w / 2, y - (onGround ? levelBase(0) : 0), p.gz + d / 2, p.rot, h.obj.catalogId);
      if (lot?.id !== h.lotId) { this.paint(BAD); this.ctx.hint('Items stay on their own lot', false); return null; }
      const pv = check([{ op: 'moveObject', lotId: h.lotId, id: h.obj.id, gx: p.gx, gz: p.gz, rot: p.rot, level: this.level }], `Move ${item.name} (Delete sells it)`);
      return pv ? { ...pv, action: () => { this.holding = null; this.commit(pv.ops, pv.label); } } : null;
    }
    if (!lot || !b) return null;
    const o = this.objectAt(b, x, z);
    if (!o) { this.ctx.hint('Click an item to pick it up', true); return null; }
    this.boxAround(o, y);
    if (lot.owner !== this.ctx.myKey()) { this.paint(BAD); this.ctx.hint(`That belongs to ${lot.ownerName ?? 'a neighbor'}`, false); return null; }
    this.paint(PICK);
    this.ctx.hint(`Pick up ${CATALOG[o.catalogId].name}`, true);
    return { label: 'Pick up', action: () => { this.holding = { lotId: lot.id, obj: { ...o } }; this.rot = o.rot; } };
  }

  private previewEyedropper(lot: LotState | null, b: LotBuild | null, x: number, z: number, y: number) {
    if (!lot || !b) { this.ctx.hint('Click an item, wall or floor to copy it', true); return null; }
    const o = this.objectAt(b, x, z);
    if (o) {
      this.boxAround(o, y); this.paint(PICK);
      this.ctx.hint(`Copy ${CATALOG[o.catalogId].name}`, true);
      return { label: 'copy', action: () => { this.catalogId = o.catalogId; this.tint = o.tint ?? 0; this.rot = o.rot; this.setTool('object'); } };
    }
    const e = this.nearestEdge(x, z);
    const w = b.walls[wallKey(this.level, e.dir, e.gx, e.gz)];
    if (w && e.dist < 0.4) {
      const side: 'A' | 'B' = e.dir === 'x' ? (z < e.gz ? 'A' : 'B') : (x < e.gx ? 'A' : 'B');
      this.edgeBox(w.gx, w.gz, w.dir, y, WALL_HEIGHT[wallKindOf(w)]); this.paint(PICK);
      this.ctx.hint('Copy this wall’s finish', true);
      return { label: 'copy', action: () => { this.wallStyle = w.style; this.wallKind = wallKindOf(w); this.finish = sideFinish(b, w, side); this.setTool('paint'); } };
    }
    const f = b.floors[floorKey(this.level, Math.floor(x), Math.floor(z))];
    if (f) {
      this.rectBox(f.gx, y - 0.04, f.gz, f.gx + 1, y + 0.02, f.gz + 1); this.paint(PICK);
      this.ctx.hint(`Copy ${f.mat} floor`, true);
      return { label: 'copy', action: () => { this.floorMat = f.mat; this.setTool('floor'); } };
    }
    this.ctx.hint('Click an item, wall or floor to copy it', true);
    return null;
  }

  private previewDelete(b: LotBuild | null, lotId: string, x: number, z: number, y: number, check: (ops: BuildOp[], label: string, del?: boolean) => { ops: BuildOp[]; label: string } | null) {
    if (!b) { this.ctx.hint('Nothing to remove here', false); return null; }
    const o = this.objectAt(b, x, z);
    if (o) {
      this.boxAround(o, y);
      return check([{ op: 'removeObject', lotId, id: o.id }], `Sell ${CATALOG[o.catalogId].name}`, true);
    }
    const e = this.nearestEdge(x, z);
    const k = wallKey(this.level, e.dir, e.gx, e.gz);
    const w = b.walls[k];
    if (w && e.dist < 0.3) {
      this.edgeBox(e.gx, e.gz, e.dir, y, WALL_HEIGHT[wallKindOf(w)]);
      if (w.opening !== 'none') return check([{ op: 'opening', lotId, key: k, opening: 'none' }], `Remove ${OPENING_LABEL[w.opening]}`, true);
      return check([{ op: 'removeWall', lotId, key: k }], wallKindOf(w) === 'full' ? 'Demolish wall' : 'Remove section', true);
    }
    const cx = Math.floor(x), cz = Math.floor(z);
    if (this.level === 0) for (const id in b.pools) {
      const p = b.pools[id];
      if (cx >= p.x0 && cx < p.x1 && cz >= p.z0 && cz < p.z1) {
        this.rectBox(p.x0, -0.4, p.z0, p.x1, 0.1, p.z1);
        return check([{ op: 'removePool', lotId, id }], 'Fill in pool', true);
      }
    }
    if (b.floors[floorKey(this.level, cx, cz)]) {
      this.rectBox(cx, y - 0.05, cz, cx + 1, y + 0.02, cz + 1);
      return check([{ op: 'removeFloor', lotId, level: this.level, x0: cx, z0: cz, x1: cx, z1: cz }], 'Remove floor tile', true);
    }
    for (const id in b.roofs) {
      const r = b.roofs[id];
      if (r.level === this.level && x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) {
        const top = levelBase(r.level) + LEVEL_HEIGHT;
        this.rectBox(r.x0, top, r.z0, r.x1, top + 0.3, r.z1);
        return check([{ op: 'removeRoof', lotId, id }], 'Remove roof', true);
      }
    }
    this.ctx.hint('Nothing to remove here', false);
    return null;
  }

  // ---------------------------------------------------------------- auto-roof

  /** Roofs every full-walled footprint on the active level of your lot in one click. */
  autoRoof() {
    const world = this.houses.world;
    const me = this.ctx.myKey();
    const lot = world && Object.values(world.lots).find(l => l.owner === me);
    if (!world || !lot) return this.ctx.notice('Buy a lot first');
    const b = world.builds[lot.id];
    const cells = new Set<string>();
    for (const k in b.floors) { const f = b.floors[k]; if (f.level === this.level) cells.add(`${f.gx}|${f.gz}`); }
    if (!cells.size) return this.ctx.notice('Build rooms on this level first');
    // One roof per connected floor island, sized to its bounding box.
    const ops: BuildOp[] = [];
    const seen = new Set<string>();
    for (const c of cells) {
      if (seen.has(c)) continue;
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      const stack = [c];
      seen.add(c);
      while (stack.length) {
        const [cx, cz] = stack.pop()!.split('|').map(Number);
        x0 = Math.min(x0, cx); z0 = Math.min(z0, cz); x1 = Math.max(x1, cx + 1); z1 = Math.max(z1, cz + 1);
        for (const n of [`${cx + 1}|${cz}`, `${cx - 1}|${cz}`, `${cx}|${cz + 1}`, `${cx}|${cz - 1}`]) if (cells.has(n) && !seen.has(n)) { seen.add(n); stack.push(n); }
      }
      const covered = Object.values(b.roofs).some(r => r.level === this.level && r.x0 <= x0 && r.z0 <= z0 && r.x1 >= x1 && r.z1 >= z1);
      if (covered || x1 - x0 < 2 || z1 - z0 < 2) continue;
      const style: RoofStyle = this.roofStyle === 'gable_x' || this.roofStyle === 'gable_z' ? (x1 - x0 >= z1 - z0 ? 'gable_x' : 'gable_z') : this.roofStyle;
      ops.push({ op: 'roof', lotId: lot.id, roof: { id: randomId(16), x0, z0, x1, z1, level: this.level, style, pitchDeg: this.roofPitch } });
    }
    if (!ops.length) return this.ctx.notice('Everything on this level already has a roof');
    const cost = ops.reduce((s, op) => s + opCost(world, op), 0);
    if (cost > this.ctx.money()) return this.ctx.notice(`Auto-roof needs $${cost.toLocaleString()}`);
    this.commit(ops, 'Auto-roof');
    this.ctx.notice(`Auto-roof: ${ops.length} roof${ops.length > 1 ? 's' : ''} for $${cost.toLocaleString()}`);
  }

  // ---------------------------------------------------------------- helpers

  private scratchFor(lotId: string): WorldState {
    const world = this.houses.world!;
    if (!world.lots[lotId]) return world;
    return { lots: { [lotId]: { ...world.lots[lotId] } }, builds: { [lotId]: structuredClone(world.builds[lotId]) }, version: 0 };
  }

  /**
   * Grid placement for an item under the cursor. Wall décor finds the closest
   * full wall and turns to face away from it, the way Sims items snap.
   */
  private placement(b: LotBuild | undefined, catalogId: string, x: number, z: number, rot: number) {
    const item = CATALOG[catalogId];
    if (item.layer === 'wall' && b) {
      const e = this.nearestEdge(x, z, (s) => { const w = b.walls[wallKey(this.level, s.dir, s.gx, s.gz)]; return !!w && wallKindOf(w) === 'full'; });
      if (e && e.dist < 1.2) {
        const r = e.dir === 'x' ? (z >= e.gz ? 0 : 2) : (x >= e.gx ? 3 : 1);
        const { w, d } = footprint(item, r);
        let gx: number, gz: number;
        if (e.dir === 'x') { gx = Math.round(x - w / 2); gz = r === 0 ? e.gz : e.gz - 1; }
        else { gz = Math.round(z - d / 2); gx = r === 3 ? e.gx : e.gx - 1; }
        return { gx, gz, rot: r };
      }
    }
    const { w, d } = footprint(item, rot);
    return { gx: Math.round(x - w / 2), gz: Math.round(z - d / 2), rot };
  }

  private objectAt(b: LotBuild, x: number, z: number): PlacedObject | null {
    const cx = Math.floor(x), cz = Math.floor(z);
    let best: PlacedObject | null = null;
    const rank = { wall: 3, floor: 2, ceiling: 1, rug: 0 } as const;
    for (const id in b.objects) {
      const o = b.objects[id];
      if (o.level !== this.level || !objectCells(o).cells.some(([a, c]) => a === cx && c === cz)) continue;
      const item = CATALOG[o.catalogId];
      if (item.layer === 'wall') {
        const e = backEdge(cx, cz, o.rot);
        const ex = e.dir === 'x' ? x : e.gx, ez = e.dir === 'z' ? z : e.gz;
        if (Math.hypot(x - ex, z - ez) > 0.45) continue;
      }
      if (!best || rank[item.layer] > rank[CATALOG[best.catalogId].layer]) best = o;
    }
    return best;
  }

  /** Every wall side facing into the enclosed room that `side` of edge `e` belongs to. */
  private roomSides(b: LotBuild, lot: LotState, e: Seg, side: 'A' | 'B'): { key: string; side: 'A' | 'B' }[] {
    const lv = this.level;
    const solid = (s: Seg) => { const w = b.walls[wallKey(lv, s.dir, s.gx, s.gz)]; return !!w && wallKindOf(w) === 'full'; };
    const start: [number, number] = e.dir === 'x' ? [e.gx, side === 'A' ? e.gz - 1 : e.gz] : [side === 'A' ? e.gx - 1 : e.gx, e.gz];
    const seen = new Set<string>([start.join('|')]);
    const stack = [start];
    while (stack.length) {
      const [cx, cz] = stack.pop()!;
      if (cx < lot.x || cz < lot.z || cx >= lot.x + lot.w || cz >= lot.z + lot.d || seen.size > 500) return [{ key: wallKey(lv, e.dir, e.gx, e.gz), side }];
      const steps: [number, number, Seg][] = [
        [cx + 1, cz, { gx: cx + 1, gz: cz, dir: 'z' }], [cx - 1, cz, { gx: cx, gz: cz, dir: 'z' }],
        [cx, cz + 1, { gx: cx, gz: cz + 1, dir: 'x' }], [cx, cz - 1, { gx: cx, gz: cz, dir: 'x' }],
      ];
      for (const [nx, nz, edge] of steps) {
        const k = `${nx}|${nz}`;
        if (seen.has(k) || solid(edge)) continue;
        seen.add(k); stack.push([nx, nz]);
      }
    }
    const out: { key: string; side: 'A' | 'B' }[] = [];
    for (const c of seen) {
      const [cx, cz] = c.split('|').map(Number);
      const edges: [Seg, 'A' | 'B'][] = [
        [{ gx: cx, gz: cz, dir: 'x' }, 'B'], [{ gx: cx, gz: cz + 1, dir: 'x' }, 'A'],
        [{ gx: cx, gz: cz, dir: 'z' }, 'B'], [{ gx: cx + 1, gz: cz, dir: 'z' }, 'A'],
      ];
      for (const [s, sd] of edges) if (solid(s)) out.push({ key: wallKey(lv, s.dir, s.gx, s.gz), side: sd });
    }
    return out.slice(0, 200);
  }

  private dragSegments(x: number, z: number) {
    const segs: Seg[] = [];
    const end = { x: Math.round(x), z: Math.round(z) };
    const s = this.dragStart ?? end;
    if (Math.abs(end.x - s.x) >= Math.abs(end.z - s.z)) {
      for (let i = Math.min(s.x, end.x); i < Math.max(s.x, end.x); i++) segs.push({ gx: i, gz: s.z, dir: 'x' });
    } else {
      for (let j = Math.min(s.z, end.z); j < Math.max(s.z, end.z); j++) segs.push({ gx: s.x, gz: j, dir: 'z' });
    }
    if (!this.dragStart) this.cursor.position.set(end.x, levelBase(this.level) + 0.02, end.z);
    return segs.slice(0, 200);
  }

  private nearestEdge(x: number, z: number): { gx: number; gz: number; dir: WallDir; dist: number };
  private nearestEdge(x: number, z: number, filter: (s: Seg) => boolean): { gx: number; gz: number; dir: WallDir; dist: number } | null;
  private nearestEdge(x: number, z: number, filter?: (s: Seg) => boolean) {
    const cx = Math.floor(x), cz = Math.floor(z);
    const c: { gx: number; gz: number; dir: WallDir; dist: number }[] = [];
    const reach = filter ? 1 : 0;
    for (let i = -reach; i <= reach; i++) for (let j = -reach; j <= reach; j++) {
      const ax = cx + i, az = cz + j;
      c.push(
        { gx: ax, gz: az, dir: 'z', dist: Math.hypot(x - ax, Math.max(0, Math.abs(z - (az + 0.5)) - 0.5)) },
        { gx: ax, gz: az, dir: 'x', dist: Math.hypot(z - az, Math.max(0, Math.abs(x - (ax + 0.5)) - 0.5)) },
      );
    }
    const pool = filter ? c.filter(filter) : c;
    if (!pool.length) return null;
    return pool.reduce((a, b) => (b.dist < a.dist ? b : a));
  }

  private drawWallGhost(segs: Seg[], y: number, h: number) {
    const m = new THREE.Matrix4();
    const n = Math.min(256, segs.length);
    for (let i = 0; i < n; i++) {
      const s = segs[i];
      const sx = s.dir === 'x' ? 1 : WALL_T, sz = s.dir === 'z' ? 1 : WALL_T;
      m.makeScale(sx, h, sz).setPosition(s.dir === 'x' ? s.gx + 0.5 : s.gx, y + h / 2, s.dir === 'z' ? s.gz + 0.5 : s.gz);
      this.wallGhost.setMatrixAt(i, m);
    }
    this.wallGhost.count = n;
    this.wallGhost.instanceMatrix.needsUpdate = true;
  }

  private rectBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    this.rectGhost.visible = true;
    this.rectGhost.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    this.rectGhost.scale.set(Math.max(0.05, x1 - x0), Math.max(0.02, y1 - y0), Math.max(0.05, z1 - z0));
  }

  private boxAround(o: PlacedObject, y: number) {
    const item = CATALOG[o.catalogId];
    const { w, d } = footprint(item, o.rot);
    const lift = item.layer === 'ceiling' ? LEVEL_HEIGHT - 0.4 : item.layer === 'wall' ? 0.8 : 0;
    this.rectBox(o.gx, y + lift, o.gz, o.gx + w, y + lift + Math.max(0.12, item.h || 0.4), o.gz + d);
  }

  private edgeBox(gx: number, gz: number, dir: WallDir, y: number, h: number) {
    this.edgeGhost.visible = true;
    this.edgeGhost.position.set(dir === 'x' ? gx + 0.5 : gx, y + h / 2, dir === 'z' ? gz + 0.5 : gz);
    this.edgeGhost.scale.set(dir === 'x' ? 1 : WALL_T + 0.06, h, dir === 'z' ? 1 : WALL_T + 0.06);
  }

  private showObjectGhost(cx: number, y: number, cz: number, rot: number, id = this.catalogId) {
    if (this.objGhostId !== id) {
      if (this.objGhost) this.root.remove(this.objGhost);
      this.objGhost = buildFurniture(id);
      const ghostly = (g: THREE.Object3D) => g.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.material = this.ghostMat; m.castShadow = false; } });
      ghostly(this.objGhost);
      this.objGhost.userData.onCustomFill = ghostly;
      this.root.add(this.objGhost);
      this.objGhostId = id;
    }
    this.cursor.visible = false;
    this.objGhost!.visible = true;
    this.objGhost!.position.set(cx, y, cz);
    this.objGhost!.rotation.y = -rot * (Math.PI / 2);
  }

  private paint(c: THREE.Color) { this.ghostMat.color.copy(c); }
}

// ------------------------------------------------------------------ inverse ops

const cellRects = (cells: Set<string>) => greedyRects(cells).map(r => ({ x0: r.x0, z0: r.z0, x1: r.x1 - 1, z1: r.z1 - 1 }));

/** The ops that undo `op`, given the lot build as it is just before `op` runs. */
function inverseOf(b: LotBuild, op: BuildOp): BuildOp[] {
  const lotId = (op as { lotId: string }).lotId;
  switch (op.op) {
    case 'walls': return op.segs.map(s => ({ op: 'removeWall', lotId, key: wallKey(op.level, s.dir, s.gx, s.gz) }));
    case 'removeWall': {
      const w = b.walls[op.key];
      const out: BuildOp[] = [{ op: 'walls', lotId, level: w.level, style: w.style, kind: wallKindOf(w), segs: [{ gx: w.gx, gz: w.gz, dir: w.dir }] }];
      if (w.opening !== 'none') out.push({ op: 'opening', lotId, key: op.key, opening: w.opening });
      if (w.paintA) out.push({ op: 'paint', lotId, key: op.key, side: 'A', finish: w.paintA });
      if (w.paintB) out.push({ op: 'paint', lotId, key: op.key, side: 'B', finish: w.paintB });
      return out;
    }
    case 'opening': return [{ op: 'opening', lotId, key: op.key, opening: b.walls[op.key].opening }];
    case 'paint': { const w = b.walls[op.key]; return [{ op: 'paint', lotId, key: op.key, side: op.side, finish: (op.side === 'A' ? w.paintA : w.paintB) ?? 'auto' }]; }
    case 'floor':
    case 'removeFloor': {
      const empty = new Set<string>();
      const byMat = new Map<FloorMat, Set<string>>();
      for (let x = Math.min(op.x0, op.x1); x <= Math.max(op.x0, op.x1); x++)
        for (let z = Math.min(op.z0, op.z1); z <= Math.max(op.z0, op.z1); z++) {
          const prev = b.floors[floorKey(op.level, x, z)];
          if (!prev) { if (op.op === 'floor') empty.add(`${x}|${z}`); continue; }
          if (op.op === 'floor' && prev.mat === op.mat) continue;
          if (!byMat.has(prev.mat)) byMat.set(prev.mat, new Set());
          byMat.get(prev.mat)!.add(`${x}|${z}`);
        }
      const out: BuildOp[] = cellRects(empty).map(r => ({ op: 'removeFloor', lotId, level: op.level, ...r }));
      for (const [mat, cells] of byMat) for (const r of cellRects(cells)) out.push({ op: 'floor', lotId, level: op.level, mat, ...r });
      return out;
    }
    case 'object': return [{ op: 'removeObject', lotId, id: op.obj.id }];
    case 'moveObject': { const o = b.objects[op.id]; return [{ op: 'moveObject', lotId, id: op.id, gx: o.gx, gz: o.gz, rot: o.rot, level: o.level }]; }
    case 'tint': return [{ op: 'tint', lotId, id: op.id, tint: b.objects[op.id].tint ?? 0 }];
    case 'removeObject': return [{ op: 'object', lotId, obj: { ...b.objects[op.id] } }];
    case 'roof': return [{ op: 'removeRoof', lotId, id: op.roof.id }];
    case 'removeRoof': return [{ op: 'roof', lotId, roof: { ...b.roofs[op.id] } }];
    case 'pool': return [{ op: 'removePool', lotId, id: op.pool.id }];
    case 'removePool': return [{ op: 'pool', lotId, pool: { ...b.pools[op.id] } }];
    case 'buyLot': return [];
  }
}
