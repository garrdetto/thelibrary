import bpy
import bmesh
import json
import math
import os
import random
import struct
import sys
from mathutils import Matrix, Quaternion, Vector, noise
from mathutils.bvhtree import BVHTree

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(ARGS[0]) if ARGS else os.path.abspath(os.path.join(os.path.dirname(__file__), '../../../public/modules/rackreel/models'))
PREVIEW = ARGS[1] if len(ARGS) > 1 else ''
ONLY = set(ARGS[2].split(',')) if len(ARGS) > 2 and ARGS[2] else None
os.makedirs(OUT, exist_ok=True)
rng = random.Random(7)


def lerp(a, b, t):
    return a + (b - a) * t


def mix(c1, c2, t):
    t = max(0.0, min(1.0, t))
    return (lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t))


def smooth01(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def n3(co, s=1.0):
    return noise.noise(Vector((co[0] * s, co[1] * s, co[2] * s)))


class Piece:
    def __init__(self):
        self.pos = []
        self.nor = []
        self.col = []
        self.tris = []
        self.uv = None


def piece_from_bm(bm, color_fn, smooth=True, flip=False):
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.normal_update()
    p = Piece()
    if smooth:
        bm.verts.index_update()
        for v in bm.verts:
            p.pos.append(tuple(v.co))
            n = v.normal if not flip else -v.normal
            p.nor.append(tuple(n))
            p.col.append(color_fn(v.co, n))
        for f in bm.faces:
            ids = [v.index for v in f.verts]
            p.tris.append(tuple(ids[::-1]) if flip else tuple(ids))
    else:
        for f in bm.faces:
            n = f.normal if not flip else -f.normal
            base = len(p.pos)
            vs = list(f.verts)
            if flip:
                vs = vs[::-1]
            for v in vs:
                p.pos.append(tuple(v.co))
                p.nor.append(tuple(n))
                p.col.append(color_fn(v.co, n))
            p.tris.append((base, base + 1, base + 2))
    bm.free()
    return p


def new_bm():
    return bmesh.new()


def cone(r1, r2, depth, seg=10, at=(0, 0, 0), cap=True, rot=None):
    bm = new_bm()
    m = Matrix.Translation(Vector(at) + Vector((0, 0, depth / 2)))
    if rot is not None:
        m = Matrix.Translation(Vector(at)) @ rot @ Matrix.Translation((0, 0, depth / 2))
    bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=True, segments=seg, radius1=r1, radius2=r2, depth=depth, matrix=m)
    return bm


def ico(radius, sub=2, at=(0, 0, 0), scale=(1, 1, 1)):
    bm = new_bm()
    m = Matrix.Translation(Vector(at)) @ Matrix.Diagonal(Vector((scale[0], scale[1], scale[2], 1)))
    bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=radius, matrix=m)
    return bm


def sphere(radius, u=12, v=8, at=(0, 0, 0), scale=(1, 1, 1)):
    bm = new_bm()
    m = Matrix.Translation(Vector(at)) @ Matrix.Diagonal(Vector((scale[0], scale[1], scale[2], 1)))
    bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, radius=radius, matrix=m)
    return bm


def box(size, at=(0, 0, 0), rot=None):
    bm = new_bm()
    m = Matrix.Translation(Vector(at))
    if rot is not None:
        m = m @ rot
    m = m @ Matrix.Diagonal(Vector((size[0], size[1], size[2], 1)))
    bmesh.ops.create_cube(bm, size=1.0, matrix=m)
    return bm


def displace(bm, amount, scale, seed=0.0):
    for v in bm.verts:
        d = n3(Vector(v.co) + Vector((seed, seed * 0.7, seed * 1.3)), scale)
        v.co += v.co.normalized() * d * amount if v.co.length > 1e-5 else Vector()


def displace_local(bm, center, amount, scale, seed=0.0):
    c = Vector(center)
    for v in bm.verts:
        off = Vector(v.co) - c
        d = n3(Vector(v.co) + Vector((seed, seed * 0.7, seed * 1.3)), scale)
        if off.length > 1e-5:
            v.co += off.normalized() * d * amount


def tube(points, radii, seg=8, cap=True):
    bm = new_bm()
    rings = []
    count = len(points)
    for i, p in enumerate(points):
        p = Vector(p)
        if i == 0:
            t = (Vector(points[1]) - p).normalized()
        elif i == count - 1:
            t = (p - Vector(points[i - 1])).normalized()
        else:
            t = (Vector(points[i + 1]) - Vector(points[i - 1])).normalized()
        up = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
        a = t.cross(up).normalized()
        b = t.cross(a).normalized()
        ring = []
        for k in range(seg):
            ang = k / seg * math.tau
            ring.append(bm.verts.new(p + (a * math.cos(ang) + b * math.sin(ang)) * radii[i]))
        rings.append(ring)
    for i in range(count - 1):
        for k in range(seg):
            k2 = (k + 1) % seg
            bm.faces.new((rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]))
    if cap:
        tip = bm.verts.new(Vector(points[-1]) + (Vector(points[-1]) - Vector(points[-2])).normalized() * radii[-1] * 0.6)
        for k in range(seg):
            bm.faces.new((rings[-1][k], rings[-1][(k + 1) % seg], tip))
        base = bm.verts.new(Vector(points[0]))
        for k in range(seg):
            bm.faces.new((rings[0][(k + 1) % seg], rings[0][k], base))
    bm.normal_update()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return bm


_mb_count = [0]


def metaball(elements, resolution=0.05, threshold=0.6, decimate=None):
    _mb_count[0] += 1
    name = 'mbfam%da' % _mb_count[0]
    mb = bpy.data.metaballs.new(name)
    mb.resolution = resolution
    mb.render_resolution = resolution
    mb.threshold = threshold
    for el in elements:
        e = mb.elements.new()
        e.type = 'ELLIPSOID'
        e.co = el[0]
        e.radius = el[1] * 1.74
        sx, sy, sz = el[2] if len(el) > 2 else (1, 1, 1)
        e.size_x, e.size_y, e.size_z = sx, sy, sz
        e.stiffness = el[3] if len(el) > 3 and el[3] else 2.0
        if len(el) > 4 and el[4] is not None:
            e.rotation = el[4]
    obj = bpy.data.objects.new(name, mb)
    bpy.context.scene.collection.objects.link(obj)
    dg = bpy.context.evaluated_depsgraph_get()
    dg.update()
    me = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
    bpy.data.objects.remove(obj)
    if decimate:
        tmp = bpy.data.objects.new(name + 'dec', me)
        bpy.context.scene.collection.objects.link(tmp)
        mod = tmp.modifiers.new('dec', 'DECIMATE')
        mod.ratio = decimate * 0.5
        dg = bpy.context.evaluated_depsgraph_get()
        dg.update()
        me2 = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
        bpy.data.objects.remove(tmp)
        me = me2
    bm = new_bm()
    bm.from_mesh(me)
    return bm


