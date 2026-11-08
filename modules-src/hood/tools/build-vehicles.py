"""The Hood town vehicles, built in Blender.

Run headless from the repo root:

    blender -b --factory-startup -P modules-src/hood/tools/build-vehicles.py
    pnpm assets

Writes assets-src/models/hood/vehicles.glb: one root Empty per vehicle kind (cruiser, delivery, pickup,
lawntruck, engine, ambulance, garbage, utility, shuttle, bus, tanker, wreck, trailer). Each root sits on
the ground (y = 0) with the vehicle's front facing +z in three.js and its left side (L) at +x.

Bodies are lofted cross-sections (cars) or rounded grid boxes with raked windshields, tumblehome and
crowned roofs (trucks, buses), with wheel wells cut by booleans, glass inset in rubber gaskets, panel
seams, lamps, grilles, bumpers, mirrors, handles and step rails. Everything that does not move is joined
into one `<kind>_body` mesh. Moving and flashing parts stay separate, children of the root:
  wheel_<axle>_<L|R>   an Empty at the wheel centre (spin axis local X; axle 0 is the steered front axle)
                       holding the tyre and rim mesh wheel_<axle>_<L|R>_mesh; dual rear tyres share it
  bar_<i>_<color>      light-bar lenses (i counts across each vehicle's bars from -x to +x), color is
                       red | blue | white | amber
  boom > boom_base, arm > arm_mesh   the utility truck's turret Empty (rotates about Y) and the arm
                       Empty at the arm pivot (rotates about X), stowed forward along +z with the bucket at its tip
Pivots are Empties because the asset pipeline's quantization moves a mesh node's origin to its bounds.
The trailer's origin is its hitch coupler; it extends toward -z.

AXES: the script authors every vehicle with its front at Blender +Y and then mirrors Y, so the front ends
up at Blender -Y, which the glTF exporter (Blender -Y -> three.js +z) turns into +z as the game expects.

Materials are named slots with distinct preview values so the asset pipeline never merges two:
paint_* (recoloured at runtime where needed; paint_wreck always is), chrome, glass, tire, rim,
trim_black, rubber, interior, steel, tank_steel, deck_wood, headlamp, taillamp, reverse_lamp,
amber_lamp and the light-bar lenses bar_red, bar_blue, bar_white, bar_amber.

Set HOOD_PREVIEW=/path/prefix to render a Cycles contact sheet (<prefix>-sheet.png) of every vehicle.
Set HOOD_ONLY=kind,kind to build only some vehicles (preview iterations; does not write the .glb).
"""
import json
import math
import os
import re
import struct

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

PI = math.pi
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.environ.get("HOOD_REPO") or os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT = os.path.join(REPO, "assets-src", "models", "hood", "vehicles.glb")


def srgb(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


# Preview colour, roughness, metalness (every slot distinct).
PALETTE = {
    "paint_black": (srgb("#141518"), 0.30, 0.0),
    "paint_white": (srgb("#eeeeec"), 0.31, 0.0),
    "paint_red": (srgb("#b3201a"), 0.32, 0.0),
    "paint_yellow": (srgb("#f2b632"), 0.33, 0.0),
    "paint_green": (srgb("#2f6e3c"), 0.34, 0.0),
    "paint_cityorange": (srgb("#e2762e"), 0.35, 0.0),
    "paint_teal": (srgb("#2f8a96"), 0.36, 0.0),
    "paint_blue": (srgb("#3b5f8a"), 0.37, 0.0),
    "paint_navy": (srgb("#22386b"), 0.38, 0.0),
    "paint_wreck": (srgb("#8a2b2b"), 0.39, 0.0),
    "chrome": (srgb("#eceef0"), 0.08, 1.0),
    "glass": (srgb("#141b22"), 0.04, 0.0),
    "tire": (srgb("#1a1a1b"), 0.88, 0.0),
    "rim": (srgb("#b9bcc1"), 0.28, 1.0),
    "trim_black": (srgb("#101112"), 0.55, 0.0),
    "rubber": (srgb("#202021"), 0.93, 0.0),
    "interior": (srgb("#33302d"), 0.80, 0.0),
    "steel": (srgb("#8e9196"), 0.42, 1.0),
    "tank_steel": (srgb("#d9dce0"), 0.15, 1.0),
    "deck_wood": (srgb("#8a6440"), 0.85, 0.0),
    "headlamp": (srgb("#f4f1e6"), 0.10, 0.0),
    "taillamp": (srgb("#8e1410"), 0.20, 0.0),
    "reverse_lamp": (srgb("#e2e4e6"), 0.12, 0.0),
    "amber_lamp": (srgb("#f08a10"), 0.21, 0.0),
    "bar_red": (srgb("#c81e1e"), 0.18, 0.0),
    "bar_blue": (srgb("#1e46c8"), 0.18, 0.0),
    "bar_white": (srgb("#f0f2f6"), 0.17, 0.0),
    "bar_amber": (srgb("#ffa21a"), 0.19, 0.0),
}
ALL = list(PALETTE)
MI = {n: i for i, n in enumerate(ALL)}
MATS = {}


def mat(name):
    if name in MATS:
        return MATS[name]
    col, rough, metal = PALETTE[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*col, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    MATS[name] = m
    return m


# ---------------------------------------------------------------- parts

PARTS = [[]]


def push():
    PARTS.append([])


def pop():
    return PARTS.pop()


def finish(bm, name, material=None, loc=(0, 0, 0), rot=(0, 0, 0), bevel=0.0, seg=2, angle=35):
    if material:
        for f in bm.faces:
            f.material_index = MI[material]
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in ALL:
        me.materials.append(mat(m))
    for p in me.polygons:
        p.use_smooth = True
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = loc
    obj.rotation_euler = rot
    if bevel > 0:
        m = obj.modifiers.new("Bevel", "BEVEL")
        m.width = bevel
        m.segments = seg
        m.limit_method = "ANGLE"
        m.angle_limit = math.radians(angle)
    PARTS[-1].append(obj)
    return obj


def rbox(material, size, loc, rot=(0, 0, 0), bevel=0.01, seg=2):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    b = min(bevel, min(size) * 0.45)
    if max(size) < 0.6 or min(size) <= 0.065:
        seg = 1
    return finish(bm, "box", material, loc, rot, bevel=b if b >= 0.004 else 0.0, seg=seg)


AXIS_ROT = {"x": Matrix.Rotation(PI / 2, 4, "Y"), "y": Matrix.Rotation(-PI / 2, 4, "X"), "z": Matrix.Identity(4)}


def cyl(material, r, h, loc, axis="z", seg=16, r2=None, bevel=0.0, rot=(0, 0, 0)):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=h)
    bmesh.ops.transform(bm, matrix=AXIS_ROT[axis], verts=bm.verts)
    return finish(bm, "cyl", material, loc, rot, bevel=bevel)


def ball(material, r, loc, scale=(1, 1, 1), seg=16, rings=10):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=r)
    bmesh.ops.scale(bm, vec=Vector(scale), verts=bm.verts)
    return finish(bm, "ball", material, loc)


def frames(pts):
    T = []
    for i in range(len(pts)):
        a = pts[max(0, i - 1)]
        b = pts[min(len(pts) - 1, i + 1)]
        T.append((b - a).normalized())
    up = Vector((0, 0, 1)) if abs(T[0].z) < 0.9 else Vector((1, 0, 0))
    N = [T[0].cross(up).normalized()]
    for i in range(1, len(pts)):
        n = N[-1] - T[i] * N[-1].dot(T[i])
        N.append(n.normalized() if n.length > 1e-6 else N[-1])
    B = [t.cross(n) for t, n in zip(T, N)]
    return T, N, B


def sweep(material, pts, radius, seg=8, caps=True):
    pts = [Vector(p) for p in pts]
    clean = [pts[0]]
    for p in pts[1:]:
        if (p - clean[-1]).length > 1e-4:
            clean.append(p)
    pts = clean
    if len(pts) < 2:
        return None
    T, N, B = frames(pts)
    bm = bmesh.new()
    rings = []
    for i, p in enumerate(pts):
        r = radius(i / (len(pts) - 1)) if callable(radius) else radius
        rings.append([bm.verts.new(p + N[i] * math.cos(j / seg * 2 * PI) * r + B[i] * math.sin(j / seg * 2 * PI) * r) for j in range(seg)])
    for a, b in zip(rings, rings[1:]):
        for j in range(seg):
            bm.faces.new((a[j], a[(j + 1) % seg], b[(j + 1) % seg], b[j]))
    if caps:
        bm.faces.new(rings[0][::-1])
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return finish(bm, "tube", material)


def lathe_x(material, profile, seg=32, loc=(0, 0, 0), offset=None, ref=None, mirror=False):
    """Revolve [(axial, radius), ...] about the X axis; offset(k, j) nudges ring k at segment j radially."""
    bm = bmesh.new()
    rings = []
    for k, (a, rho) in enumerate(profile):
        if rho <= 1e-6:
            rings.append([bm.verts.new((a, 0, 0))])
            continue
        ring = []
        for j in range(seg):
            t = j / seg * 2 * PI
            rr = rho + (offset(k, j) if offset else 0.0)
            ring.append(bm.verts.new((a, rr * math.cos(t), rr * math.sin(t))))
        rings.append(ring)
    ca = sum(p[0] for p in profile) / len(profile)
    cr = sum(p[1] for p in profile) / len(profile)
    if ref is not None:
        ca, cr = ref
    for a, b in zip(rings, rings[1:]):
        fs = []
        if len(a) == 1 and len(b) == 1:
            continue
        if len(a) == 1:
            fs = [bm.faces.new((a[0], b[j], b[(j + 1) % seg])) for j in range(seg)]
        elif len(b) == 1:
            fs = [bm.faces.new((a[j], a[(j + 1) % seg], b[0])) for j in range(seg)]
        else:
            fs = [bm.faces.new((a[j], a[(j + 1) % seg], b[(j + 1) % seg], b[j])) for j in range(seg)]
        for f in fs:
            f.normal_update()
            c = f.calc_center_median()
            t = math.atan2(c.z, c.y)
            refp = Vector((ca, cr * math.cos(t), cr * math.sin(t)))
            if f.normal.dot(c - refp) < 0:
                f.normal_flip()
    if mirror:
        bmesh.ops.scale(bm, vec=(-1, 1, 1), verts=bm.verts)
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    return finish(bm, "lathe", material, loc)


def prism_x(profile, x0, x1):
    """A bmesh prism: a convex (s, h) outline extruded along X from x0 to x1."""
    bm = bmesh.new()
    a = [bm.verts.new((x0, s, h)) for s, h in profile]
    b = [bm.verts.new((x1, s, h)) for s, h in profile]
    n = len(profile)
    for j in range(n):
        bm.faces.new((a[j], a[(j + 1) % n], b[(j + 1) % n], b[j]))
    bm.faces.new(a[::-1])
    bm.faces.new(b)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def plate_arc(material, x0, x1, s, h, r, a0, a1, thick=0.012, n=14):
    """A bent sheet (fender) over a wheel: an arc of radius r about (s, h) spanning x0..x1."""
    bm = bmesh.new()
    rows = []
    for i in range(n + 1):
        a = a0 + (a1 - a0) * i / n
        row = []
        for rr in (r, r + thick):
            for x in (x0, x1):
                row.append(bm.verts.new((x, s + rr * math.cos(a), h + rr * math.sin(a))))
        rows.append(row)
    for p, q in zip(rows, rows[1:]):
        bm.faces.new((p[0], p[1], q[1], q[0]))
        bm.faces.new((p[2], q[2], q[3], p[3]))
        bm.faces.new((p[0], q[0], q[2], p[2]))
        bm.faces.new((p[1], p[3], q[3], q[1]))
    for row in (rows[0], rows[-1]):
        bm.faces.new((row[0], row[2], row[3], row[1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return finish(bm, "fender", material)


# ---------------------------------------------------------------- booleans and surface helpers

def boolean(obj, cutter, material):
    for f in cutter.faces:
        f.material_index = MI[material]
    cme = bpy.data.meshes.new("cutter")
    cutter.to_mesh(cme)
    cutter.free()
    for m in ALL:
        cme.materials.append(mat(m))
    cobj = bpy.data.objects.new("cutter", cme)
    bpy.context.scene.collection.objects.link(cobj)
    mod = obj.modifiers.new("Cut", "BOOLEAN")
    mod.operation = "DIFFERENCE"
    mod.object = cobj
    mod.solver = "EXACT"
    for mode in ("INDEX", "TRANSFER"):
        try:
            mod.material_mode = mode
            break
        except TypeError:
            pass
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
    obj.modifiers.remove(mod)
    old = obj.data
    obj.data = me
    bpy.data.meshes.remove(old)
    bpy.data.objects.remove(cobj)
    bpy.data.meshes.remove(cme)
    for p in me.polygons:
        p.use_smooth = True


def arch_outline(centres, R, h, n=20):
    """Wheel-well outline around one axle or a tandem pair (stadium)."""
    c0, c1 = max(centres), min(centres)
    pts = []
    for i in range(n + 1):
        a = -PI / 2 + PI * i / n
        pts.append((c0 + R * math.cos(a), h + R * math.sin(a)))
    for i in range(n + 1):
        a = PI / 2 + PI * i / n
        pts.append((c1 + R * math.cos(a), h + R * math.sin(a)))
    clean = []
    for p in pts:
        if not clean or abs(p[0] - clean[-1][0]) + abs(p[1] - clean[-1][1]) > 1e-6:
            clean.append(p)
    if abs(clean[0][0] - clean[-1][0]) + abs(clean[0][1] - clean[-1][1]) < 1e-6:
        clean.pop()
    return clean


def cut_arches(obj, arches, x_in, x_out=3.0, material="trim_black"):
    """arches: [(centres, R, h)]; cuts wells into both sides from |x| = x_in outward."""
    bm = bmesh.new()
    for centres, R, h in arches:
        prof = arch_outline(centres, R, h)
        for x0, x1 in ((x_in, x_out), (-x_out, -x_in)):
            p = prism_x(prof, x0, x1)
            me = bpy.data.meshes.new("tmp")
            p.to_mesh(me)
            p.free()
            bm.from_mesh(me)
            bpy.data.meshes.remove(me)
    boolean(obj, bm, material)


def hit(bvh, origin, d):
    loc, nor, idx, dist = bvh.ray_cast(Vector(origin), Vector(d).normalized(), 40.0)
    return loc, nor


def side_x(bvh, s, h, side=1, default=None):
    loc, _ = hit(bvh, (side * 8, s, h), (-side, 0, 0))
    return loc.x if loc is not None else default


def front_s(bvh, x, h, front=1, default=None):
    loc, _ = hit(bvh, (x, front * 30, h), (0, -front, 0))
    return loc.y if loc is not None else default


def top_z(bvh, x, s, default=None):
    loc, _ = hit(bvh, (x, s, 9), (0, 0, -1))
    return loc.z if loc is not None else default


def seam(bvh, pts, d, r=0.005, material="trim_black"):
    """A panel seam: the points are projected onto the body along direction d and a thin dark bead laid there."""
    d = Vector(d).normalized()
    out = []
    for p in pts:
        loc, nor = hit(bvh, Vector(p) - d * 9, d)
        if loc is None:
            if len(out) >= 2:
                sweep(material, out, r, seg=4)
            out = []
            continue
        out.append(loc + nor * 0.0008)
    if len(out) >= 2:
        sweep(material, out, r, seg=4)


def side_seam(bvh, sh_pts, sides=(1, -1), r=0.0045, n=None):
    pts = sh_pts
    if n:
        pts = []
        for (s0, h0), (s1, h1) in zip(sh_pts, sh_pts[1:]):
            for i in range(n):
                t = i / n
                pts.append((s0 + (s1 - s0) * t, h0 + (h1 - h0) * t))
        pts.append(sh_pts[-1])
    for side in sides:
        seam(bvh, [(0, s, h) for s, h in pts], (-side, 0, 0), r)


def vseam(bvh, s, h0, h1, sides=(1, -1), n=5):
    side_seam(bvh, [(s, h0), (s, h1)], sides, n=n)


def top_seam(bvh, xy_pts, n=6):
    pts = []
    for (x0, s0), (x1, s1) in zip(xy_pts, xy_pts[1:]):
        for i in range(n):
            t = i / n
            pts.append((x0 + (x1 - x0) * t, s0 + (s1 - s0) * t, 0))
    pts.append((*xy_pts[-1], 0))
    seam(bvh, pts, (0, 0, -1))


def front_seam(bvh, xh_pts, front=1, n=6):
    pts = []
    for (x0, h0), (x1, h1) in zip(xh_pts, xh_pts[1:]):
        for i in range(n):
            t = i / n
            pts.append((x0 + (x1 - x0) * t, 0, h0 + (h1 - h0) * t))
    pts.append((xh_pts[-1][0], 0, xh_pts[-1][1]))
    seam(bvh, pts, (0, -front, 0))


def on_side(bvh, material, size, s, h, out=0.0, sides=(1, -1), bevel=0.008, seg=2):
    for side in sides:
        x = side_x(bvh, s, h, side)
        if x is None:
            continue
        rbox(material, size, (x + side * (size[0] / 2 - 0.006 + out), s, h), bevel=bevel, seg=seg)


def on_front(bvh, material, size, x, h, front=1, mirror=True, bevel=0.01, seg=2, sink=0.012):
    for xx in ((x, -x) if mirror and abs(x) > 1e-4 else (x,)):
        s = front_s(bvh, xx, h, front)
        if s is None:
            continue
        rbox(material, size, (xx, s + front * (size[1] / 2 - sink), h), bevel=bevel, seg=seg)


def handle(bvh, s, h, sides=(1, -1), material="trim_black", length=0.17):
    on_side(bvh, material, (0.03, length, 0.035), s, h, sides=sides, bevel=0.012, seg=2)


def arch_trim(bvh, centres, R, h, r=0.028, material="trim_black", sides=(1, -1), out=0.012):
    c0, c1 = max(centres), min(centres)
    pts = []
    for i in range(13):
        a = PI / 2 * i / 12
        pts.append((c0 + R * math.cos(a), h + R * math.sin(a)))
    for i in range(13):
        a = PI / 2 + PI / 2 * i / 12
        pts.append((c1 + R * math.cos(a), h + R * math.sin(a)))
    for side in sides:
        line = []
        for s, hh in pts:
            x = side_x(bvh, s, hh, side)
            if x is not None:
                line.append((x + side * out, s, hh))
        if len(line) > 2:
            sweep(material, line, r, seg=6)


# ---------------------------------------------------------------- lofted bodies (cars)

def pchip(xs, ys):
    n = len(xs)
    h = [xs[i + 1] - xs[i] for i in range(n - 1)]
    d = [(ys[i + 1] - ys[i]) / h[i] for i in range(n - 1)]
    m = [0.0] * n
    m[0], m[-1] = d[0], d[-1]
    for i in range(1, n - 1):
        if d[i - 1] * d[i] <= 0:
            m[i] = 0.0
        else:
            w1, w2 = 2 * h[i] + h[i - 1], h[i] + 2 * h[i - 1]
            m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])

    def f(x):
        if x <= xs[0]:
            return ys[0]
        if x >= xs[-1]:
            return ys[-1]
        i = 0
        while xs[i + 1] < x:
            i += 1
        t = (x - xs[i]) / h[i]
        t2, t3 = t * t, t * t * t
        return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1]
    return f


