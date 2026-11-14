"""
Blender build of Tello's detailed downtown and quarry pieces (run with `blender -b -P` or as `python3` with the `bpy`
module, then `pnpm assets`):

  assets-src/models/tello/downtown-kit.glb  storefront details the page lays onto every front: a bracketed cornice
                                            with modillions, scroll brackets, arched and flat window hoods, double-hung
                                            window frames, stone sills, cast-iron pilasters, a panelled shop door and a
                                            bell-cast turret roof with its finial.
  assets-src/models/tello/quarry.glb        the falls across from the light (granite cliff in blocky tiers, three
                                            cascades down chutes, foam, the pool, its cut-stone wall and the wishing
                                            well), three quarry-wall faces and a small falls for the granite park.

Every object is a root node named for the part. Material names are slots the page paints: trim, wall, stone, door,
shingle, metal, granite, wetrock, wallstone, water, foam, pool, wood. Blender's front view looks along +Y, so parts face
-Y (the glTF +Z the page's fronts face). Units are metres. Deterministic: random streams are seeded.
"""
import math
import os
import random

import bpy  # noqa: I001  (first: the bpy module puts bmesh and mathutils on the path)
import bmesh
from mathutils import Matrix, Vector, noise

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, '..', '..', '..', 'assets-src', 'models', 'tello'))

SLOT_COLORS = {
    'trim': (0.9, 0.88, 0.82), 'wall': (0.8, 0.7, 0.55), 'stone': (0.78, 0.74, 0.66), 'door': (0.23, 0.18, 0.14),
    'shingle': (0.4, 0.38, 0.36), 'metal': (0.1, 0.1, 0.11), 'granite': (0.62, 0.42, 0.36), 'wetrock': (0.38, 0.24, 0.2),
    'wallstone': (0.48, 0.41, 0.34), 'water': (0.9, 0.95, 0.97), 'foam': (1, 1, 1), 'pool': (0.08, 0.13, 0.12),
    'wood': (0.42, 0.29, 0.19),
}


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for slot, c in SLOT_COLORS.items():
        m = bpy.data.materials.new(slot)
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get('Principled BSDF')
        if bsdf:
            bsdf.inputs['Base Color'].default_value = (*c, 1)
            bsdf.inputs['Roughness'].default_value = 0.9


def mat_index(me, slot):
    for i, m in enumerate(me.materials):
        if m.name == slot:
            return i
    me.materials.append(bpy.data.materials[slot])
    return len(me.materials) - 1