class Model:
    def __init__(self, name, ground=True, ao_dist=1.0, ao_strength=0.85):
        self.name = name
        self.parts = {}
        self.pivots = {}
        self.ground = ground
        self.ao_dist = ao_dist
        self.ao_strength = ao_strength
        self.materials = {}
        self.parents = {}

    def add(self, part, piece, pivot=(0, 0, 0), material=None, parent=None):
        self.parts.setdefault(part, []).append(piece)
        self.pivots.setdefault(part, pivot)
        if material:
            self.materials[part] = material
        if parent:
            self.parents[part] = parent


def bake_ao(model, samples=20):
    verts = []
    polys = []
    for pieces in model.parts.values():
        for p in pieces:
            base = len(verts)
            verts.extend(Vector(v) for v in p.pos)
            polys.extend((a + base, b + base, c + base) for a, b, c in p.tris)
    if model.ground:
        base = len(verts)
        s = 50
        verts.extend([Vector((-s, -s, -0.002)), Vector((s, -s, -0.002)), Vector((s, s, -0.002)), Vector((-s, s, -0.002))])
        polys.extend([(base, base + 1, base + 2), (base, base + 2, base + 3)])
    tree = BVHTree.FromPolygons(verts, polys, epsilon=0.0)
    r = random.Random(3)
    dirs = []
    for i in range(samples):
        u = (i + r.random()) / samples
        phi = r.random() * math.tau
        st = math.sqrt(u)
        dirs.append((st * math.cos(phi), st * math.sin(phi), math.sqrt(1 - u)))
    for pieces in model.parts.values():
        for p in pieces:
            for i, (co, n) in enumerate(zip(p.pos, p.nor)):
                nv = Vector(n)
                if nv.length < 1e-6:
                    continue
                nv.normalize()
                t1 = nv.cross(Vector((0, 0, 1)) if abs(nv.z) < 0.9 else Vector((1, 0, 0))).normalized()
                t2 = nv.cross(t1)
                origin = Vector(co) + nv * 0.006
                hit = 0
                for dx, dy, dz in dirs:
                    d = t1 * dx + t2 * dy + nv * dz
                    loc, _, _, dist = tree.ray_cast(origin, d, model.ao_dist)
                    if loc is not None:
                        hit += 1.0 - (dist / model.ao_dist) * 0.5
                ao = 1.0 - model.ao_strength * hit / samples
                c = p.col[i]
                p.col[i] = (c[0] * ao, c[1] * ao, c[2] * ao)


def to_srgb_byte(x):
    x = max(0.0, min(1.0, x))
    return int(round(x * 255))


def write_model(model):
    (getattr(model, 'bake', None) or bake_ao)(model)
    header = {'name': model.name, 'parts': []}
    blobs = []
    offset = 0
    for name, pieces in model.parts.items():
        pos, nor, col, idx, uvs = [], [], [], [], []
        has_uv = any(p.uv for p in pieces)
        for p in pieces:
            base = len(pos)
            pos.extend(p.pos)
            nor.extend(p.nor)
            col.extend(p.col)
            uvs.extend(p.uv if p.uv else [(0.0, 0.0)] * len(p.pos))
            idx.extend((a + base, b + base, c + base) for a, b, c in p.tris)
        piv = model.pivots[name]
        vcount = len(pos)
        wide = vcount > 65535
        chunk = bytearray()
        for (x, y, z) in pos:
            chunk += struct.pack('<3f', x, z, y)
        for (x, y, z) in nor:
            l = math.sqrt(x * x + y * y + z * z) or 1.0
            chunk += struct.pack('<3b', int(round(x / l * 127)), int(round(z / l * 127)), int(round(y / l * 127)))
        while len(chunk) % 4:
            chunk += b'\0'
        for (r, g, b) in col:
            chunk += struct.pack('<4B', to_srgb_byte(r), to_srgb_byte(g), to_srgb_byte(b), 255)
        if has_uv:
            for (u, v) in uvs:
                chunk += struct.pack('<2f', u, v)
        for (a, b, c) in idx:
            chunk += struct.pack('<3I' if wide else '<3H', a, c, b)
        while len(chunk) % 4:
            chunk += b'\0'
        header['parts'].append({'name': name, 'pivot': [piv[0], piv[2], piv[1]], 'vertices': vcount, 'indices': len(idx) * 3, 'wide': wide, 'offset': offset, 'bytes': len(chunk), 'uv': has_uv, 'material': model.materials.get(name, ''), **({'parent': model.parents[name]} if name in model.parents else {})})
        offset += len(chunk)
        blobs.append(bytes(chunk))
    for name, (source, material, piv, parent) in getattr(model, 'aliases', {}).items():
        header['parts'].append({'name': name, 'alias': source, 'pivot': [piv[0], piv[2], piv[1]], 'vertices': 0, 'indices': 0, 'wide': False, 'offset': offset, 'bytes': 0, 'uv': False, 'material': material, **({'parent': parent} if parent else {})})
    hj = json.dumps(header, separators=(',', ':')).encode('utf8')
    while (len(hj) + 8) % 4:
        hj += b' '
    path = os.path.join(OUT, model.name + '.rrm')
    with open(path, 'wb') as f:
        f.write(b'RRM1')
        f.write(struct.pack('<I', len(hj)))
        f.write(hj)
        for b in blobs:
            f.write(b)
    tris = sum(p['indices'] for p in header['parts']) // 3
    print('wrote %s  parts=%d  tris=%d  bytes=%d' % (model.name, len(header['parts']), tris, os.path.getsize(path)))
    if PREVIEW:
        preview(model)


def preview(model):
    for o in list(bpy.context.scene.objects):
        bpy.data.objects.remove(o)
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for name, pieces in model.parts.items():
        for p in pieces:
            me = bpy.data.meshes.new(name)
            me.from_pydata([Vector(v) for v in p.pos], [], [tuple(t) for t in p.tris])
            attr = me.color_attributes.new('col', 'FLOAT_COLOR', 'POINT')
            for i, c in enumerate(p.col):
                attr.data[i].color = (c[0] ** 2.2, c[1] ** 2.2, c[2] ** 2.2, 1)
            me.shade_smooth()
            ob = bpy.data.objects.new(name, me)
            bpy.context.scene.collection.objects.link(ob)
            for v in p.pos:
                lo = Vector((min(lo.x, v[0]), min(lo.y, v[1]), min(lo.z, v[2])))
                hi = Vector((max(hi.x, v[0]), max(hi.y, v[1]), max(hi.z, v[2])))
    center = (lo + hi) / 2
    size = (hi - lo).length
    cam_data = bpy.data.cameras.new('cam')
    cam = bpy.data.objects.new('cam', cam_data)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = center + Vector((size * 0.9, -size * 1.1, size * 0.55))
    cam.rotation_euler = (center - cam.location).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = cam
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'STUDIO'
    sc.display.shading.color_type = 'VERTEX'
    sc.render.resolution_x = 512
    sc.render.resolution_y = 384
    views = [('', Vector((size * 0.9, -size * 1.1, size * 0.55))), ('-front', Vector((size * 1.0, size * 0.95, size * 0.3))), ('-side', Vector((size * 1.35, 0.0, size * 0.12)))]
    for suffix, offset in views:
        cam.location = center + offset
        cam.rotation_euler = (center - cam.location).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = os.path.join(PREVIEW, model.name + suffix + '.png')
        bpy.ops.render.render(write_still=True)


