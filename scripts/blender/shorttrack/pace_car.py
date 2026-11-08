"""Short Track Showdown: an original pace car (a low two-door coupe with a roof light bar) as glTF, with LODs:

    blender -b --factory-startup -P scripts/blender/shorttrack/pace_car.py -- --out assets-src/models/shorttrack

or, with Blender as a Python module (pip install bpy): python3 scripts/blender/shorttrack/pace_car.py

The design is the module's own: no make, model, badge or logo. The body is a closed loft of rounded
superellipse sections (tumblehome above the beltline, a long hood, a short ducktail deck) with the wheel
arches cut by booleans and lined; the greenhouse is a second loft whose roof is paint and whose sides and
screens are glass. Frame and nodes match the race truck: model metres, x forward, y up, z to the right side;
`PaceCar` root with `Body`, and `Wheel_<FL|FR|RL|RR>` hub pivots with `Tire_<..>` under each. AO is baked
into `ao`, then LODs are cut to the Phase 5 budgets (40k / 12k / 3k triangles).
"""

import json
import math
import os
import sys

import bpy
import bmesh
from mathutils import Euler, Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402

LODS = (40000, 12000, 3000)
WHEEL_LODS = (1200, 500, 160)
WHEEL_SEGMENTS = (56, 24, 12)
STATIONS, AROUND = 140, 88
X0, X1 = -2.30, 2.32
AXLES = (1.40, -1.38)
TYRE_R, TYRE_W, TRACK = 0.335, 0.27, 0.80


def smooth(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def half_width(x):
    nose = smooth(X1, X1 - 0.55, x)
    tail = smooth(X0, X0 + 0.45, x)
    hips = 0.035 * math.exp(-((x + 1.35) / 0.55) ** 2) + 0.025 * math.exp(-((x - 1.4) / 0.5) ** 2)
    return lerp(0.80, 0.93, nose) * lerp(0.86 / 0.93, 1.0, tail) + hips


def bottom(x):
    return 0.17 + 0.07 * smooth(X1 - 0.5, X1, x) + 0.08 * smooth(X0 + 0.45, X0, x)


def top(x):
    hood = lerp(0.60, 0.80, smooth(X1, 0.85, x))
    deck = lerp(0.84, 0.88, smooth(-0.95, -2.05, x)) - 0.10 * smooth(-2.05, X0, x)
    return hood if x > 0.0 else lerp(deck, hood, smooth(-0.95, 0.0, x))


def section(x, around, exponent=5.0, taper=0.13):
    """One body cross-section: a superellipse between bottom and top with tumblehome on the upper half."""
    w, z0, z1 = half_width(x), bottom(x), top(x)
    zc, h = (z0 + z1) / 2, (z1 - z0) / 2
    points = []
    for i in range(around):
        a = 2 * math.pi * i / around
        c, s = math.cos(a), math.sin(a)
        y = math.copysign(abs(c) ** (2 / exponent), c) * w
        z = math.copysign(abs(s) ** (2 / exponent), s) * h
        if z > 0:
            y *= 1 - taper * (z / h) ** 2
        points.append((x, y, zc + z))
    return points


def loft(name, rings, mat_of_face=None):
    """A closed tube through rings of equal size, capped at both ends."""
    bm = bmesh.new()
    verts = [[bm.verts.new(p) for p in ring] for ring in rings]
    n = len(rings[0])
    for r in range(len(rings) - 1):
        for i in range(n):
            a, b = verts[r][i], verts[r][(i + 1) % n]
            c, d = verts[r + 1][(i + 1) % n], verts[r + 1][i]
            bm.faces.new((a, d, c, b))
    bm.faces.new(list(reversed(verts[0])))
    bm.faces.new(verts[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def box(name, center, size, mat):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((center[0] + v.co.x * size[0], center[1] + v.co.y * size[1], center[2] + v.co.z * size[2]))
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def cylinder(name, center, radius, depth, mat, segments=48, axis="Y"):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segments, radius1=radius, radius2=radius, depth=depth)
    rot = {"Y": (math.pi / 2, 0, 0), "X": (0, math.pi / 2, 0), "Z": (0, 0, 0)}[axis]
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Euler(rot).to_matrix())
    bmesh.ops.translate(bm, verts=bm.verts, vec=Vector(center))
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    if mat:
        mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def cut(target, cutter):
    mod = target.modifiers.new("arch", "BOOLEAN")
    mod.operation = "DIFFERENCE"
    mod.object = cutter
    mod.solver = "EXACT"
    common.select_only([target], target)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter, do_unlink=True)