class Part:
    """One part: a bmesh with faces tagged by slot, finished into a root-level object."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.slots = []
        self.colors = {}
        self.vcolors = {}

    def slot(self, s):
        if s not in self.slots:
            self.slots.append(s)
        return self.slots.index(s)

    def face(self, pts, slot, color=None):
        vs = [self.bm.verts.new(p) for p in pts]
        try:
            f = self.bm.faces.new(vs)
        except ValueError:
            return None
        f.material_index = self.slot(slot)
        if color is not None:
            self.colors[f] = color
        return f

    def box(self, x0, y0, z0, x1, y1, z1, slot, color=None, matrix=None):
        c = [Vector((x, y, z)) for z in (z0, z1) for y in (y0, y1) for x in (x0, x1)]
        if matrix is not None:
            c = [matrix @ v for v in c]
        q = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
        for a, b, cc, d in q:
            self.face([c[a], c[b], c[cc], c[d]], slot, color)

    def extrude_profile(self, prof, x0, x1, slot, color=None):
        """A closed side profile [(out, up), ...] (out is toward the street, -Y) swept along X from x0 to x1."""
        n = len(prof)
        a = [Vector((x0, -d, z)) for d, z in prof]
        b = [Vector((x1, -d, z)) for d, z in prof]
        for i in range(n):
            j = (i + 1) % n
            self.face([a[i], a[j], b[j], b[i]], slot, color)
        self.face(list(reversed(a)), slot, color)
        self.face(b, slot, color)

    def merge(self, other_bm, slot, color=None, matrix=None):
        m = matrix if matrix is not None else Matrix.Identity(4)
        vmap = {}
        per_vertex = getattr(color, 'per_vertex', None)
        for v in other_bm.verts:
            vmap[v] = self.bm.verts.new(m @ v.co)
            if per_vertex:
                self.vcolors[vmap[v]] = per_vertex(v)
        for f in other_bm.faces:
            try:
                nf = self.bm.faces.new([vmap[v] for v in f.verts])
            except ValueError:
                continue
            nf.material_index = self.slot(slot)
            if callable(color):
                self.colors[nf] = color(f)
            elif color is not None:
                self.colors[nf] = color

    def finish(self, bevel=0.0, smooth_angle=35, uv_scale=1.0, collection=None, recalc=True):
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=0.0005)
        if recalc:
            bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        uv = self.bm.loops.layers.uv.new('UVMap')
        col = self.bm.loops.layers.color.new('Col')
        for f in self.bm.faces:
            n = f.normal
            ax = max(range(3), key=lambda k: abs(n[k]))
            c = self.colors.get(f, (1.0, 1.0, 1.0))
            for lp in f.loops:
                p = lp.vert.co
                u, v = (p.y, p.z) if ax == 0 else (p.x, p.z) if ax == 1 else (p.x, p.y)
                lp[uv].uv = (u * uv_scale, v * uv_scale)
                lp[col] = (*self.vcolors.get(lp.vert, c), 1.0)
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me)
        self.bm.free()
        for s in self.slots:
            me.materials.append(bpy.data.materials[s])
        # One colour attribute, ours, exported as COLOR_0.
        for a in [a for a in me.color_attributes if a.name != 'Col']:
            me.color_attributes.remove(a)
        if 'Col' in me.color_attributes:
            me.color_attributes.active_color = me.color_attributes['Col']
            me.color_attributes.render_color_index = me.color_attributes.find('Col')
        o = bpy.data.objects.new(self.name, me)
        (collection or bpy.context.scene.collection).objects.link(o)
        if bevel > 0:
            mod = o.modifiers.new('bevel', 'BEVEL')
            mod.width = bevel
            mod.segments = 2
            mod.limit_method = 'ANGLE'
            mod.angle_limit = math.radians(30)
            mod.harden_normals = True
            bpy.context.view_layer.objects.active = o
            o.select_set(True)
            bpy.ops.object.modifier_apply(modifier='bevel')
            o.select_set(False)
        for p in me.polygons:
            p.use_smooth = True
        try:
            me.set_sharp_from_angle(angle=math.radians(smooth_angle))
        except Exception:
            pass
        return o


def arc(cx, cz, r, a0, a1, n):
    return [(cx + math.cos(a0 + (a1 - a0) * i / n) * r, cz + math.sin(a0 + (a1 - a0) * i / n) * r) for i in range(n + 1)]


# ---------------------------------------------------------------- downtown kit

def cornice():
    p = Part('cornice')
    prof = [(0, 0), (0.07, 0), (0.07, 0.05), (0.1, 0.05)]
    prof += [(0.1 + 0.1 * (1 - math.cos(t * math.pi / 2)), 0.05 + 0.11 * math.sin(t * math.pi / 2)) for t in [i / 6 for i in range(1, 7)]]
    prof += [(0.46, 0.16), (0.46, 0.18), (0.48, 0.18), (0.48, 0.34)]
    for i in range(1, 9):
        t = i / 8
        prof.append((0.48 + 0.1 * t, 0.34 + 0.14 * (t - math.sin(2 * math.pi * t) / (2 * math.pi))))
    prof += [(0.58, 0.52), (0, 0.52)]
    p.extrude_profile(prof, 0, 1, 'trim')
    for i in range(4):
        x = 0.125 + i * 0.25
        p.box(x - 0.035, -0.45, 0.11, x + 0.035, -0.19, 0.16, 'trim')
        p.box(x - 0.045, -0.46, 0.13, x + 0.045, -0.44, 0.16, 'trim')
    for i in range(10):
        x = 0.05 + i * 0.1
        p.box(x - 0.02, -0.105, 0.0, x + 0.02, -0.07, 0.045, 'trim')
    return p.finish(bevel=0.004)


def bracket():
    p = Part('bracket')
    outline = [(0.0, 0.0), (0.0, -0.62), (0.05, -0.62)]
    for i in range(1, 15):
        t = i / 14
        d = 0.07 + 0.36 * (t ** 1.6)
        z = -0.6 + 0.58 * t + 0.035 * math.sin(math.pi * t * 2.2) * (1 - t)
        outline.append((d, z))
    outline.append((0.45, 0.0))
    t2 = 0.055
    a = [Vector((-t2, -d, z)) for d, z in outline]
    b = [Vector((t2, -d, z)) for d, z in outline]
    n = len(outline)
    for i in range(n):
        j = (i + 1) % n
        p.face([a[i], a[j], b[j], b[i]], 'trim')
    p.face(list(reversed(b)), 'trim')
    p.face(a, 'trim')
    for (d, z, r) in [(0.36, -0.1, 0.075), (0.12, -0.52, 0.055)]:
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=14, radius1=r, radius2=r, depth=0.15)
        p.merge(bm, 'trim', matrix=Matrix.Translation((0, -d, z)) @ Matrix.Rotation(math.pi / 2, 4, 'Y'))
        bm.free()
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=0.035, radius2=0.0, depth=0.12)
    p.merge(bm, 'trim', matrix=Matrix.Translation((0, -0.06, -0.68)) @ Matrix.Rotation(math.pi, 4, 'X'))
    bm.free()
    p.box(-0.075, -0.47, -0.04, 0.075, 0.0, 0.0, 'trim')
    return p.finish(bevel=0.005)


def hood_arch():
    """A semicircular hood for a unit-wide window (radius 0.5, spring line at z 0), with keystone and label stops."""
    p = Part('hood-arch')
    seg = 18
    r0, r1 = 0.5, 0.66
    for i in range(seg):
        a0 = math.pi * i / seg
        a1 = math.pi * (i + 1) / seg
        q = lambda a, r, d: Vector((math.cos(a) * r, -d, math.sin(a) * r))
        p.face([q(a1, r0, 0.09), q(a0, r0, 0.09), q(a0, r1, 0.09), q(a1, r1, 0.09)], 'trim')
        p.face([q(a0, r1, 0.0), q(a1, r1, 0.0), q(a1, r1, 0.09), q(a0, r1, 0.09)], 'trim')
        p.face([q(a1, r0, 0.0), q(a0, r0, 0.0), q(a0, r0, 0.09), q(a1, r0, 0.09)], 'trim')
        p.face([q(a1, r1, 0.09), q(a0, r1, 0.09), q(a0, r1 + 0.04, 0.12), q(a1, r1 + 0.04, 0.12)], 'trim')
        p.face([q(a0, r1 + 0.04, 0.12), q(a0, r1 + 0.04, 0.0), q(a1, r1 + 0.04, 0.0), q(a1, r1 + 0.04, 0.12)], 'trim')
    p.face([Vector((-0.17, -0.13, 0.46)), Vector((0.17, -0.13, 0.46)), Vector((0.11, -0.13, 0.78)), Vector((-0.11, -0.13, 0.78))], 'trim')
    p.box(-0.11, -0.13, 0.46, 0.11, 0.0, 0.47, 'trim')
    kz = [(-0.085, 0.46), (0.085, 0.46), (0.11, 0.78), (-0.11, 0.78)]
    p.face([Vector((x, 0.0, z)) for x, z in reversed(kz)], 'trim')
    for i in range(4):
        x0, z0 = kz[i]
        x1, z1 = kz[(i + 1) % 4]
        p.face([Vector((x0, 0.0, z0)), Vector((x1, 0.0, z1)), Vector((x1, -0.13, z1)), Vector((x0, -0.13, z0))], 'trim')
    for s in (-1, 1):
        p.box(s * 0.58 - 0.07, -0.14, -0.12, s * 0.58 + 0.07, 0.0, 0.02, 'trim')
    return p.finish(bevel=0.004)


def hood_flat():
    p = Part('hood-flat')
    p.box(-0.58, -0.07, 0.0, 0.58, 0.0, 0.2, 'trim')
    prof = [(0.0, 0.2), (0.09, 0.2), (0.09, 0.23), (0.13, 0.26), (0.16, 0.26), (0.16, 0.33), (0.0, 0.33)]
    p.extrude_profile(prof, -0.66, 0.66, 'trim')
    for s in (-1, 1):
        p.box(s * 0.6 - 0.05, -0.12, -0.12, s * 0.6 + 0.05, 0.0, 0.2, 'trim')
        p.box(s * 0.6 - 0.04, -0.1, -0.2, s * 0.6 + 0.04, 0.0, -0.12, 'trim')
    p.box(-0.12, -0.075, 0.04, 0.12, -0.07, 0.16, 'trim')
    return p.finish(bevel=0.004)


def window():
    """Double-hung frame for a 1 x 1.6 opening (bottom centre at the origin): casing, sashes, meeting rail, muntins."""
    p = Part('window')
    W, H = 1.0, 1.6
    c = 0.08
    p.box(-W / 2 - c, -0.06, 0, -W / 2, 0, H, 'trim')
    p.box(W / 2, -0.06, 0, W / 2 + c, 0, H, 'trim')
    p.box(-W / 2 - c - 0.02, -0.07, H, W / 2 + c + 0.02, 0, H + c + 0.02, 'trim')
    p.box(-W / 2 - c, -0.075, H + c + 0.02, W / 2 + c, 0, H + c + 0.05, 'trim')
    s = 0.045
    for (z0, z1, dy) in [(0.0, H / 2 + 0.02, -0.03), (H / 2 - 0.02, H, -0.015)]:
        p.box(-W / 2, dy - 0.02, z0, -W / 2 + s, dy, z1, 'trim')
        p.box(W / 2 - s, dy - 0.02, z0, W / 2, dy, z1, 'trim')
        p.box(-W / 2, dy - 0.02, z1 - s, W / 2, dy, z1, 'trim')
        p.box(-W / 2, dy - 0.02, z0, W / 2, dy, z0 + (0.07 if z0 == 0 else s), 'trim')
        p.box(-0.013, dy - 0.018, z0, 0.013, dy, z1, 'trim')
    return p.finish(bevel=0.003)


def sill():
    p = Part('sill')
    prof = [(0.0, 0.0), (0.12, 0.0), (0.12, 0.012), (0.14, 0.02), (0.14, 0.07), (0.0, 0.09)]
    p.extrude_profile(prof, -0.65, 0.65, 'stone')
    for s in (-1, 1):
        p.box(s * 0.62 - 0.05, -0.09, -0.08, s * 0.62 + 0.05, 0.0, 0.0, 'stone')
    return p.finish(bevel=0.004)


def pilaster():
    shaft = Part('pilaster-shaft')
    shaft.box(-0.17, -0.06, 0, 0.17, 0, 1, 'trim')
    for x in (-0.1, 0.0, 0.1):
        shaft.box(x - 0.022, -0.1, 0.0, x + 0.022, -0.06, 1.0, 'trim')
    for x in (-0.15, 0.15):
        shaft.box(x - 0.02, -0.1, 0.0, x + 0.02, -0.06, 1.0, 'trim')
    shaft.finish(bevel=0.003)
    cap = Part('pilaster-cap')
    cap.box(-0.18, -0.11, 0.0, 0.18, 0, 0.05, 'trim')
    prof = [(0.0, 0.05), (0.11, 0.05), (0.15, 0.12), (0.19, 0.16), (0.19, 0.24), (0.0, 0.24)]
    cap.extrude_profile(prof, -0.23, 0.23, 'trim')
    cap.finish(bevel=0.003)
    base = Part('pilaster-base')
    base.box(-0.22, -0.16, 0.0, 0.22, 0, 0.16, 'trim')
    prof = [(0.0, 0.16), (0.15, 0.16), (0.15, 0.19), (0.12, 0.24), (0.11, 0.3), (0.0, 0.3)]
    base.extrude_profile(prof, -0.2, 0.2, 'trim')
    base.finish(bevel=0.003)


def door():
    """A panelled shop door 0.98 x 2.25 (bottom centre at the origin); the glass above the lock rail is the page's."""
    p = Part('door')
    W, H = 0.98, 2.25
    p.box(-W / 2, -0.05, 0, -W / 2 + 0.12, 0, H, 'door')
    p.box(W / 2 - 0.12, -0.05, 0, W / 2, 0, H, 'door')
    p.box(-W / 2, -0.05, H - 0.14, W / 2, 0, H, 'door')
    p.box(-W / 2, -0.05, 0.92, W / 2, 0, 1.06, 'door')
    p.box(-W / 2, -0.05, 0, W / 2, 0, 0.18, 'metal')
    p.box(-W / 2 + 0.12, -0.03, 0.18, W / 2 - 0.12, 0, 0.92, 'door')
    p.box(-W / 2 + 0.2, -0.05, 0.28, W / 2 - 0.2, -0.03, 0.82, 'door')
    p.box(W / 2 - 0.2, -0.09, 1.0, W / 2 - 0.15, -0.05, 1.04, 'metal')
    p.box(W / 2 - 0.19, -0.11, 0.97, W / 2 - 0.16, -0.05, 1.15, 'metal')
    return p.finish(bevel=0.003)


