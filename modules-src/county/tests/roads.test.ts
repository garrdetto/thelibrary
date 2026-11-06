import { test } from 'node:test';
import assert from 'node:assert/strict';
import { county } from '../shared/County';
import { RoadNet, CROSSFALL, CURB, MAX_GRADE, crossHeight, pointInPoly, rowHalf, walkEnd, walkTop, type V2 } from '../shared/Roads';

const { net, terrain } = county();

function segmentsCross(a: V2, b: V2, c: V2, d: V2) {
  const o = (p: V2, q: V2, r: V2) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}
function shrink(poly: V2[], k: number): V2[] {
  const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length, cz = poly.reduce((s, p) => s + p[1], 0) / poly.length;
  return poly.map(([x, z]) => { const dx = x - cx, dz = z - cz, l = Math.hypot(dx, dz); return [x - (dx / l) * k, z - (dz / l) * k] as V2; });
}
function polysOverlap(a: V2[], b: V2[]) {
  if (a.some(p => pointInPoly(b, p[0], p[1])) || b.some(p => pointInPoly(a, p[0], p[1]))) return true;
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) if (segmentsCross(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) return true;
  return false;
}

test('the county is deterministic', () => {
  const again = new RoadNet();
  assert.equal(again.lots.length, net.lots.length);
  assert.deepEqual(again.lots.map(l => [l.poly, l.pad, l.house]), net.lots.map(l => [l.poly, l.pad, l.house]));
  assert.equal(terrain.heightAt(-1001.3, 377.7), terrain.heightAt(-1001.3, 377.7));
});

test('every street is connected and has room between its junctions', () => {
  const seen = new Set([0]), stack = [0];
  while (stack.length) { const n = stack.pop()!; for (const e of net.edges) if (e.nodes.includes(n)) for (const m of e.nodes) if (!seen.has(m)) { seen.add(m); stack.push(m); } }
  assert.equal(seen.size, net.nodes.length);
  for (const e of net.edges) assert.ok(e.trim[0] + e.trim[1] + 16 < e.len, `${e.name} #${e.id} too short for its junctions`);
});

test('roads never climb faster than the grade limit', () => {
  for (const e of net.edges) for (let s = 0; s + 4 <= e.len; s += 4) {
    const g = Math.abs(net.elevAt(e, s + 4) - net.elevAt(e, s)) / 4;
    assert.ok(g <= MAX_GRADE + 0.005, `${e.name} grade ${g.toFixed(3)} at ${s}`);
  }
});

test('junction curb paths meet the trimmed streets exactly, at the same height', () => {
  for (const j of net.junctions.values()) for (const c of j.corners) {
    for (const [ref, pt] of [[c.from, c.path[0]], [c.to, c.path[c.path.length - 1]]] as const) {
      const e = net.edges[ref.edge], s = net.sAt(e, ref.end, e.trim[ref.end]);
      const side = (ref === c.from ? 1 : -1) * net.outLeft(ref);
      const [x, z] = net.offset(e, s, side * e.cls.half);
      assert.ok(Math.hypot(x - pt.x, z - pt.z) < 0.01, `seam gap at junction ${j.node}`);
      assert.ok(Math.abs(net.elevAt(e, s) - j.elev) < 0.001, `seam step at junction ${j.node}`);
    }
  }
});

test('junction areas never overlap each other', () => {
  const js = [...net.junctions.values()];
  for (let i = 0; i < js.length; i++) for (let k = i + 1; k < js.length; k++) assert.ok(!polysOverlap(js[i].outline, js[k].outline), `junctions ${js[i].node} and ${js[k].node} overlap`);
});

test('the cross-section has no steps except the curb face', () => {
  for (const w of [net.edges[0].cls, net.edges[net.edges.length - 1].cls]) for (const cut of [0, 0.5, 1]) {
    for (let d = 0.001; d < walkEnd(w) - 0.001; d += 0.01) assert.ok(Math.abs(crossHeight(w, d + 0.001, cut) - crossHeight(w, d, cut)) < 0.003);
    assert.ok(Math.abs(crossHeight(w, walkEnd(w)) - walkTop(w)) < 1e-9);
    assert.ok(Math.abs(walkTop(w) - (CURB.height + CROSSFALL * w.walk)) < 1e-9);
  }
});