def K(s, wb, wt, z0, z1, rb=0.1, rt=0.1, bulge=0.0, crown=0.0):
    return dict(s=s, wb=wb, wt=wt, z0=z0, z1=z1, rb=rb, rt=rt, bulge=bulge, crown=crown)


SEGS = (("bot", 1), ("barc", 2), ("side", 6), ("tarc", 4), ("top", 3))


def half_profile(p):
    wb, wt, z0, z1 = p["wb"], p["wt"], p["z0"], p["z1"]
    hh = max(z1 - z0, 0.03)
    rb = max(0.005, min(p["rb"], hh * 0.42, wb * 0.9))
    rt = max(0.005, min(p["rt"], hh * 0.45, wt * 0.9))
    out = []
    for label, n in SEGS:
        for k in range(n):
            t = k / n
            if label == "bot":
                x, z = t * (wb - rb), z0
            elif label == "barc":
                a = -PI / 2 + PI / 2 * t
                x, z = wb - rb + rb * math.cos(a), z0 + rb + rb * math.sin(a)
            elif label == "side":
                x = wb + (wt - wb) * t + p["bulge"] * math.sin(PI * t)
                z = z0 + rb + (z1 - rt - z0 - rb) * t
            elif label == "tarc":
                a = PI / 2 * t
                x, z = wt - rt + rt * math.cos(a), z1 - rt + rt * math.sin(a)
            else:
                x = (wt - rt) * (1 - t)
                z = z1 + p["crown"] * (1 - (1 - t) ** 2)
            out.append((x, z, label))
    out.append((0.0, z1 + p["crown"], "top"))
    return out


def loft(keys, matfn=None, default="paint_white", forced=(), ds=0.1, insets=None, name="loft"):
    """Loft rounded-trapezoid sections along +Y. Returns (object, bvh)."""
    keys = sorted(keys, key=lambda k: k["s"])
    ss = [k["s"] for k in keys]
    fns = {p: pchip(ss, [k[p] for k in keys]) for p in ("wb", "wt", "z0", "z1", "rb", "rt", "bulge", "crown")}
    s0, s1 = ss[0], ss[-1]
    samples = {round(s0, 4), round(s1, 4)}
    n = max(2, int((s1 - s0) / ds))
    for i in range(1, n):
        samples.add(round(s0 + (s1 - s0) * i / n, 4))
    for e in (0.015, 0.04, 0.075):
        samples.add(round(s0 + e, 4))
        samples.add(round(s1 - e, 4))
    for f in forced:
        if s0 < f < s1:
            samples.add(round(f, 4))
    samples = sorted(samples)
    merged = [samples[0]]
    for v in samples[1:]:
        if v - merged[-1] > 0.008:
            merged.append(v)
        else:
            merged[-1] = v if v in forced else merged[-1]
    bm = bmesh.new()
    rings, labels = [], None
    for s in merged:
        p = {k: f(s) for k, f in fns.items()}
        half = half_profile(p)
        full = half + [(-x, z, lab) for x, z, lab in reversed(half[1:-1])]
        rings.append([bm.verts.new((x, s, z)) for x, z, _ in full])
        labels = [lab for _, _, lab in full]
    nring = len(rings[0])
    half_n = len(half_profile(keys[0]))
    us = [i / (half_n - 1) for i in range(half_n)] + [(half_n - 1 - i) / (half_n - 1) for i in range(1, half_n - 1)]
    us = us[:nring]
    faces = []
    for i, (a, b) in enumerate(zip(rings, rings[1:])):
        for j in range(nring):
            k = (j + 1) % nring
            f = bm.faces.new((a[j], a[k], b[k], b[j]))
            lo = j if us[j] <= us[k] else k
            faces.append((f, (merged[i] + merged[i + 1]) / 2, labels[lo], (us[j] + us[k]) / 2))
    bm.faces.new(rings[0][::-1])
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.normal_update()
    for f in bm.faces:
        f.material_index = MI[default]
    if matfn:
        for f, s, lab, u in faces:
            m = matfn(s, lab, u, f.calc_center_median(), f.normal)
            if m:
                f.material_index = MI[m]
    apply_insets(bm, insets if insets is not None else {"glass": (0.012, 0.008, "trim_black")})
    bvh = BVHTree.FromBMesh(bm)
    return finish(bm, name), bvh


def apply_insets(bm, insets):
    for m, (thick, depth, ring) in insets.items():
        bm.normal_update()
        fs = [f for f in bm.faces if f.material_index == MI[m]]
        if not fs:
            continue
        res = bmesh.ops.inset_region(bm, faces=fs, thickness=thick, depth=-depth, use_even_offset=True, use_boundary=True)
        for f in res["faces"]:
            f.material_index = MI[ring]


# ---------------------------------------------------------------- rounded grid boxes (trucks)

def R(material, face=None, x=None, y=None, z=None):
    return (material, face, x, y, z)


def gbox(ext, r, regions=(), default="paint_white", deform=None, insets=None, cuts=((), (), ()), name="gbox"):
    """A box with rounded edges whose faces are gridded along every region boundary, so windows, panels
    and stripes are exact face regions. deform(Vector) -> Vector shapes it after rounding."""
    (x0, x1), (y0, y1), (z0, z1) = ext
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((x0 if v.co.x < 0 else x1, y0 if v.co.y < 0 else y1, z0 if v.co.z < 0 else z1))
    rr = min(r, min(x1 - x0, y1 - y0, z1 - z0) * 0.45)
    lines = [set(c) for c in cuts]
    for i, (a, b) in enumerate(ext):
        for t in (0.0, math.tan(PI / 12), math.tan(PI / 6)):
            lines[i].add(a + rr - rr * t)
            lines[i].add(b - rr + rr * t)
    for reg in regions:
        for i, rng in enumerate(reg[2:]):
            if rng:
                lines[i].update(rng)
    for i, vals in enumerate(lines):
        no = Vector([1.0 if k == i else 0.0 for k in range(3)])
        done = []
        for v in sorted(vals):
            if not (ext[i][0] + 2e-3 < v < ext[i][1] - 2e-3):
                continue
            if done and v - done[-1] < 2e-3:
                continue
            done.append(v)
            geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
            bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-6, plane_co=no * v, plane_no=no)
    bm.normal_update()
    for f in bm.faces:
        c = f.calc_center_median()
        n = f.normal
        ax = max(range(3), key=lambda k: abs(n[k]))
        face = ("+" if n[ax] > 0 else "-") + "xyz"[ax]
        m = default
        for mm, fc, xr, yr, zr in regions:
            if fc and not (fc == face or (len(fc) == 1 and fc == face[1])):
                continue
            if xr and not (xr[0] - 1e-4 <= c.x <= xr[1] + 1e-4):
                continue
            if yr and not (yr[0] - 1e-4 <= c.y <= yr[1] + 1e-4):
                continue
            if zr and not (zr[0] - 1e-4 <= c.z <= zr[1] + 1e-4):
                continue
            m = mm
            break
        f.material_index = MI[m]
    lo = Vector((x0 + rr, y0 + rr, z0 + rr))
    hi = Vector((x1 - rr, y1 - rr, z1 - rr))
    for v in bm.verts:
        q = Vector((min(max(v.co.x, lo.x), hi.x), min(max(v.co.y, lo.y), hi.y), min(max(v.co.z, lo.z), hi.z)))
        d = v.co - q
        if d.length > 1e-9:
            v.co = q + d.normalized() * rr
    if deform:
        for v in bm.verts:
            v.co = deform(v.co.copy())
    bm.normal_update()
    apply_insets(bm, insets if insets is not None else {"glass": (0.014, 0.01, "trim_black")})
    bvh = BVHTree.FromBMesh(bm)
    return finish(bm, name), bvh


def chain(*fs):
    def f(v):
        for g in fs:
            v = g(v)
        return v
    return f


def rake(front, belt, k, start):
    """Lean the face at y = front back by k per metre above the belt, fading out toward y = start."""
    def f(v):
        if v.z > belt and v.y > start:
            w = min(1.0, (v.y - start) / (front - start))
            v.y -= (v.z - belt) * k * w
        return v
    return f


def tumble(belt, top, k):
    def f(v):
        if v.z > belt:
            v.x *= 1 - k * (v.z - belt) / (top - belt)
        return v
    return f


def crown(top, c, hw, band=0.3):
    def f(v):
        if v.z > top - band:
            w = (v.z - (top - band)) / band
            v.z += c * w * max(0.0, 1 - (v.x / hw) ** 2)
        return v
    return f


def slope_top(z_hi, y0, y1, drop):
    """Lower the top surface linearly from y0 (no drop) to y1 (drop)."""
    def f(v):
        if v.z > z_hi - 0.25:
            w = min(1.0, max(0.0, (v.y - y0) / (y1 - y0)))
            v.z -= drop * w * (v.z - (z_hi - 0.25)) / 0.25
        return v
    return f


def nose(front, z_lo, z_hi, k):
    """Lean the front face: points at y near front move back by k per metre below z_hi (a swept-back bumper)."""
    def f(v):
        if v.y > front - 0.3:
            w = (v.y - (front - 0.3)) / 0.3
            v.y -= max(0.0, z_hi - v.z) * k * w
        return v
    return f


# ---------------------------------------------------------------- wheels