def turret_roof():
    """Bell-cast octagonal roof, radius 1 at the eave and 1 tall (the page scales it), eave band and finial."""
    p = Part('turret-roof')
    rings = [(1.1, 0.0), (1.02, 0.05), (0.86, 0.18), (0.64, 0.38), (0.4, 0.62), (0.18, 0.86), (0.03, 1.0)]
    seg = 8
    pts = [[Vector((math.cos((k + 0.5) / seg * 2 * math.pi) * r, math.sin((k + 0.5) / seg * 2 * math.pi) * r, z)) for k in range(seg)] for r, z in rings]
    for i in range(len(rings) - 1):
        for k in range(seg):
            j = (k + 1) % seg
            p.face([pts[i][k], pts[i][j], pts[i + 1][j], pts[i + 1][k]], 'shingle')
    p.face(list(reversed(pts[0])), 'shingle')
    band = [[Vector((math.cos((k + 0.5) / seg * 2 * math.pi) * r, math.sin((k + 0.5) / seg * 2 * math.pi) * r, z)) for k in range(seg)] for r, z in [(1.12, -0.12), (1.12, 0.0)]]
    for k in range(seg):
        j = (k + 1) % seg
        p.face([band[0][k], band[0][j], band[1][j], band[1][k]], 'trim')
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=0.07)
    p.merge(bm, 'metal', matrix=Matrix.Translation((0, 0, 1.06)))
    bm.free()
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=0.025, radius2=0.004, depth=0.5)
    p.merge(bm, 'metal', matrix=Matrix.Translation((0, 0, 1.36)))
    bm.free()
    return p.finish(bevel=0.0, smooth_angle=50, uv_scale=2.0)