def lathe(name, profile, segments, mats):
    """Revolves (radius, y, material index) points about the Y axis (the axle)."""
    bm = bmesh.new()
    rings = []
    for r, y, _ in profile:
        rings.append([bm.verts.new((r * math.cos(2 * math.pi * k / segments), y, r * math.sin(2 * math.pi * k / segments))) for k in range(segments)])
    for j in range(len(rings) - 1):
        for k in range(segments):
            face = bm.faces.new((rings[j][k], rings[j][(k + 1) % segments], rings[j + 1][(k + 1) % segments], rings[j + 1][k]))
            face.material_index = profile[j][2]
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for mat in mats:
        mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def wheel(tag, mats, level):
    """Tyre and five-spoke rim; hub at the origin, axle on Blender Y, rim face outward (+Y left, turned for the right)."""
    r, w = TYRE_R, TYRE_W
    profile = [
        (0.20, -w / 2 + 0.01, 0), (0.24, -w / 2, 0), (r - 0.03, -w / 2 + 0.005, 0), (r, -w / 2 + 0.04, 0),
        (r, w / 2 - 0.04, 0), (r - 0.03, w / 2 - 0.005, 0), (0.24, w / 2, 0), (0.20, w / 2 - 0.01, 1),
        (0.12, w / 2 - 0.05, 1), (0.05, w / 2 - 0.03, 1), (0.0, w / 2 - 0.03, 1),
    ]
    if level == 2:
        profile = [(0.2, -w / 2, 0), (r, -w / 2 + 0.03, 0), (r, w / 2 - 0.03, 0), (0.2, w / 2, 0), (0.0, w / 2 - 0.03, 1)]
    tire = lathe(f"Tire_{tag}", profile, WHEEL_SEGMENTS[level], [mats["tire"], mats["rim"]])
    for k in range(5 if level < 2 else 0):
        a = 2 * math.pi * k / 5
        spoke = box(f"spoke{k}", (0.11 * math.cos(a), w / 2 - 0.035, 0.11 * math.sin(a)), (0.18, 0.025, 0.045), mats["rim"])
        spoke.rotation_euler = (0, -a, 0)
        common.select_only([spoke], spoke)
        bpy.ops.object.transform_apply(rotation=True)
        common.select_only([tire, spoke], tire)
        bpy.ops.object.join()
    if tag in ("FR", "RR"):
        tire.data.transform(Matrix.Rotation(math.pi, 4, "Z"))
    return tire


def greenhouse(mats):
    rings = []
    xs = [lerp(-1.02, 0.92, i / 59) for i in range(60)]
    for x in xs:
        front = smooth(0.92, 0.10, x)
        rear = smooth(-1.02, -0.45, x)
        z0 = top(x) - 0.03
        roof = 1.27
        z1 = lerp(z0 + 0.02, roof, min(front, rear) ** 0.8)
        w0 = half_width(x) * 0.86
        w1 = 0.60
        ring = []
        n = 44
        for i in range(n):
            a = 2 * math.pi * i / n
            c, s = math.cos(a), math.sin(a)
            t = (math.copysign(abs(s) ** 0.4, s) + 1) / 2
            y = math.copysign(abs(c) ** 0.4, c) * lerp(w0, w1, t)
            ring.append((x, y, lerp(z0, z1, t)))
        rings.append(ring)
    obj = loft("Greenhouse", rings)
    obj.data.materials.append(mats["glass"])
    obj.data.materials.append(mats["paint"])
    obj.data.materials.append(mats["trim"])
    for poly in obj.data.polygons:
        c, n = poly.center, poly.normal
        if n.z > 0.86 and c.z > 1.2:
            poly.material_index = 1
        elif abs(c.x - 0.12) < 0.05 or abs(c.x + 0.66) < 0.06:
            poly.material_index = 2
    return obj


