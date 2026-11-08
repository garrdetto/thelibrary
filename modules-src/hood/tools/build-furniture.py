"""The Hood furniture and yard objects, built in Blender.

Run headless from the repo root:

    blender -b -P modules-src/hood/tools/build-furniture.py
    pnpm assets

Writes assets-src/models/hood/furniture.glb: one root node per catalog id (shared/Catalog.ts), each
centred on its footprint with its floor at y = 0 and its front facing -z in three.js (+Y in Blender,
which the exporter turns into -z... see AXES below). Edges are bevelled, cushions are puffed and
subdivided, round parts are lathed and tubes are swept, so the pieces read as real furniture.

Materials are slots the game fills in (src/models/Furniture.ts):
  wood_color / wood_accent     wood grain in the item's colour or accent
  cloth_color / cloth_accent   woven fabric in the item's colour or accent
  paint_color / paint_accent   painted or plastic finish
  gloss_color / gloss_accent   lacquer, enamel or porcelain
  metal_color / metal_accent   metal in the item's colour or accent
  leaf_accent                  foliage in the item's accent
and fixed finishes (steel, chrome, blackmetal, glass, mirror, screen, linen, pillow, rubber, soil,
leaf, bark, book_0..5, stone, mulch, flower_*, tomato, ball, net, display, wood_dark, wood_walnut,
porcelain, cooktop, oven_glass, keys, glow_accent).

AXES: Blender +Z up and +Y is the object's front; the glTF exporter maps Blender -Y to three.js +z,
so the front ends up facing three.js -z as the game expects.

Set HOOD_PREVIEW=/path/prefix to render a contact sheet of every item with Cycles.
"""
import math
import os
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

PI = math.pi
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.environ.get("HOOD_REPO") or os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT = os.path.join(REPO, "assets-src", "models", "hood", "furniture.glb")

# Preview colour, roughness, metalness. Every slot gets a distinct value so the asset pipeline's
# dedup pass never merges two slots into one material.
PALETTE = {
    "wood_color": ((0.62, 0.42, 0.25), 0.55, 0.0), "wood_accent": ((0.48, 0.32, 0.19), 0.56, 0.0),
    "cloth_color": ((0.35, 0.50, 0.66), 0.95, 0.0), "cloth_accent": ((0.88, 0.84, 0.77), 0.96, 0.0),
    "paint_color": ((0.94, 0.93, 0.90), 0.6, 0.0), "paint_accent": ((0.20, 0.20, 0.22), 0.61, 0.0),
    "gloss_color": ((0.92, 0.93, 0.94), 0.25, 0.0), "gloss_accent": ((0.76, 0.22, 0.17), 0.26, 0.0),
    "metal_color": ((0.18, 0.18, 0.19), 0.4, 1.0), "metal_accent": ((0.85, 0.42, 0.18), 0.41, 1.0),
    "leaf_accent": ((0.30, 0.55, 0.27), 0.8, 0.0), "glow_accent": ((1.0, 0.91, 0.69), 0.7, 0.0),
    "steel": ((0.73, 0.75, 0.78), 0.32, 1.0), "chrome": ((0.90, 0.91, 0.92), 0.12, 1.0), "blackmetal": ((0.10, 0.10, 0.11), 0.45, 0.8),
    "glass": ((0.80, 0.90, 0.95), 0.05, 0.0), "mirror": ((0.86, 0.90, 0.92), 0.03, 1.0), "screen": ((0.03, 0.04, 0.06), 0.15, 0.0),
    "linen": ((0.96, 0.95, 0.92), 0.97, 0.0), "pillow": ((0.99, 0.99, 0.98), 0.98, 0.0), "rubber": ((0.06, 0.06, 0.06), 0.9, 0.0),
    "soil": ((0.22, 0.15, 0.10), 1.0, 0.0), "leaf": ((0.24, 0.45, 0.20), 0.82, 0.0), "bark": ((0.32, 0.24, 0.17), 0.95, 0.0),
    "stone": ((0.62, 0.60, 0.56), 0.9, 0.0), "mulch": ((0.36, 0.22, 0.14), 1.0, 0.0), "tomato": ((0.80, 0.12, 0.08), 0.35, 0.0),
    "ball": ((0.91, 0.41, 0.17), 0.7, 0.0), "net": ((0.97, 0.97, 0.97), 0.9, 0.0), "display": ((0.40, 0.85, 0.95), 0.3, 0.0),
    "wood_dark": ((0.23, 0.16, 0.12), 0.5, 0.0), "wood_walnut": ((0.42, 0.27, 0.19), 0.5, 0.0), "porcelain": ((0.97, 0.97, 0.96), 0.15, 0.0),
    "cooktop": ((0.04, 0.04, 0.05), 0.08, 0.0), "oven_glass": ((0.05, 0.05, 0.06), 0.06, 0.0), "keys": ((0.17, 0.18, 0.20), 0.7, 0.0),
    "flower_yellow": ((0.95, 0.82, 0.29), 0.7, 0.0), "flower_white": ((0.98, 0.97, 0.95), 0.7, 0.0), "flower_red": ((0.77, 0.31, 0.25), 0.7, 0.0),
    "paper": ((0.93, 0.90, 0.82), 0.9, 0.0), "charcoal": ((0.14, 0.14, 0.15), 0.85, 0.0),
}
for i, c in enumerate([(0.77, 0.31, 0.25), (0.23, 0.44, 0.66), (0.85, 0.64, 0.24), (0.31, 0.54, 0.25), (0.48, 0.35, 0.66), (0.91, 0.88, 0.83)]):
    PALETTE[f"book_{i}"] = (c, 0.8 + i * 0.002, 0.0)

MATS = {}


def lerp(a, b, t):
    return a + (b - a) * t