def build_kit():
    reset()
    cornice()
    bracket()
    hood_arch()
    hood_flat()
    window()
    sill()
    pilaster()
    door()
    turret_roof()
    export(os.path.join(OUT, 'downtown-kit.glb'))


# ---------------------------------------------------------------- the quarry

def boulder(rng, cx, cy, cz, sx, sy, sz, seed, blocky=0.65):
    """A blocky granite boulder: a subdivided cube pulled toward a sphere and roughened with cell noise."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=2.0)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=4, use_grid_fill=True)
    off = Vector((seed * 13.1, seed * 7.7, seed * 3.3))
    for v in bm.verts:
        d = v.co.normalized()
        v.co = v.co.lerp(d * 1.25, 1 - blocky)
        n = noise.noise(v.co * 0.9 + off) * 0.16 + noise.noise(v.co * 2.7 + off) * 0.06
        cell = noise.cell(v.co * 1.3 + off) * 0.12
        v.co += d * (n - cell)
    m = Matrix.Translation((cx, cy, cz)) @ Matrix.Rotation(rng.uniform(-0.25, 0.25), 4, 'Z') @ Matrix.Rotation(rng.uniform(-0.12, 0.12), 4, 'X') @ Matrix.Diagonal((sx, sy, sz, 1))
    return bm, m


def smoothstep(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def granite_mass(center, half, seed, cuts=14, facet=0.22, crease=0.07, stretch=(1.0, 1.0, 1.0), base=(0.64, 0.43, 0.36), flat_top=0.6):
    """One solid piece of granite: a rounded block whose surface breaks into large flat facets (each Voronoi cell pushed
    in or out), with sharp creases along the cell edges and fine rough grain; creases are shaded darker."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=2.0)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=cuts, use_grid_fill=True)
    for v in bm.verts:
        p = v.co.copy()
        p = p.lerp(p.normalized() * 1.25, 0.16)
        v.co = Vector((p.x * half[0], p.y * half[1], p.z * half[2]))
    bm.normal_update()
    off = Vector((seed * 17.3, seed * 5.1, seed * 11.9))
    shade = {}
    for v in bm.verts:
        w = v.co + Vector(center)
        q = Vector((w.x * 0.42 / stretch[0], w.y * 0.42 / stretch[1], w.z * 0.42 / stretch[2])) + off
        dist, pts = noise.voronoi(q, distance_metric='DISTANCE', exponent=2.5)
        cell = noise.cell(Vector(pts[0]))
        edge = 1 - smoothstep(0.0, 0.16, dist[1] - dist[0])
        top = flat_top if v.normal.z > 0.75 else 1.0
        d = ((cell - 0.5) * 2 * facet - crease * edge) * top + noise.fractal(w * 1.9 + off, 0.55, 2.1, 3) * 0.035
        v.co += v.normal * d
        shade[v] = 1 - 0.42 * edge
    bm.normal_update()

    def color(f):
        k = sum(shade[v] for v in f.verts) / len(f.verts)
        return (base[0] * k, base[1] * k, base[2] * k)

    def per_vertex(v):
        k = shade[v]
        tint = 0.88 + 0.24 * (noise.noise(v.co * 0.5 + off) * 0.5 + 0.5)
        return (base[0] * k * tint, base[1] * k * tint, base[2] * k * tint * 0.97)

    color.per_vertex = per_vertex
    return bm, Matrix.Translation(center), color