def tire(r, w, rim_r, a=0.0, seg=32, lugs=True):
    prof = [(-0.40, rim_r, 0), (-0.47, rim_r + 0.2 * (r - rim_r), 0), (-0.50, rim_r + 0.52 * (r - rim_r), 0),
            (-0.485, rim_r + 0.82 * (r - rim_r), 0), (-0.44, r - 0.018, 1), (-0.36, r, 2), (-0.12, r, 2), (-0.08, r - 0.012, 0),
            (0.08, r - 0.012, 0), (0.12, r, 4), (0.36, r, 4), (0.44, r - 0.018, 1), (0.485, rim_r + 0.82 * (r - rim_r), 0), (0.50, rim_r + 0.52 * (r - rim_r), 0),
            (0.47, rim_r + 0.2 * (r - rim_r), 0), (0.40, rim_r, 0)]
    depth = min(0.014, r * 0.035)

    def off(k, j):
        if not lugs:
            return 0.0
        fl = prof[k][2]
        if fl == 2:
            return -depth if j % 2 == 0 else 0.0
        if fl == 4:
            return -depth if j % 2 == 1 else 0.0
        if fl == 3:
            return -depth * 0.6 if (j // 2) % 2 == 0 else 0.0
        return 0.0
    return lathe_x("tire", [(a + p[0] * w, p[1]) for p in prof], seg=seg, offset=off, ref=(a, (r + rim_r) / 2))


def alloy_rim(rim_r, w, spokes=5, a=0.0, seg=28):
    o = a + 0.40 * w
    lathe_x("rim", [(o + 0.015, rim_r + 0.012), (o + 0.022, rim_r - 0.004), (o + 0.008, rim_r - 0.022), (a - 0.38 * w, rim_r - 0.022),
                    (a - 0.42 * w, rim_r + 0.008)], seg=seg, ref=(a, rim_r + 0.2))
    lathe_x("trim_black", [(o - 0.04, rim_r - 0.02), (o - 0.04, 0.0)], seg=seg, ref=(o - 1, 0.0))
    L = rim_r * 0.74
    for i in range(spokes):
        t = i / spokes * 2 * PI + PI / 2
        mid = rim_r * 0.22 + L / 2
        rbox("rim", (0.03, L, rim_r * 0.2), (o - 0.004, mid * math.cos(t), mid * math.sin(t)), rot=(t - PI / 2, 0, 0), bevel=0.01)
    lathe_x("rim", [(o - 0.03, rim_r * 0.3), (o + 0.004, rim_r * 0.3), (o + 0.012, rim_r * 0.2), (o + 0.016, 0.0)], seg=20, ref=(o - 1, 0))
    for i in range(5):
        t = i / 5 * 2 * PI
        cyl("chrome", 0.011, 0.02, (o + 0.016, rim_r * 0.16 * math.cos(t), rim_r * 0.16 * math.sin(t)), axis="x", seg=6)
    cyl("chrome", rim_r * 0.09, 0.012, (o + 0.02, 0, 0), axis="x", seg=12)


def steel_rim(rim_r, w, a=0.0, front_cap=False, dish=True, seg=24, holes=5, nuts=8):
    o = a + 0.40 * w
    d = 0.08 if dish else 0.03
    lathe_x("rim", [(o + 0.012, rim_r + 0.012), (o + 0.016, rim_r - 0.006), (o, rim_r - 0.02), (o - d, rim_r * 0.74), (o - d + 0.02, rim_r * 0.45),
                    (o - d + 0.025, rim_r * 0.3), (o - d + 0.025, 0.0)], seg=seg, ref=(o - 1, 0))
    lathe_x("rim", [(o, rim_r - 0.02), (a - 0.38 * w, rim_r - 0.02), (a - 0.42 * w, rim_r + 0.008)], seg=seg, ref=(a, rim_r + 0.2))
    for i in range(holes):
        t = (i + 0.5) / holes * 2 * PI
        rad = rim_r * 0.6
        cyl("trim_black", rim_r * 0.1, 0.01, (o - d + 0.008, rad * math.cos(t), rad * math.sin(t)), axis="x", seg=8)
    for i in range(nuts):
        t = i / nuts * 2 * PI
        cyl("chrome", 0.016, 0.03, (o - d + 0.035, rim_r * 0.36 * math.cos(t), rim_r * 0.36 * math.sin(t)), axis="x", seg=6)
    if front_cap:
        lathe_x("chrome", [(o - d + 0.02, rim_r * 0.3), (o - d + 0.08, rim_r * 0.27), (o - d + 0.13, rim_r * 0.16), (o - d + 0.145, 0.0)], seg=20, ref=(o - 1, 0))
    else:
        lathe_x("chrome", [(o - d + 0.02, rim_r * 0.24), (o - d + 0.07, rim_r * 0.22), (o - d + 0.075, 0.0)], seg=16, ref=(o - 1, 0))


def make_wheel(name, loc, side, r, w, style="alloy", dual=False, front_cap=False, seg=28, spokes=5, bake=None):
    push()
    if style == "alloy":
        rim_r = r * 0.62
        tire(r, w, rim_r, seg=seg)
        alloy_rim(rim_r, w, spokes=spokes, seg=seg)
    else:
        rim_r = r * 0.56
        if dual:
            g = w / 2 + 0.016
            tire(r, w, rim_r, a=g, seg=seg)
            tire(r, w, rim_r, a=-g, seg=seg)
            steel_rim(rim_r, w, a=g, dish=True, seg=seg)
            lathe_x("rim", [(-g + 0.40 * w, rim_r - 0.02), (-g - 0.42 * w, rim_r - 0.02)], seg=seg, ref=(0, rim_r + 0.2))
        else:
            tire(r, w, rim_r, seg=seg)
            steel_rim(rim_r, w, front_cap=front_cap, dish=False, seg=seg)
    objs = pop()
    o = join_parts(objs, name)
    if side < 0:
        o.data.transform(Matrix.Scale(-1, 4, (1, 0, 0)))
        o.data.flip_normals()
    if bake:
        o.data.transform(bake)
    return pivot(o, name, loc)


def pivot(o, name, loc, parent=None):
    """An Empty named `name` at the pivot holding the mesh as `<name>_mesh`, so the asset pipeline's per-mesh
    quantization (which moves a mesh node's origin to its bounds) never moves the pivot."""
    e = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(e)
    e.location = loc
    e.parent = parent
    o.name = name + "_mesh"
    o.data.name = name + "_mesh"
    o.parent = e
    o.location = (0, 0, 0)
    return e


def wheels(axles, r, w, track, style="alloy", duals=(), seg=28, spokes=5, bake=None, steer_cap=True):
    out = []
    for i, s in enumerate(axles):
        for side, tag in ((1, "L"), (-1, "R")):
            dual = i in duals
            b = bake.get((i, tag)) if bake else None
            out.append(make_wheel(f"wheel_{i}_{tag}", (side * track / 2, s, r), side, r, w, style=style, dual=dual,
                                  front_cap=(i == 0 and steer_cap), seg=seg, spokes=spokes, bake=b))
    return out


# ---------------------------------------------------------------- shared fittings

BARS = []


def light_bar(width, s, h, colors, depth=0.3, n=None, face_front=False):
    """A light bar: a black housing plus separate lens objects bar_<i>_<color> (i from -x to +x)."""
    n = n or len(colors)
    if not face_front:
        for sx in (-1, 1):
            rbox("trim_black", (0.06, 0.18, 0.04), (sx * width * 0.36, s, h + 0.02), bevel=0.01)
        rbox("trim_black", (width, depth, 0.05), (0, s, h + 0.06), bevel=0.02, seg=2)
        rbox("trim_black", (width - 0.02, depth * 0.35, 0.035), (0, s, h + 0.2), bevel=0.012)
    lw = (width - 0.04) / n
    for i in range(n):
        c = colors[i % len(colors)]
        x = -width / 2 + 0.02 + (i + 0.5) * lw
        push()
        if face_front:
            rbox(f"bar_{c}", (lw - 0.025, 0.05, 0.13), (x, s, h), bevel=0.02, seg=2)
        else:
            rbox(f"bar_{c}", (lw - 0.018, depth - 0.03, 0.12), (x, s, h + 0.145), bevel=0.025, seg=2)
        objs = pop()
        BARS.append((objs, c))


def name_bars():
    out = []
    order = sorted(range(len(BARS)), key=lambda i: (round(BARS[i][0][0].location.z, 2) * 0 + i))
    for k, i in enumerate(order):
        objs, c = BARS[i]
        o = join_parts(objs, f"bar_{k}_{c}")
        centre_origin(o)
        out.append(o)
    BARS.clear()
    return out


def centre_origin(o):
    vs = [v.co for v in o.data.vertices]
    c = sum(vs, Vector()) / len(vs)
    o.data.transform(Matrix.Translation(-c))
    o.location = c


def mirror_pair(s, h, hw, tall=False, chrome_arm=False, size=None):
    for side in (1, -1):
        if tall:
            arm = "chrome" if chrome_arm else "steel"
            x = side * (hw + 0.2)
            sweep(arm, [(side * (hw - 0.02), s + 0.05, h - 0.25), (x, s + 0.05, h - 0.25), (x, s + 0.05, h - 0.2)], 0.014, seg=8)
            sweep(arm, [(side * (hw - 0.02), s + 0.05, h + 0.3), (x, s + 0.05, h + 0.3), (x, s + 0.05, h + 0.25)], 0.014, seg=8)
            rbox("trim_black", (0.07, 0.12, 0.42), (x, s + 0.05, h + 0.02), bevel=0.025)
            rbox("chrome", (0.06, 0.012, 0.36), (x, s - 0.012, h + 0.02), bevel=0.004)
        else:
            sx, sy, sz = size or (0.2, 0.08, 0.12)
            rbox("trim_black", (0.08, 0.1, 0.07), (side * (hw + 0.02), s, h - 0.02), bevel=0.02)
            rbox("trim_black", (sx, sy, sz), (side * (hw + sx / 2 + 0.02), s, h + 0.02), bevel=0.03, seg=3)
            rbox("chrome", (sx - 0.04, 0.01, sz - 0.03), (side * (hw + sx / 2 + 0.02), s - sy / 2, h + 0.02), bevel=0.004)


def grille(x_half, h0, h1, s, slats=5, frame="chrome", inner="trim_black", depth=0.06, vertical=False):
    w, hh = x_half * 2, h1 - h0
    rbox(frame, (w + 0.06, depth, hh + 0.06), (0, s - 0.01, (h0 + h1) / 2), bevel=0.02, seg=2)
    rbox(inner, (w, depth, hh), (0, s + 0.004, (h0 + h1) / 2), bevel=0.006)
    if vertical:
        for i in range(slats):
            x = -x_half + (i + 0.5) * w / slats
            rbox(frame, (0.018, 0.03, hh - 0.02), (x, s + depth / 2, (h0 + h1) / 2), bevel=0.006)
    else:
        for i in range(slats):
            z = h0 + (i + 0.5) * hh / slats
            rbox(frame, (w - 0.02, 0.03, 0.016), (0, s + depth / 2, z), bevel=0.006)


def ladder(x, s0, s1, h, width=0.48, rung_pitch=0.3, material="steel"):
    L = s1 - s0
    for sx in (-1, 1):
        rbox(material, (0.04, L, 0.1), (x + sx * width / 2, (s0 + s1) / 2, h), bevel=0.01)
    n = int(L / rung_pitch)
    for i in range(n + 1):
        s = s0 + 0.12 + (L - 0.24) * i / n
        cyl(material, 0.016, width, (x, s, h), axis="x", seg=6)


def vladder(x, s, h0, h1, width=0.4, material="steel"):
    """A vertical ladder on a rear face at s: rails at x +- width/2, rungs across x."""
    for sx in (-1, 1):
        rbox(material, (0.035, 0.035, h1 - h0), (x + sx * width / 2, s, (h0 + h1) / 2), bevel=0.008)
    n = int((h1 - h0) / 0.3)
    for i in range(n):
        z = h0 + 0.2 + i * (h1 - h0 - 0.3) / max(1, n - 1)
        cyl(material, 0.014, width, (x, s, z), axis="x", seg=6)


def ribbed(x, side, s0, s1, z0, z1, pitch=0.055, depth=0.008, material="steel"):
    """A roll-up compartment door: a corrugated sheet on the face at x."""
    bm = bmesh.new()
    rows = []
    n = max(2, int((z1 - z0) / (pitch / 2)))
    for i in range(n + 1):
        z = z0 + (z1 - z0) * i / n
        xx = x + side * (0.006 + depth * (i % 2))
        rows.append((bm.verts.new((xx, s0, z)), bm.verts.new((xx, s1, z))))
    for (a0, a1), (b0, b1) in zip(rows, rows[1:]):
        bm.faces.new((a0, a1, b1, b0))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        f.normal_update()
        if f.normal.x * side < 0:
            f.normal_flip()
    finish(bm, "rollup", material)
    fx = x + side * 0.012
    for zz in (z0, z1):
        rbox("trim_black" if material != "chrome" else "steel", (0.03, s1 - s0 + 0.05, 0.035), (fx, (s0 + s1) / 2, zz), bevel=0.008)
    for ss in (s0, s1):
        rbox("trim_black", (0.03, 0.035, z1 - z0 + 0.05), (fx, ss, (z0 + z1) / 2), bevel=0.008)
    rbox("chrome", (0.03, (s1 - s0) * 0.5, 0.03), (x + side * 0.03, (s0 + s1) / 2, z0 + 0.09), bevel=0.008)


def frame_rails(s0, s1, h, xw=0.45, hh=0.2):
    for sx in (-1, 1):
        rbox("trim_black", (0.08, s1 - s0, hh), (sx * xw, (s0 + s1) / 2, h), bevel=0.008)


def interior_cab(s_dash, s_seat, hw, belt, seats=2, rows=1):
    rbox("interior", (hw * 2 - 0.2, 0.35, 0.18), (0, s_dash, belt - 0.02), bevel=0.04)
    for row in range(rows):
        sb = s_seat - row * 0.95
        for sx in ((-0.42, 0.42) if seats == 2 else (-0.5, 0, 0.5)):
            rbox("interior", (0.45, 0.14, 0.5), (sx * hw * 0.9, sb, belt + 0.02), rot=(-0.12, 0, 0), bevel=0.04, seg=1)


# ---------------------------------------------------------------- vehicles

def sedan(paint="paint_black", door="paint_white", roofp="paint_white", police=True, wreck=False):
    """A full-size four-door sedan (the cruiser, and the wreck)."""
    hood_bay = (1.05, 2.3) if wreck else None

    def low_mat(s, lab, u, c, n):
        if hood_bay and lab in ("top",) and hood_bay[0] < s < hood_bay[1] and c.z > 0.7:
            return "trim_black"
        if police and lab in ("side", "barc", "tarc") and -1.08 < s < 1.2 and c.z > 0.36:
            return door
        return None

    lower = [
        K(-2.40, 0.80, 0.74, 0.36, 0.90, 0.08, 0.09),
        K(-2.33, 0.88, 0.82, 0.31, 0.97, 0.10, 0.11),
        K(-2.05, 0.915, 0.85, 0.28, 1.00, 0.10, 0.12, 0.01),
        K(-1.35, 0.925, 0.855, 0.27, 0.985, 0.10, 0.12, 0.012),
        K(0.0, 0.93, 0.86, 0.26, 0.955, 0.10, 0.12, 0.014),
        K(1.05, 0.925, 0.855, 0.27, 0.915, 0.10, 0.12, 0.012),
        K(1.70, 0.915, 0.84, 0.28, 0.86, 0.10, 0.12, 0.01, 0.01),
        K(2.22, 0.89, 0.80, 0.30, 0.82, 0.10, 0.11, 0.0, 0.01),
        K(2.35, 0.85, 0.75, 0.33, 0.78, 0.09, 0.10),
        K(2.41, 0.78, 0.66, 0.37, 0.71, 0.07, 0.08),
    ]
    body, bvh = loft(lower, low_mat, default=paint, forced=(1.2, 0.02, -1.08, 1.05, 2.3, -1.4))
    if police or not wreck:
        pass
    roof_c = roofp

    def gh_mat(s, lab, u, c, n):
        if lab == "top":
            return "glass" if (s > 0.28 or s < -0.86) else roof_c
        if lab == "side" and 0.99 > c.z > 0.95 + 0.0:
            return "trim_black"
        if lab == "side" and c.z > 0.99 and -0.98 < s < 0.98 and not (-0.07 < s < 0.07):
            return "glass"
        return roof_c

    gh = [
        K(1.10, 0.80, 0.70, 0.90, 0.93, 0.02, 0.02),
        K(0.95, 0.80, 0.69, 0.90, 1.03, 0.02, 0.06),
        K(0.28, 0.79, 0.62, 0.90, 1.43, 0.02, 0.11, 0.0, 0.015),
        K(-0.20, 0.79, 0.62, 0.90, 1.45, 0.02, 0.11, 0.0, 0.02),
        K(-0.86, 0.79, 0.63, 0.90, 1.41, 0.02, 0.11, 0.0, 0.015),
        K(-1.30, 0.80, 0.68, 0.90, 1.05, 0.02, 0.06),
        K(-1.42, 0.80, 0.70, 0.90, 0.97, 0.02, 0.02),
    ]
    green, gbvh = loft(gh, gh_mat, default=roof_c, forced=(0.28, -0.86, 0.07, -0.07, 0.98, -0.98), ds=0.08)
    cut_arches(body, [((1.45,), 0.41, 0.36), ((-1.45,), 0.41, 0.36)], 0.6)
    # seams
    vseam(bvh, 1.2, 0.36, 0.93)
    vseam(bvh, 0.02, 0.32, 0.95)
    side_seam(bvh, [(-1.06, 0.95), (-1.04, 0.6), (-1.0, 0.45), (-0.95, 0.33)], n=4)
    side_seam(bvh, [(2.0, 0.35), (2.1, 0.62), (2.16, 0.8)], n=5)
    side_seam(bvh, [(-2.0, 0.34), (-2.08, 0.62), (-2.12, 0.92)], n=5)
    if not wreck:
        top_seam(bvh, [(-0.74, 1.05), (0.74, 1.05)])
        for sx in (-1, 1):
            top_seam(bvh, [(sx * 0.74, 1.05), (sx * 0.74, 2.28)])
    top_seam(bvh, [(-0.74, -1.43), (0.74, -1.43)])
    for sx in (-1, 1):
        top_seam(bvh, [(sx * 0.74, -1.43), (sx * 0.74, -2.3)])
    front_seam(bvh, [(-0.7, 0.92), (-0.72, 0.62), (0.72, 0.62), (0.7, 0.92)], front=-1)
    side_seam(bvh, [(-0.95, 0.38), (1.08, 0.38)], n=12)
    handle(bvh, 0.32, 0.86)
    handle(bvh, -0.82, 0.86)
    # front fascia
    if not wreck:
        on_front(bvh, "headlamp", (0.36, 0.1, 0.13), 0.6, 0.71)
        on_front(bvh, "amber_lamp", (0.08, 0.1, 0.1), 0.83, 0.68, sink=0.03)
    else:
        on_front(bvh, "headlamp", (0.36, 0.1, 0.13), -0.6, 0.71, mirror=False)
        on_front(bvh, "amber_lamp", (0.08, 0.1, 0.1), -0.83, 0.68, sink=0.03, mirror=False)
    sg = front_s(bvh, 0, 0.7, 1, 2.4)
    grille(0.36, 0.62, 0.78, sg + 0.01, slats=4, frame="chrome" if not police else "trim_black")
    if police:
        rbox("chrome", (0.74, 0.02, 0.02), (0, sg + 0.04, 0.7), bevel=0.006)
    bump = rbox("trim_black", (1.82, 0.17, 0.24), (0, 2.37, 0.42), bevel=0.07, seg=3)
    rbox("trim_black", (1.1, 0.04, 0.09), (0, 2.46, 0.4), bevel=0.02)
    rbox("paint_white", (0.5, 0.012, 0.11), (0, 2.465, 0.55), bevel=0.004)
    for sx in (-1, 1):
        cyl("headlamp", 0.04, 0.02, (sx * 0.66, 2.455, 0.4), axis="y", seg=12)
    # rear
    on_front(bvh, "taillamp", (0.38, 0.08, 0.16), 0.64, 0.85, front=-1)
    on_front(bvh, "reverse_lamp", (0.1, 0.08, 0.07), 0.38, 0.84, front=-1, sink=0.02)
    on_front(bvh, "amber_lamp", (0.12, 0.08, 0.05), 0.72, 0.75, front=-1, sink=0.02)
    rbox("trim_black", (1.84, 0.16, 0.22), (0, -2.37, 0.44), bevel=0.07, seg=3)
    rbox("paint_white", (0.5, 0.012, 0.11), (0, -2.405, 0.72), bevel=0.004)
    cyl("chrome", 0.035, 0.12, (0.55, -2.39, 0.3), axis="y", seg=10)
    # mirrors, interior, underside
    mirror_pair(1.0, 1.0, 0.88, size=(0.18, 0.08, 0.12))
    interior_cab(0.8, -0.05, 0.8, 0.98, rows=2)
    rbox("trim_black", (1.5, 4.0, 0.08), (0, 0.0, 0.26), bevel=0.02)
    return body, bvh, green, gbvh, bump


def build_cruiser():
    body, bvh, green, gbvh, _ = sedan()
    light_bar(1.3, -0.15, top_z(gbvh, 0, -0.15, 1.45) - 0.01, ["red", "red", "white", "white", "blue", "blue"])
    for sx in (-1, 1):
        rbox("trim_black", (0.06, 0.06, 0.55), (sx * 0.34, 2.5, 0.58), bevel=0.012)
        rbox("trim_black", (0.07, 0.12, 0.06), (sx * 0.34, 2.44, 0.36), bevel=0.012)
    for h in (0.5, 0.78):
        rbox("trim_black", (0.78, 0.06, 0.07), (0, 2.52, h), bevel=0.018)
    for sx in (-1, 1):
        rbox("rubber", (0.12, 0.04, 0.42), (sx * 0.34, 2.535, 0.6), bevel=0.012)
    cyl("chrome", 0.06, 0.12, (0.9, 1.0, 1.04), axis="y", seg=14)
    rbox("chrome", (0.03, 0.08, 0.03), (0.86, 1.04, 1.02), bevel=0.008)
    cyl("trim_black", 0.004, 0.7, (-0.3, -1.9, 1.33), seg=6)
    cyl("trim_black", 0.012, 0.03, (-0.3, -1.9, 0.99), seg=8)
    return wheels([1.45, -1.45], 0.36, 0.245, 1.60, spokes=6)


def build_wreck():
    body, bvh, green, gbvh, bump = sedan(paint="paint_wreck", door="paint_wreck", roofp="paint_wreck", police=False, wreck=True)
    bump.location = (0.1, 2.15, 0.36)
    bump.rotation_euler = (0.1, -0.16, 0.12)
    # crumpled hood, buckled and sprung open at the front
    hood, hbvh = gbox(((-0.78, 0.78), (1.05, 2.05), (0.0, 0.035)), 0.012, default="paint_wreck", cuts=((-0.4, 0, 0.4), (1.3, 1.55, 1.8), ()))

    def crumple(v):
        t = (v.y - 1.05) / 1.0
        v.z += 0.13 * math.sin(PI * min(1, t * 1.3)) * (1 - 0.6 * abs(v.x)) + 0.03 * math.sin(v.x * 9 + v.y * 7)
        v.z += 0.06 * max(0.0, v.x) * t
        return v
    for vtx in hood.data.vertices:
        vtx.co = crumple(vtx.co.copy())
    hood.location = (0.02, 0.0, 0.9)
    hood.rotation_euler = (0.2, 0.05, -0.04)
    for p in ((0.1, 1.5, 0.9), (-0.2, 1.62, 0.9)):
        cyl("steel", 0.12, 0.25, p, seg=12)
    rbox("trim_black", (1.1, 0.3, 0.3), (0, 1.6, 0.75), bevel=0.04)
    for a in range(5):
        t = a / 5 * 2 * PI
        sweep("paint_white", [(0.15, 0.62, 1.2), (0.15 + 0.35 * math.cos(t), 0.62 - 0.1 * math.sin(t), 1.2 + 0.18 * math.sin(t))], 0.003, seg=4)
    on_front(bvh, "amber_lamp", (0.08, 0.1, 0.1), 0.83, 0.68, sink=0.03, mirror=False)
    bake = {(0, "L"): Matrix.Translation((-0.05, 0, -0.03)) @ Matrix.Rotation(0.38, 4, "Z") @ Matrix.Rotation(0.22, 4, "Y")}
    return wheels([1.45, -1.45], 0.36, 0.245, 1.60, spokes=5, bake=bake)


def crush_front(objs, s0=1.3):
    for o in objs:
        me = o.data
        for v in me.vertices:
            p = o.matrix_world @ v.co
            if p.y > s0:
                t = (p.y - s0) / 1.15
                p.y = s0 + (p.y - s0) * (0.68 - 0.12 * max(0.0, p.x))
                amp = 0.04 * t
                p.x += amp * math.sin(p.z * 23 + p.y * 11) - (0.06 * t if p.x > 0.5 else 0)
                p.z += amp * math.sin(p.x * 19 + p.y * 13) - 0.04 * t * (p.z > 0.6)
                v.co = o.matrix_world.inverted() @ p


def build_delivery():
    def low_mat(s, lab, u, c, n):
        return None
    lower = [
        K(-1.95, 0.77, 0.72, 0.33, 0.88, 0.08, 0.08),
        K(-1.89, 0.835, 0.79, 0.28, 0.94, 0.09, 0.10),
        K(-1.5, 0.85, 0.80, 0.26, 0.955, 0.10, 0.10, 0.012),
        K(0.0, 0.85, 0.80, 0.25, 0.93, 0.10, 0.10, 0.014),
        K(0.95, 0.845, 0.79, 0.26, 0.88, 0.10, 0.10, 0.012),
        K(1.5, 0.835, 0.77, 0.27, 0.80, 0.10, 0.11, 0.0, 0.01),
        K(1.86, 0.81, 0.72, 0.29, 0.74, 0.09, 0.10),
        K(1.95, 0.74, 0.62, 0.34, 0.66, 0.07, 0.07),
    ]
    body, bvh = loft(lower, low_mat, default="paint_yellow", forced=(0.92, -0.02, -0.86, 0.95))

    def gh_mat(s, lab, u, c, n):
        if lab == "top":
            return "glass" if (s > 0.32 or s < -1.62) else "paint_yellow"
        if lab == "side" and c.z > 0.95 and -1.62 < s < 0.92 and not (-0.07 < s < 0.06) and not (-1.24 < s < -1.12):
            return "glass"
        if lab == "side" and c.z <= 0.95:
            return "trim_black"
        return None
    gh = [
        K(0.98, 0.78, 0.70, 0.85, 0.88, 0.02, 0.02),
        K(0.85, 0.78, 0.69, 0.85, 0.99, 0.02, 0.06),
        K(0.32, 0.77, 0.62, 0.85, 1.51, 0.02, 0.11, 0.0, 0.015),
        K(-1.0, 0.77, 0.62, 0.85, 1.52, 0.02, 0.11, 0.0, 0.015),
        K(-1.62, 0.77, 0.63, 0.85, 1.47, 0.02, 0.10, 0.0, 0.01),
        K(-1.82, 0.78, 0.68, 0.85, 1.12, 0.02, 0.06),
        K(-1.88, 0.78, 0.70, 0.85, 0.92, 0.02, 0.02),
    ]
    green, gbvh = loft(gh, gh_mat, default="paint_yellow", forced=(0.32, -1.62, 0.06, -0.07, 0.92, -1.12, -1.24), ds=0.08)
    cut_arches(body, [((1.25,), 0.37, 0.32), ((-1.25,), 0.37, 0.32)], 0.55)
    vseam(bvh, 0.92, 0.36, 0.9)
    vseam(bvh, -0.02, 0.3, 0.92)
    side_seam(bvh, [(-0.86, 0.94), (-0.85, 0.62), (-0.82, 0.4)], n=4)
    top_seam(bvh, [(-0.7, 0.95), (0.7, 0.95)])
    for sx in (-1, 1):
        top_seam(bvh, [(sx * 0.7, 0.95), (sx * 0.7, 1.84)])
    front_seam(bvh, [(-0.68, 0.94), (-0.7, 0.5), (0.7, 0.5), (0.68, 0.94)], front=-1)
    handle(bvh, 0.28, 0.83)
    handle(bvh, -0.7, 0.85)
    on_front(bvh, "headlamp", (0.3, 0.1, 0.12), 0.58, 0.66)
    on_front(bvh, "amber_lamp", (0.07, 0.1, 0.08), 0.76, 0.63, sink=0.03)
    sg = front_s(bvh, 0, 0.6, 1, 1.95)
    grille(0.3, 0.55, 0.66, sg + 0.005, slats=3, frame="trim_black")
    rbox("trim_black", (1.72, 0.16, 0.22), (0, 1.88, 0.4), bevel=0.07, seg=3)
    rbox("trim_black", (0.9, 0.04, 0.08), (0, 1.96, 0.38), bevel=0.02)
    on_front(bvh, "taillamp", (0.14, 0.08, 0.3), 0.72, 0.82, front=-1)
    on_front(bvh, "reverse_lamp", (0.1, 0.07, 0.07), 0.72, 0.62, front=-1, sink=0.02)
    rbox("trim_black", (1.72, 0.15, 0.22), (0, -1.88, 0.42), bevel=0.07, seg=3)
    rbox("paint_white", (0.46, 0.012, 0.11), (0, -1.94, 0.7), bevel=0.004)
    front_seam(bvh, [(-0.6, 0.55), (-0.62, 0.95), (0.62, 0.95), (0.6, 0.55)], front=-1)
    mirror_pair(0.86, 0.96, 0.83, size=(0.16, 0.07, 0.11))
    interior_cab(0.7, -0.05, 0.75, 0.95, rows=2)
    rbox("trim_black", (1.4, 3.2, 0.06), (0, 0.0, 0.25), bevel=0.02)
    # roof topper sign
    rz = top_z(gbvh, 0, -0.3, 1.52)
    for sx in (-1, 1):
        rbox("trim_black", (0.05, 0.9, 0.04), (sx * 0.4, -0.3, rz + 0.01), bevel=0.012)
    sign, _ = gbox(((-0.46, 0.46), (-0.47, -0.13), (rz + 0.04, rz + 0.42)), 0.04, default="paint_red",
                   deform=lambda v: Vector((v.x, -0.3 + (v.y + 0.3) * (1 - 0.55 * (v.z - rz - 0.04) / 0.38), v.z)))
    for d in (1, -1):
        y = -0.3 + d * 0.105
        cyl("paint_yellow", 0.12, 0.012, (0, y, rz + 0.23), axis="y", seg=24, rot=(d * 0.42, 0, 0))
    rbox("trim_black", (0.94, 0.07, 0.03), (0, -0.3, rz + 0.425), bevel=0.01)
    return wheels([1.25, -1.25], 0.32, 0.195, 1.48, spokes=5, seg=28)


def build_pickup(lawn=False):
    paint = "paint_green" if lawn else "paint_white"
    belt, roof, z0 = 1.33, 1.95, 0.55
    hw = 1.0
    cab_regions = [
        R("glass", "+y", x=(-0.86, 0.86), z=(belt + 0.07, roof - 0.08)),
        R("glass", "-y", x=(-0.66, 0.66), z=(belt + 0.1, roof - 0.12)),
        R("glass", "x", y=(0.86, 1.94), z=(belt + 0.05, roof - 0.09)),
        R("glass", "x", y=(-0.5, 0.7), z=(belt + 0.05, roof - 0.09)),
        R("trim_black", "x", y=(0.7, 0.86), z=(belt + 0.05, roof - 0.09)),
    ]
    cab, cbvh = gbox(((-hw, hw), (-0.62, 2.0), (z0, roof)), 0.1, cab_regions, default=paint,
                     deform=chain(rake(2.0, belt, 0.95, 0.4), tumble(belt, roof, 0.07), crown(roof, 0.03, hw)))
    hood, hbvh = gbox(((-0.995, 0.995), (1.97, 3.93), (z0 - 0.02, belt)), 0.11, default=paint,
                      deform=chain(slope_top(belt, 2.0, 3.93, 0.1), nose(3.93, 0.4, 1.25, 0.06), crown(belt, 0.025, 1.0, 0.2)),
                      cuts=((), (2.2, 2.6, 3.0, 3.4), ()))
    cut_arches(hood, [((2.8,), 0.48, 0.40)], 0.55)
    arch_trim(hbvh, (2.8,), 0.49, 0.40, r=0.035)
    # bed: outer shell minus the tub
    bed, bbvh = gbox(((-hw, hw), (-2.1, -0.66), (0.62, belt)), 0.06, default=paint)
    tub = bmesh.new()
    bmesh.ops.create_cube(tub, size=1.0)
    bmesh.ops.scale(tub, vec=(1.82, 1.28, 1.2), verts=tub.verts)
    bmesh.ops.translate(tub, vec=(0, -1.38, 0.9 + 0.6), verts=tub.verts)
    boolean(bed, tub, "rubber")
    cut_arches(bed, [((-1.1,), 0.48, 0.40)], 0.55)
    arch_trim(bbvh, (-1.1,), 0.49, 0.40, r=0.035)
    for sx in (-1, 1):
        rbox("trim_black", (0.12, 1.44, 0.03), (sx * 0.95, -1.38, belt + 0.012), bevel=0.01)
    rbox("trim_black", (2.0, 0.1, 0.03), (0, -0.7, belt + 0.012), bevel=0.01)
    # seams and handles
    vseam(cbvh, 1.93, 0.6, belt + 0.02)
    vseam(cbvh, 0.78, 0.6, belt + 0.02)
    vseam(cbvh, -0.55, 0.62, belt + 0.02)
    handle(cbvh, 1.05, belt - 0.12, material="chrome")
    handle(cbvh, -0.3, belt - 0.12, material="chrome")
    top_seam(hbvh, [(-0.86, 2.1), (0.86, 2.1)])
    for sx in (-1, 1):
        top_seam(hbvh, [(sx * 0.86, 2.1), (sx * 0.86, 3.85)])
    front_seam(bbvh, [(-0.92, 0.66), (-0.92, belt - 0.03), (0.92, belt - 0.03), (0.92, 0.66)], front=-1)
    rbox("chrome", (0.3, 0.03, 0.05), (0, -2.11, 1.18), bevel=0.01)
    # front end
    sg = front_s(hbvh, 0, 0.95, 1, 3.93)
    grille(0.62, 0.72, 1.18, sg + 0.02, slats=5, frame="chrome" if not lawn else "trim_black")
    for sx in (-1, 1):
        rbox("headlamp", (0.3, 0.08, 0.18), (sx * 0.82, front_s(hbvh, sx * 0.82, 1.06, 1, 3.9) + 0.02, 1.06), bevel=0.02)
        rbox("amber_lamp", (0.1, 0.08, 0.18), (sx * 0.955, front_s(hbvh, sx * 0.95, 1.06, 1, 3.9) + 0.0, 1.06), bevel=0.02)
    rbox("chrome" if not lawn else "trim_black", (2.0, 0.2, 0.26), (0, 3.85, 0.6), bevel=0.05, seg=3)
    rbox("trim_black", (1.2, 0.06, 0.12), (0, 3.94, 0.6), bevel=0.02)
    for sx in (-1, 1):
        rbox("taillamp", (0.07, 0.06, 0.36), (sx * 0.955, -2.1, 1.12), bevel=0.015)
        rbox("reverse_lamp", (0.07, 0.06, 0.1), (sx * 0.955, -2.1, 0.88), bevel=0.012)
    rbox("chrome", (1.98, 0.2, 0.18), (0, -2.0, 0.5), bevel=0.04, seg=3)
    rbox("trim_black", (0.08, 0.12, 0.08), (0, -2.12, 0.5), bevel=0.01)
    if lawn:
        rbox("steel", (0.06, 0.16, 0.05), (0, -2.18, 0.5), bevel=0.008)
        cyl("chrome", 0.012, 0.04, (0, -2.22, 0.53), seg=10)
        ball("chrome", 0.028, (0, -2.222, 0.575))
        for sx in (-1, 1):
            sweep("steel", [(sx * 0.2, -2.07, 0.44), (sx * 0.22, -2.12, 0.35), (sx * 0.2, -2.15, 0.44)], 0.006, seg=6)
    # running gear
    frame_rails(-2.0, 3.6, 0.48)
    for sx in (-1, 1):
        sweep("steel", [(sx * 0.92, 1.85, 0.44), (sx * 0.97, 1.75, 0.42), (sx * 0.97, -0.45, 0.42), (sx * 0.92, -0.55, 0.44)], 0.035, seg=10)
        for s in (1.4, 0.2):
            rbox("steel", (0.12, 0.04, 0.06), (sx * 0.9, s, 0.46), bevel=0.01)
    mirror_pair(1.82, belt + 0.18, hw, tall=False, size=(0.22, 0.1, 0.26))
    interior_cab(1.75, 1.0, 0.95, belt, rows=2)
    if not lawn:
        light_bar(1.2, 1.15, top_z(cbvh, 0, 1.15, roof) - 0.01, ["amber"] * 6)
    return wheels([2.8, -1.1], 0.40, 0.28, 1.74, spokes=6)


def build_trailer():
    deck_h = 0.52
    s0, s1 = -0.9, -4.3
    hw = 0.95
    for sx in (-1, 1):
        rbox("steel", (0.08, s0 - s1, 0.14), (sx * (hw - 0.04), (s0 + s1) / 2, deck_h - 0.07), bevel=0.008)
    for k in range(6):
        s = s0 - 0.1 - k * (s0 - s1 - 0.2) / 5
        rbox("steel", (hw * 2 - 0.1, 0.06, 0.08), (0, s, deck_h - 0.06), bevel=0.006)
    n = 8
    bw = (hw * 2 - 0.12) / n
    for k in range(n):
        x = -hw + 0.06 + (k + 0.5) * bw
        rbox("deck_wood", (bw - 0.008, s0 - s1 - 0.04, 0.04), (x, (s0 + s1) / 2, deck_h + 0.02), bevel=0.005)
    rail_h = 0.98
    for sx in (-1, 1):
        x = sx * (hw - 0.03)
        rbox("steel", (0.05, s0 - s1, 0.05), (x, (s0 + s1) / 2, rail_h), bevel=0.008)
        rbox("steel", (0.04, s0 - s1, 0.04), (x, (s0 + s1) / 2, (rail_h + deck_h) / 2 + 0.05), bevel=0.006)
        for k in range(7):
            s = s0 - 0.02 - k * (s0 - s1 - 0.04) / 6
            rbox("steel", (0.04, 0.04, rail_h - deck_h), (x, s, (rail_h + deck_h) / 2 + 0.02), bevel=0.006)
    rbox("steel", (hw * 2, 0.05, 0.05), (0, s0, rail_h), bevel=0.008)
    for x in (-0.45, 0.0, 0.45):
        rbox("steel", (0.04, 0.04, rail_h - deck_h), (x, s0, (rail_h + deck_h) / 2 + 0.02), bevel=0.006)
    rbox("steel", (hw * 2 - 0.04, 0.04, 0.04), (0, s0, (rail_h + deck_h) / 2 + 0.05), bevel=0.006)
    # tilted ramp gate
    gate_rot = (0.42, 0, 0)
    gh = 1.15
    cx, cs, cz = 0, s1 - 0.5 * gh * math.sin(gate_rot[0]), deck_h + 0.5 * gh * math.cos(gate_rot[0])
    push()
    rbox("steel", (1.86, 0.05, 0.05), (0, 0, gh / 2 - 0.02))
    rbox("steel", (1.86, 0.06, 0.06), (0, 0, -gh / 2 + 0.03))
    for x in (-0.9, 0.9):
        rbox("steel", (0.05, 0.05, gh), (x, 0, 0))
    for k in range(12):
        z = -gh / 2 + 0.1 + k * (gh - 0.18) / 11
        rbox("steel", (1.78, 0.012, 0.03), (0, 0.0, z), bevel=0.0)
    for x in (-0.45, 0, 0.45):
        rbox("steel", (0.03, 0.02, gh - 0.05), (x, 0.0, 0), bevel=0.0)
    gate = pop()
    for o in gate:
        o.location = Matrix.Rotation(gate_rot[0], 3, "X") @ o.location + Vector((cx, cs, cz))
        o.rotation_euler = gate_rot
        PARTS[-1].append(o)
    cyl("steel", 0.025, 1.9, (0, s1, deck_h + 0.02), axis="x", seg=10)
    # fenders over the wheels
    for sx in (-1, 1):
        plate_arc("steel", sx * 0.955, sx * 1.22, -2.6, 0.30, 0.36, 0.0, PI, thick=0.01, n=14)
        rbox("amber_lamp", (0.03, 0.06, 0.04), (sx * 1.23, -2.6, 0.66), bevel=0.01)
    # tongue
    for sx in (-1, 1):
        sweep("steel", [(0, -0.28, 0.47), (sx * 0.5, -0.65, 0.46), (sx * (hw - 0.05), s0 - 0.05, 0.46)], 0.035, seg=8)
    rbox("steel", (0.08, s0 + 0.35, 0.08), (0, (s0 - 0.35) / 2, 0.46), bevel=0.01)
    rbox("steel", (0.12, 0.32, 0.1), (0, -0.16, 0.5), bevel=0.02)
    ball("steel", 0.05, (0, 0.0, 0.53), scale=(1.2, 1.2, 0.7))
    rbox("steel", (0.04, 0.12, 0.03), (0, -0.12, 0.57), bevel=0.008)
    cyl("steel", 0.04, 0.42, (0.16, -0.55, 0.45), seg=12)
    cyl("steel", 0.025, 0.1, (0.16, -0.55, 0.69), seg=10)
    cyl("rubber", 0.06, 0.05, (0.16, -0.55, 0.07), axis="x", seg=14)
    rbox("steel", (0.04, 0.06, 0.12), (0.16, -0.55, 0.16), bevel=0.008)
    for sx in (-1, 1):
        pts = [(sx * 0.03, -0.3, 0.42)]
        for i in range(1, 6):
            t = i / 5
            pts.append((sx * (0.03 + 0.05 * t), -0.3 + 0.27 * t, 0.42 - 0.12 * math.sin(PI * t)))
        sweep("steel", pts, 0.006, seg=5)
    for sx in (-1, 1):
        rbox("taillamp", (0.12, 0.04, 0.07), (sx * (hw - 0.1), s1 - 0.02, deck_h - 0.06), bevel=0.012)
        rbox("amber_lamp", (0.03, 0.06, 0.04), (sx * hw, s0 - 0.05, deck_h - 0.06), bevel=0.01)
    cyl("steel", 0.035, 2.0, (0, -2.6, 0.30), axis="x", seg=10)
    for sx in (-1, 1):
        rbox("steel", (0.06, 1.1, 0.04), (sx * 0.8, -2.6, 0.38), bevel=0.008)
    # walk-behind mower
    mx, ms = -0.38, -2.3
    push()
    deck, _ = gbox(((-0.36, 0.36), (-0.42, 0.36), (0.0, 0.16)), 0.05, default="paint_red",
                   deform=crown(0.16, 0.03, 0.36, 0.08))
    rbox("trim_black", (0.32, 0.3, 0.24), (0.0, 0.0, 0.28), bevel=0.04)
    cyl("trim_black", 0.1, 0.06, (0.0, 0.0, 0.43), seg=16)
    cyl("steel", 0.05, 0.1, (0.12, 0.1, 0.36), axis="x", seg=12)
    rbox("paint_red", (0.18, 0.12, 0.08), (-0.08, 0.12, 0.42), bevel=0.02)
    for sx in (-1, 1):
        cyl("rubber", 0.09, 0.06, (sx * 0.36, 0.25, 0.04), axis="x", seg=14)
        cyl("rubber", 0.12, 0.07, (sx * 0.36, -0.36, 0.07), axis="x", seg=16)
        sweep("trim_black", [(sx * 0.2, -0.38, 0.18), (sx * 0.24, -0.62, 0.55), (sx * 0.25, -0.8, 0.85)], 0.016, seg=8)
    sweep("rubber", [(-0.25, -0.8, 0.85), (0.25, -0.8, 0.85)], 0.02, seg=8)
    sweep("steel", [(-0.22, -0.74, 0.8), (0.0, -0.7, 0.78), (0.22, -0.74, 0.8)], 0.008, seg=6)
    rbox("trim_black", (0.4, 0.34, 0.28), (0.0, -0.62, 0.2), rot=(0.25, 0, 0), bevel=0.04)
    mower = pop()
    for o in mower:
        o.location += Vector((mx, ms, deck_h + 0.07))
        PARTS[-1].append(o)
    # tool bin with handles
    bx, bs = 0.45, -1.35
    tubb, _ = gbox(((bx - 0.33, bx + 0.33), (bs - 0.25, bs + 0.25), (deck_h + 0.04, deck_h + 0.42)), 0.04, default="paint_cityorange")
    inner = bmesh.new()
    bmesh.ops.create_cube(inner, size=1.0)
    bmesh.ops.scale(inner, vec=(0.6, 0.44, 0.6), verts=inner.verts)
    bmesh.ops.translate(inner, vec=(bx, bs, deck_h + 0.4), verts=inner.verts)
    boolean(tubb, inner, "trim_black")
    for k, (dx, ds, lean) in enumerate(((-0.15, -0.08, 0.18), (0.0, 0.06, -0.12), (0.14, -0.05, 0.25), (0.08, 0.1, -0.3))):
        base = Vector((bx + dx, bs + ds, deck_h + 0.12))
        top = base + Vector((math.sin(lean) * 0.3, -0.2, 1.05))
        sweep("deck_wood", [base, top], 0.014, seg=6)
        if k == 0:
            rbox("steel", (0.18, 0.02, 0.22), (top.x, top.y, top.z + 0.06), rot=(0.2, 0, 0), bevel=0.0)
        elif k == 2:
            rbox("steel", (0.36, 0.03, 0.03), (top.x, top.y, top.z + 0.02), bevel=0.0)
            for t in range(9):
                cyl("steel", 0.004, 0.08, (top.x - 0.16 + t * 0.04, top.y, top.z - 0.02), seg=4)
    gc, _ = gbox(((-0.62, -0.4), (-1.22, -1.02), (deck_h + 0.04, deck_h + 0.36)), 0.03, default="paint_red")
    sweep("trim_black", [(-0.51, -1.2, deck_h + 0.36), (-0.51, -1.12, deck_h + 0.44), (-0.51, -1.04, deck_h + 0.36)], 0.012, seg=6)
    return wheels([-2.6], 0.30, 0.2, 2.1, style="steel", seg=24, steer_cap=False)


def cabover(s_back, s_front, hw, z0, belt, roof, paint, front_door, rear_door=None, rake_k=0.12, r=0.15, stripe=None):
    regs = [
        R("glass", "+y", x=(-hw + 0.13, hw - 0.13), z=(belt + 0.06, roof - 0.16)),
        R("glass", "x", y=front_door[0], z=(belt + 0.05, roof - 0.18)),
    ]
    if rear_door:
        regs.append(R("glass", "x", y=rear_door[0], z=(belt + 0.05, roof - 0.18)))
    if stripe:
        regs.append(R(stripe[0], None, z=stripe[1]))
    cab, bvh = gbox(((-hw, hw), (s_back, s_front), (z0, roof)), r, regs, default=paint,
                    deform=chain(rake(s_front, belt, rake_k, s_front - 1.2), tumble(belt, roof, 0.04), crown(roof, 0.04, hw)))
    return cab, bvh


def build_engine():
    hw, belt, roof = 1.25, 1.78, 2.95
    cab, cbvh = cabover(2.35, 5.0, hw, 0.62, belt, roof, "paint_red", ((3.95, 4.78),), ((2.55, 3.8),),
                        stripe=("paint_white", (1.5, 1.6)))
    body, bbvh = gbox(((-hw, hw), (-3.95, 2.34), (0.78, 2.95)), 0.08, [R("paint_white", "x", z=(0.84, 0.92))], default="paint_red",
                      cuts=((), (-1.2,), ()))
    hose = bmesh.new()
    bmesh.ops.create_cube(hose, size=1.0)
    bmesh.ops.scale(hose, vec=(2.2, 2.6, 1.0), verts=hose.verts)
    bmesh.ops.translate(hose, vec=(0, -2.6, 2.95 + 0.25), verts=hose.verts)
    boolean(body, hose, "steel")
    cut_arches(cab, [((3.8,), 0.6, 0.52)], 0.75)
    cut_arches(body, [((-2.2, -3.4), 0.6, 0.52)], 0.7)
    arch_trim(cbvh, (3.8,), 0.61, 0.52, r=0.03, material="chrome")
    arch_trim(bbvh, (-2.2, -3.4), 0.61, 0.52, r=0.03, material="chrome")
    for k in range(5):
        rbox("paint_yellow", (2.1, 0.5, 0.11), (0, -2.6 + (k - 2) * 0.01, 2.5 + k * 0.105), bevel=0.05, seg=2)
    rbox("paint_yellow", (2.1, 2.3, 0.4), (0, -2.65, 2.62), bevel=0.06, seg=2)
    # cab details
    vseam(cbvh, 4.85, 1.18, roof - 0.12)
    vseam(cbvh, 3.88, 1.18, roof - 0.12)
    vseam(cbvh, 3.82, 0.66, roof - 0.12)
    vseam(cbvh, 2.48, 0.66, roof - 0.12)
    side_seam(cbvh, [(3.88, 1.18), (4.85, 1.18)], n=8)
    handle(cbvh, 4.0, 1.66, material="chrome")
    handle(cbvh, 2.62, 1.66, material="chrome")
    for sx in (-1, 1):
        for s0, s1, h in ((3.95, 4.75, 0.98), (3.95, 4.75, 0.7), (2.55, 3.75, 0.5)):
            rbox("steel", (0.22, s1 - s0, 0.04), (sx * (hw - 0.1), (s0 + s1) / 2, h), bevel=0.01)
        rbox("chrome", (0.03, 0.03, 0.9), (sx * (hw + 0.02), 4.9, 1.75), bevel=0.01)
    sg = front_s(cbvh, 0, 1.3, 1, 5.0)
    grille(0.6, 0.98, 1.6, sg + 0.015, slats=7)
    for sx in (-1, 1):
        for dx in (0.78, 1.0):
            rbox("headlamp", (0.18, 0.06, 0.16), (sx * dx, sg + 0.01, 1.18), bevel=0.02)
        rbox("amber_lamp", (0.4, 0.06, 0.08), (sx * 0.89, sg + 0.01, 1.0), bevel=0.015)
        rbox("bar_red" if False else "taillamp", (0.16, 0.06, 0.16), (sx * 0.89, sg + 0.01, 1.48), bevel=0.02)
    rbox("chrome", (2.5, 0.25, 0.32), (0, 5.02, 0.72), bevel=0.06, seg=3)
    rbox("trim_black", (2.0, 0.04, 0.08), (0, 5.15, 0.72), bevel=0.01)
    mirror_pair(4.75, 2.0, hw, tall=True, chrome_arm=True)
    interior_cab(4.75, 4.15, 1.15, belt, rows=2)
    light_bar(2.0, 4.6, top_z(cbvh, 0, 4.6, roof) - 0.01, ["red", "white", "red", "red", "white", "red", "red", "white"][:8])
    # apparatus body
    for sx in (-1, 1):
        x = sx * hw
        ribbed(x, sx, 1.65, 2.25, 0.95, 2.3, material="chrome")
        for k in range(4):
            cyl("chrome", 0.05, 0.03, (x + sx * 0.03, 1.8 + (k % 2) * 0.3, 2.5 + (k // 2) * 0.18), axis="x", seg=12)
        cyl("chrome", 0.07, 0.25, (x + sx * 0.1, 1.95, 1.2), axis="x", seg=12)
        ribbed(x, sx, 0.1, 1.5, 0.95, 2.3)
        ribbed(x, sx, -1.55, -0.05, 0.95, 2.3)
        ribbed(x, sx, -3.85, -1.7, 1.25, 2.3)
        rbox("chrome", (0.03, 6.25, 0.03), (x + sx * 0.012, -0.8, 2.36), bevel=0.008)
        sweep("chrome", [(x + sx * 0.02, -3.92, 1.0), (x + sx * 0.06, -3.92, 1.05), (x + sx * 0.06, -3.92, 2.2), (x + sx * 0.02, -3.92, 2.25)], 0.016, seg=8)
    on_front(bbvh, "taillamp", (0.18, 0.06, 0.3), 1.0, 1.3, front=-1)
    on_front(bbvh, "amber_lamp", (0.18, 0.06, 0.14), 1.0, 1.65, front=-1)
    on_front(bbvh, "reverse_lamp", (0.18, 0.06, 0.12), 1.0, 1.05, front=-1)
    rbox("steel", (2.4, 0.3, 0.08), (0, -4.1, 0.75), bevel=0.02)
    rbox("trim_black", (2.4, 0.12, 0.25), (0, -4.1, 0.6), bevel=0.02)
    rbox("steel", (1.9, 0.02, 1.3), (0, -3.96, 1.65), bevel=0.0)
    vladder(-0.8, -3.99, 0.9, 2.95, width=0.36)
    frame_rails(-4.0, 4.8, 0.62, xw=0.5, hh=0.24)
    # ladder rack and ladders on top
    for s in (-3.4, -1.1, 1.2):
        for sx in (-1, 1):
            rbox("steel", (0.05, 0.05, 0.12), (sx * 0.45, s, 3.01), bevel=0.008)
        rbox("steel", (1.0, 0.06, 0.04), (0, s, 3.07), bevel=0.008)
    ladder(0, -3.75, 2.2, 3.12, width=0.62)
    ladder(0, -3.55, 2.0, 3.21, width=0.5)
    cyl("chrome", 0.17, 0.5, (0.0, 2.1, 3.06), axis="x", seg=16)
    return wheels([3.8, -2.2, -3.4], 0.52, 0.32, 2.0, style="steel", duals=(1, 2), seg=24)


def build_ambulance():
    belt, roof = 1.38, 2.3
    cab_regs = [
        R("glass", "+y", x=(-0.92, 0.92), z=(belt + 0.06, roof - 0.1)),
        R("glass", "x", y=(1.65, 2.82), z=(belt + 0.05, roof - 0.12)),
    ]
    cab, cbvh = gbox(((-1.05, 1.05), (1.55, 2.95), (0.55, roof)), 0.13, cab_regs, default="paint_white",
                     deform=chain(rake(2.95, belt, 0.7, 1.9), tumble(belt, roof, 0.06), crown(roof, 0.03, 1.05)))
    hood, hbvh = gbox(((-1.02, 1.02), (2.9, 3.83), (0.5, belt)), 0.14, default="paint_white",
                      deform=chain(slope_top(belt, 2.95, 3.83, 0.2), nose(3.83, 0.4, 1.2, 0.12)))
    cut_arches(cab, [((2.8,), 0.5, 0.42)], 0.6)
    cut_arches(hood, [((2.8,), 0.5, 0.42)], 0.6)
    box_regs = [
        R("paint_red", None, z=(1.12, 1.36)),
        R("glass", "-y", x=(-0.88, -0.22), z=(1.7, 2.25)),
        R("glass", "-y", x=(0.22, 0.88), z=(1.7, 2.25)),
        R("glass", "x", y=(0.8, 1.3), z=(1.95, 2.45)),
    ]
    box, xbvh = gbox(((-1.15, 1.15), (-2.72, 1.6), (0.72, 2.85)), 0.1, box_regs, default="paint_white", cuts=((-0.03, 0.03), (), ()))
    cut_arches(box, [((-1.6,), 0.5, 0.42)], 0.6)
    arch_trim(xbvh, (-1.6,), 0.51, 0.42, r=0.03)
    arch_trim(cbvh, (2.8,), 0.51, 0.42, r=0.03)
    arch_trim(hbvh, (2.8,), 0.51, 0.42, r=0.03)
    # seams: cab doors, box doors and compartments
    vseam(cbvh, 2.85, 0.92, belt + 0.02)
    vseam(cbvh, 1.6, 0.6, belt + 0.02)
    handle(cbvh, 1.75, belt - 0.12, material="chrome")
    front_seam(xbvh, [(0, 0.8), (0, 2.6)], front=-1)
    front_seam(xbvh, [(-0.98, 0.8), (-0.98, 2.6), (0.98, 2.6), (0.98, 0.8)], front=-1)
    for sx in (-1, 1):
        rbox("chrome", (0.18, 0.04, 0.035), (sx * 0.2, -2.75, 1.5), bevel=0.012)
    side_seam(xbvh, [(0.25, 0.85), (0.25, 2.6), (1.35, 2.6), (1.35, 0.85)], sides=(-1,), n=8)
    handle(xbvh, 0.4, 1.55, sides=(-1,), material="chrome")
    side_seam(xbvh, [(0.6, 0.85), (0.6, 2.0), (1.4, 2.0), (1.4, 0.85)], sides=(1,), n=8)
    side_seam(xbvh, [(-0.95, 1.0), (-0.95, 2.0), (-0.1, 2.0), (-0.1, 1.0)], sides=(1,), n=8)
    handle(xbvh, 1.0, 1.5, sides=(1,), material="chrome")
    handle(xbvh, -0.52, 1.5, sides=(1,), material="chrome")
    for sx in (-1, 1):
        rbox("chrome", (0.04, 0.04, 0.7), (sx * 1.18, -2.6, 1.7), bevel=0.012)
    # front end
    sg = front_s(hbvh, 0, 0.9, 1, 3.83)
    grille(0.5, 0.72, 1.08, sg + 0.015, slats=4)
    for sx in (-1, 1):
        rbox("headlamp", (0.32, 0.08, 0.16), (sx * 0.75, front_s(hbvh, sx * 0.75, 1.0, 1, 3.8) + 0.02, 1.0), bevel=0.02)
        rbox("amber_lamp", (0.1, 0.06, 0.08), (sx * 0.95, front_s(hbvh, sx * 0.9, 0.95, 1, 3.8) + 0.0, 0.95), bevel=0.015)
    rbox("trim_black", (2.08, 0.18, 0.26), (0, 3.76, 0.58), bevel=0.06, seg=3)
    # rear
    for sx in (-1, 1):
        rbox("taillamp", (0.16, 0.06, 0.32), (sx * 0.98, -2.73, 1.0), bevel=0.02)
        rbox("amber_lamp", (0.16, 0.06, 0.12), (sx * 0.98, -2.73, 1.3) if False else (sx * 0.98, -2.73, 0.78), bevel=0.015)
        rbox("reverse_lamp", (0.14, 0.06, 0.1), (sx * 0.98, -2.73, 2.62), bevel=0.015)
    rbox("steel", (2.2, 0.3, 0.1), (0, -2.6, 0.62), bevel=0.02)
    rbox("trim_black", (2.2, 0.1, 0.18), (0, -2.66, 0.52), bevel=0.02)
    frame_rails(-2.6, 3.5, 0.55)
    mirror_pair(2.75, 1.65, 1.05, tall=True)
    interior_cab(2.75, 2.1, 0.95, belt, rows=1)
    light_bar(1.6, 2.35, top_z(cbvh, 0, 2.35, roof) - 0.01, ["red", "blue", "white", "white", "blue", "red"])
    light_bar(1.9, 1.62, 2.68, ["red", "white", "white", "red"], face_front=True)
    light_bar(1.9, -2.745, 2.68, ["red", "amber", "red"], face_front=True)
    for sx in (-1, 1):
        rbox("bar_red" if False else "taillamp", (0.04, 0.2, 0.12), (sx * 1.16, 1.4, 2.62), bevel=0.012)
        rbox("taillamp", (0.04, 0.2, 0.12), (sx * 1.16, -2.5, 2.62), bevel=0.012)
    return wheels([2.8, -1.6], 0.42, 0.24, 1.80, style="steel", duals=(1,), seg=24)


def build_garbage():
    hw, belt, roof = 1.25, 1.62, 2.75
    cab, cbvh = cabover(2.55, 4.75, 1.22, 0.65, belt, roof, "paint_white", ((3.3, 4.6),), rake_k=0.1)
    cut_arches(cab, [((3.6,), 0.6, 0.52)], 0.72)
    arch_trim(cbvh, (3.6,), 0.61, 0.52, r=0.032)
    regs = [R("paint_white", "x", z=(0.96, 1.08))]
    body, bbvh = gbox(((-hw, hw), (-4.3, 2.5), (0.95, 3.18)), 0.2, regs, default="paint_green", deform=crown(3.18, 0.12, hw, 0.45))
    cut_arches(body, [((-2.4, -3.6), 0.6, 0.52)], 0.72)
    # tailgate with hopper
    def tg(v):
        if v.y < -4.6:
            v.y += (v.z - 0.75) * 0.22
        return v
    tail, tbvh = gbox(((-1.2, 1.2), (-5.42, -4.28), (0.72, 3.22)), 0.18,
                      [R("steel", "-y", x=(-1.0, 1.0), z=(0.95, 1.85)), R("paint_yellow", "-y", z=(0.72, 0.9))],
                      default="paint_green", deform=chain(tg, crown(3.22, 0.1, 1.2, 0.4)),
                      insets={"steel": (0.04, 0.45, "interior")})
    arch_trim(bbvh, (-2.4, -3.6), 0.61, 0.52, r=0.032)
    for sx in (-1, 1):
        x = sx * (hw + 0.005)
        for s in (2.25, 1.85, -3.6, -4.05):
            rbox("paint_green", (0.06, 0.08, 2.0), (x, s, 2.05), bevel=0.02)
        rbox("paint_green", (0.06, 6.7, 0.08), (x, -0.9, 3.0), bevel=0.02)
        cyl("chrome", 0.04, 1.3, (sx * 1.15, -4.4, 2.2), seg=10, rot=(0.5, 0, 0))
        cyl("steel", 0.07, 0.7, (sx * 1.15, -4.2, 2.6), seg=12, rot=(0.5, 0, 0))
        cyl("steel", 0.12, 0.2, (sx * 1.1, -4.3, 3.05), axis="x", seg=14)
        rbox("steel", (0.25, 0.3, 0.05), (sx * 1.0, -5.35, 0.62), bevel=0.01)
        sweep("chrome", [(sx * 1.2, -5.25, 1.0), (sx * 1.27, -5.3, 1.05), (sx * 1.27, -5.15, 2.0), (sx * 1.2, -5.1, 2.05)], 0.018, seg=8)
        rbox("taillamp", (0.06, 0.18, 0.3), (sx * 1.18, -5.3, 2.5), bevel=0.015)
        rbox("amber_lamp", (0.06, 0.18, 0.12), (sx * 1.18, -5.24, 2.8), bevel=0.012)
    rbox("paint_yellow", (2.3, 0.14, 0.18), (0, -5.47, 0.8), bevel=0.03)
    for sx in (-1, 1):
        rbox("reverse_lamp", (0.16, 0.05, 0.08), (sx * 0.85, -5.54, 0.8), bevel=0.012)
    vseam(cbvh, 4.6, 1.15, roof - 0.12)
    vseam(cbvh, 3.25, 0.7, roof - 0.12)
    handle(cbvh, 3.45, belt - 0.12, material="chrome")
    for sx in (-1, 1):
        for s0, s1, h in ((3.3, 4.55, 0.95), (3.3, 4.55, 0.68)):
            rbox("steel", (0.22, s1 - s0, 0.04), (sx * 1.12, (s0 + s1) / 2, h), bevel=0.01)
        sweep("chrome", [(sx * 1.24, 3.25, 1.0), (sx * 1.27, 3.22, 1.05), (sx * 1.27, 3.22, 2.2)], 0.016, seg=8)
    sg = front_s(cbvh, 0, 1.25, 1, 4.75)
    grille(0.68, 1.0, 1.5, sg + 0.012, slats=6, frame="trim_black")
    for sx in (-1, 1):
        rbox("headlamp", (0.32, 0.06, 0.16), (sx * 0.9, sg + 0.01, 1.08), bevel=0.02)
        rbox("amber_lamp", (0.14, 0.06, 0.1), (sx * 0.9, sg + 0.01, 1.3), bevel=0.015)
    rbox("steel", (2.44, 0.22, 0.3), (0, 4.74, 0.72), bevel=0.05, seg=3)
    frame_rails(-5.0, 4.6, 0.75, xw=0.5, hh=0.26)
    mirror_pair(4.6, 1.95, 1.22, tall=True)
    interior_cab(4.55, 3.9, 1.12, belt, rows=1)
    light_bar(1.0, 3.9, top_z(cbvh, 0, 3.9, roof) - 0.01, ["amber"] * 4)
    return wheels([3.6, -2.4, -3.6], 0.52, 0.32, 2.0, style="steel", duals=(1, 2), seg=24)


def build_utility():
    belt, roof = 1.48, 2.32
    cab_regs = [
        R("glass", "+y", x=(-0.94, 0.94), z=(belt + 0.06, roof - 0.1)),
        R("glass", "x", y=(1.7, 2.88), z=(belt + 0.05, roof - 0.12)),
        R("glass", "-y", x=(-0.6, 0.6), z=(belt + 0.1, roof - 0.14)),
    ]
    cab, cbvh = gbox(((-1.08, 1.08), (1.6, 3.0), (0.62, roof)), 0.12, cab_regs, default="paint_white",
                     deform=chain(rake(3.0, belt, 0.65, 2.0), tumble(belt, roof, 0.06), crown(roof, 0.03, 1.08)))
    hood, hbvh = gbox(((-1.05, 1.05), (2.95, 4.03), (0.6, belt)), 0.14, default="paint_white",
                      deform=chain(slope_top(belt, 3.0, 4.03, 0.16), nose(4.03, 0.5, 1.3, 0.1)))
    cut_arches(cab, [((2.9,), 0.53, 0.44)], 0.65)
    cut_arches(hood, [((2.9,), 0.53, 0.44)], 0.65)
    arch_trim(cbvh, (2.9,), 0.54, 0.44, r=0.032)
    arch_trim(hbvh, (2.9,), 0.54, 0.44, r=0.032)
    body, bbvh = gbox(((-1.15, 1.15), (-3.25, 1.55), (0.75, 1.62)), 0.05, default="paint_cityorange")
    bed = bmesh.new()
    bmesh.ops.create_cube(bed, size=1.0)
    bmesh.ops.scale(bed, vec=(1.36, 4.6, 1.2), verts=bed.verts)
    bmesh.ops.translate(bed, vec=(0, -0.9, 1.05 + 0.6), verts=bed.verts)
    boolean(body, bed, "steel")
    cut_arches(body, [((-2.0,), 0.53, 0.44)], 0.65)
    arch_trim(bbvh, (-2.0,), 0.54, 0.44, r=0.032)
    for (s0, s1, z0) in ((0.15, 1.45, 0.82), (-1.4, 0.05, 0.82), (-2.6, -1.5, 1.04), (-3.17, -2.7, 0.82)):
        side_seam(bbvh, [(s0, z0), (s0, 1.55), (s1, 1.55), (s1, z0), (s0, z0)], n=6)
        handle(bbvh, (s0 + s1) / 2, 1.42, material="chrome", length=0.12)
    for sx in (-1, 1):
        rbox("chrome", (0.13, 4.8, 0.03), (sx * 0.98, -0.85, 1.635), bevel=0.008)
    vseam(cbvh, 2.92, 0.98, belt + 0.02)
    vseam(cbvh, 1.66, 0.66, belt + 0.02)
    handle(cbvh, 1.8, belt - 0.12, material="chrome")
    sg = front_s(hbvh, 0, 1.0, 1, 4.03)
    grille(0.55, 0.8, 1.2, sg + 0.015, slats=5)
    for sx in (-1, 1):
        rbox("headlamp", (0.32, 0.08, 0.16), (sx * 0.78, front_s(hbvh, sx * 0.78, 1.1, 1, 4.0) + 0.02, 1.1), bevel=0.02)
        rbox("amber_lamp", (0.1, 0.06, 0.08), (sx * 0.97, front_s(hbvh, sx * 0.92, 1.05, 1, 4.0), 1.05), bevel=0.015)
    rbox("trim_black", (2.12, 0.18, 0.26), (0, 3.95, 0.66), bevel=0.06, seg=3)
    for sx in (-1, 1):
        rbox("taillamp", (0.16, 0.06, 0.26), (sx * 0.98, -3.26, 1.2), bevel=0.02)
        rbox("reverse_lamp", (0.16, 0.06, 0.1), (sx * 0.98, -3.26, 0.98), bevel=0.015)
        rbox("steel", (0.12, 0.12, 0.55), (sx * 1.05, -3.05, 0.5), bevel=0.01)
        rbox("steel", (0.25, 0.25, 0.03), (sx * 1.05, -3.05, 0.22), bevel=0.008)
    rbox("trim_black", (2.2, 0.12, 0.18), (0, -3.18, 0.6), bevel=0.02)
    frame_rails(-3.1, 3.8, 0.6)
    mirror_pair(2.8, 1.75, 1.08, tall=True)
    interior_cab(2.8, 2.15, 0.98, belt, rows=1)
    light_bar(1.2, 2.55, top_z(cbvh, 0, 2.55, roof) - 0.01, ["amber"] * 6)
    # pedestal, boom rest
    cyl("paint_white", 0.28, 0.65, (0, -2.6, 1.05 + 0.325), seg=20)
    rbox("steel", (0.12, 0.12, 1.0), (0, 1.48, 1.62 + 0.4), bevel=0.01)
    rbox("rubber", (0.4, 0.2, 0.08), (0, 1.48, 2.48), bevel=0.02)
    for sx in (-1, 1):
        rbox("rubber", (0.06, 0.2, 0.18), (sx * 0.2, 1.48, 2.58), bevel=0.015)
    return wheels([2.9, -2.0], 0.44, 0.24, 1.84, style="steel", duals=(1,), seg=24)


def build_boom():
    """The utility truck's turret and arm, authored in vehicle space; split into boom_base and arm later."""
    push()
    cyl("paint_white", 0.36, 0.2, (0, -2.6, 1.8), seg=24)
    turret, _ = gbox(((-0.3, 0.3), (-2.95, -2.25), (1.88, 2.62)), 0.06, default="paint_white")
    for sx in (-1, 1):
        rbox("paint_white", (0.06, 0.4, 0.4), (sx * 0.24, -2.6, 2.72), bevel=0.02)
    rbox("steel", (0.2, 0.3, 0.3), (0.3, -2.75, 2.1), bevel=0.02)
    base = pop()
    push()
    piv = Vector((0, -2.6, 2.78))
    cyl("chrome", 0.07, 0.56, piv, axis="x", seg=14)
    arm1, _ = gbox(((-0.17, 0.17), (piv.y - 0.25, piv.y + 2.6), (piv.z - 0.17, piv.z + 0.17)), 0.04, default="paint_white")
    arm2, _ = gbox(((-0.13, 0.13), (piv.y + 2.4, piv.y + 4.55), (piv.z - 0.13, piv.z + 0.13)), 0.04, default="paint_yellow")
    cyl("steel", 0.06, 1.4, (0, piv.y + 1.0, piv.z - 0.32), axis="y", seg=10)
    cyl("chrome", 0.035, 0.9, (0, piv.y + 1.9, piv.z - 0.32), axis="y", seg=8)
    rbox("steel", (0.5, 0.18, 0.3), (-0.2, piv.y + 4.55, piv.z), bevel=0.02)
    bk, _ = gbox(((-0.95, -0.25), (piv.y + 4.25, piv.y + 4.95), (piv.z - 0.38, piv.z + 0.42)), 0.06, default="paint_yellow",
                 insets={})
    inner = bmesh.new()
    bmesh.ops.create_cube(inner, size=1.0)
    bmesh.ops.scale(inner, vec=(0.6, 0.6, 0.9), verts=inner.verts)
    bmesh.ops.translate(inner, vec=(-0.6, piv.y + 4.6, piv.z + 0.4), verts=inner.verts)
    boolean(bk, inner, "trim_black")
    rbox("trim_black", (0.74, 0.74, 0.04), (-0.6, piv.y + 4.6, piv.z + 0.43), bevel=0.012)
    arm = pop()
    return base, arm, piv


def build_shuttle():
    hw, top, z0 = 1.15, 2.95, 0.62
    windows = [(-3.35, -2.35), (-2.25, -1.25), (-1.15, -0.15), (-0.05, 0.95), (1.05, 1.85)]
    regs = [R("glass", "+y", x=(-1.0, 1.0), z=(1.45, 2.62)), R("paint_teal", None, z=(z0, 1.28)),
            R("glass", "-y", x=(-0.9, 0.9), z=(1.6, 2.5))]
    for a, b in windows:
        regs.append(R("glass", "x", y=(a, b), z=(1.55, 2.55)))
    regs.append(R("glass", "-x", y=(2.0, 2.7), z=(0.82, 2.55)))
    regs.append(R("glass", "+x", y=(2.0, 2.7), z=(1.55, 2.55)))
    body, bvh = gbox(((-hw, hw), (-3.75, 3.02), (z0, top)), 0.18, regs, default="paint_white",
                     deform=chain(rake(3.02, 1.35, 0.4, 2.0), crown(top, 0.04, hw)))
    hood, hbvh = gbox(((-1.06, 1.06), (2.9, 3.73), (0.58, 1.36)), 0.14, [R("paint_teal", None, z=(0.0, 1.28))], default="paint_white",
                      deform=chain(slope_top(1.36, 3.0, 3.73, 0.16), nose(3.73, 0.4, 1.2, 0.1)))
    cut_arches(body, [((2.5,), 0.52, 0.44), ((-2.3,), 0.52, 0.44)], 0.7)
    cut_arches(hood, [((2.5,), 0.52, 0.44)], 0.7)
    arch_trim(bvh, (-2.3,), 0.53, 0.44, r=0.03)
    arch_trim(bvh, (2.5,), 0.53, 0.44, r=0.03)
    side_seam(bvh, [(1.98, 0.75), (1.98, 2.6)], sides=(-1,), n=8)
    side_seam(bvh, [(2.35, 0.75), (2.35, 2.6)], sides=(-1,), n=8)
    side_seam(bvh, [(2.72, 0.75), (2.72, 2.6)], sides=(-1,), n=8)
    vseam(bvh, 2.85, 0.98, 1.5, sides=(1,))
    handle(bvh, 2.2, 1.45, sides=(1,), material="chrome")
    rbox("paint_white", (1.4, 1.4, 0.24), (0, -0.8, top + 0.14), bevel=0.08, seg=3)
    for k in range(4):
        rbox("trim_black", (1.2, 0.03, 0.02), (0, -1.3 + k * 0.33, top + 0.265), bevel=0.0)
    sg = front_s(hbvh, 0, 0.95, 1, 3.73)
    grille(0.5, 0.75, 1.1, sg + 0.015, slats=4)
    for sx in (-1, 1):
        rbox("headlamp", (0.32, 0.08, 0.16), (sx * 0.75, front_s(hbvh, sx * 0.75, 1.02, 1, 3.7) + 0.02, 1.02), bevel=0.02)
        rbox("amber_lamp", (0.1, 0.06, 0.08), (sx * 0.95, front_s(hbvh, sx * 0.92, 0.98, 1, 3.7), 0.98), bevel=0.015)
        rbox("taillamp", (0.14, 0.06, 0.4), (sx * 0.98, -3.76, 1.05), bevel=0.02)
        rbox("reverse_lamp", (0.14, 0.06, 0.1), (sx * 0.98, -3.76, 0.78), bevel=0.015)
        rbox("amber_lamp", (0.05, 0.1, 0.05), (sx * 1.16, -3.6, 2.85), bevel=0.01)
    rbox("trim_black", (2.12, 0.18, 0.26), (0, 3.65, 0.6), bevel=0.06, seg=3)
    rbox("trim_black", (2.3, 0.16, 0.24), (0, -3.68, 0.58), bevel=0.06, seg=3)
    frame_rails(-3.5, 3.4, 0.55)
    mirror_pair(2.9, 1.7, 1.12, tall=True)
    interior_cab(2.75, 2.1, 1.0, 1.4, rows=1)
    for k in range(5):
        for sx in (-1, 1):
            rbox("interior", (0.8, 0.12, 0.55), (sx * 0.6, 1.4 - k * 1.05, 1.55), bevel=0.04)
    return wheels([2.5, -2.3], 0.44, 0.26, 1.90, style="steel", seg=24)


def build_bus():
    hw, top, z0 = 1.25, 3.15, 0.58
    regs = [R("glass", "+y", x=(-1.12, -0.03), z=(1.5, 2.85)), R("glass", "+y", x=(0.03, 1.12), z=(1.5, 2.85)),
            R("paint_navy", None, z=(1.12, 1.4)), R("glass", "-y", x=(-0.9, 0.9), z=(2.0, 2.75))]
    panes = []
    s = -4.75
    while s + 1.0 < 4.0:
        panes.append((s, s + 1.0))
        s += 1.1
    for a, b in panes:
        regs.append(R("glass", "x", y=(a, b), z=(1.82, 2.62)))
    regs.append(R("glass", "-x", y=(4.15, 4.95), z=(1.82, 2.62)))
    body, bvh = gbox(((-hw, hw), (-5.25, 5.25), (z0, top)), 0.2, regs, default="paint_white",
                     deform=chain(rake(5.25, 1.45, 0.08, 4.4), crown(top, 0.05, hw), nose(5.25, 0.5, 1.0, 0.08)))
    cut_arches(body, [((3.6,), 0.6, 0.5), ((-3.4,), 0.6, 0.5)], 0.72)
    arch_trim(bvh, (3.6,), 0.61, 0.5, r=0.03)
    arch_trim(bvh, (-3.4,), 0.61, 0.5, r=0.03)
    for side in (1, -1):
        x = side_x(bvh, 0, 2.2, side, side * hw)
        for a, b in panes + ([(4.15, 4.95)] if side < 0 else []):
            n = int((b - a) / 0.13)
            for k in range(n + 1):
                cyl("steel", 0.011, 0.84, (x + side * 0.03, a + 0.04 + k * (b - a - 0.08) / n, 2.22), seg=6)
            rbox("steel", (0.03, b - a, 0.03), (x + side * 0.03, (a + b) / 2, 2.62), bevel=0.0)
            rbox("steel", (0.03, b - a, 0.03), (x + side * 0.03, (a + b) / 2, 1.82), bevel=0.0)
    side_seam(bvh, [(4.1, 0.7), (4.1, 2.9), (5.0, 2.9), (5.0, 0.7)], sides=(-1,), n=8)
    vseam(bvh, 4.55, 0.7, 2.9, sides=(-1,))
    front_seam(bvh, [(-0.7, 0.7), (-0.7, 2.85), (0.7, 2.85), (0.7, 0.7)], front=-1)
    for k in range(9):
        on_front(bvh, "trim_black", (1.1, 0.03, 0.025), 0, 0.9 + k * 0.055, front=-1, mirror=False, bevel=0.0, sink=0.008)
    for k in range(6):
        on_front(bvh, "steel", (0.02, 0.03, 0.78), -0.7 + k * 0.28, 2.38, front=-1, mirror=False, bevel=0.0, sink=0.0)
    for k in range(3):
        rbox("paint_white", (0.9, 0.7, 0.12), (0, 2.5 - k * 3.2, top + 0.08), bevel=0.05, seg=2)
    sg = front_s(bvh, 0, 1.0, 1, 5.25)
    grille(0.6, 0.72, 1.05, sg + 0.012, slats=4, frame="trim_black")
    for sx in (-1, 1):
        rbox("headlamp", (0.3, 0.06, 0.16), (sx * 0.9, front_s(bvh, sx * 0.9, 1.0, 1, 5.2) + 0.01, 1.0), bevel=0.02)
        rbox("amber_lamp", (0.14, 0.06, 0.1), (sx * 0.9, front_s(bvh, sx * 0.9, 0.8, 1, 5.2) + 0.01, 0.8), bevel=0.015)
        rbox("taillamp", (0.18, 0.06, 0.34), (sx * 1.0, front_s(bvh, sx * 1.0, 1.0, -1, -5.2) - 0.01, 1.0), bevel=0.02)
        rbox("reverse_lamp", (0.16, 0.06, 0.1), (sx * 1.0, front_s(bvh, sx * 1.0, 0.75, -1, -5.2) - 0.01, 0.75), bevel=0.015)
        for s in (-4.0, 4.6):
            rbox("amber_lamp", (0.05, 0.1, 0.05), (sx * 1.26, s, 3.0), bevel=0.01)
        sweep("steel", [(sx * 1.1, 4.95, 2.7), (sx * 1.25, 5.2, 2.7), (sx * 1.38, 5.16, 2.5)], 0.016, seg=8)
        rbox("trim_black", (0.1, 0.12, 0.38), (sx * 1.4, 5.14, 2.32), bevel=0.03)
    rbox("trim_black", (2.4, 0.18, 0.26), (0, 5.17, 0.62), bevel=0.06, seg=3)
    rbox("trim_black", (2.4, 0.18, 0.26), (0, -5.17, 0.62), bevel=0.06, seg=3)
    for k in range(7):
        for sx in (-1, 1):
            rbox("interior", (0.95, 0.12, 0.6), (sx * 0.6, 3.6 - k * 1.1, 1.85), bevel=0.04)
    rbox("interior", (2.2, 0.06, 1.6), (0, 3.9, 1.9), bevel=0.01)
    return wheels([3.6, -3.4], 0.50, 0.27, 2.0, style="steel", duals=(1,), seg=24)


def build_tanker():
    belt, roof = 1.72, 2.85
    hw = 1.22
    cab_regs = [
        R("glass", "+y", x=(-1.06, 1.06), z=(belt + 0.06, roof - 0.12)),
        R("glass", "x", y=(2.45, 3.55), z=(belt + 0.05, roof - 0.14)),
        R("glass", "-y", x=(-0.6, 0.6), z=(belt + 0.12, roof - 0.18)),
    ]
    cab, cbvh = gbox(((-hw, hw), (1.6, 3.75), (0.7, roof)), 0.14, cab_regs, default="paint_blue",
                     deform=chain(rake(3.75, belt, 0.32, 2.6), tumble(belt, roof, 0.05), crown(roof, 0.04, hw)))
    hood, hbvh = gbox(((-1.1, 1.1), (3.7, 5.28), (0.72, belt - 0.02)), 0.16, default="paint_blue",
                      deform=chain(slope_top(belt, 3.75, 5.28, 0.18), nose(5.28, 0.6, 1.5, 0.08), crown(belt, 0.03, 1.1, 0.2)),
                      cuts=((), (4.2, 4.7), ()))
    cut_arches(cab, [((3.2,), 0.6, 0.5)], 0.7)
    cut_arches(hood, [((3.2,), 0.6, 0.5)], 0.7)
    arch_trim(cbvh, (3.2,), 0.61, 0.5, r=0.034, material="chrome")
    arch_trim(hbvh, (3.2,), 0.61, 0.5, r=0.034, material="chrome")
    vseam(cbvh, 3.62, 1.12, belt + 0.02)
    vseam(cbvh, 2.38, 0.74, belt + 0.02)
    handle(cbvh, 2.55, belt - 0.12, material="chrome")
    for sx in (-1, 1):
        top_seam(hbvh, [(sx * 1.0, 3.8), (sx * 1.0, 5.2)])
        rbox("steel", (0.24, 0.9, 0.04), (sx * 1.1, 2.95, 1.0) if False else (sx * 1.12, 2.0, 0.95), bevel=0.01)
        rbox("steel", (0.24, 0.6, 0.04), (sx * 1.12, 2.0, 0.65), bevel=0.01)
        cyl("chrome", 0.09, 2.3, (sx * 1.08, 1.5, 1.55 + 0.35), seg=14)
        cyl("chrome", 0.075, 0.12, (sx * 1.08, 1.5, 3.07), seg=14, rot=(0.0, sx * 0.3, 0))
        cyl("steel", 0.25, 0.9, (sx * 1.14, 1.2, 1.0), axis="y", seg=16)
    sg = front_s(hbvh, 0, 1.15, 1, 5.28)
    grille(0.72, 0.85, 1.55, sg + 0.02, slats=8, vertical=True)
    for sx in (-1, 1):
        rbox("headlamp", (0.26, 0.08, 0.18), (sx * 0.92, front_s(hbvh, sx * 0.92, 1.2, 1, 5.2) + 0.02, 1.2), bevel=0.02)
        rbox("amber_lamp", (0.1, 0.08, 0.1), (sx * 0.95, front_s(hbvh, sx * 0.95, 0.98, 1, 5.2) + 0.02, 0.98), bevel=0.015)
    rbox("chrome", (2.44, 0.24, 0.34), (0, 5.27, 0.78), bevel=0.06, seg=3)
    rbox("trim_black", (1.4, 0.06, 0.12), (0, 5.4, 0.74), bevel=0.02)
    for sx in (-1, 1):
        cyl("amber_lamp", 0.04, 0.03, (sx * 0.35, 3.0 - 0.0, roof + 0.02), seg=12)
    cyl("amber_lamp", 0.04, 0.03, (0.0, 3.0, roof + 0.02), seg=12)
    mirror_pair(3.6, 2.0, hw, tall=True, chrome_arm=True)
    interior_cab(3.55, 2.9, 1.1, belt, rows=1)
    # tank: superelliptic section with domed heads
    push()
    bm = bmesh.new()
    segs = 40
    stations = []
    s0, s1 = -5.15, 1.25
    ends = [0.0, 0.04, 0.12, 0.22, 0.32]
    shrink = [0.82, 0.93, 0.98, 0.995, 1.0]
    for k, e in enumerate(ends):
        stations.append((s0 + e, shrink[k]))
    n_mid = 14
    for i in range(1, n_mid):
        stations.append((s0 + 0.32 + (s1 - s0 - 0.64) * i / n_mid, 1.0))
    for k, e in reversed(list(enumerate(ends))):
        stations.append((s1 - e, shrink[k]))
    rings = []
    a_h, b_h, cz, pw = 1.22, 0.74, 2.12, 2.6
    for s, k in stations:
        ring = []
        for j in range(segs):
            t = j / segs * 2 * PI
            c, sn = math.cos(t), math.sin(t)
            x = a_h * k * math.copysign(abs(c) ** (2 / pw), c)
            z = b_h * k * math.copysign(abs(sn) ** (2 / pw), sn)
            ring.append(bm.verts.new((x, s, cz + z)))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for j in range(segs):
            bm.faces.new((a[j], a[(j + 1) % segs], b[(j + 1) % segs], b[j]))
    for ring, flip in ((rings[0], True), (rings[-1], False)):
        c = bm.verts.new(sum((v.co for v in ring), Vector()) / segs)
        for j in range(segs):
            q = (ring[j], ring[(j + 1) % segs], c)
            bm.faces.new(q[::-1] if flip else q)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    finish(bm, "tank", "tank_steel")
    tank_parts = pop()
    PARTS[-1].extend(tank_parts)
    for s in (-4.5, -2.0, 0.6):
        for sx in (-1, 1):
            rbox("trim_black", (0.25, 0.4, 0.5), (sx * 0.5, s, 1.35), bevel=0.02)
    for s in (-3.9, -2.0, -0.1):
        cyl("steel", 0.25, 0.1, (0, s, cz + b_h + 0.03), seg=20)
        cyl("steel", 0.18, 0.06, (0, s, cz + b_h + 0.1), seg=16)
    for sx in (-1, 1):
        rbox("steel", (0.04, 5.6, 0.04), (sx * 0.45, -2.0, cz + b_h + 0.25), bevel=0.0)
        for s in (-4.6, -3.2, -2.0, -0.8, 0.6):
            cyl("steel", 0.016, 0.25, (sx * 0.45, s, cz + b_h + 0.12), seg=6)
    rbox("steel", (0.6, 5.8, 0.03), (0, -2.0, cz + b_h + 0.05), bevel=0.0)
    vladder(0.0, -5.17, 1.6, cz + b_h + 0.1, width=0.42)
    frame_rails(-5.1, 5.0, 0.82, xw=0.5, hh=0.25)
    rbox("trim_black", (2.2, 6.4, 0.1), (0, -1.95, 1.08), bevel=0.02)
    for sx in (-1, 1):
        plate_arc("steel", sx * 0.75, sx * 1.27, -2.2, 0.5, 0.58, 0.15 * PI, 0.62 * PI, thick=0.008, n=8)
        plate_arc("steel", sx * 0.75, sx * 1.27, -3.4, 0.5, 0.58, 0.38 * PI, 0.85 * PI, thick=0.008, n=8)
        rbox("steel", (0.5, 1.5, 0.3), (sx * 0.95, -0.9, 0.95), bevel=0.02)
        rbox("trim_black", (0.05, 1.5, 0.05), (sx * 1.2, -0.9, 0.95), bevel=0.0)
    cab2, _ = gbox(((-1.15, 1.15), (-5.2, -4.75), (0.78, 1.55)), 0.05, default="steel", insets={})
    cyl("steel", 0.3, 1.2, (0.0, -4.97, 1.25), axis="x", seg=20)
    cyl("rubber", 0.26, 1.0, (0.0, -4.97, 1.25), axis="x", seg=20)
    for sx in (-1, 1):
        rbox("taillamp", (0.2, 0.05, 0.12), (sx * 0.95, -5.21, 0.95), bevel=0.015)
        rbox("amber_lamp", (0.12, 0.05, 0.1), (sx * 0.7, -5.21, 0.95), bevel=0.012)
        rbox("reverse_lamp", (0.12, 0.05, 0.1), (sx * 0.5, -5.21, 0.95), bevel=0.012)
    rbox("steel", (2.3, 0.12, 0.14), (0, -5.1, 0.52), bevel=0.02)
    return wheels([3.2, -2.2, -3.4], 0.50, 0.3, 2.0, style="steel", duals=(1, 2), seg=24)


VEHICLES = [
    ("cruiser", build_cruiser),
    ("delivery", build_delivery),
    ("pickup", lambda: build_pickup(False)),
    ("lawntruck", lambda: build_pickup(True)),
    ("engine", build_engine),
    ("ambulance", build_ambulance),
    ("garbage", build_garbage),
    ("utility", build_utility),
    ("shuttle", build_shuttle),
    ("bus", build_bus),
    ("tanker", build_tanker),
    ("wreck", build_wreck),
    ("trailer", build_trailer),
]


# ---------------------------------------------------------------- assembly

def join_parts(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    vl = bpy.context.view_layer
    vl.objects.active = objs[0]
    bpy.ops.object.convert(target="MESH")
    if len(objs) > 1:
        bpy.ops.object.join()
    o = vl.objects.active
    o.data.transform(o.matrix_basis)
    o.matrix_basis = Matrix.Identity(4)
    o.name = name
    o.data.name = name
    return o


def mirror_forward(o):
    if o.type == "MESH":
        o.data.transform(Matrix.Scale(-1, 4, (0, 1, 0)))
        o.data.flip_normals()
    o.location.y = -o.location.y


def tidy_normals(o):
    me = o.data
    for p in me.polygons:
        p.use_smooth = True
    me.set_sharp_from_angle(angle=math.radians(38))
    m = o.modifiers.new("WN", "WEIGHTED_NORMAL")
    m.keep_sharp = True
    m.weight = 50


def build(kind, fn):
    root = bpy.data.objects.new(kind, None)
    bpy.context.scene.collection.objects.link(root)
    PARTS[:] = [[]]
    BARS.clear()
    wheel_objs = fn()
    if kind == "utility":
        base, arm, piv = build_boom()
    statics = PARTS[-1]
    body = join_parts(statics, f"{kind}_body")
    if kind == "wreck":
        crush_front([body], 1.25)
    body.parent = root
    for w in wheel_objs:
        w.parent = root
    for b in name_bars():
        b.parent = root
    if kind == "utility":
        boom = bpy.data.objects.new("boom", None)
        bpy.context.scene.collection.objects.link(boom)
        boom.parent = root
        boom_origin = Vector((0, -2.6, 1.7))
        boom.location = boom_origin
        bo = join_parts(base, "boom_base")
        bo.data.transform(Matrix.Translation(-boom_origin))
        bo.parent = boom
        ao = join_parts(arm, "arm")
        ao.data.transform(Matrix.Translation(-piv))
        pivot(ao, "arm", piv - boom_origin, boom)
    for o in [root] + list(root.children_recursive):
        if o is not root:
            mirror_forward(o)
    for o in root.children_recursive:
        if o.type == "MESH":
            tidy_normals(o)
    return root


def tri_count(root):
    dg = bpy.context.evaluated_depsgraph_get()
    total = 0
    for o in root.children_recursive:
        if o.type == "MESH":
            me = o.evaluated_get(dg).to_mesh()
            me.calc_loop_triangles()
            total += len(me.loop_triangles)
            o.evaluated_get(dg).to_mesh_clear()
    return total


def strip_suffixes(path):
    """Blender needs unique object names; under each root the contract names repeat, so drop the .001 suffixes."""
    with open(path, "rb") as f:
        data = f.read()
    magic, ver, length = struct.unpack_from("<III", data, 0)
    jlen, jtype = struct.unpack_from("<II", data, 12)
    doc = json.loads(data[20:20 + jlen])
    rest = data[20 + jlen:]
    for key in ("nodes", "meshes"):
        for n in doc.get(key, []):
            if "name" in n:
                n["name"] = re.sub(r"\.\d{3}$", "", n["name"])
    js = json.dumps(doc, separators=(",", ":")).encode()
    js += b" " * ((4 - len(js) % 4) % 4)
    out = struct.pack("<III", magic, ver, 12 + 8 + len(js) + len(rest)) + struct.pack("<II", len(js), jtype) + js + rest
    with open(path, "wb") as f:
        f.write(out)


def preview(prefix, roots):
    import numpy as np
    scn = bpy.context.scene
    scn.render.engine = "CYCLES"
    scn.cycles.samples = int(os.environ.get("HOOD_SAMPLES", "24"))
    scn.cycles.device = "CPU"
    try:
        scn.cycles.use_denoising = True
    except Exception:
        pass
    W, H = 520, 340
    scn.render.resolution_x, scn.render.resolution_y = W, H
    world = bpy.data.worlds.new("W")
    world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs[0].default_value = (0.62, 0.72, 0.85, 1)
    bg.inputs[1].default_value = 0.8
    scn.world = world
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 3.5
    sun.data.angle = 0.1
    sun.rotation_euler = (math.radians(40), math.radians(15), math.radians(-150))
    scn.collection.objects.link(sun)
    floor = bpy.data.meshes.new("floor")
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=60)
    bm.to_mesh(floor)
    fo = bpy.data.objects.new("floor", floor)
    scn.collection.objects.link(fo)
    fm = bpy.data.materials.new("floor")
    fm.use_nodes = True
    next(n for n in fm.node_tree.nodes if n.type == "BSDF_PRINCIPLED").inputs["Base Color"].default_value = (0.32, 0.32, 0.31, 1)
    floor.materials.append(fm)
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    cam.data.lens = 50
    scn.collection.objects.link(cam)
    scn.camera = cam
    views = os.environ.get("HOOD_VIEWS", "front,rear").split(",")
    files = []
    for root in roots:
        for other in roots:
            for ch in other.children_recursive:
                ch.hide_render = other is not root
        pts = [o.matrix_world @ Vector(c) for o in root.children_recursive if o.type == "MESH" for c in o.bound_box]
        lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
        hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
        size = max(hi.y - lo.y, 3.0)
        target = (lo + hi) / 2
        target.z = (hi.z) * 0.42
        for view in views:
            dist = size * 1.25 + 3.0 if view != "close" else size * 0.55 + 2.2
            sy = -1 if view in ("front", "close") else 1
            sx = 1 if view != "side" else 1
            d = Vector((dist * 0.72 * sx, dist * 0.62 * sy, dist * 0.36))
            if view == "side":
                d = Vector((dist * 1.0, 0.0, dist * 0.22))
            cam.location = target + d
            cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
            path = f"{prefix}-{root.name}-{view}.png"
            scn.render.filepath = path
            bpy.ops.render.render(write_still=True)
            files.append(path)
    cols = len(views) * (2 if len(views) == 1 else 1) * 2
    cols = 4 if len(views) <= 2 else len(views)
    rows = (len(files) + cols - 1) // cols
    sheet = np.full((rows * H, cols * W, 4), 0.5, dtype=np.float32)
    for i, path in enumerate(files):
        img = bpy.data.images.load(path)
        px = np.array(img.pixels[:], dtype=np.float32).reshape(H, W, 4)
        r, c = i // cols, i % cols
        sheet[(rows - 1 - r) * H:(rows - r) * H, c * W:(c + 1) * W] = px
        bpy.data.images.remove(img)
    out = bpy.data.images.new("sheet", cols * W, rows * H, alpha=True)
    out.pixels.foreach_set(sheet.ravel())
    out.filepath_raw = f"{prefix}-sheet.png"
    out.file_format = "PNG"
    out.save()
    print("sheet", f"{prefix}-sheet.png")


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    only = os.environ.get("HOOD_ONLY")
    picks = [v for v in VEHICLES if not only or v[0] in only.split(",")]
    roots = []
    for kind, fn in picks:
        root = build(kind, fn)
        roots.append(root)
        print(f"vehicle {kind}: {tri_count(root)} triangles, children {[c.name for c in root.children]}")
        if os.environ.get("HOOD_DETAIL"):
            for o in root.children_recursive:
                if o.type == "MESH":
                    print("   ", o.name, len(o.data.polygons), "faces")
    if not only:
        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        bpy.ops.object.select_all(action="SELECT")
        bpy.ops.export_scene.gltf(filepath=OUT, use_selection=True, export_format="GLB", export_apply=True, export_yup=True,
                                  export_texcoords=False, export_normals=True, export_materials="EXPORT", export_animations=False,
                                  export_extras=False)
        strip_suffixes(OUT)
        print("wrote", OUT, os.path.getsize(OUT))
    prefix = os.environ.get("HOOD_PREVIEW")
    if prefix:
        preview(prefix, roots)


main()