def bark(co, n):
    v = n3(co, 6) * 0.5 + 0.5
    return mix((0.22, 0.16, 0.11), (0.34, 0.26, 0.18), v)


def build_pine():
    m = Model('pine', ao_dist=3.0, ao_strength=0.7)
    m.add('trunk', piece_from_bm(cone(0.28, 0.06, 15.5, 7), bark))
    layers = 7
    for i in range(layers):
        t = i / (layers - 1)
        z = lerp(2.6, 12.6, t)
        r = lerp(3.1, 0.75, t)
        h = lerp(3.4, 2.6, t)
        bm = cone(r, 0.05, h, 11, at=(0, 0, z))
        for v in bm.verts:
            rr = math.hypot(v.co.x, v.co.y)
            if rr > 0.3:
                ang = math.atan2(v.co.y, v.co.x)
                v.co.x += math.cos(ang) * n3(v.co, 1.7) * 0.5
                v.co.y += math.sin(ang) * n3(v.co, 1.7) * 0.5
                v.co.z -= 0.35 * (rr / r) + 0.3 * abs(math.sin(ang * 5.5 + i))
        def col(co, n, z0=z, h0=h):
            g = n3(co, 2.2) * 0.5 + 0.5
            tip = smooth01(0.5, 1.0, math.hypot(co.x, co.y) / 3.0)
            base = mix((0.07, 0.17, 0.09), (0.13, 0.27, 0.12), g)
            return mix(base, (0.22, 0.35, 0.16), tip * 0.5 + max(0.0, n.z) * 0.2)
        m.add('crown', piece_from_bm(bm, col))
    write_model(m)


def build_hardwood():
    m = Model('hardwood', ao_dist=2.5, ao_strength=0.75)
    m.add('trunk', piece_from_bm(tube([(0, 0, -0.2), (0.1, 0, 2.5), (0.05, 0.1, 5.5), (0.2, 0.0, 8.0)], [0.36, 0.28, 0.2, 0.1], 8), bark))
    branches = [((0.05, 0.1, 4.0), (1.8, 0.6, 6.8)), ((0.1, 0.0, 4.8), (-1.5, -0.9, 7.6)), ((0.12, 0.05, 5.8), (0.4, -1.8, 8.6))]
    for a, b in branches:
        mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2 + 0.4)
        m.add('trunk', piece_from_bm(tube([a, mid, b], [0.14, 0.09, 0.04], 6), bark))
    clumps = [((0, 0, 8.6), 2.8), ((1.9, 0.6, 7.4), 2.2), ((-1.7, -0.9, 7.9), 2.3), ((0.5, -1.9, 8.8), 2.0), ((-0.6, 1.5, 7.2), 2.0), ((0.9, 1.0, 10.0), 1.9), ((-1.0, 0.0, 6.4), 1.8)]
    for i, (c, r) in enumerate(clumps):
        bm = ico(r, 2, at=c, scale=(1, 1, 0.82))
        displace_local(bm, c, r * 0.32, 0.9, seed=i * 3.1)
        def col(co, n):
            g = n3(co, 1.4) * 0.5 + 0.5
            light = max(0.0, n.z) * 0.25 + max(0.0, n.x * 0.3)
            return mix((0.62, 0.62, 0.6), (0.95, 0.95, 0.92), g * 0.6 + light)
        m.add('crown', piece_from_bm(bm, col))
    write_model(m)


def build_birch():
    m = Model('birch', ao_dist=2.0, ao_strength=0.7)
    def birch_bark(co, n):
        mark = n3(Vector((co.x * 2, co.y * 2, co.z * 9)), 1.0)
        base = (0.86, 0.85, 0.8)
        return (0.12, 0.11, 0.1) if mark > 0.42 else mix(base, (0.7, 0.68, 0.62), n3(co, 4) * 0.5 + 0.5)
    m.add('trunk', piece_from_bm(tube([(0, 0, -0.2), (0.15, 0.05, 3.0), (0.05, 0.12, 6.5), (0.25, 0.05, 10.0)], [0.2, 0.17, 0.12, 0.05], 8), birch_bark))
    for i, (c, r) in enumerate([((0.2, 0.1, 9.2), 1.7), ((1.0, 0.4, 7.8), 1.4), ((-0.8, -0.3, 8.1), 1.4), ((0.1, -0.9, 6.9), 1.2), ((-0.2, 0.9, 6.6), 1.2)]):
        bm = ico(r, 2, at=c, scale=(1, 1, 1.1))
        displace_local(bm, c, r * 0.35, 1.2, seed=i * 7.3)
        def col(co, n):
            g = n3(co, 1.6) * 0.5 + 0.5
            return mix((0.7, 0.72, 0.6), (1.0, 1.0, 0.9), g * 0.6 + max(0.0, n.z) * 0.3)
        m.add('crown', piece_from_bm(bm, col))
    write_model(m)


def blade(bm, base, ang, length, width, bend, segs=3, lean=0.0):
    prev = None
    d = Vector((math.cos(ang), math.sin(ang), 0))
    side = Vector((-d.y, d.x, 0))
    for s in range(segs + 1):
        t = s / segs
        w = width * (1 - t) ** 0.8
        p = Vector(base) + d * (bend * t * t * length + lean * t) + Vector((0, 0, length * t * (1 - 0.25 * t * t)))
        l = bm.verts.new(p - side * w)
        r = bm.verts.new(p + side * w)
        if prev:
            bm.faces.new((prev[0], prev[1], r, l))
        prev = (l, r)


def build_grass():
    m = Model('grass', ao_dist=0.5, ao_strength=0.6)
    bm = new_bm()
    for i in range(11):
        ang = rng.random() * math.tau
        rr = rng.random() * 0.18
        blade(bm, (math.cos(ang) * rr, math.sin(ang) * rr, 0), ang + rng.uniform(-0.5, 0.5), rng.uniform(0.35, 0.75), 0.035, rng.uniform(0.15, 0.45), 3)
    def col(co, n):
        t = smooth01(0.0, 0.7, co.z)
        return mix((0.16, 0.24, 0.08), (0.62, 0.66, 0.34), t)
    m.add('blades', piece_from_bm(bm, col))
    write_model(m)