test('lots stay out of the right of way and off each other', () => {
  assert.ok(net.lots.length > 80, `only ${net.lots.length} lots`);
  for (const l of net.lots) {
    const inner = shrink(l.poly, 0.05);
    for (const [x, z] of inner) assert.ok(!net.query(x, z).inside, `lot ${l.id} corner inside a street`);
    const xs = inner.map(p => p[0]), zs = inner.map(p => p[1]);
    for (let x = Math.min(...xs); x <= Math.max(...xs); x += 2) for (let z = Math.min(...zs); z <= Math.max(...zs); z += 2)
      if (pointInPoly(inner, x, z)) assert.ok(!net.query(x, z).inside, `lot ${l.id} overlaps a street at ${x.toFixed(1)}, ${z.toFixed(1)}`);
  }
  for (let i = 0; i < net.lots.length; i++) for (let k = i + 1; k < net.lots.length; k++) {
    const a = net.lots[i], b = net.lots[k];
    if (Math.hypot(a.origin[0] - b.origin[0], a.origin[1] - b.origin[1]) > 120) continue;
    assert.ok(!polysOverlap(shrink(a.poly, 0.05), shrink(b.poly, 0.05)), `lots ${a.id} and ${b.id} overlap`);
  }
});

test('curb cuts sit clear of junctions and of each other', () => {
  for (const e of net.edges) for (const side of [1, -1] as const) {
    const cuts = e.cuts.filter(c => c.side === side);
    for (const c of cuts) {
      assert.ok(c.s - c.width / 2 - c.flare >= e.trim[0] - 1e-6 && c.s + c.width / 2 + c.flare <= e.len - e.trim[1] + 1e-6, `${c.kind} cut on ${e.name} runs into a junction`);
    }
    for (let i = 1; i < cuts.length; i++) {
      const gap = cuts[i].s - cuts[i].width / 2 - cuts[i].flare - (cuts[i - 1].s + cuts[i - 1].width / 2 + cuts[i - 1].flare);
      assert.ok(gap >= 1.5, `cuts on ${e.name} only ${gap.toFixed(2)} m apart`);
    }
  }
});

test('the ground mesh stays under every sidewalk and verge', () => {
  let worst = -Infinity;
  for (const e of net.edges) {
    if (e.len > 400) continue;
    for (let s = e.trim[0]; s <= e.len - e.trim[1]; s += 1.37) for (const side of [1, -1] as const) {
      const elev = net.elevAt(e, s), cut = net.cutAt(e, side, s);
      for (let d = 0.2; d <= walkEnd(e.cls) - 0.3; d += 0.35) {
        const [x, z] = net.offset(e, s, side * (e.cls.half + d));
        worst = Math.max(worst, terrain.gridHeight(x, z) - (elev + crossHeight(e.cls, d, cut)));
      }
    }
  }
  assert.ok(worst <= 0.02, `ground pokes ${worst.toFixed(3)} m above a sidewalk`);
});

test('the ground meets the sidewalk at the edge of the right of way', () => {
  for (const e of net.edges.filter(e => e.len < 400)) for (let s = e.trim[0] + 3; s < e.len - e.trim[1] - 3; s += 7.1) for (const side of [1, -1] as const) {
    const [x, z] = net.offset(e, s, side * (rowHalf(e.cls) + 0.5));
    if (net.query(x, z).inside) continue;
    const diff = terrain.heightAt(x, z) - (net.elevAt(e, s) + walkTop(e.cls));
    assert.ok(Math.abs(diff) < 0.05, `ground ${diff.toFixed(2)} m off the sidewalk on ${e.name}`);
  }
});
