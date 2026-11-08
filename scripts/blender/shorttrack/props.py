"""Short Track Showdown: the track prop kit (instanced trackside props) as one glTF, run headless:

    blender -b --factory-startup -P scripts/blender/shorttrack/props.py -- --out assets-src/models/shorttrack

or, with Blender as a Python module (pip install bpy): python3 scripts/blender/shorttrack/props.py

One file, `props_kit.glb`, with one root node per prop (`Prop_<name>`), each a single mesh standing on its
origin (y up, metres) so a renderer can instance it anywhere: a traffic cone, a stack of three old tyres, a
round hay bale, a concrete barrier segment, an infield light tower and a pit board on a post. Every prop is
within `BUDGET` triangles; AO is baked into `ao`. Plain colours only, no text or logos.
"""

import json
import math
import os
import sys

import bpy
import bmesh
from mathutils import Euler, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402

BUDGET = 1500


def new_object(name, bm, mats):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for mat in mats:
        mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def lathe_into(bm, profile, segments, mat_index, offset=(0, 0, 0), smooth=True):
    """Revolves (radius, height) points about Z into bm."""
    rings = []
    for r, z in profile:
        rings.append([bm.verts.new((offset[0] + r * math.cos(2 * math.pi * k / segments), offset[1] + r * math.sin(2 * math.pi * k / segments), offset[2] + z)) for k in range(segments)])
    for j in range(len(rings) - 1):
        for k in range(segments):
            face = bm.faces.new((rings[j][k], rings[j][(k + 1) % segments], rings[j + 1][(k + 1) % segments], rings[j + 1][k]))
            face.material_index = mat_index
            face.smooth = smooth


def box_into(bm, center, size, mat_index, rot_z=0.0):
    made = bmesh.ops.create_cube(bm, size=1.0)["verts"]
    m = Euler((0, 0, rot_z)).to_matrix()
    for v in made:
        v.co = Vector(center) + m @ Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    for f in {f for v in made for f in v.link_faces}:
        f.material_index = mat_index


def cone(m):
    bm = bmesh.new()
    box_into(bm, (0, 0, 0.015), (0.38, 0.38, 0.03), 1)
    lathe_into(bm, [(0.14, 0.03), (0.12, 0.2), (0.105, 0.28), (0.09, 0.36), (0.075, 0.44), (0.04, 0.68), (0.0, 0.7)], 32, 0)
    obj = new_object("Prop_cone", bm, [m["orange"], m["black"]])
    for poly in obj.data.polygons:
        if 0.28 < poly.center.z < 0.36:
            poly.material_index = 2
    obj.data.materials.append(m["white"])
    return obj


def tyre_stack(m):
    bm = bmesh.new()
    for i in range(3):
        z = i * 0.25
        lathe_into(bm, [(0.2, z), (0.3, z + 0.005), (0.33, z + 0.04), (0.34, z + 0.125), (0.33, z + 0.21), (0.3, z + 0.245), (0.2, z + 0.25), (0.2, z)], 36, 0)
    return new_object("Prop_tyre_stack", bm, [m["rubber"]])


def hay_bale(m):
    bm = bmesh.new()
    seg = 28
    rings = []
    for j, y in enumerate((-0.6, -0.58, 0.58, 0.6)):
        r = 0.62 if j in (1, 2) else 0.58
        rings.append([bm.verts.new((r * math.cos(2 * math.pi * k / seg), y, 0.62 + r * math.sin(2 * math.pi * k / seg))) for k in range(seg)])
    for j in range(3):
        for k in range(seg):
            f = bm.faces.new((rings[j][k], rings[j][(k + 1) % seg], rings[j + 1][(k + 1) % seg], rings[j + 1][k]))
            f.smooth = True
    bm.faces.new(rings[0])
    bm.faces.new(list(reversed(rings[-1])))
    return new_object("Prop_hay_bale", bm, [m["hay"]])