def build_fern():
    m = Model('fern', ao_dist=0.6, ao_strength=0.6)
    bm = new_bm()
    fronds = 8
    for i in range(fronds):
        ang = i / fronds * math.tau + rng.uniform(-0.2, 0.2)
        d = Vector((math.cos(ang), math.sin(ang), 0))
        side = Vector((-d.y, d.x, 0))
        length = rng.uniform(0.7, 1.0)
        prev = None
        steps = 8
        for s in range(steps + 1):
            t = s / steps
            w = 0.16 * math.sin(math.pi * min(1.0, t * 1.15)) + 0.01
            p = d * (length * t) + Vector((0, 0, 0.55 * math.sin(t * math.pi * 0.75) - 0.15 * t * t))
            l = bm.verts.new(p - side * w + Vector((0, 0, -0.04 * w)))
            c = bm.verts.new(p + Vector((0, 0, 0.02)))
            r = bm.verts.new(p + side * w + Vector((0, 0, -0.04 * w)))
            if prev:
                bm.faces.new((prev[0], prev[1], c, l))
                bm.faces.new((prev[1], prev[2], r, c))
            prev = (l, c, r)
    def col(co, n):
        t = math.hypot(co.x, co.y)
        return mix((0.1, 0.24, 0.07), (0.36, 0.52, 0.16), smooth01(0.1, 0.9, t) * 0.8 + n3(co, 4) * 0.2)
    m.add('fronds', piece_from_bm(bm, col))
    write_model(m)


def build_cattail():
    m = Model('cattail', ao_dist=0.6, ao_strength=0.5)
    bm = new_bm()
    for i in range(9):
        ang = rng.random() * math.tau
        rr = rng.random() * 0.25
        blade(bm, (math.cos(ang) * rr, math.sin(ang) * rr, 0), ang, rng.uniform(1.2, 1.9), 0.03, rng.uniform(0.1, 0.35), 4)
    def col(co, n):
        return mix((0.24, 0.3, 0.12), (0.62, 0.6, 0.32), smooth01(0.0, 1.8, co.z))
    m.add('reeds', piece_from_bm(bm, col))
    for i in range(3):
        x, y = rng.uniform(-0.15, 0.15), rng.uniform(-0.15, 0.15)
        h = rng.uniform(1.5, 2.0)
        m.add('reeds', piece_from_bm(tube([(x, y, 0), (x + 0.03, y, h * 0.5), (x + 0.06, y, h)], [0.012, 0.01, 0.008], 5), lambda co, n: (0.4, 0.42, 0.2)))
        m.add('reeds', piece_from_bm(tube([(x + 0.06, y, h - 0.32), (x + 0.065, y, h - 0.02)], [0.035, 0.035], 7), lambda co, n: (0.3, 0.17, 0.08)))
    write_model(m)


def build_rock():
    m = Model('rock', ao_dist=1.0, ao_strength=0.6)
    bm = ico(1.0, 3, at=(0, 0, 0.35), scale=(1.3, 1.0, 0.7))
    displace_local(bm, (0, 0, 0.35), 0.35, 1.3, seed=2)
    def col(co, n):
        moss = smooth01(0.4, 0.9, n.z) * (n3(co, 2) * 0.5 + 0.6)
        stone = mix((0.36, 0.35, 0.33), (0.55, 0.53, 0.5), n3(co, 5) * 0.5 + 0.5)
        return mix(stone, (0.22, 0.32, 0.12), moss)
    m.add('rock', piece_from_bm(bm, col))
    write_model(m)


def build_log():
    m = Model('log', ao_dist=0.8, ao_strength=0.7)
    m.add('log', piece_from_bm(tube([(-2.4, 0, 0.26), (-0.8, 0.05, 0.25), (0.8, -0.04, 0.24), (2.4, 0, 0.22)], [0.3, 0.29, 0.27, 0.25], 10), lambda co, n: mix((0.25, 0.19, 0.13), (0.36, 0.3, 0.2), n3(co, 3) * 0.5 + 0.5 + max(0.0, n.z) * 0.3)))
    write_model(m)


def deer_color(co, n):
    belly = smooth01(-0.2, -0.75, n.z) * smooth01(1.15, 0.85, co.z)
    back = mix((0.47, 0.33, 0.2), (0.34, 0.23, 0.14), smooth01(0.3, 0.9, n.z))
    c = mix(back, (0.88, 0.85, 0.8), belly)
    if co.y < -0.62 and co.z > 0.85:
        c = mix(c, (0.9, 0.88, 0.84), smooth01(0.0, -0.7, n.z) + 0.2)
    return c


def build_deer():
    m = Model('deer', ao_dist=0.5, ao_strength=0.75)
    torso = metaball([
        ((0, 0.25, 1.0), 0.45, (0.62, 1.0, 0.72)),
        ((0, -0.25, 1.0), 0.45, (0.6, 1.0, 0.7)),
        ((0, 0.52, 1.02), 0.33, (0.8, 0.9, 0.95)),
        ((0, -0.52, 1.05), 0.34, (0.8, 0.9, 0.9)),
        ((0, -0.78, 1.15), 0.12, (0.5, 0.6, 1.2)),
    ], 0.035, decimate=0.35)
    m.add('body', piece_from_bm(torso, deer_color))
    head = metaball([
        ((0, 0.72, 1.2), 0.2, (0.8, 0.9, 1.0)),
        ((0, 0.86, 1.42), 0.17, (0.7, 0.8, 1.1)),
        ((0, 0.95, 1.62), 0.15, (0.75, 0.9, 0.85)),
        ((0, 1.1, 1.6), 0.11, (0.65, 1.4, 0.7)),
        ((0, 1.25, 1.56), 0.07, (0.8, 1.0, 0.8)),
    ], 0.025, decimate=0.4)
    def head_col(co, n):
        c = mix((0.48, 0.34, 0.21), (0.36, 0.25, 0.15), smooth01(0.4, 0.9, n.z))
        if co.y > 1.27:
            return (0.06, 0.05, 0.05)
        if co.z < 1.35 and n.y > 0.2 and n.z < 0.1:
            c = mix(c, (0.88, 0.86, 0.82), 0.7)
        if 1.18 < co.y < 1.26 and co.z < 1.56:
            c = (0.85, 0.83, 0.8)
        return c
    m.add('head', piece_from_bm(head, head_col), pivot=(0, 0.68, 1.2))
    for side in (-1, 1):
        ear = sphere(0.1, 8, 6, at=(side * 0.13, 0.9, 1.74), scale=(0.5, 0.25, 1.1))
        for v in ear.verts:
            v.co.x += side * (v.co.z - 1.74) * 0.6
        m.add('head', piece_from_bm(ear, lambda co, n: (0.42, 0.3, 0.2)))
        eye = sphere(0.03, 8, 6, at=(side * 0.105, 1.05, 1.66))
        m.add('head', piece_from_bm(eye, lambda co, n: (0.03, 0.02, 0.02)))
    legs = {'legFL': (0.17, 0.5, True), 'legFR': (-0.17, 0.5, True), 'legBL': (0.17, -0.5, False), 'legBR': (-0.17, -0.5, False)}
    for name, (x, y, front) in legs.items():
        if front:
            els = [((x, y, 0.92), 0.17, (0.7, 0.9, 1.4)), ((x, y + 0.02, 0.6), 0.09, (0.6, 0.7, 1.6)), ((x, y + 0.01, 0.3), 0.06, (0.6, 0.7, 2.2)), ((x, y + 0.03, 0.06), 0.06, (0.75, 1.1, 0.8))]
        else:
            els = [((x, y, 0.92), 0.22, (0.7, 1.1, 1.3)), ((x, y - 0.1, 0.62), 0.1, (0.6, 0.8, 1.6)), ((x, y - 0.05, 0.33), 0.06, (0.6, 0.7, 2.2)), ((x, y - 0.02, 0.06), 0.06, (0.75, 1.1, 0.8))]
        bm = metaball(els, 0.022, decimate=0.4)
        def leg_col(co, n):
            if co.z < 0.1:
                return (0.08, 0.07, 0.06)
            return mix((0.6, 0.47, 0.33), (0.45, 0.32, 0.2), smooth01(0.3, 0.8, co.z))
        m.add(name, piece_from_bm(bm, leg_col), pivot=(x, y, 0.95))
    write_model(m)