GRANITE = [(0.66, 0.44, 0.37), (0.58, 0.37, 0.31), (0.72, 0.52, 0.44), (0.5, 0.32, 0.27), (0.63, 0.43, 0.36)]
WET = [(0.42, 0.26, 0.22), (0.36, 0.23, 0.2), (0.46, 0.3, 0.25)]
# x0, x1 (east of the pool's centre), north of the front, height above the water at the top of each step.
CASCADES = [
    (-6.2, -2.1, [(9.4, 5.4), (8.5, 5.0), (7.4, 3.2), (6.2, 2.8), (5.0, 1.1), (3.9, 0)]),
    (-1.7, 3.6, [(10.3, 6.6), (9.2, 6.2), (8.0, 4.1), (6.7, 3.7), (5.4, 1.6), (4.1, 0)]),
    (4.0, 6.6, [(9.1, 4.8), (8.2, 4.4), (7.0, 2.3), (5.8, 1.9), (4.6, 0)]),
]


def falls(col):
    rng = random.Random(7)
    rock = Part('falls-rock')
    # A few big solid masses of granite either side of and behind the three chutes.
    masses = [
        ((-9.6, 6.6, 2.3), (3.4, 3.2, 3.1)), ((9.9, 6.0, 2.1), (3.3, 3.0, 2.9)), ((0.4, 11.4, 4.4), (8.8, 2.8, 3.4)),
        ((-1.9, 7.4, 3.0), (0.75, 3.2, 3.7)), ((3.8, 7.0, 2.6), (0.7, 3.0, 3.3)), ((-7.4, 5.6, 1.5), (1.6, 2.0, 2.2)),
        ((7.7, 5.2, 1.4), (1.5, 1.9, 2.0)), ((-10.7, 2.3, 0.2), (1.5, 1.3, 1.1)), ((10.5, 2.8, 0.2), (1.6, 1.4, 1.2)),
        ((-4.6, 12.4, 6.6), (3.2, 2.2, 1.6)), ((5.6, 12.0, 6.2), (3.0, 2.2, 1.5)),
    ]
    for k, (c, h) in enumerate(masses):
        bm, m, color = granite_mass(c, h, k + 3, cuts=14 if max(h) > 2 else 10, base=GRANITE[k % len(GRANITE)])
        rock.merge(bm, 'granite', color, m)
        bm.free()
    # Behind each cascade, a wet granite staircase the water runs down.
    wet = Part('falls-wetrock')
    for ci, (x0, x1, steps) in enumerate(CASCADES):
        prof = [(steps[0][0] + 2.2, -0.6), (steps[0][0] + 2.2, steps[0][1] + 0.1)]
        for y, z in steps[:-1]:
            prof += [(y + 0.1, z + 0.06), (y - 0.2, z - 0.05)]
        prof += [(steps[-1][0] + 0.1, steps[-1][1] + 0.06), (steps[-1][0] + 0.1, -0.6)]
        bm = bmesh.new()
        ring_a = [bm.verts.new((x0 - 0.45, y, z)) for y, z in prof]
        ring_b = [bm.verts.new((x1 + 0.45, y, z)) for y, z in prof]
        nprof = len(prof)
        for i in range(nprof):
            j = (i + 1) % nprof
            bm.faces.new([ring_a[i], ring_b[i], ring_b[j], ring_a[j]])
        bm.faces.new(list(reversed(ring_a)))
        bm.faces.new(ring_b)
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
        bmesh.ops.subdivide_edges(bm, edges=[e for e in bm.edges if e.calc_length() > 0.6], cuts=3, use_grid_fill=False)
        bm.normal_update()
        off = Vector((ci * 9.1, 3.3, 1.7))
        for v in bm.verts:
            d = noise.fractal(v.co * 1.3 + off, 0.6, 2.0, 3) * 0.06 - (1 - smoothstep(0, 0.14, abs(noise.voronoi(v.co * 0.6 + off)[0][1] - noise.voronoi(v.co * 0.6 + off)[0][0]))) * 0.04
            v.co += v.normal * d
        wet.merge(bm, 'wetrock', WET[ci % len(WET)])
        bm.free()
    rock.finish(smooth_angle=42, uv_scale=0.5, collection=col)
    wet.finish(smooth_angle=42, uv_scale=0.5, collection=col)

    water = Part('falls-water')
    for ci, (x0, x1, steps) in enumerate(CASCADES):
        cols = 8
        v = 0.0
        prev = None
        # Each step: a lip that curls over, then the sheet falling to the next.
        prof = []
        for i in range(len(steps) - 1):
            (ya, za), (yb, zb) = steps[i], steps[i + 1]
            prof += [(ya, za), (ya - 0.25, za - 0.08), (ya - 0.42, za - 0.35), (yb + 0.05, zb + 0.15)]
        prof.append(steps[-1])
        for i, (y, z) in enumerate(prof):
            if i:
                v += math.hypot(y - prof[i - 1][0], z - prof[i - 1][1]) / 3.0
            row = []
            spread = 0.25 * (1 - z / max(1e-3, prof[0][1]))
            for k in range(cols + 1):
                t = k / cols
                x = x0 - spread + (x1 - x0 + 2 * spread) * t
                wob = noise.noise(Vector((x * 0.7, y * 0.9 + ci, z * 0.8))) * 0.08
                row.append((Vector((x, y - 0.3, z + wob)), (t, v)))
            if prev:
                for k in range(cols):
                    water.face([prev[k + 1][0], prev[k][0], row[k][0], row[k + 1][0]], 'water')
            prev = row
    wo = water.finish(smooth_angle=80, collection=col, recalc=False)
    flow_uvs(wo)

    foam = Part('falls-foam')
    for x0, x1, steps in CASCADES:
        y = steps[-1][0]
        ring = []
        for k in range(16):
            a = k / 16 * 2 * math.pi
            rx = (x1 - x0) / 2 + 0.9 + rng.uniform(-0.2, 0.3)
            ry = 1.1 + rng.uniform(-0.2, 0.3)
            ring.append(Vector(((x0 + x1) / 2 + math.cos(a) * rx, (y - 0.9) + math.sin(a) * ry, 0.03)))
        foam.face(ring, 'foam')
    foam.finish(smooth_angle=80, uv_scale=0.3, collection=col, recalc=False)

    pool = Part('falls-pool')
    pool.face([Vector((-9.6, 0.3, 0.0)), Vector((9.6, 0.3, 0.0)), Vector((9.6, 8.5, 0.0)), Vector((-9.6, 8.5, 0.0))], 'pool')
    pool.finish(collection=col, recalc=False)

    wall = Part('falls-wall')
    tone = lambda: tuple(c * rng.uniform(0.82, 1.12) for c in (0.5, 0.43, 0.36))
    for side_run in [('front', -10.1, 10.1)]:
        _, a, b = side_run
        for row in range(4):
            z0 = -1.2 + row * 0.42
            x = a - (0.3 if row % 2 else 0)
            while x < b:
                L = rng.uniform(0.45, 0.85)
                x1 = min(b, x + L)
                if x1 - max(a, x) > 0.1:
                    wall.box(max(a, x) + 0.012, 0.0, z0 + 0.012, x1 - 0.012, 0.5, z0 + 0.4, 'wallstone', tone())
                x = x1
        x = a
        while x < b:
            x1 = min(b, x + rng.uniform(0.7, 1.1))
            wall.box(x + 0.01, -0.06, 0.48, x1 - 0.01, 0.56, 0.58, 'wallstone', tone())
            x = x1
    for sx in (-10.35, 10.35):
        for row in range(4):
            z0 = -1.2 + row * 0.42
            y = 0.0
            while y < 5.0:
                y1 = min(5.0, y + rng.uniform(0.5, 0.9))
                wall.box(sx - 0.25, y + 0.012, z0 + 0.012, sx + 0.25, y1 - 0.012, z0 + 0.4, 'wallstone', tone())
                y = y1
    wall.finish(bevel=0.02, uv_scale=1.0, collection=col)

    well = Part('falls-well')
    for k in range(12):
        a0, a1 = k / 12 * 2 * math.pi, (k + 1) / 12 * 2 * math.pi
        am = (a0 + a1) / 2
        m = Matrix.Translation((-13 + math.cos(am) * 0.66, 1.3 + math.sin(am) * 0.66, 0.0)) @ Matrix.Rotation(am, 4, 'Z')
        for row in range(3):
            well.box(-0.16, -0.18, row * 0.28, 0.16, 0.18, row * 0.28 + 0.26, 'wallstone', tone(), m @ Matrix.Rotation(math.pi / 2 * (row % 2) * 0.1, 4, 'Z'))
    for s in (-1, 1):
        well.box(-13 + s * 0.7 - 0.06, 1.24, 0.5, -13 + s * 0.7 + 0.06, 1.36, 2.05, 'wood')
    well.box(-13.78, 1.26, 1.5, -12.22, 1.34, 1.58, 'wood')
    well.box(-12.22, 1.28, 1.47, -12.0, 1.32, 1.51, 'wood')
    ridge, eave = 2.55, 1.85
    for s in (-1, 1):
        well.face([Vector((-13.95, 1.3 + s * 0.85, eave)), Vector((-12.05, 1.3 + s * 0.85, eave)), Vector((-12.05, 1.3, ridge)), Vector((-13.95, 1.3, ridge))][::s], 'shingle')
    for s in (-1, 1):
        well.face([Vector((-13 + s * 0.9, 1.3 - 0.8, eave)), Vector((-13 + s * 0.9, 1.3 + 0.8, eave)), Vector((-13 + s * 0.9, 1.3, ridge - 0.04))][::s], 'wood')
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=0.16, radius2=0.19, depth=0.26)
    well.merge(bm, 'wood', matrix=Matrix.Translation((-13, 1.3, 1.05)))
    bm.free()
    well.finish(bevel=0.01, uv_scale=1.5, collection=col)