def barrier(m):
    bm = bmesh.new()
    prof = [(-0.3, 0.0), (0.3, 0.0), (0.3, 0.08), (0.12, 0.26), (0.08, 0.81), (-0.08, 0.81), (-0.12, 0.26), (-0.3, 0.08)]
    a = [bm.verts.new((-1.5, y, z)) for y, z in prof]
    b = [bm.verts.new((1.5, y, z)) for y, z in prof]
    n = len(prof)
    for i in range(n):
        bm.faces.new((a[i], b[i], b[(i + 1) % n], a[(i + 1) % n]))
    bm.faces.new(list(reversed(a)))
    bm.faces.new(b)
    return new_object("Prop_barrier", bm, [m["concrete"]])


def light_tower(m):
    bm = bmesh.new()
    lathe_into(bm, [(0.2, 0.0), (0.16, 0.3), (0.12, 0.3), (0.1, 14.0), (0.0, 14.05)], 16, 0)
    box_into(bm, (0, 0, 14.2), (2.4, 0.12, 0.08), 0)
    box_into(bm, (0, 0, 15.0), (2.4, 0.12, 0.08), 0)
    for row, z in enumerate((14.45, 15.25)):
        for k in range(4):
            x = -0.9 + k * 0.6
            box_into(bm, (x, -0.12, z), (0.42, 0.18, 0.36), 0)
            box_into(bm, (x, -0.215, z), (0.36, 0.02, 0.3), 1)
    return new_object("Prop_light_tower", bm, [m["steel"], m["lamp"]])


def pit_board(m):
    bm = bmesh.new()
    lathe_into(bm, [(0.03, 0.0), (0.03, 1.6), (0.0, 1.6)], 12, 0)
    box_into(bm, (0, -0.04, 1.75), (0.7, 0.03, 0.5), 1)
    box_into(bm, (0, -0.056, 1.75), (0.62, 0.005, 0.42), 2)
    return new_object("Prop_pit_board", bm, [m["steel"], m["black"], m["white"]])


def main():
    args = common.args(__doc__, {"out": "assets-src/models/shorttrack", "name": "props_kit", "no-ao": False})
    bpy.ops.wm.read_factory_settings(use_empty=True)
    m = {
        "orange": common.material("prop_orange", (0.95, 0.25, 0.02), 0.55, 0.0),
        "black": common.material("prop_black", (0.02, 0.02, 0.02), 0.7, 0.0),
        "white": common.material("prop_white", (0.85, 0.85, 0.85), 0.5, 0.0),
        "rubber": common.material("prop_rubber", (0.015, 0.015, 0.015), 0.92, 0.0),
        "hay": common.material("prop_hay", (0.62, 0.48, 0.2), 0.95, 0.0),
        "concrete": common.material("prop_concrete", (0.55, 0.55, 0.52), 0.9, 0.0),
        "steel": common.material("prop_steel", (0.45, 0.47, 0.5), 0.45, 0.8),
        "lamp": common.material("prop_lamp", (0.95, 0.95, 0.9), 0.1, 0.0, emission=(1.0, 0.97, 0.88), strength=2.0),
    }
    props = [cone(m), tyre_stack(m), hay_bale(m), barrier(m), light_tower(m), pit_board(m)]
    for i, obj in enumerate(props):
        obj.location.x = i * 4.0
        obj["prop"] = obj.name[5:]
    if not args.no_ao:
        common.try_bake(props, distance=0.3, floor=0.5)
    report = {}
    for obj in props:
        report[obj.name] = common.decimate(obj, BUDGET)
        obj.location.x = 0.0
    root = bpy.data.objects.new("TrackProps", None)
    bpy.context.scene.collection.objects.link(root)
    root["props"] = json.dumps([o.name for o in props])
    for obj in props:
        obj.parent = root
    path = os.path.join(os.path.abspath(args.out), f"{args.name}.glb")
    common.export(path)
    print(f"[shorttrack] {os.path.basename(path)}: {sum(report.values())} triangles {json.dumps(report)}")


if __name__ == "__main__":
    main()