def build_antlers():
    m = Model('antlers', ground=False, ao_dist=0.2, ao_strength=0.4)
    col = lambda co, n: mix((0.42, 0.34, 0.24), (0.86, 0.8, 0.68), smooth01(1.7, 2.1, co.z))
    for side in (-1, 1):
        beam = []
        for i in range(9):
            t = i / 8
            ang = t * 2.2
            beam.append((side * (0.08 + 0.3 * math.sin(ang * 0.75)), 0.88 + 0.36 * math.sin(ang) - 0.05, 1.72 + 0.3 * math.sin(t * 2.6) + 0.05 * t))
        m.add('antlers', piece_from_bm(tube(beam, [0.03 - 0.022 * (i / 8) for i in range(9)], 6), col), pivot=(0, 0.68, 1.2))
        brow = [beam[1], (beam[1][0] + side * 0.02, beam[1][1] + 0.06, beam[1][2] + 0.12)]
        m.add('antlers', piece_from_bm(tube(brow, [0.016, 0.006], 5), col), pivot=(0, 0.68, 1.2))
        for k, i in enumerate((3, 5, 7)):
            b = beam[i]
            h = 0.26 - k * 0.05
            tine = [b, (b[0] + side * 0.01, b[1] + 0.02, b[2] + h * 0.6), (b[0] - side * 0.02, b[1] + 0.05, b[2] + h)]
            m.add('antlers', piece_from_bm(tube(tine, [0.018, 0.012, 0.005], 5), col), pivot=(0, 0.68, 1.2))
    write_model(m)


def build_bear():
    m = Model('bear', ao_dist=0.6, ao_strength=0.75)
    fur = lambda co, n: mix((0.05, 0.045, 0.04), (0.11, 0.095, 0.08), n3(co, 9) * 0.5 + 0.5 + max(0.0, n.z) * 0.3)
    body = metaball([
        ((0, 0.2, 0.85), 0.62, (0.75, 1.0, 0.75)),
        ((0, -0.35, 0.92), 0.62, (0.8, 1.0, 0.8)),
        ((0, 0.55, 0.95), 0.4, (0.75, 0.8, 0.8)),
    ], 0.045, decimate=0.35)
    m.add('body', piece_from_bm(body, fur))
    head = metaball([
        ((0, 0.82, 1.0), 0.3, (0.9, 0.9, 0.9)),
        ((0, 1.02, 1.03), 0.25, (0.85, 0.9, 0.85)),
        ((0, 1.22, 0.98), 0.14, (0.7, 1.2, 0.65)),
    ], 0.03, decimate=0.4)
    def head_col(co, n):
        if co.y > 1.33:
            return (0.03, 0.03, 0.03)
        if co.y > 1.12:
            return (0.42, 0.3, 0.2)
        return fur(co, n)
    m.add('head', piece_from_bm(head, head_col), pivot=(0, 0.75, 1.0))
    for side in (-1, 1):
        m.add('head', piece_from_bm(sphere(0.07, 8, 6, at=(side * 0.15, 0.95, 1.24)), fur))
        m.add('head', piece_from_bm(sphere(0.022, 6, 5, at=(side * 0.09, 1.16, 1.1)), lambda co, n: (0.01, 0.01, 0.01)))
    for name, (x, y) in {'legFL': (0.22, 0.45), 'legFR': (-0.22, 0.45), 'legBL': (0.24, -0.5), 'legBR': (-0.24, -0.5)}.items():
        bm = metaball([((x, y, 0.75), 0.24, (0.8, 0.9, 1.3)), ((x, y + 0.02, 0.38), 0.16, (0.8, 0.85, 1.6)), ((x, y + 0.08, 0.07), 0.13, (0.9, 1.3, 0.6))], 0.03, decimate=0.4)
        m.add(name, piece_from_bm(bm, fur), pivot=(x, y, 0.85))
    write_model(m)


FISH = {
    'muskie': {'len': 1.0, 'depth': 0.13, 'width': 0.075, 'head': 0.24, 'base': (0.62, 0.58, 0.42), 'back': (0.35, 0.36, 0.25), 'pattern': 'bars', 'fins': (0.55, 0.32, 0.2)},
    'pike': {'len': 1.0, 'depth': 0.13, 'width': 0.075, 'head': 0.24, 'base': (0.33, 0.42, 0.22), 'back': (0.17, 0.24, 0.12), 'pattern': 'spots', 'fins': (0.5, 0.4, 0.22)},
    'walleye': {'len': 1.0, 'depth': 0.18, 'width': 0.1, 'head': 0.26, 'base': (0.66, 0.58, 0.3), 'back': (0.36, 0.33, 0.16), 'pattern': 'mottle', 'fins': (0.5, 0.45, 0.3)},
    'smallmouth': {'len': 1.0, 'depth': 0.26, 'width': 0.12, 'head': 0.3, 'base': (0.55, 0.45, 0.24), 'back': (0.3, 0.26, 0.14), 'pattern': 'vbars', 'fins': (0.45, 0.36, 0.2)},
    'perch': {'len': 1.0, 'depth': 0.26, 'width': 0.12, 'head': 0.28, 'base': (0.8, 0.72, 0.3), 'back': (0.38, 0.4, 0.16), 'pattern': 'vbars', 'fins': (0.85, 0.42, 0.15)},
}