def flow_uvs(o):
    """Cascade UVs: u across, v down the water in metres / 3 (recomputed from the sheet's own rows)."""
    me = o.data
    uv = me.uv_layers.active.data
    for poly in me.polygons:
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            uv[li].uv = (co.x * 0.35, -(co.z * 0.4 - co.y * 0.25))


def quarry_wall(col, name, width, height, seed):
    """A quarry face: one solid mass of red granite cut by tall cleavage facets and creases, with fallen blocks at its foot."""
    rng = random.Random(seed)
    p = Part(name)
    bm, m, color = granite_mass((0, 1.6, height / 2), (width / 2, 1.6, height / 2), seed, cuts=18, facet=0.3, crease=0.09, stretch=(0.8, 1.0, 2.2), base=GRANITE[seed % len(GRANITE)], flat_top=0.4)
    p.merge(bm, 'granite', color, m)
    bm.free()
    for k in range(3):
        x = rng.uniform(-width / 2 + 1, width / 2 - 1)
        s = rng.uniform(0.6, 1.1)
        bm, m, color = granite_mass((x, -rng.uniform(0.3, 1.2), s * 0.6), (s * 1.3, s, s * 0.8), seed * 7 + k, cuts=8, facet=0.15, base=GRANITE[(seed + k) % len(GRANITE)])
        p.merge(bm, 'granite', color, m)
        bm.free()
    return p.finish(smooth_angle=42, uv_scale=0.5, collection=col)