def mat(name):
    if name in MATS:
        return MATS[name]
    col, rough, metal = PALETTE[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*col, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if name in ("glass",):
        b.inputs["Alpha"].default_value = 0.3
        m.blend_method = "BLEND" if hasattr(m, "blend_method") else None
    if name in ("glow_accent", "display"):
        b.inputs["Emission Color"].default_value = (*col, 1)
        b.inputs["Emission Strength"].default_value = 2.0
    MATS[name] = m
    return m


# ---------------------------------------------------------------- object helpers

PARENT = [None]


def finish(bm, name, material, loc=(0, 0, 0), rot=(0, 0, 0), bevel=0.0, seg=2, sub=0, smooth=True, angle=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat(material))
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = loc
    obj.rotation_euler = rot
    obj.parent = PARENT[0]
    if bevel > 0:
        m = obj.modifiers.new("Bevel", "BEVEL")
        m.width = bevel
        m.segments = seg
        m.limit_method = "ANGLE"
        m.angle_limit = math.radians(angle or 35)
        m.harden_normals = sub == 0 and bevel >= 0.004
    if sub:
        m = obj.modifiers.new("Sub", "SUBSURF")
        m.levels = sub
        m.render_levels = sub
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    return obj


def rbox(material, size, loc, rot=(0, 0, 0), bevel=0.006, seg=2):
    """A box by size and centre, with rounded edges of real width (scale baked into the mesh)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    b = min(bevel, min(size) * 0.45)
    return finish(bm, "box", material, loc, rot, bevel=b if b >= 0.004 else 0.0, seg=seg, smooth=b >= 0.004)


def cushion(material, size, loc, rot=(0, 0, 0), puff=0.02, round_=0.03, cuts=4):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=cuts, use_grid_fill=True)
    sx, sy, sz = size
    for v in bm.verts:
        x, y, z = v.co.x * 2, v.co.y * 2, v.co.z * 2
        f = (1 - x * x) * (1 - y * y)
        v.co.x *= sx
        v.co.y *= sy
        v.co.z = v.co.z * sz + math.copysign(puff * f * 0.5, z) if abs(z) > 0.99 else v.co.z * sz * (1 + 0.0)
        side = (1 - z * z)
        v.co.x += math.copysign(puff * 0.35 * side * (1 - y * y), x) if abs(x) > 0.99 else 0
        v.co.y += math.copysign(puff * 0.35 * side * (1 - x * x), y) if abs(y) > 0.99 else 0
    return finish(bm, "cushion", material, loc, rot, bevel=min(round_, min(size) * 0.4), seg=3, sub=1)


def cyl(material, r, h, loc, rot=(0, 0, 0), seg=24, r2=None, bevel=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=h)
    obj = finish(bm, "cyl", material, loc, rot, bevel=bevel, seg=2)
    return obj


def ball(material, r, loc, scale=(1, 1, 1), seg=20, rings=12, rot=(0, 0, 0)):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=r)
    bmesh.ops.scale(bm, vec=Vector(scale), verts=bm.verts)
    return finish(bm, "ball", material, loc, rot)


def lathe(material, profile, loc=(0, 0, 0), seg=32, rot=(0, 0, 0), scale=(1, 1, 1)):
    """Revolve [(radius, z), ...] about the local Z axis; a zero radius closes the end."""
    bm = bmesh.new()
    rings = []
    for r, z in profile:
        if r <= 1e-6:
            rings.append([bm.verts.new((0, 0, z))])
        else:
            rings.append([bm.verts.new((r * math.cos(j / seg * 2 * PI) * scale[0], r * math.sin(j / seg * 2 * PI) * scale[1], z)) for j in range(seg)])
    for a, b in zip(rings, rings[1:]):
        if len(a) == 1 and len(b) == 1:
            continue
        if len(a) == 1:
            for j in range(seg):
                bm.faces.new((a[0], b[j], b[(j + 1) % seg]))
        elif len(b) == 1:
            for j in range(seg):
                bm.faces.new((a[j], b[0], a[(j + 1) % seg]))
        else:
            for j in range(seg):
                bm.faces.new((a[j], a[(j + 1) % seg], b[(j + 1) % seg], b[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return finish(bm, "lathe", material, loc, rot)


def frames(pts):
    """Parallel-transport frames along a polyline."""
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


def sweep(material, pts, radius, seg=10, caps=True, flat=1.0):
    """A tube along points; radius is a number or a function of 0..1 along the path."""
    pts = [Vector(p) for p in pts]
    T, N, B = frames(pts)
    bm = bmesh.new()
    rings = []
    for i, p in enumerate(pts):
        r = radius(i / (len(pts) - 1)) if callable(radius) else radius
        rings.append([bm.verts.new(p + N[i] * math.cos(j / seg * 2 * PI) * r + B[i] * math.sin(j / seg * 2 * PI) * r * flat) for j in range(seg)])
    for a, b in zip(rings, rings[1:]):
        for j in range(seg):
            bm.faces.new((a[j], a[(j + 1) % seg], b[(j + 1) % seg], b[j]))
    if caps:
        bm.faces.new(rings[0][::-1])
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return finish(bm, "tube", material)


def ribbon(material, pts, widths, normal):
    """A flat strip (leaves, blades) through points with a width per point, facing roughly `normal`."""
    bm = bmesh.new()
    pts = [Vector(p) for p in pts]
    row = []
    for i, p in enumerate(pts):
        t = (pts[min(len(pts) - 1, i + 1)] - pts[max(0, i - 1)]).normalized()
        side = t.cross(Vector(normal)).normalized()
        w = widths[i]
        row.append((bm.verts.new(p - side * w), bm.verts.new(p + side * w)))
    for (a0, a1), (b0, b1) in zip(row, row[1:]):
        bm.faces.new((a0, a1, b1, b0))
    return finish(bm, "leaf", material)


def arc(p0, p1, bulge, n=12, axis=(0, 0, 1)):
    p0, p1 = Vector(p0), Vector(p1)
    out = []
    for i in range(n + 1):
        t = i / n
        p = p0.lerp(p1, t) + Vector(axis) * bulge * math.sin(PI * t)
        out.append(p)
    return out


def legs4(material, w, d, h, inset, size, taper=0.75, round_=True):
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = sx * (w / 2 - inset), sy * (d / 2 - inset)
            if round_:
                cyl(material, size / 2, h, (x, y, h / 2), r2=size / 2 * taper, seg=14, rot=(PI, 0, 0))
            else:
                rbox(material, (size, size, h), (x, y, h / 2), bevel=0.003)


def shaker_door(material, w, h, x, z, front_y, knob="steel", knob_at=None):
    """A cabinet door: frame, recessed centre panel and a knob."""
    rbox(material, (w - 0.006, 0.018, h - 0.006), (x, front_y + 0.009, z), bevel=0.003)
    rbox(material, (w - 0.13, 0.006, h - 0.13), (x, front_y + 0.019, z), bevel=0.002)
    for dz in (-1, 1):
        rbox(material, (w - 0.02, 0.008, 0.06), (x, front_y + 0.021, z + dz * (h / 2 - 0.035)), bevel=0.0015)
    for dx in (-1, 1):
        rbox(material, (0.06, 0.0095, h - 0.02), (x + dx * (w / 2 - 0.035), front_y + 0.0215, z), bevel=0.0015)
    if knob_at:
        ball(knob, 0.012, (knob_at[0], front_y + 0.036, knob_at[1]), seg=12, rings=8)


# ---------------------------------------------------------------- the items

def bed(w, d, double):
    frame_h = 0.32
    for sx in (-1, 1):
        rbox("wood_color", (0.05, d - 0.1, 0.16), (sx * (w / 2 - 0.035), 0.0, 0.26), bevel=0.008)
    rbox("wood_color", (w - 0.08, 0.05, 0.16), (0, d / 2 - 0.03, 0.26), bevel=0.008)
    for sx in (-1, 1):
        for sy, hh in ((1, 0.48), (-1, 1.02 if double else 0.88)):
            cyl("wood_color", 0.035, hh, (sx * (w / 2 - 0.035), sy * (d / 2 - 0.035), hh / 2), seg=16, bevel=0.004)
            ball("wood_color", 0.04, (sx * (w / 2 - 0.035), sy * (d / 2 - 0.035), hh + 0.02), seg=14, rings=10)
    hb_h = 0.95 if double else 0.8
    rbox("wood_color", (w - 0.08, 0.05, hb_h - 0.42), (0, -d / 2 + 0.035, 0.42 + (hb_h - 0.42) / 2), bevel=0.01)
    rbox("wood_color", (w - 0.24, 0.02, hb_h - 0.58), (0, -d / 2 + 0.07, 0.42 + (hb_h - 0.42) / 2), bevel=0.006)
    rbox("wood_color", (w - 0.06, 0.07, 0.04), (0, -d / 2 + 0.035, hb_h + 0.01), bevel=0.012)
    rbox("wood_color", (w - 0.08, 0.04, 0.16), (0, d / 2 - 0.035, 0.38), bevel=0.008)
    cushion("linen", (w - 0.12, d - 0.1, 0.2), (0, 0, 0.44), puff=0.02, round_=0.05)
    # duvet with a turned-down top and sides that drape over the mattress
    dw = w - 0.06
    cushion("cloth_accent", (dw, d * 0.66, 0.06), (0, d * 0.16, 0.565), puff=0.025, round_=0.025)
    for sx in (-1, 1):
        rbox("cloth_accent", (0.03, d * 0.66, 0.22), (sx * (dw / 2 - 0.01), d * 0.16, 0.47), bevel=0.012, seg=3)
    rbox("cloth_accent", (dw, 0.03, 0.22), (0, d * 0.49, 0.47), bevel=0.012, seg=3)
    cushion("linen", (dw - 0.01, 0.16, 0.035), (0, -d * 0.17 + 0.0, 0.575), puff=0.01, round_=0.015)
    pillows = (-0.24, 0.24) if double else (0,)
    for px in pillows:
        cushion("pillow", (w * 0.36 if double else w * 0.66, 0.36, 0.13), (px * w, -d / 2 + 0.3, 0.6), rot=(0.25, 0, 0), puff=0.05, round_=0.05)
    if double:
        cushion("cloth_color", (0.36, 0.12, 0.3), (-0.12, -d / 2 + 0.5, 0.66), rot=(0.35, 0, 0.12), puff=0.04, round_=0.04)


def fridge(w, d):
    bw, bd = w * 0.86, d * 0.8
    y0 = d * 0.05
    rbox("gloss_color", (bw, bd, 1.84), (0, -y0 + 0.0, 0.94), bevel=0.02, seg=3)
    front = -y0 + bd / 2
    rbox("gloss_color", (bw - 0.01, 0.04, 0.5), (0, front + 0.02, 1.6), bevel=0.018, seg=3)
    rbox("gloss_color", (bw - 0.01, 0.04, 1.2), (0, front + 0.02, 0.73), bevel=0.018, seg=3)
    rbox("paint_accent", (bw - 0.02, 0.01, 0.012), (0, front + 0.005, 1.343), bevel=0.0)
    rbox("charcoal", (bw - 0.06, 0.02, 0.07), (0, front - 0.01, 0.06), bevel=0.004)
    for z0, z1 in ((1.42, 1.78), (0.85, 1.25)):
        x = bw / 2 - 0.06
        sweep("metal_accent", [(x, front + 0.04, z0), (x, front + 0.075, z0 + 0.03), (x, front + 0.075, z1 - 0.03), (x, front + 0.04, z1)], 0.011, seg=12)
    rbox("display", (0.07, 0.006, 0.09), (-bw / 2 + 0.14, front + 0.041, 1.1), bevel=0.003)


def stove(w, d):
    bw, bd = w * 0.92, d * 0.82
    y = d * -0.04
    front = y + bd / 2
    rbox("gloss_color", (bw, bd, 0.86), (0, y, 0.45), bevel=0.012, seg=3)
    rbox("cooktop", (bw, bd, 0.012), (0, y, 0.886), bevel=0.004)
    for sx in (-0.21, 0.21):
        for sy, big in ((-0.14, True), (0.17, False)):
            r = 0.1 if big else 0.08
            cx, cy = sx * w, y + sy * d
            lathe("blackmetal", [(0, 0.89), (r * 0.42, 0.89), (r * 0.42, 0.905), (r * 0.36, 0.912), (0, 0.912)], (cx, cy, 0), seg=20)
            for a in range(4):
                ang = a * PI / 4
                rbox("blackmetal", (r * 2.1, 0.012, 0.012), (cx, cy, 0.925), rot=(0, 0, ang), bevel=0.004)
            lathe("blackmetal", [(r * 1.0, 0.915), (r * 1.06, 0.925), (r * 1.0, 0.935)], (cx, cy, 0), seg=24)
    back = y - bd / 2
    rbox("gloss_color", (bw, 0.08, 0.16), (0, back + 0.04, 0.97), bevel=0.012, seg=3)
    rbox("display", (0.12, 0.004, 0.04), (0, back + 0.082, 0.98), bevel=0.002)
    for i in range(4):
        x = (-0.33 + i * 0.22 + (0.1 if i >= 2 else 0)) * w * 0.9
        cyl("chrome", 0.022, 0.03, (x, back + 0.095, 0.97), rot=(PI / 2, 0, 0), seg=18, bevel=0.003)
    rbox("gloss_color", (bw - 0.03, 0.03, 0.52), (0, front + 0.012, 0.48), bevel=0.012, seg=3)
    rbox("oven_glass", (bw - 0.16, 0.006, 0.28), (0, front + 0.028, 0.47), bevel=0.01, seg=3)
    sweep("chrome", [(-bw * 0.38, front + 0.03, 0.7), (-bw * 0.38, front + 0.07, 0.7), (bw * 0.38, front + 0.07, 0.7), (bw * 0.38, front + 0.03, 0.7)], 0.011, seg=12)
    rbox("gloss_color", (bw - 0.03, 0.025, 0.14), (0, front + 0.01, 0.13), bevel=0.01)
    rbox("chrome", (0.2, 0.02, 0.016), (0, front + 0.032, 0.15), bevel=0.006)
    rbox("charcoal", (bw - 0.06, 0.02, 0.05), (0, front - 0.03, 0.025), bevel=0.003)


def cabinet(w, d, color="paint_color", top="wood_accent", sink=False):
    bw, bd = w * 0.98, d * 0.8
    y = -d * 0.06
    front = y + bd / 2
    rbox(color, (bw, bd, 0.78), (0, y, 0.48), bevel=0.004)
    rbox("charcoal", (bw - 0.02, 0.03, 0.09), (0, front - 0.06, 0.045), bevel=0.002)
    if not sink:
        shaker_door(color, bw - 0.02, 0.17, 0, 0.77, front, knob="steel")
        sweep("steel", [(-0.07, front + 0.03, 0.77), (-0.07, front + 0.05, 0.77), (0.07, front + 0.05, 0.77), (0.07, front + 0.03, 0.77)], 0.006, seg=8)
        for sx in (-1, 1):
            shaker_door(color, bw / 2 - 0.012, 0.56, sx * bw / 4, 0.385, front, knob_at=(sx * 0.06, 0.6))
    else:
        rbox(color, (bw - 0.02, 0.022, 0.16), (0, front + 0.011, 0.79), bevel=0.003)
        for sx in (-1, 1):
            shaker_door(color, bw / 2 - 0.012, 0.56, sx * bw / 4, 0.385, front, knob_at=(sx * 0.06, 0.6))
    if top:
        rbox(top, (w, d * 0.86, 0.045), (0, -d * 0.04, 0.8975), bevel=0.006)


def counter(w, d):
    cabinet(w, d)
    lathe("porcelain", [(0, 0.92), (0.07, 0.92), (0.08, 0.93), (0.075, 0.96), (0.06, 0.965), (0, 0.965)], (0.2, -0.1, 0), seg=24)
    for i, (x, h) in enumerate(((-0.28, 0.24), (-0.18, 0.2))):
        lathe("gloss_accent" if i else "paint_accent", [(0, 0.92), (0.045, 0.92), (0.05, 0.94), (0.05, 0.92 + h - 0.03), (0.035, 0.92 + h), (0.0, 0.92 + h)], (x, -0.24, 0), seg=18)
    rbox("wood_color", (0.32, 0.22, 0.02), (0.04, 0.05, 0.93), rot=(0, 0, 0.15), bevel=0.004)


def kitchen_sink(w, d):
    cabinet(w, d, top=None, sink=True)
    y = -d * 0.04
    top_d = d * 0.86
    # counter top in light stone, with an apron-front basin set into it
    for sx in (-1, 1):
        rbox("stone", ((w - w * 0.62) / 2, top_d, 0.045), (sx * (w / 2 - (w - w * 0.62) / 4), y, 0.8975), bevel=0.006)
    rbox("stone", (w * 0.62, top_d - top_d * 0.62, 0.045), (0, y - top_d / 2 + (top_d - top_d * 0.62) / 2, 0.8975), bevel=0.006)
    bw, bd = w * 0.62, top_d * 0.62
    bx, by = 0.0, y + top_d / 2 - bd / 2 - 0.0
    t = 0.025
    rbox("porcelain", (bw, t, 0.26), (bx, by + bd / 2 - t / 2, 0.80), bevel=0.01, seg=3)
    rbox("porcelain", (bw, t, 0.26), (bx, by - bd / 2 + t / 2, 0.80), bevel=0.01, seg=3)
    for sx in (-1, 1):
        rbox("porcelain", (t, bd, 0.26), (bx + sx * (bw / 2 - t / 2), by, 0.80), bevel=0.01, seg=3)
    rbox("porcelain", (bw - 0.02, bd - 0.02, 0.03), (bx, by, 0.69), bevel=0.012, seg=3)
    lathe("steel", [(0, 0.705), (0.025, 0.705), (0.02, 0.708), (0, 0.708)], (bx, by, 0), seg=16)
    back = y - top_d / 2 + 0.06
    cyl("chrome", 0.025, 0.04, (0, back, 0.94), seg=18, bevel=0.003)
    sweep("chrome", [(0, back, 0.94), (0, back, 1.18), (0, back + 0.03, 1.27), (0, back + 0.1, 1.28), (0, back + 0.17, 1.24), (0, back + 0.19, 1.16)], 0.013, seg=14)
    sweep("chrome", [(0.05, back, 0.98), (0.05, back + 0.02, 1.03), (0.05, back + 0.1, 1.06)], 0.006, seg=8)


def dining_table(w, d):
    rbox("wood_color", (w * 0.94, d * 0.88, 0.045), (0, 0, 0.7475), bevel=0.01, seg=3)
    rbox("wood_color", (w * 0.84, d * 0.74, 0.08), (0, 0, 0.68), bevel=0.004)
    prof = [(0, 0), (0.024, 0), (0.026, 0.02), (0.02, 0.06), (0.024, 0.11), (0.032, 0.16), (0.03, 0.2), (0.022, 0.28), (0.027, 0.5), (0.032, 0.56), (0.036, 0.6), (0.036, 0.725), (0, 0.725)]
    for sx in (-1, 1):
        for sy in (-1, 1):
            lathe("wood_accent", prof, (sx * (w * 0.42 - 0.03), sy * (d * 0.37 - 0.03), 0), seg=16)
    lathe("porcelain", [(0, 0.77), (0.05, 0.77), (0.065, 0.82), (0.06, 0.88), (0.035, 0.94), (0.03, 0.97), (0.04, 0.99), (0, 0.99)], (0, 0, 0), seg=24)
    rng = random.Random(3)
    for i in range(9):
        a = i / 9 * 2 * PI
        tip = Vector((math.cos(a) * 0.14, math.sin(a) * 0.14, 1.12 + rng.random() * 0.08))
        base = Vector((0, 0, 0.97))
        mid = base.lerp(tip, 0.5) + Vector((0, 0, 0.07))
        pts = [base, base.lerp(mid, 0.5), mid, mid.lerp(tip, 0.5), tip]
        ribbon("leaf", pts, [0.004, 0.018, 0.024, 0.018, 0.002], (0, 0, 1))
    for i, (x, y) in enumerate(((-0.55, 0.12), (0.55, -0.1))):
        lathe("porcelain", [(0, 0.77), (0.07, 0.77), (0.13, 0.775), (0.135, 0.78), (0, 0.78)], (x * w / 2, y, 0), seg=28)


def dining_chair(w, d):
    sw, sd = 0.46, 0.44
    rbox("wood_color", (sw, sd, 0.04), (0, 0.02, 0.45), bevel=0.012, seg=3)
    cushion("cloth_accent", (sw - 0.06, sd - 0.06, 0.035), (0, 0.03, 0.485), puff=0.012, round_=0.015)
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = sx * (sw / 2 - 0.035), sy * (sd / 2 - 0.035) + 0.02
            top = 0.45 if sy > 0 else 0.98
            if sy > 0:
                cyl("wood_color", 0.019, top, (x, y, top / 2), r2=0.014, rot=(PI, 0, 0), seg=14)
            else:
                pts = [(x, y, 0.0), (x, y, 0.45), (x, y - 0.03, 0.75), (x, y - 0.05, 0.98)]
                sweep("wood_color", pts, lambda t: lerp(0.016, 0.019, math.sin(PI * t)), seg=12)
    for sy in (-1, 1):
        rbox("wood_color", (sw - 0.07, 0.016, 0.016), (0, sy * (sd / 2 - 0.035) + 0.02, 0.16), bevel=0.005)
    for sx in (-1, 1):
        rbox("wood_color", (0.016, sd - 0.07, 0.016), (sx * (sw / 2 - 0.035), 0.02, 0.2), bevel=0.005)
    by = -sd / 2 + 0.015 - 0.05
    sweep("wood_color", arc((-sw / 2 + 0.035, by, 0.97), (sw / 2 - 0.035, by, 0.97), -0.03, 10, axis=(0, 1, 0)), 0.022, seg=10, flat=0.55)
    sweep("wood_color", arc((-sw / 2 + 0.035, by + 0.01, 0.64), (sw / 2 - 0.035, by + 0.01, 0.64), -0.025, 10, axis=(0, 1, 0)), 0.012, seg=8)
    for i in range(5):
        x = (-0.12 + i * 0.06)
        yb = by + 0.01 - 0.025 * math.sin(PI * (0.5 + x / 0.42))
        sweep("wood_color", [(x, yb, 0.64), (x, yb - 0.004, 0.8), (x * 1.04, yb - 0.008, 0.96)], lambda t: 0.007 + 0.003 * math.sin(PI * t), seg=8)


def sofa(w, d):
    base_h = 0.2
    rbox("cloth_color", (w * 0.96, d * 0.82, base_h), (0, 0.0, 0.08 + base_h / 2), bevel=0.03, seg=3)
    rbox("cloth_color", (w * 0.96, 0.2, 0.52), (0, -d * 0.31, 0.08 + 0.26 + 0.12), bevel=0.04, seg=3)
    for sx in (-1, 1):
        x = sx * (w * 0.48 - 0.08)
        rbox("cloth_color", (0.15, d * 0.82, 0.36), (x, 0.0, 0.08 + 0.18 + 0.1), bevel=0.04, seg=3)
        cyl("cloth_color", 0.085, d * 0.82, (x + sx * 0.0, 0.0, 0.62), rot=(PI / 2, 0, 0), seg=20, bevel=0.03)
    for sx in (-0.225, 0.225):
        cushion("cloth_color", (w * 0.41, d * 0.6, 0.15), (sx * w, d * 0.07, 0.41), puff=0.035, round_=0.04)
        cushion("cloth_color", (w * 0.41, 0.17, 0.42), (sx * w, -d * 0.2, 0.66), rot=(-0.18, 0, 0), puff=0.05, round_=0.05)
    cushion("cloth_accent", (0.38, 0.12, 0.36), (-w * 0.33, -d * 0.08, 0.66), rot=(-0.3, 0, 0.22), puff=0.05, round_=0.05)
    cushion("cloth_accent", (0.34, 0.12, 0.32), (w * 0.34, -d * 0.08, 0.64), rot=(-0.3, 0, -0.18), puff=0.05, round_=0.05)
    for sx in (-1, 1):
        for sy in (-1, 1):
            cyl("wood_dark", 0.024, 0.09, (sx * w * 0.44, sy * d * 0.33, 0.045), r2=0.016, rot=(PI, 0, 0), seg=14)


def armchair(w, d):
    cw, cd = 0.82, 0.84
    rbox("cloth_color", (cw, cd, 0.2), (0, 0.0, 0.25), bevel=0.03, seg=3)
    rbox("cloth_color", (cw, 0.16, 0.86), (0, -cd / 2 + 0.08, 0.15 + 0.43 + 0.06), rot=(-0.06, 0, 0), bevel=0.04, seg=3)
    for sx in (-1, 1):
        x = sx * (cw / 2 - 0.065)
        rbox("cloth_color", (0.13, cd - 0.08, 0.3), (x, 0.04, 0.45), bevel=0.04, seg=3)
        cyl("cloth_color", 0.075, cd - 0.08, (x + sx * 0.005, 0.04, 0.6), rot=(PI / 2, 0, 0), seg=20, bevel=0.025)
        # wings
        rbox("cloth_color", (0.11, 0.28, 0.42), (sx * (cw / 2 - 0.06), -cd / 2 + 0.2, 0.88), rot=(0, sx * 0.12, sx * -0.35), bevel=0.05, seg=3)
    cushion("cloth_color", (cw - 0.27, cd - 0.2, 0.13), (0, 0.06, 0.41), puff=0.035, round_=0.04)
    cushion("cloth_accent", (0.36, 0.11, 0.3), (0, -cd / 2 + 0.22, 0.62), rot=(-0.25, 0, 0), puff=0.04, round_=0.04)
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = sx * (cw / 2 - 0.06), sy * (cd / 2 - 0.06)
            sweep("wood_accent", [(x, y, 0.16), (x + sx * 0.005, y + sy * 0.004, 0.09), (x + sx * 0.02, y + sy * 0.02, 0.0)], lambda t: lerp(0.022, 0.014, t), seg=12)


def tv(w, d):
    cw, cd, ch = w * 0.94, d * 0.48, 0.44
    y = d * -0.12
    front = y + cd / 2
    rbox("wood_walnut", (cw, cd, 0.035), (0, y, ch - 0.0175), bevel=0.006)
    rbox("wood_walnut", (cw - 0.02, cd - 0.02, ch - 0.15), (0, y, 0.12 + (ch - 0.15) / 2), bevel=0.004)
    for sx in (-1, 1):
        rbox("wood_walnut", (cw / 2 - 0.02, 0.016, ch - 0.18), (sx * cw / 4, front + 0.004, 0.12 + (ch - 0.15) / 2), bevel=0.003)
        rbox("blackmetal", (0.008, 0.012, 0.09), (sx * 0.03, front + 0.016, 0.28), bevel=0.003)
    for sx in (-1, 1):
        for sy in (-1, 1):
            cyl("blackmetal", 0.012, 0.12, (sx * (cw / 2 - 0.06), y + sy * (cd / 2 - 0.05), 0.06), seg=12)
    # television: slim panel on a pedestal foot
    tw, th = w * 0.96, 0.56
    z0 = ch + 0.07
    rbox("metal_color", (0.28, 0.16, 0.012), (0, y, ch + 0.006), bevel=0.004)
    rbox("metal_color", (0.06, 0.03, 0.12), (0, y - 0.01, ch + 0.06), bevel=0.006)
    rbox("gloss_color", (tw, 0.03, th), (0, y - 0.015, z0 + th / 2), bevel=0.006, seg=3)
    rbox("screen", (tw - 0.025, 0.004, th - 0.025), (0, y + 0.0015, z0 + th / 2), bevel=0.0)
    rbox("metal_color", (tw * 0.5, 0.06, 0.055), (0, front - 0.035, ch + 0.0275), bevel=0.012, seg=3)


def bookshelf(w, d):
    bw, bd, h = w * 0.9, d * 0.38, 1.86
    y = -d * 0.29
    for sx in (-1, 1):
        rbox("wood_color", (0.024, bd, h), (sx * (bw / 2 - 0.012), y, h / 2), bevel=0.003)
    rbox("wood_color", (bw + 0.02, bd + 0.02, 0.03), (0, y + 0.005, h - 0.015), bevel=0.006)
    rbox("wood_color", (bw - 0.03, 0.01, h - 0.04), (0, y - bd / 2 + 0.005, h / 2), bevel=0.0)
    rbox("wood_color", (bw - 0.04, 0.02, 0.07), (0, y + bd / 2 - 0.012, 0.035), bevel=0.003)
    rng = random.Random(11)
    shelves = [0.08 + i * 0.44 for i in range(4)] + [h - 0.03]
    for k, z in enumerate(shelves[:-1]):
        rbox("wood_color", (bw - 0.04, bd - 0.01, 0.022), (0, y + 0.005, z + 0.011), bevel=0.003)
        x = -bw / 2 + 0.035
        end = bw / 2 - 0.035
        if k == 1:
            end = bw * 0.12
        i = 0
        lean = False
        while x < end - 0.03:
            bt = 0.025 + rng.random() * 0.025
            bh = 0.22 + rng.random() * 0.1
            bdp = bd * (0.7 + rng.random() * 0.2)
            m = f"book_{rng.randrange(6)}"
            if not lean and rng.random() < 0.12 and x > -bw / 2 + 0.1:
                rbox(m, (bt, bdp, bh), (x + bh * 0.25, y + 0.0, z + 0.022 + bh * 0.47), rot=(0, -0.45, 0), bevel=0.003)
                x += bh * 0.5
                lean = True
                continue
            rbox(m, (bt, bdp, bh), (x + bt / 2, y + bd / 2 - bdp / 2 - 0.01, z + 0.022 + bh / 2), bevel=0.003)
            x += bt + 0.002
            i += 1
        if k == 1:
            for j in range(3):
                rbox(f"book_{(j + 2) % 6}", (0.2, 0.15, 0.03), (bw * 0.28, y + 0.01, z + 0.037 + j * 0.031), rot=(0, 0, 0.1 * j), bevel=0.003)
            lathe("porcelain", [(0, z + 0.022), (0.04, z + 0.022), (0.05, z + 0.08), (0.03, z + 0.13), (0.035, z + 0.15), (0, z + 0.15)], (bw * 0.28, y, 0.0), seg=20)


def toilet(w, d):
    y = -d * 0.04
    lathe("gloss_color", [(0, 0.0), (0.12, 0.0), (0.12, 0.01), (0.095, 0.05), (0.09, 0.2), (0.15, 0.32), (0.19, 0.4), (0.0, 0.4)], (0, y + 0.03, 0), seg=28, scale=(1.0, 1.35, 1))
    lathe("gloss_color", [(0.0, 0.405), (0.15, 0.405), (0.19, 0.41), (0.2, 0.425), (0.19, 0.435), (0.0, 0.435)], (0, y + 0.03, 0), seg=28, scale=(1.0, 1.32, 1))
    lathe("gloss_color", [(0.0, 0.438), (0.185, 0.438), (0.19, 0.448), (0.18, 0.455), (0.0, 0.452)], (0, y + 0.03, 0), seg=28, scale=(1.0, 1.32, 1))
    rbox("gloss_accent", (0.42, 0.19, 0.38), (0, -d / 2 + 0.16, 0.62), bevel=0.025, seg=3)
    rbox("gloss_accent", (0.45, 0.21, 0.035), (0, -d / 2 + 0.16, 0.83), bevel=0.012, seg=3)
    rbox("gloss_accent", (0.2, 0.12, 0.08), (0, -d / 2 + 0.15, 0.4), bevel=0.02)
    rbox("chrome", (0.06, 0.012, 0.014), (-0.17, -d / 2 + 0.26, 0.76), bevel=0.005)


def shower(w, d):
    rbox("porcelain", (w * 0.97, d * 0.97, 0.08), (0, 0, 0.04), bevel=0.012, seg=3)
    rbox("porcelain", (w * 0.88, d * 0.88, 0.02), (0, 0, 0.075), bevel=0.01)
    lathe("chrome", [(0, 0.081), (0.035, 0.081), (0.035, 0.084), (0, 0.084)], (0, 0, 0), seg=20)
    h = 2.0
    for (x, y, sx, sy) in ((0, d * 0.47, w * 0.94, 0.01), (w * 0.47, 0, 0.01, d * 0.94)):
        rbox("glass", (sx, sy, h), (x, y, 0.08 + h / 2), bevel=0.0)
    for (x0, y0, x1, y1) in ((-w * 0.47, d * 0.47, w * 0.47, d * 0.47), (w * 0.47, d * 0.47, w * 0.47, -d * 0.47)):
        sweep("chrome", [(x0, y0, 2.08), (x1, y1, 2.08)], 0.008, seg=8)
        sweep("chrome", [(x0, y0, 0.08), (x1, y1, 0.08)], 0.008, seg=8)
    cyl("chrome", 0.01, h, (w * 0.47, d * 0.47, 0.08 + h / 2), seg=10)
    sweep("chrome", [(w * 0.1, d * 0.47 - 0.05, 0.9), (w * 0.1, d * 0.47 - 0.01, 0.9)], 0.01, seg=8)
    # rain head on an arm from the back wall, plus the mixer valve
    back = -d * 0.48
    sweep("chrome", [(0, back, 1.9), (0, back + 0.06, 2.0), (0, back + 0.3, 2.02)], 0.011, seg=12)
    lathe("chrome", [(0, 1.98), (0.11, 1.99), (0.12, 2.0), (0.11, 2.01), (0.02, 2.02), (0, 2.02)], (0, back + 0.32, 0), seg=28)
    cyl("chrome", 0.05, 0.02, (0, back + 0.01, 1.1), rot=(PI / 2, 0, 0), seg=24, bevel=0.004)
    sweep("chrome", [(0, back + 0.02, 1.1), (0, back + 0.06, 1.1), (0.06, back + 0.08, 1.1)], 0.008, seg=8)
    rbox("glass", (0.3, 0.12, 0.012), (-w * 0.3, back + 0.07, 1.25), bevel=0.003)
    rbox("paint_accent", (0.06, 0.05, 0.16), (-w * 0.36, back + 0.07, 1.336), bevel=0.012)


def bath_sink(w, d):
    y = d * -0.08
    lathe("gloss_color", [(0, 0), (0.12, 0), (0.12, 0.015), (0.085, 0.04), (0.07, 0.2), (0.065, 0.5), (0.08, 0.66), (0.0, 0.66)], (0, y, 0), seg=24, scale=(1.0, 0.8, 1))
    rbox("gloss_color", (w * 0.56, d * 0.44, 0.14), (0, y + 0.02, 0.76), bevel=0.04, seg=4)
    lathe("porcelain", [(0.0, 0.79), (0.15, 0.79), (0.17, 0.83), (0.0, 0.83)], (0, y + 0.04, 0.0), seg=28, scale=(1.0, 0.72, 1))
    lathe("chrome", [(0, 0.795), (0.016, 0.795), (0, 0.797)], (0, y + 0.04, 0), seg=12)
    back = y + 0.02 - d * 0.22 + 0.04
    cyl("chrome", 0.018, 0.08, (0, back, 0.87), seg=16, bevel=0.003)
    sweep("chrome", [(0, back, 0.9), (0, back + 0.06, 0.91), (0, back + 0.1, 0.88)], 0.008, seg=10)
    for sx in (-1, 1):
        cyl("chrome", 0.012, 0.04, (sx * 0.09, back, 0.85), seg=12, bevel=0.003)
    # mirror on the wall behind
    my = -d * 0.48
    rbox("metal_accent", (w * 0.5, 0.025, 0.66), (0, my, 1.42), bevel=0.012, seg=3)
    rbox("mirror", (w * 0.46, 0.01, 0.62), (0, my + 0.013, 1.42), bevel=0.004)


def computer(w, d):
    dw, dd = w * 0.96, d * 0.62
    y = -d * 0.18
    rbox("wood_color", (dw, dd, 0.035), (0, y, 0.7425), bevel=0.006)
    for sx in (-1, 1):
        x = sx * (dw / 2 - 0.05)
        sweep("blackmetal", [(x, y + dd / 2 - 0.05, 0.0), (x, y + dd / 2 - 0.05, 0.725), (x, y - dd / 2 + 0.05, 0.725), (x, y - dd / 2 + 0.05, 0.0)], 0.014, seg=10, caps=True)
        sweep("blackmetal", [(x, y + dd / 2 - 0.05, 0.012), (x, y - dd / 2 + 0.05, 0.012)], 0.012, seg=8)
    rbox("blackmetal", (dw - 0.1, 0.012, 0.18), (0, y - dd / 2 + 0.06, 0.62), bevel=0.003)
    # monitor
    my = y - dd * 0.2
    rbox("metal_color", (0.22, 0.16, 0.01), (0, my, 0.765), bevel=0.004)
    rbox("metal_color", (0.04, 0.025, 0.24), (0, my - 0.02, 0.88), rot=(0.08, 0, 0), bevel=0.008)
    rbox("gloss_accent", (0.6, 0.025, 0.36), (0, my + 0.0, 1.11), bevel=0.006, seg=3)
    rbox("screen", (0.58, 0.004, 0.335), (0, my + 0.0135, 1.114), bevel=0.0)
    # keyboard with key rows, mouse and a mug
    ky = y + dd * 0.18
    rbox("paint_accent", (0.42, 0.13, 0.016), (0, ky, 0.768), rot=(0.05, 0, 0), bevel=0.005)
    for r in range(4):
        for c in range(14):
            rbox("keys", (0.024, 0.022, 0.008), (-0.19 + c * 0.0292, ky - 0.045 + r * 0.028, 0.779 + r * 0.0014), bevel=0.002, seg=1)
    rbox("keys", (0.15, 0.022, 0.008), (0.0, ky + 0.067, 0.785), bevel=0.002, seg=1)
    ball("paint_accent", 0.03, (0.3, ky + 0.01, 0.765), scale=(0.75, 1.15, 0.45), seg=16, rings=10)
    lathe("porcelain", [(0, 0.76), (0.04, 0.76), (0.042, 0.85), (0.037, 0.85), (0.036, 0.77), (0, 0.77)], (-0.34, y - 0.05, 0), seg=20)
    sweep("porcelain", [(-0.30, y - 0.05, 0.835), (-0.278, y - 0.05, 0.83), (-0.278, y - 0.05, 0.79), (-0.30, y - 0.05, 0.785)], 0.006, seg=8)
    # office chair in front of the desk (Sims sit at z = -0.75 d in three.js, +Y here)
    cy = d * 0.75
    hub = Vector((0, cy, 0.09))
    for i in range(5):
        a = i / 5 * 2 * PI + 0.3
        tip = hub + Vector((math.cos(a) * 0.3, math.sin(a) * 0.3, -0.03))
        sweep("blackmetal", [hub, hub.lerp(tip, 0.5) + Vector((0, 0, 0.01)), tip], lambda t: lerp(0.022, 0.014, t), seg=10)
        ball("rubber", 0.025, (tip.x, tip.y, 0.026), scale=(1, 0.7, 1), seg=12, rings=8)
    cyl("chrome", 0.02, 0.32, (0, cy, 0.25), seg=16)
    cyl("blackmetal", 0.032, 0.14, (0, cy, 0.16), seg=16)
    rbox("blackmetal", (0.24, 0.24, 0.04), (0, cy, 0.42), bevel=0.01)
    cushion("cloth_accent", (0.48, 0.46, 0.07), (0, cy + 0.0, 0.47), puff=0.02, round_=0.03)
    # the backrest is on the side away from the desk: the Sim sits facing the screen
    sweep("blackmetal", [(0, cy + 0.12, 0.44), (0, cy + 0.27, 0.5), (0, cy + 0.27, 0.62)], 0.018, seg=10)
    cushion("cloth_accent", (0.44, 0.07, 0.48), (0, cy + 0.27, 0.86), rot=(0.12, 0, 0), puff=0.03, round_=0.035)
    for sx in (-1, 1):
        sweep("blackmetal", [(sx * 0.22, cy, 0.44), (sx * 0.25, cy, 0.62), (sx * 0.25, cy - 0.12, 0.64)], 0.012, seg=8)
        rbox("rubber", (0.06, 0.22, 0.025), (sx * 0.25, cy - 0.02, 0.655), bevel=0.01)


def stereo(w, d):
    cw, cd, ch = w * 0.72, d * 0.45, 0.38
    y = d * 0.1 - 0.05
    rbox("wood_walnut", (cw, cd, ch), (0, y, ch / 2 + 0.06), bevel=0.006)
    for sx in (-1, 1):
        for sy in (-1, 1):
            cyl("wood_walnut", 0.015, 0.06, (sx * (cw / 2 - 0.04), y + sy * (cd / 2 - 0.04), 0.03), r2=0.01, seg=12)
    front = y + cd / 2
    rbox("wood_walnut", (cw - 0.04, 0.012, ch - 0.06), (0, front + 0.004, ch / 2 + 0.06), bevel=0.003)
    # receiver
    rbox("gloss_color", (0.34, 0.26, 0.12), (0, y, ch + 0.06 + 0.06), bevel=0.008)
    rbox("display", (0.12, 0.004, 0.03), (0.04, y + 0.131, ch + 0.13), bevel=0.002)
    cyl("chrome", 0.028, 0.02, (-0.11, y + 0.135, ch + 0.12), rot=(PI / 2, 0, 0), seg=20, bevel=0.003)
    for i in range(4):
        cyl("chrome", 0.007, 0.012, (0.0 + i * 0.03, y + 0.135, ch + 0.09), rot=(PI / 2, 0, 0), seg=10)
    # speakers with woofer, tweeter and accent rings
    for sx in (-1, 1):
        x = sx * (w * 0.32)
        rbox("gloss_color", (0.18, 0.2, 0.32), (x, y, ch + 0.06 + 0.16), bevel=0.01)
        fy = y + 0.101
        for z, r in ((ch + 0.06 + 0.11, 0.065), (ch + 0.06 + 0.26, 0.025)):
            lathe("metal_accent", [(r * 1.08, 0), (r * 1.1, 0.004), (r * 0.98, 0.006), (0, 0.006)], (x, fy, z), rot=(-PI / 2, 0, 0), seg=24)
            lathe("blackmetal", [(r * 0.95, 0.006), (r * 0.5, -0.012), (r * 0.18, -0.012), (r * 0.12, 0.0), (0, 0.004)], (x, fy, z), rot=(-PI / 2, 0, 0), seg=24)


def lamp(w, d):
    bx, by = -0.22, -0.22
    lathe("metal_color", [(0, 0), (0.16, 0), (0.165, 0.012), (0.16, 0.035), (0.13, 0.045), (0, 0.05)], (bx, by, 0), seg=32)
    ctrl = [Vector((bx, by, 0.04)), Vector((bx, by, 0.9)), Vector((bx + 0.02, by + 0.02, 1.45)), Vector((bx + 0.15, by + 0.15, 1.78)), Vector((0.12, 0.12, 1.86)), Vector((0.3, 0.3, 1.78))]
    pts = []
    for i in range(len(ctrl) - 1):
        for k in range(6):
            t = k / 6
            a, b = ctrl[i], ctrl[i + 1]
            pts.append(a.lerp(b, t))
    pts.append(ctrl[-1])
    smooth = [pts[0]] + [(pts[i - 1] + pts[i] * 2 + pts[i + 1]) / 4 for i in range(1, len(pts) - 1)] + [pts[-1]]
    sweep("metal_color", smooth, 0.012, seg=10)
    tip = smooth[-1]
    lathe("metal_color", [(0.0, 0.0), (0.03, -0.004), (0.15, -0.1), (0.2, -0.19), (0.195, -0.195), (0.145, -0.105), (0.026, -0.012), (0, -0.01)], (tip.x, tip.y, tip.z), seg=36)
    lathe("glow_accent", [(0.0, -0.05), (0.04, -0.06), (0.05, -0.11), (0.0, -0.12)], (tip.x, tip.y, tip.z), seg=20)


def plant(w, d):
    lathe("paint_color", [(0, 0.0), (0.12, 0.0), (0.135, 0.02), (0.165, 0.27), (0.18, 0.28), (0.185, 0.31), (0.17, 0.315), (0.155, 0.3), (0.0, 0.3)], (0, 0, 0), seg=32)
    lathe("soil", [(0, 0.27), (0.155, 0.27), (0.155, 0.285), (0, 0.29)], (0, 0, 0), seg=24)
    rng = random.Random(5)
    for i in range(16):
        a = i / 16 * 2 * PI + rng.random() * 0.3
        length = 0.42 + rng.random() * 0.22
        rise = 0.35 + rng.random() * 0.3
        base = Vector((math.cos(a) * 0.03, math.sin(a) * 0.03, 0.29))
        pts, widths = [], []
        n = 14
        for k in range(n + 1):
            t = k / n
            out = length * t
            up = rise * math.sin(t * PI * 0.62) - 0.25 * t * t
            pts.append(base + Vector((math.cos(a) * out, math.sin(a) * out, up)))
            leaflet = 0.5 + 0.5 * abs(math.sin(t * PI * 7))
            widths.append(0.055 * math.sin(PI * min(1.0, t * 1.05)) ** 0.7 * leaflet + 0.002)
        ribbon("leaf_accent", pts, widths, (0, 0, 1))


def rug(w, d):
    rbox("cloth_color", (w * 0.92, d * 0.86, 0.012), (0, 0, 0.006), bevel=0.004)
    for inset, m in ((0.07, "cloth_accent"), (0.11, "cloth_color"), (0.2, "cloth_accent"), (0.26, "cloth_color")):
        rbox(m, (w * 0.92 - inset * 2, d * 0.86 - inset * 2, 0.012), (0, 0, 0.0065 + inset * 0.001), bevel=0.002)
    for i, s in enumerate((0.5, 0.36, 0.22)):
        rbox("cloth_accent" if i % 2 == 0 else "cloth_color", (s, s, 0.012), (0, 0, 0.0075 + i * 0.0006), rot=(0, 0, PI / 4), bevel=0.002)
    for sy in (-1, 1):
        for i in range(36):
            x = -w * 0.44 + i * (w * 0.88) / 35
            rbox("linen", (0.012, 0.05, 0.003), (x, sy * (d * 0.43 + 0.025), 0.002), bevel=0.0)


def grill(w, d):
    z = 0.78
    lathe("gloss_accent", [(0.0, z - 0.25), (0.08, z - 0.25), (0.18, z - 0.21), (0.25, z - 0.13), (0.28, z - 0.03), (0.285, z), (0.29, z + 0.005), (0.0, z + 0.005)], (0, 0, 0), seg=40)
    lathe("gloss_accent", [(0.29, z + 0.008), (0.285, z + 0.05), (0.26, z + 0.13), (0.2, z + 0.2), (0.11, z + 0.24), (0.0, z + 0.25)], (0, 0, 0), seg=40)
    lathe("blackmetal", [(0.27, z + 0.004), (0.28, z + 0.008), (0.27, z + 0.012)], (0, 0, 0), seg=40)
    lathe("steel", [(0, z + 0.25), (0.04, z + 0.25), (0.045, z + 0.262), (0.0, z + 0.265)], (0, 0, 0), seg=20)
    sweep("wood_dark", [(-0.09, 0.0, z + 0.285), (0.09, 0.0, z + 0.285)], 0.016, seg=12)
    for sx in (-1, 1):
        sweep("steel", [(sx * 0.07, 0, z + 0.24), (sx * 0.09, 0, z + 0.285)], 0.006, seg=8)
    for sx in (-1, 1):
        sweep("wood_dark", [(sx * 0.23, -0.06, z - 0.04), (sx * 0.34, -0.06, z - 0.04)], 0.014, seg=10)
    for i in range(3):
        a = i / 3 * 2 * PI + PI / 2
        top = Vector((math.cos(a) * 0.16, math.sin(a) * 0.16, z - 0.18))
        foot = Vector((math.cos(a) * 0.3, math.sin(a) * 0.3, 0.03 if i else 0.08))
        sweep("blackmetal", [top, top.lerp(foot, 0.5), foot], 0.014, seg=10)
        if i:
            cyl("rubber", 0.065, 0.03, (foot.x, foot.y, 0.065), rot=(0, PI / 2, a), seg=20, bevel=0.008)
    lathe("steel", [(0.0, 0.25), (0.17, 0.25), (0.175, 0.29), (0.17, 0.295), (0.165, 0.255), (0.0, 0.255)], (0, 0, 0), seg=32)
    sweep("steel", [(0.25, 0, 0.27), (0.12, 0, 0.27)], 0.006, seg=6)


def bench(w, d):
    for sx in (-1, 1):
        x = sx * (w * 0.42)
        sweep("metal_accent", [(x, 0.18, 0.0), (x, 0.16, 0.2), (x, 0.12, 0.42), (x, 0.08, 0.44), (x, -0.16, 0.44), (x, -0.2, 0.42), (x, -0.22, 0.2), (x, -0.24, 0.0)], 0.02, seg=10, flat=0.55)
        sweep("metal_accent", [(x, -0.18, 0.44), (x, -0.24, 0.6), (x, -0.27, 0.82)], 0.02, seg=10, flat=0.55)
        sweep("metal_accent", [(x, -0.2, 0.62), (x, 0.0, 0.64), (x, 0.17, 0.62), (x, 0.2, 0.58), (x, 0.17, 0.44)], 0.016, seg=10)
        ball("metal_accent", 0.025, (x, 0.2, 0.6), seg=12, rings=8)
    for i, yy in enumerate((0.15, 0.07, -0.01, -0.09, -0.17)):
        rbox("wood_color", (w * 0.96, 0.07, 0.03), (0, yy, 0.46), bevel=0.008)
    for i, (zz, yy) in enumerate(((0.56, -0.22), (0.66, -0.245), (0.76, -0.265))):
        rbox("wood_color", (w * 0.96, 0.025, 0.075), (0, yy, zz), rot=(-0.2, 0, 0), bevel=0.008)


def picnic(w, d):
    for i in range(5):
        y = -0.32 + i * 0.16
        rbox("wood_color", (w * 0.94, 0.15, 0.04), (0, y * (d / 2) / 0.9 * 0.9 * 0.7, 0.76), bevel=0.008)
    for sy in (-1, 1):
        for i in range(2):
            rbox("wood_color", (w * 0.94, 0.13, 0.04), (0, sy * (d * 0.36 + (i - 0.5) * 0.14), 0.45), bevel=0.008)
    for sx in (-1, 1):
        x = sx * w * 0.34
        for sy in (-1, 1):
            rbox("wood_accent", (0.07, 0.09, 0.98), (x, sy * 0.25, 0.39), rot=(sy * 0.6, 0, 0), bevel=0.008)
        rbox("wood_accent", (0.07, d * 0.94, 0.1), (x, 0, 0.38), bevel=0.008)
        rbox("wood_accent", (0.06, 0.6, 0.09), (x, 0, 0.7), bevel=0.008)
    rbox("wood_accent", (w * 0.66, 0.07, 0.07), (0, 0, 0.3), bevel=0.008)


def garden(w, d):
    for z in (0.08, 0.24):
        for sy in (-1, 1):
            rbox("wood_color", (w * 0.96, 0.04, 0.15), (0, sy * (d * 0.42), z), bevel=0.006)
        for sx in (-1, 1):
            rbox("wood_color", (0.04, d * 0.84, 0.15), (sx * (w * 0.46), 0, z), bevel=0.006)
    for sx in (-1, 1):
        for sy in (-1, 1):
            rbox("wood_color", (0.07, 0.07, 0.38), (sx * (w * 0.46), sy * (d * 0.42), 0.19), bevel=0.008)
    rbox("wood_color", (w * 0.98, 0.07, 0.03), (0, d * 0.43, 0.335), bevel=0.006)
    rbox("wood_color", (w * 0.98, 0.07, 0.03), (0, -d * 0.43, 0.335), bevel=0.006)
    cushion("soil", (w * 0.88, d * 0.78, 0.04), (0, 0, 0.29), puff=0.03, round_=0.015)
    rng = random.Random(7)
    for i in range(5):
        cx = -w * 0.38 + i * w * 0.19
        for j in range(7):
            a = j / 7 * 2 * PI + rng.random()
            base = Vector((cx, 0.16, 0.32))
            tip = base + Vector((math.cos(a) * 0.1, math.sin(a) * 0.1, 0.08 + rng.random() * 0.04))
            ribbon("leaf_accent", [base, base.lerp(tip, 0.4) + Vector((0, 0, 0.03)), tip], [0.01, 0.045, 0.02], (0, 0, 1))
        ball("leaf_accent", 0.05, (cx, 0.16, 0.36), scale=(1, 1, 0.8), seg=12, rings=8)
    for i in range(3):
        cx = -w * 0.3 + i * w * 0.3
        cyl("wood_dark", 0.008, 0.7, (cx, -0.18, 0.62), seg=6)
        for k in range(6):
            ball("leaf", 0.055 + rng.random() * 0.02, (cx + rng.uniform(-0.07, 0.07), -0.18 + rng.uniform(-0.06, 0.06), 0.42 + k * 0.08), seg=10, rings=6, scale=(1, 1, 0.75))
        for k in range(4):
            ball("tomato", 0.022, (cx + rng.uniform(-0.08, 0.08), -0.18 + rng.uniform(-0.09, 0.09), 0.45 + rng.random() * 0.35), seg=12, rings=8)


def hoop(w, d):
    by = -d * 0.4
    rbox("blackmetal", (0.3, 0.3, 0.02), (0, by, 0.01), bevel=0.004)
    rbox("blackmetal", (0.09, 0.09, 2.9), (0, by, 1.45), bevel=0.01)
    sweep("blackmetal", [(0, by, 2.75), (0, by + 0.2, 2.95), (0, by + 0.38, 2.97)], 0.03, seg=10)
    sweep("blackmetal", [(0, by, 2.55), (0, by + 0.38, 2.82)], 0.022, seg=8)
    bb = by + 0.4
    rbox("gloss_color", (1.12, 0.035, 0.72), (0, bb, 3.12), bevel=0.012)
    rbox("metal_accent", (1.12, 0.04, 0.04), (0, bb + 0.002, 3.46), bevel=0.0)
    rbox("metal_accent", (1.12, 0.04, 0.04), (0, bb + 0.002, 2.78), bevel=0.0)
    for sx in (-1, 1):
        rbox("metal_accent", (0.04, 0.04, 0.72), (sx * 0.54, bb + 0.002, 3.12), bevel=0.0)
    for (cx, cz, sx, sz) in ((0, 3.18, 0.46, 0.03), (0, 2.96, 0.46, 0.03), (-0.215, 3.07, 0.03, 0.24), (0.215, 3.07, 0.03, 0.24)):
        rbox("paint_accent", (sx, 0.04, sz), (cx, bb + 0.003, cz), bevel=0.0)
    rim_c = Vector((0, bb + 0.26, 3.05))
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=False, segments=32, radius1=0.23, radius2=0.23, depth=0.001)
    bm.free()
    pts = [rim_c + Vector((math.cos(a / 40 * 2 * PI) * 0.23, math.sin(a / 40 * 2 * PI) * 0.23, 0)) for a in range(41)]
    sweep("metal_accent", pts, 0.009, seg=8, caps=False)
    sweep("metal_accent", [(0, bb + 0.02, 3.05), (0, bb + 0.035, 3.05)], 0.03, seg=8)
    rbox("metal_accent", (0.12, 0.06, 0.012), (0, bb + 0.05, 3.05), bevel=0.003)
    for i in range(12):
        a0 = i / 12 * 2 * PI
        pts = []
        for k in range(6):
            t = k / 5
            r = lerp(0.225, 0.14, t)
            a = a0 + (0.26 if k % 2 else 0)
            pts.append(rim_c + Vector((math.cos(a) * r, math.sin(a) * r, -t * 0.42)))
        sweep("net", pts, 0.004, seg=5, caps=False)
    ball("ball", 0.12, (0.22, d * 0.3, 0.12), seg=24, rings=16)
    for rot in ((0, 0, 0), (PI / 2, 0, 0)):
        lathe("charcoal", [(0.1205, -0.003), (0.1205, 0.003)], (0.22, d * 0.3, 0.12), rot=rot, seg=32)


def tree(w, d):
    rng = random.Random(21)
    trunk = [Vector((0, 0, 0)), Vector((0.02, 0.0, 1.0)), Vector((0.0, 0.03, 1.9)), Vector((-0.03, 0.02, 2.6))]
    sweep("bark", trunk, lambda t: lerp(0.15, 0.07, t) + 0.05 * max(0.0, 0.12 - t) * 8, seg=14)
    for r, a in ((0.21, 0.0), (0.19, 1.3), (0.2, 2.6), (0.18, 3.9), (0.2, 5.1)):
        sweep("bark", [(0, 0, 0.12), (math.cos(a) * r, math.sin(a) * r, -0.02)], lambda t: lerp(0.06, 0.02, t), seg=8)
    tips = []
    for i in range(7):
        a = i / 7 * 2 * PI + rng.random() * 0.5
        h0 = 1.3 + i * 0.18
        start = Vector((0.0, 0.0, h0))
        tip = start + Vector((math.cos(a) * (1.0 + rng.random() * 0.4), math.sin(a) * (1.0 + rng.random() * 0.4), 1.0 + rng.random() * 0.8))
        mid = start.lerp(tip, 0.5) + Vector((0, 0, 0.15))
        sweep("bark", [start, mid, tip], lambda t: lerp(0.055, 0.015, t), seg=8)
        tips.append(tip)
    clumps = list(tips)
    for i in range(22):
        a = i * 2.39996
        rr = 0.3 + 0.95 * ((i * 7) % 11) / 10
        clumps.append(Vector((math.cos(a) * rr, math.sin(a) * rr, 2.7 + 1.9 * ((i * 5) % 9) / 8 - rr * 0.35)))
    tv, tf = None, None
    for i, c in enumerate(clumps):
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=3, radius=1.0)
        r = 0.5 + rng.random() * 0.3
        for v in bm.verts:
            n = v.co.normalized()
            bumpy = 1 + 0.14 * math.sin(n.x * 11 + i) * math.sin(n.y * 10 + i * 2) * math.sin(n.z * 9) + 0.05 * math.sin(n.x * 31 + n.y * 27 + i)
            v.co = n * r * bumpy
            v.co.z *= 0.78
        finish(bm, "crown", "leaf_accent" if i % 3 else "leaf", (c.x, c.y, c.z), (0, 0, rng.random() * 3))


def flowers(w, d):
    for i in range(16):
        a = i / 16 * 2 * PI
        r = 0.44
        rbox("stone", (0.13, 0.08, 0.1), (math.cos(a) * r, math.sin(a) * r, 0.05), rot=(0, 0, a + PI / 2), bevel=0.02, seg=2)
    cushion("mulch", (0.82, 0.82, 0.08), (0, 0, 0.05), puff=0.05, round_=0.03)
    rng = random.Random(9)
    colors = ["leaf_accent", "flower_yellow", "flower_white", "flower_red"]
    for i in range(14):
        x, y = rng.uniform(-0.3, 0.3), rng.uniform(-0.3, 0.3)
        if x * x + y * y > 0.1:
            continue
        h = 0.22 + rng.random() * 0.14
        sweep("leaf", [(x, y, 0.08), (x + 0.01, y, 0.08 + h * 0.5), (x, y + 0.01, 0.08 + h)], 0.004, seg=5)
        for k in range(3):
            a = rng.random() * 2 * PI
            base = Vector((x, y, 0.1 + k * 0.03))
            tip = base + Vector((math.cos(a) * 0.09, math.sin(a) * 0.09, 0.06))
            ribbon("leaf", [base, base.lerp(tip, 0.5) + Vector((0, 0, 0.02)), tip], [0.004, 0.018, 0.003], (0, 0, 1))
        m = colors[i % 4]
        c = Vector((x, y + 0.01, 0.08 + h))
        for p in range(6):
            a = p / 6 * 2 * PI
            ball(m if m != "leaf_accent" else "glow_accent" if False else m, 0.022, (c.x + math.cos(a) * 0.022, c.y + math.sin(a) * 0.022, c.z), scale=(1, 0.55, 0.25), rot=(0, 0, a), seg=10, rings=6)
        ball("flower_yellow" if m != "flower_yellow" else "wood_dark", 0.012, (c.x, c.y, c.z + 0.006), seg=10, rings=6)


ITEMS = [
    ("bed-twin", 1, 2, lambda w, d: bed(w, d, False)),
    ("bed-double", 2, 2, lambda w, d: bed(w, d, True)),
    ("fridge", 1, 1, fridge),
    ("stove", 1, 1, stove),
    ("counter", 1, 1, counter),
    ("kitchen-sink", 1, 1, kitchen_sink),
    ("dining-table", 2, 1, dining_table),
    ("dining-chair", 1, 1, dining_chair),
    ("sofa", 2, 1, sofa),
    ("armchair", 1, 1, armchair),
    ("tv", 1, 1, tv),
    ("bookshelf", 1, 1, bookshelf),
    ("toilet", 1, 1, toilet),
    ("shower", 1, 1, shower),
    ("bath-sink", 1, 1, bath_sink),
    ("computer", 1, 1, computer),
    ("stereo", 1, 1, stereo),
    ("lamp", 1, 1, lamp),
    ("plant", 1, 1, plant),
    ("rug", 2, 2, rug),
    ("grill", 1, 1, grill),
    ("bench", 2, 1, bench),
    ("picnic", 2, 2, picnic),
    ("garden", 2, 1, garden),
    ("hoop", 1, 1, hoop),
    ("tree", 1, 1, tree),
    ("flowers", 1, 1, flowers),
]


def preview(prefix, roots):
    scn = bpy.context.scene
    scn.render.engine = "CYCLES"
    scn.cycles.samples = 32
    scn.cycles.device = "CPU"
    scn.render.resolution_x = 420
    scn.render.resolution_y = 420
    world = bpy.data.worlds.new("W")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.75, 0.8, 0.86, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.9
    scn.world = world
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 3.0
    sun.rotation_euler = (math.radians(45), math.radians(10), math.radians(-35))
    scn.collection.objects.link(sun)
    floor = bpy.data.meshes.new("floor")
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=60)
    bm.to_mesh(floor)
    fo = bpy.data.objects.new("floor", floor)
    scn.collection.objects.link(fo)
    fm = bpy.data.materials.new("floor")
    fm.use_nodes = True
    fm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.78, 0.74, 0.68, 1)
    floor.materials.append(fm)
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    cam.data.lens = 50
    scn.collection.objects.link(cam)
    scn.camera = cam
    for i, (root, (name, w, d, _)) in enumerate(zip(roots, ITEMS)):
        for other in roots:
            for ch in other.children_recursive:
                ch.hide_render = other is not root
        size = max(w, d, 1.0)
        tall = {"hoop": 3.5, "tree": 5.0, "shower": 2.2, "lamp": 1.8, "fridge": 1.9, "bookshelf": 1.9}.get(name, 1.0)
        target = Vector((0, 0, tall * 0.42))
        dist = max(size * 1.9, tall * 1.5) + 0.6
        pos = target + Vector((dist * 0.62, dist * 0.78, dist * 0.42 + tall * 0.1))
        cam.location = pos
        cam.rotation_euler = (target - pos).to_track_quat("-Z", "Y").to_euler()
        scn.render.filepath = f"{prefix}-{i:02d}-{name}.png"
        bpy.ops.render.render(write_still=True)


def merge_children(root, name):
    """Apply every modifier and join the item's parts into one mesh (one primitive per material)."""
    kids = [c for c in root.children if c.type == "MESH"]
    bpy.ops.object.select_all(action="DESELECT")
    for c in kids:
        c.select_set(True)
    bpy.context.view_layer.objects.active = kids[0]
    bpy.ops.object.convert(target="MESH")
    bpy.ops.object.join()
    merged = bpy.context.view_layer.objects.active
    merged.name = name + "_mesh"
    merged.data.name = name + "_mesh"


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    roots = []
    only = os.environ.get("HOOD_ONLY")
    for name, w, d, fn in ITEMS:
        root = bpy.data.objects.new(name, None)
        bpy.context.scene.collection.objects.link(root)
        PARENT[0] = root
        fn(w, d)
        merge_children(root, name)
        roots.append(root)
    total = 0
    for root in roots:
        for ch in root.children_recursive:
            if ch.type == "MESH":
                deps = bpy.context.evaluated_depsgraph_get()
                total += len(ch.evaluated_get(deps).data.polygons)
    print("furniture faces", total)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=OUT, use_selection=True, export_format="GLB", export_apply=True, export_yup=True,
                              export_texcoords=False, export_normals=True, export_materials="EXPORT", export_animations=False, export_extras=False)
    print("wrote", OUT)
    prefix = os.environ.get("HOOD_PREVIEW")
    if prefix:
        preview(prefix, roots)


main()