def build_fish(kind, spec):
    m = Model('fish-' + kind, ground=False, ao_dist=0.12, ao_strength=0.5)
    L, D, W = spec['len'], spec['depth'], spec['width']
    def col(co, n):
        t = (co.y + 0.5)
        top = smooth01(-0.2, 0.7, n.z)
        c = mix(spec['base'], spec['back'], top)
        belly = smooth01(-0.3, -0.8, n.z)
        p = spec['pattern']
        if p == 'bars' and math.sin(co.y * 48) > 0.35 and n.z > -0.3:
            c = mix(c, (0.2, 0.22, 0.15), 0.6)
        elif p == 'spots' and n3(Vector((co.y * 28, co.z * 40, 0)), 1.0) > 0.25 and n.z > -0.3:
            c = mix(c, (0.85, 0.82, 0.55), 0.75)
        elif p == 'mottle' and n3(Vector((co.y * 20, co.z * 30, 1)), 1.0) > 0.2:
            c = mix(c, (0.25, 0.22, 0.1), 0.5)
        elif p == 'vbars' and math.sin(co.y * 40) > 0.4 and n.z > -0.4:
            c = mix(c, (0.22, 0.2, 0.08), 0.55)
        c = mix(c, (0.9, 0.88, 0.8), belly)
        return c
    body = metaball([
        ((0, 0.28, 0), 0.2, (W * 5, spec['head'] * 4.0, D * 4.6)),
        ((0, 0.05, 0.01), 0.2, (W * 5, 1.4, D * 5.0)),
        ((0, -0.2, 0), 0.2, (W * 4, 1.2, D * 3.5)),
        ((0, -0.38, 0), 0.14, (W * 3.5, 1.0, D * 3.0)),
    ], 0.012, decimate=0.35)
    m.add('body', piece_from_bm(body, col))
    for side in (-1, 1):
        eye = sphere(0.022, 8, 6, at=(side * W * 0.62, 0.42, D * 0.28))
        m.add('body', piece_from_bm(eye, lambda co, n: (0.85, 0.7, 0.2) if n.x * side > 0.8 else (0.02, 0.02, 0.02)))
    def fin(points, part):
        bm = new_bm()
        vs = [bm.verts.new(Vector(p)) for p in points]
        bm.faces.new(vs)
        bm2 = new_bm()
        vs2 = [bm2.verts.new(Vector(p)) for p in points[::-1]]
        bm2.faces.new(vs2)
        fc = lambda co, n: spec['fins']
        m.add(part, piece_from_bm(bm, fc))
        m.add(part, piece_from_bm(bm2, fc))
    fin([(0, -0.43, 0), (0, -0.62, D * 0.85), (0, -0.56, 0), (0, -0.62, -D * 0.85)], 'tail')
    fin([(0, 0.05, D * 0.9), (0, -0.05, D * 1.8), (0, -0.25, D * 1.3), (0, -0.28, D * 0.7)], 'body')
    fin([(0, -0.15, -D * 0.8), (0, -0.25, -D * 1.4), (0, -0.32, -D * 0.6)], 'body')
    m.pivots['tail'] = (0, -0.4, 0)
    write_model(m)


def build_hunter():
    m = Model('hunter', ao_dist=0.4, ao_strength=0.7)
    orange = lambda co, n: mix((0.95, 0.36, 0.05), (0.75, 0.22, 0.03), n3(co, 12) * 0.5 + 0.5)
    skin = lambda co, n: (0.78, 0.58, 0.45)
    torso = metaball([((0, 0, 1.25), 0.3, (0.75, 0.55, 1.0)), ((0, 0, 1.0), 0.28, (0.72, 0.52, 0.9)), ((0, 0, 1.45), 0.24, (1.0, 0.55, 0.6))], 0.03, decimate=0.4)
    m.add('torso', piece_from_bm(torso, orange))
    m.add('torso', piece_from_bm(sphere(0.11, 14, 10, at=(0, 0.01, 1.7), scale=(0.9, 1.0, 1.1)), skin))
    cap = sphere(0.12, 14, 8, at=(0, 0, 1.76), scale=(1.0, 1.05, 0.65))
    bmesh.ops.delete(cap, geom=[v for v in cap.verts if v.co.z < 1.74], context='VERTS')
    m.add('torso', piece_from_bm(cap, orange))
    m.add('torso', piece_from_bm(box((0.18, 0.12, 0.015), at=(0, 0.13, 1.75)), orange))
    pants = lambda co, n: mix((0.22, 0.2, 0.16), (0.3, 0.27, 0.2), n3(co, 10) * 0.5 + 0.5)
    for side, name in ((1, 'armL'), (-1, 'armR')):
        arm = tube([(side * 0.24, 0, 1.45), (side * 0.28, 0.02, 1.18), (side * 0.29, 0.06, 0.95)], [0.075, 0.065, 0.055], 8)
        m.add(name, piece_from_bm(arm, orange), pivot=(side * 0.24, 0, 1.45))
        m.add(name, piece_from_bm(sphere(0.05, 8, 6, at=(side * 0.29, 0.07, 0.88)), skin), pivot=(side * 0.24, 0, 1.45))
    for side, name in ((1, 'legL'), (-1, 'legR')):
        leg = tube([(side * 0.1, 0, 0.9), (side * 0.11, 0.02, 0.5), (side * 0.11, 0, 0.12)], [0.09, 0.07, 0.06], 8)
        m.add(name, piece_from_bm(leg, pants), pivot=(side * 0.1, 0, 0.9))
        m.add(name, piece_from_bm(box((0.11, 0.26, 0.12), at=(side * 0.11, 0.05, 0.06)), lambda co, n: (0.2, 0.13, 0.07)), pivot=(side * 0.1, 0, 0.9))
    write_model(m)


