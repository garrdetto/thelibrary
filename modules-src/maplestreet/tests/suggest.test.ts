import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectAxles, partsFromViews, surfaceSamples, type ViewFrame, type ViewName } from '../../../src/components/maplestreet/vehicle/suggest';

type Wheel = { x: number; r: number; halfTrack: number; width: number; lift?: number };

function vehicle(length: number, width: number, height: number, sill: number, wheels: Wheel[]) {
  const tris: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]) => { tris.push(...a, ...b, ...c, ...a, ...c, ...d); };
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => {
    const P = (x: number, y: number, z: number) => [x, y, z];
    quad(P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)); quad(P(x0, y0, z0), P(x0, y1, z0), P(x1, y1, z0), P(x1, y0, z0));
    quad(P(x0, y1, z0), P(x0, y1, z1), P(x1, y1, z1), P(x1, y1, z0)); quad(P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1));
    quad(P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1)); quad(P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0));
  };
  box(-length / 2, length / 2, sill, height * 0.65, -width / 2 + 0.03, width / 2 - 0.03);
  box(-length / 4, length / 4, height * 0.65, height, -width * 0.4, width * 0.4);
  for (const w of wheels) for (const side of [1, -1]) {
    const seg = 20, cy = w.r + (w.lift ?? 0), zc = side * w.halfTrack;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const p = (a: number, z: number) => [w.x + w.r * Math.cos(a), cy + w.r * Math.sin(a), z];
      quad(p(a0, zc - w.width / 2), p(a1, zc - w.width / 2), p(a1, zc + w.width / 2), p(a0, zc + w.width / 2));
      for (const z of [zc - w.width / 2, zc + w.width / 2]) tris.push(w.x, cy, z, ...p(a0, z), ...p(a1, z));
    }
  }
  return surfaceSamples(new Float32Array(tris));
}

const near = (actual: number, expected: number, tolerance: number, label: string) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} is not within ${tolerance} of ${expected}`);

test('finds both axles, wheel size and track on a sedan-shaped body', () => {
  const found = detectAxles(vehicle(4.8, 1.85, 1.45, 0.3, [{ x: 1.45, r: 0.34, halfTrack: 0.78, width: 0.24 }, { x: -1.35, r: 0.34, halfTrack: 0.78, width: 0.24 }]), { length: 4.8, width: 1.85, height: 1.45 });
  assert.ok(found);
  near(found.front.x, 1.45, 0.03, 'front x'); near(found.rear.x, -1.35, 0.03, 'rear x');
  near(found.front.radius, 0.34, 0.03, 'front radius'); near(found.rear.radius, 0.34, 0.03, 'rear radius');
  near(found.front.halfTrack, 0.78, 0.03, 'track'); near(found.front.width, 0.24, 0.04, 'tire width');
});

test('handles big truck tires and small front wheels that float above the ground', () => {
  const truck = detectAxles(vehicle(5.7, 2.08, 2, 0.5, [{ x: 1.8, r: 0.45, halfTrack: 0.86, width: 0.3 }, { x: -1.7, r: 0.45, halfTrack: 0.86, width: 0.3 }]), { length: 5.7, width: 2.08, height: 2 });
  assert.ok(truck);
  near(truck.front.radius, 0.45, 0.03, 'truck radius');
  const mower = detectAxles(vehicle(1.8, 1.1, 1.2, 0.45, [{ x: 0.6, r: 0.19, halfTrack: 0.42, width: 0.15, lift: 0.09 }, { x: -0.55, r: 0.28, halfTrack: 0.44, width: 0.22 }]), { length: 1.8, width: 1.1, height: 1.2 });
  assert.ok(mower);
  near(mower.front.x, 0.6, 0.04, 'mower front x'); near(mower.front.radius, 0.19, 0.03, 'mower front radius');
  near(mower.rear.radius, 0.28, 0.03, 'mower rear radius');
});

test('returns nothing for a model with no wheels on the ground', () => {
  assert.equal(detectAxles(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), { length: 1, width: 1, height: 1 }), null);
});

test('turns view points back into ground-frame metres', () => {
  const frames: Record<ViewName, ViewFrame> = {
    side: { view: 'side', left: -3, right: 3, top: 2, bottom: -0.25 },
    top: { view: 'top', left: -3, right: 3, top: 1.2, bottom: -1.2 },
    front: { view: 'front', left: -1.2, right: 1.2, top: 2, bottom: -0.25 },
    rear: { view: 'rear', left: -1.2, right: 1.2, top: 2, bottom: -0.25 },
  };
  const at = (frame: ViewFrame, h: number, v: number) => ({ x: ((h - frame.left) / (frame.right - frame.left)) * 1000, y: ((v - frame.top) / (frame.bottom - frame.top)) * 1000 });
  const seat = { x: 0.3, y: 0.9, z: -0.42 }, head = { x: 2.8, y: 0.8, z: 0.7 }, tail = { x: -2.8, y: 0.9, z: 0.75 };
  const parts = partsFromViews({
    seat: { side: at(frames.side, seat.x, seat.y), top: at(frames.top, seat.x, -seat.z) },
    head: { side: at(frames.side, head.x, head.y), front: at(frames.front, -head.z, head.y) },
    tail: { side: at(frames.side, tail.x, tail.y), rear: at(frames.rear, tail.z, tail.y) },
    hitch: { side: null },
  }, frames);
  assert.ok(parts.seat && parts.head && parts.tail);
  near(parts.seat.x, seat.x, 0.001, 'seat x'); near(parts.seat.y, seat.y, 0.001, 'seat y'); near(parts.seat.z, seat.z, 0.001, 'seat z');
  near(parts.head.x, head.x, 0.001, 'head x'); near(parts.head.z, head.z, 0.001, 'head z');
  near(parts.tail.y, tail.y, 0.001, 'tail y'); near(parts.tail.z, tail.z, 0.001, 'tail z');
  assert.equal(parts.hitch, null);
});