def small_falls(col):
    rng = random.Random(23)
    rock = Part('small-falls-rock')
    steps = [(3.2, 3.6), (2.4, 3.3), (1.7, 1.9), (1.0, 1.6), (0.3, 0.0)]
    for k, (c, h) in enumerate([((-2.3, 1.9, 1.6), (1.5, 1.9, 2.2)), ((2.4, 1.8, 1.5), (1.6, 1.8, 2.1)), ((0.1, 3.9, 2.6), (2.6, 1.0, 1.4))]):
        bm, m, color = granite_mass(c, h, 40 + k, cuts=10, base=GRANITE[k])
        rock.merge(bm, 'granite', color, m)
        bm.free()
    for i, (y, z) in enumerate(steps[:-1]):
        bm, m, color = granite_mass((0, y + 0.7, z / 2 - 0.1), (1.05, 0.7, z / 2 + 0.25), 60 + i, cuts=6, facet=0.08, crease=0.03, base=WET[i % len(WET)])
        rock.merge(bm, 'wetrock', color, m)
        bm.free()
    rock.finish(smooth_angle=42, uv_scale=0.5, collection=col)
    water = Part('small-falls-water')
    prof = []
    for i in range(len(steps) - 1):
        (ya, za), (yb, zb) = steps[i], steps[i + 1]
        prof += [(ya, za), (ya - 0.2, za - 0.08), (ya - 0.35, za - 0.3), (yb + 0.05, zb + 0.12)]
    prof.append(steps[-1])
    prev = None
    for y, z in prof:
        row = [Vector((-0.9 + 1.8 * k / 6, y - 0.25, z)) for k in range(7)]
        if prev:
            for k in range(6):
                water.face([prev[k + 1], prev[k], row[k], row[k + 1]], 'water')
        prev = row
    flow_uvs(water.finish(smooth_angle=80, collection=col, recalc=False))
    foam = Part('small-falls-foam')
    foam.face([Vector((math.cos(a) * 1.4, -0.4 + math.sin(a) * 0.8, 0.03)) for a in [k / 12 * 2 * math.pi for k in range(12)]], 'foam')
    foam.finish(smooth_angle=80, uv_scale=0.3, collection=col, recalc=False)


def build_quarry():
    reset()
    col = bpy.context.scene.collection
    falls(col)
    quarry_wall(col, 'quarry-wall-a', 10, 6.5, 3)
    quarry_wall(col, 'quarry-wall-b', 12, 8.5, 5)
    quarry_wall(col, 'quarry-wall-c', 8, 4.5, 9)
    small_falls(col)
    export(os.path.join(OUT, 'quarry.glb'))


def export(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    kw = dict(filepath=path, export_format='GLB', export_apply=True, export_yup=True, export_materials='EXPORT', export_normals=True, export_texcoords=True)
    try:
        bpy.ops.export_scene.gltf(**kw, export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_active_vertex_color_when_no_material=True)
    except TypeError:
        bpy.ops.export_scene.gltf(**kw)
    print('wrote', path, os.path.getsize(path), 'bytes')


if __name__ == '__main__' or True:
    build_kit()
    build_quarry()