def build_utv():
    m = Model('utv', ao_dist=0.8, ao_strength=0.75)
    green = lambda co, n: mix((0.17, 0.3, 0.16), (0.24, 0.4, 0.22), max(0.0, n.z))
    black = lambda co, n: (0.06, 0.06, 0.065)
    seat = lambda co, n: (0.12, 0.11, 0.1)
    for size, at, c in [((1.3, 2.8, 0.18), (0, 0, 0.5), black), ((1.36, 0.95, 0.42), (0, 0.95, 0.78), green), ((1.36, 0.9, 0.12), (0, -0.95, 0.75), green), ((1.36, 0.9, 0.3), (0, -0.95, 0.87), green), ((1.1, 0.5, 0.25), (0, 0.15, 0.72), black), ((0.42, 0.42, 0.12), (0.3, -0.05, 0.83), seat), ((0.42, 0.42, 0.12), (-0.3, -0.05, 0.83), seat), ((0.42, 0.1, 0.5), (0.3, -0.27, 1.08), seat), ((0.42, 0.1, 0.5), (-0.3, -0.27, 1.08), seat), ((1.4, 0.15, 0.2), (0, 1.45, 0.55), black)]:
        m.add('body', piece_from_bm(box(size, at), c, smooth=False))
    bed = box((1.3, 0.85, 0.05), at=(0, -0.95, 1.03))
    m.add('body', piece_from_bm(bed, lambda co, n: (0.1, 0.12, 0.1), smooth=False))
    hood = box((1.3, 0.7, 0.08), at=(0, 1.0, 1.0), rot=Matrix.Rotation(-0.25, 4, 'X'))
    m.add('body', piece_from_bm(hood, green, smooth=False))
    for side in (-1, 1):
        cage = [(side * 0.62, 0.5, 0.95), (side * 0.6, 0.2, 1.75), (side * 0.6, -0.45, 1.8), (side * 0.62, -0.5, 1.0)]
        m.add('body', piece_from_bm(tube(cage, [0.035] * 4, 6, cap=False), black))
        m.add('body', piece_from_bm(sphere(0.07, 8, 6, at=(side * 0.45, 1.36, 0.88), scale=(1, 0.4, 1)), lambda co, n: (1.0, 0.98, 0.85)))
    for y in (0.2, -0.45):
        m.add('body', piece_from_bm(tube([(-0.6, y, 1.77), (0.6, y, 1.77)], [0.035, 0.035], 6, cap=False), black))
    m.add('body', piece_from_bm(tube([(0.3, 0.42, 0.95), (0.3, 0.3, 1.15)], [0.02, 0.02], 5), black))
    m.add('body', piece_from_bm(tube([(0.18, 0.28, 1.17), (0.42, 0.32, 1.13)], [0.12, 0.12], 10, cap=True), black))
    for name, (x, y) in {'wheelFL': (0.62, 1.0), 'wheelFR': (-0.62, 1.0), 'wheelBL': (0.62, -0.95), 'wheelBR': (-0.62, -0.95)}.items():
        tire = cone(0.34, 0.34, 0.28, 18, at=(x - 0.14, y, 0.34), rot=Matrix.Rotation(math.pi / 2, 4, 'Y'))
        def tc(co, n, x0=x, y0=y):
            ang = math.atan2(co.z - 0.34, co.y - y0)
            tread = 0.04 if math.sin(ang * 18) > 0 else 0.07
            rim = math.hypot(co.z - 0.34, co.y - y0) < 0.2 and abs(n.x) > 0.7
            return (0.35, 0.35, 0.33) if rim else (tread, tread, tread)
        m.add(name, piece_from_bm(tire, tc, smooth=False), pivot=(x, y, 0.34))
    write_model(m)


def hull_section(y, L):
    t = (y + L / 2) / L
    bow = smooth01(0.72, 1.0, t)
    half = 0.95 * (1 - bow ** 1.6 * 0.97)
    depth = 0.35 + 0.1 * bow
    keel = -0.0 + 0.32 * bow ** 2
    top = 0.72 + 0.12 * bow
    pts = []
    for k in range(7):
        s = k / 6
        x = half * s
        z = keel + (top - keel) * (s ** 2.4) * 0.3 + depth * 0.0
        if k == 6:
            z = top
        elif k == 5:
            x = half * 0.98
            z = keel + (top - keel) * 0.55
        else:
            z = keel + 0.14 * s * (1 - bow * 0.3) + 0.05 * s * s
        pts.append((x, z))
    return pts


def build_boat():
    m = Model('boat', ao_dist=0.8, ao_strength=0.7)
    L = 5.0
    stations = 18
    sections = []
    for i in range(stations + 1):
        y = -L / 2 + L * i / stations
        sections.append((y, hull_section(y, L)))
    bm = new_bm()
    inner = new_bm()
    grid = []
    igrid = []
    for y, pts in sections:
        row = []
        irow = []
        full = [(-x, z) for x, z in reversed(pts[1:])] + pts
        for x, z in full:
            row.append(bm.verts.new((x, y, z)))
            sgn = 1 if x >= 0 else -1
            ix = x - sgn * min(abs(x), 0.04)
            irow.append(inner.verts.new((ix, y, z + 0.04)))
        grid.append(row)
        igrid.append(irow)
    cols = len(grid[0])
    for i in range(stations):
        for k in range(cols - 1):
            bm.faces.new((grid[i][k], grid[i][k + 1], grid[i + 1][k + 1], grid[i + 1][k]))
            inner.faces.new((igrid[i][k + 1], igrid[i][k], igrid[i + 1][k], igrid[i + 1][k + 1]))
    bm.faces.new(grid[0][::-1])
    def hull_col(co, n):
        if co.z > 0.42:
            return mix((0.18, 0.3, 0.2), (0.24, 0.38, 0.26), max(0.0, n.z))
        return mix((0.55, 0.57, 0.58), (0.72, 0.74, 0.75), n3(co, 3) * 0.5 + 0.5)
    m.add('hull', piece_from_bm(bm, hull_col))
    m.add('hull', piece_from_bm(inner, lambda co, n: (0.42, 0.44, 0.42)))
    for i in range(stations):
        a, b = sections[i], sections[i + 1]
        for side in (-1, 1):
            p1 = (side * a[1][-1][0], a[0], a[1][-1][1])
            p2 = (side * b[1][-1][0], b[0], b[1][-1][1])
            m.add('hull', piece_from_bm(tube([p1, p2], [0.035, 0.035], 6, cap=False), lambda co, n: (0.7, 0.72, 0.72)))
    deck = box((1.6, 4.3, 0.04), at=(0, -0.15, 0.22))
    m.add('hull', piece_from_bm(deck, lambda co, n: (0.2, 0.26, 0.2), smooth=False))
    for y in (-1.6, 0.0, 1.3):
        w = 1.75 if y < 1 else 1.4
        m.add('hull', piece_from_bm(box((w, 0.35, 0.06), at=(0, y, 0.5)), lambda co, n: (0.6, 0.6, 0.58), smooth=False))
    m.add('hull', piece_from_bm(box((0.35, 0.35, 0.25), at=(0, -0.1, 0.67)), lambda co, n: (0.12, 0.12, 0.12), smooth=False))
    motor = new_bm()
    for size, at in [((0.36, 0.5, 0.42), (0, -2.75, 0.95)), ((0.12, 0.16, 0.7), (0, -2.75, 0.45)), ((0.2, 0.3, 0.1), (0, -2.75, 0.08))]:
        b = box(size, at)
        m.add('motor', piece_from_bm(b, lambda co, n: (0.1, 0.1, 0.11) if co.z > 0.7 else (0.25, 0.25, 0.27), smooth=False), pivot=(0, -2.55, 0.8))
    write_model(m)