def build(level, no_ao):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats = {
        "paint": common.material("pace_paint", (0.82, 0.83, 0.85), 0.28, 0.3, coat=1.0),
        "glass": common.material("pace_glass", (0.02, 0.025, 0.03), 0.05, 0.0, coat=1.0),
        "trim": common.material("pace_trim", (0.02, 0.02, 0.022), 0.6, 0.0),
        "light_red": common.material("pace_light_red", (0.9, 0.02, 0.02), 0.3, 0.0, emission=(1.0, 0.05, 0.03), strength=4.0),
        "light_blue": common.material("pace_light_blue", (0.02, 0.1, 0.95), 0.3, 0.0, emission=(0.05, 0.2, 1.0), strength=4.0),
        "head": common.material("pace_head", (0.9, 0.92, 0.95), 0.05, 0.0, emission=(1.0, 0.98, 0.9), strength=1.0),
        "tail": common.material("pace_tail", (0.35, 0.0, 0.01), 0.1, 0.0, emission=(1.0, 0.02, 0.02), strength=0.5),
        "tire": common.material("pace_tire", (0.012, 0.012, 0.012), 0.9, 0.0),
        "rim": common.material("pace_rim", (0.55, 0.57, 0.6), 0.3, 0.9),
    }
    root = bpy.data.objects.new("PaceCar", None)
    bpy.context.scene.collection.objects.link(root)
    root["frame"] = "x forward, y up, z right, model metres (same as the race truck)"
    root["materials"] = json.dumps(sorted(m.name for m in mats.values()))
    root["lod"] = level
    xs = [lerp(X0, X1, i / (STATIONS - 1)) for i in range(STATIONS)]
    body = loft("Body", [section(x, AROUND) for x in xs])
    body.data.materials.append(mats["paint"])
    for ax in AXLES:
        for side in (1, -1):
            cut(body, cylinder("cutter", (ax, side * 0.86, TYRE_R), TYRE_R + 0.06, 0.42, None, 64))
    parts = [body, greenhouse(mats)]
    for ax in AXLES:
        for side in (1, -1):
            liner = cylinder("liner", (ax, side * 0.66, TYRE_R), TYRE_R + 0.055, 0.02, mats["trim"], 48)
            parts.append(liner)
    nose, tail = X1 - 0.06, X0 + 0.05
    for side in (1, -1):
        parts.append(box("Headlight", (nose + 0.01, side * 0.52, 0.50), (0.10, 0.30, 0.08), mats["head"]))
        parts.append(box("Taillight", (tail - 0.01, side * 0.56, 0.62), (0.08, 0.34, 0.07), mats["tail"]))
        parts.append(box("Mirror", (0.42, side * 0.86, 0.90), (0.14, 0.16, 0.09), mats["paint"]))
        parts.append(box("Skirt", (0.0, side * 0.90, 0.20), (1.9, 0.05, 0.06), mats["trim"]))
    parts.append(box("Grille", (X1 - 0.01, 0.0, 0.36), (0.08, 1.0, 0.14), mats["trim"]))
    parts.append(box("Splitter", (X1 - 0.08, 0.0, 0.21), (0.3, 1.5, 0.03), mats["trim"]))
    parts.append(box("Diffuser", (X0 + 0.08, 0.0, 0.28), (0.2, 1.2, 0.08), mats["trim"]))
    parts.append(box("LightBarBase", (-0.25, 0.0, 1.275), (0.26, 1.12, 0.04), mats["trim"]))
    parts.append(box("LightBarLeft", (-0.25, 0.28, 1.32), (0.22, 0.52, 0.07), mats["light_red"]))
    parts.append(box("LightBarRight", (-0.25, -0.28, 1.32), (0.22, 0.52, 0.07), mats["light_blue"]))
    for obj in parts:
        obj.data.polygons.foreach_set("use_smooth", [True] * len(obj.data.polygons))
    common.select_only(parts, body)
    bpy.ops.object.join()
    body = bpy.context.view_layer.objects.active
    body.name = body.data.name = "Body"
    body.parent = root
    wheel_mats = {"tire": mats["tire"], "rim": mats["rim"]}
    tires = []
    for tag, ax, side in (("FL", AXLES[0], 1), ("FR", AXLES[0], -1), ("RL", AXLES[1], 1), ("RR", AXLES[1], -1)):
        pivot = bpy.data.objects.new(f"Wheel_{tag}", None)
        bpy.context.scene.collection.objects.link(pivot)
        pivot.location = (ax, side * TRACK, TYRE_R)
        pivot.parent = root
        tire = wheel(tag, wheel_mats, level)
        tire.parent = pivot
        tires.append(tire)
    if not no_ao:
        common.try_bake([body, *tires], distance=0.25, floor=0.55)
    report = {tire.name: common.decimate(tire, WHEEL_LODS[level]) for tire in tires}
    report["Body"] = common.decimate(body, LODS[level] - sum(report.values()))
    return report


def main():
    args = common.args(__doc__, {"out": "assets-src/models/shorttrack", "name": "pace_car", "no-ao": False})
    for level in range(len(LODS)):
        report = build(level, args.no_ao)
        path = os.path.join(os.path.abspath(args.out), f"{args.name}_lod{level}.glb")
        common.export(path)
        print(f"[shorttrack] {os.path.basename(path)}: {sum(report.values())} triangles {json.dumps(report)}")


if __name__ == "__main__":
    main()