def build_rod():
    m = Model('rod', ground=False, ao_dist=0.05, ao_strength=0.4)
    m.add('rod', piece_from_bm(tube([(0, -0.25, 0), (0, 0.6, 0), (0, 1.8, 0)], [0.012, 0.008, 0.0025], 6), lambda co, n: (0.15, 0.17, 0.2) if co.y > 0.05 else (0.62, 0.48, 0.32)))
    m.add('rod', piece_from_bm(tube([(0, 0.06, -0.04), (0, 0.06, -0.09)], [0.045, 0.045], 12), lambda co, n: (0.55, 0.56, 0.6)))
    for y in (0.4, 0.75, 1.1, 1.45, 1.75):
        m.add('rod', piece_from_bm(sphere(0.01, 6, 4, at=(0, y, -0.012)), lambda co, n: (0.7, 0.72, 0.74)))
    write_model(m)


def build_rifle():
    m = Model('rifle', ground=False, ao_dist=0.05, ao_strength=0.5)
    wood = lambda co, n: mix((0.32, 0.18, 0.08), (0.45, 0.27, 0.12), n3(co, 20) * 0.5 + 0.5)
    steel = lambda co, n: mix((0.06, 0.06, 0.07), (0.2, 0.2, 0.22), max(0.0, n.z))
    m.add('rifle', piece_from_bm(tube([(0, -0.42, -0.08), (0, -0.2, -0.03), (0, 0.15, 0.0), (0, 0.4, 0.01)], [0.035, 0.03, 0.026, 0.02], 8), wood))
    m.add('rifle', piece_from_bm(tube([(0, -0.05, 0.02), (0, 0.75, 0.03)], [0.012, 0.009], 8), steel))
    m.add('rifle', piece_from_bm(tube([(0, -0.12, 0.08), (0, 0.22, 0.08)], [0.022, 0.022], 10), steel))
    m.add('rifle', piece_from_bm(tube([(0, -0.16, 0.08), (0, -0.12, 0.08)], [0.026, 0.026], 10), steel))
    m.add('rifle', piece_from_bm(tube([(0, 0.22, 0.08), (0, 0.27, 0.08)], [0.03, 0.03], 10), steel))
    write_model(m)


def build_bobber():
    m = Model('bobber', ground=False, ao_dist=0.02, ao_strength=0.2)
    m.add('bobber', piece_from_bm(sphere(0.05, 12, 8), lambda co, n: (0.95, 0.1, 0.08) if co.z > 0 else (0.95, 0.95, 0.92)))
    write_model(m)


exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'builders_detail.py'), encoding='utf8').read(), globals())
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'builders_refine.py'), encoding='utf8').read(), globals())
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'builders_surface.py'), encoding='utf8').read(), globals())
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'builders_hero.py'), encoding='utf8').read(), globals())
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'builders_vehicles.py'), encoding='utf8').read(), globals())
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'builders_boat.py'), encoding='utf8').read(), globals())
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'builders_stand.py'), encoding='utf8').read(), globals())
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'builders_wardrobe.py'), encoding='utf8').read(), globals())
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'builders_cabin.py'), encoding='utf8').read(), globals())
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'builders_quad.py'), encoding='utf8').read(), globals())
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'builders_blind.py'), encoding='utf8').read(), globals())
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'builders_meshy.py'), encoding='utf8').read(), globals())
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'builders_meshy_hunter.py'), encoding='utf8').read(), globals())
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'builders_skinned.py'), encoding='utf8').read(), globals())
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'builders_meshy_animals.py'), encoding='utf8').read(), globals())
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'builders_meshy_vehicles.py'), encoding='utf8').read(), globals())
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'builders_bowfish.py'), encoding='utf8').read(), globals())


def build_pine_lo():
    m = Model('pine-lo', ao_dist=3.0, ao_strength=0.6)
    m.add('trunk', piece_from_bm(cone(0.3, 0.06, 15.0, 4), bark))
    for i, (z, r, h) in enumerate([(2.4, 3.1, 4.6), (6.0, 2.3, 4.2), (9.6, 1.5, 4.8)]):
        m.add('crown', piece_from_bm(cone(r, 0.05, h, 6, at=(0, 0, z)), lambda co, n: mix((0.07, 0.17, 0.09), (0.15, 0.28, 0.13), max(0.0, n.z))))
    write_model(m)


def build_round_lo(name, trunk_h, crown_at, crown_r, birch=False):
    m = Model(name, ao_dist=2.5, ao_strength=0.6)
    tc = (lambda co, n: (0.82, 0.8, 0.75)) if birch else bark
    m.add('trunk', piece_from_bm(cone(0.3 if not birch else 0.18, 0.1, trunk_h, 4), tc))
    for i, (c, r) in enumerate(crown_at):
        bm = ico(r * crown_r, 1, at=c)
        displace_local(bm, c, r * 0.25, 0.9, seed=i)
        m.add('crown', piece_from_bm(bm, lambda co, n: mix((0.62, 0.62, 0.6), (0.95, 0.95, 0.92), max(0.0, n.z) * 0.6 + 0.2)))
    write_model(m)


BUILDERS = {
    'pine-lo': build_pine_cards_lo,
    'hardwood-lo': lambda: build_leafy_lo('hardwood-lo', 'leaves', 8.0, 0.32, [((0, 0, 8.6), 2.6), ((1.8, 0.5, 7.4), 2.0), ((-1.6, -0.7, 7.8), 2.0), ((0.4, -1.8, 8.2), 1.8)], 46, 2.4, (0, 0, 7.0)),
    'birch-lo': lambda: build_leafy_lo('birch-lo', 'birchleaves', 9.5, 0.17, [((0.3, 0.1, 9.0), 1.6), ((1.1, 0.3, 7.6), 1.3), ((0.2, 0.0, 7.2), 1.3)], 34, 1.9, (0.5, 0.2, 7.5)),
    'pine': build_pine, 'hardwood': build_hardwood, 'birch': build_birch, 'grass': build_grass, 'fern': build_fern,
    'cattail': build_cattail, 'rock': build_rock, 'log': build_log, 'deer': build_deer, 'antlers': build_antlers,
    'bear': build_bear, 'hunter': build_hunter, 'utv': build_utv, 'boat': build_boat, 'rod': build_rod,
    'rifle': build_rifle, 'bobber': build_bobber, 'treestand': build_treestand, 'cabin': build_cabin, 'outfitters': lambda: build_cabin('outfitters', OUTFITTERS_W, OUTFITTERS_D, True, OUTFITTERS_WINDOWS), 'quad': build_quad, 'boxblind': build_boxblind,
    'bowboat': build_bowboat, 'wildman': build_wildman, 'bow': build_bow,
}
for kind, spec in FISH.items():
    BUILDERS['fish-' + kind] = (lambda k, s: (lambda: build_fish(k, s)))(kind, spec)

for name, fn in BUILDERS.items():
    if ONLY and name not in ONLY:
        continue
    fn()
