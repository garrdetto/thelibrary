"""Short Track Showdown: the race truck as glTF, with LODs, run headless:

    node scripts/shorttrack-truck-export.mjs
    blender -b --factory-startup -P scripts/blender/shorttrack/truck.py -- \
        --input node_modules/.cache/shorttrack/truck_source.glb --out assets-src/models/shorttrack

or, with Blender as a Python module (pip install bpy):

    python3 scripts/blender/shorttrack/truck.py --input node_modules/.cache/shorttrack/truck_source.glb

What it does:
  1. Imports the procedural truck exported from modules-src/shorttrack/truck-model.js (model metres, x forward,
     y up, z to the right side, the frame the classic renderer uses).
  2. Joins everything outside the wheels into one `Body` mesh that keeps the classic material names (`truck_paint`,
     `truck_blacktrim`, ...), and each wheel into `Tire_<FL|FR|RL|RR>` under a `Wheel_<..>` pivot at its hub, so
     the asset pipeline keeps them apart and they can spin.
  3. Bakes ambient occlusion into the `ao` colour attribute with Cycles, within 0.25 m so the closed cab and the
     panels that overlap the body (fender lips, bed rails) only shade their seams; the result is lifted to 0.55-1 so body vertices hidden under the cab do not
     smear dark bands along the beltline.
  4. Exports LOD0, LOD1 and LOD2 by collapse decimation within the Phase 5 budgets (50k / 15k / 4k triangles),
     keeping material borders and UV seams (the body has no texture atlas: liveries are decal meshes).

`pnpm assets` then optimises assets-src/models/ into public/models/ (meshopt, WebP).
"""

import json
import os
import sys

import bpy
import bmesh
from mathutils import Matrix

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402
from common import decimate, export, select_only, triangle_count  # noqa: E402,F401

LODS = (50000, 15000, 4000)
WHEEL_LODS = (800, 300, 100)
AO_DISTANCE = 0.25
AO_FLOOR = 0.55


def parse_args():
    return common.args(__doc__, {"input": "node_modules/.cache/shorttrack/truck_source.glb", "out": "assets-src/models/shorttrack", "name": "truck_race", "no-ao": False})


def wheel_tag(obj):
    node = obj
    while node is not None:
        if node.name.startswith("Wheel_"):
            return node.name[6:8], node
        node = node.parent
    return None, None


def join(objects, name):
    """Unparents the meshes keeping their world transform, joins them and applies the transform."""
    select_only(objects, objects[0])
    bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
    bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = name
    obj.data.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    work = bmesh.new()
    work.from_mesh(obj.data)
    bmesh.ops.remove_doubles(work, verts=work.verts, dist=1e-5)
    loose = [e for e in work.edges if not e.link_faces]
    bmesh.ops.delete(work, geom=loose, context="EDGES")
    work.to_mesh(obj.data)
    work.free()
    return obj


def material_base(mat):
    name = (mat.name.split(".")[0] or "misc").lower()
    return "truck_hub" if name.startswith("material") else f"truck_{name}"


def rename_materials():
    """Names every material `truck_<classic name>` and folds duplicates (`Paint.001`) into one."""
    keep = {}
    for mat in list(bpy.data.materials):
        keep.setdefault(material_base(mat), mat)
    for mesh in bpy.data.meshes:
        for i, mat in enumerate(mesh.materials):
            if mat is not None:
                mesh.materials[i] = keep[material_base(mat)]
    for base, mat in keep.items():
        mat.name = base
    for mat in list(bpy.data.materials):
        if mat.users == 0:
            bpy.data.materials.remove(mat)
    return sorted(keep)


def build(source, level, no_ao):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=source)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    body, wheels, pivots = [], {}, {}
    for obj in meshes:
        tag, pivot = wheel_tag(obj)
        if tag:
            wheels.setdefault(tag, []).append(obj)
            pivots[tag] = pivot.matrix_world.translation.copy()
        else:
            body.append(obj)
    for obj in [o for o in bpy.context.scene.objects if o.type == "EMPTY"]:
        obj.name = f"source_{obj.name}"
    materials = rename_materials()
    root = bpy.data.objects.new("RaceTruck", None)
    bpy.context.scene.collection.objects.link(root)
    root["frame"] = "x forward, y up, z right, model metres (modules-src/shorttrack/truck-model.js)"
    root["materials"] = json.dumps(materials)
    root["lod"] = level
    parts = [join(body, "Body")]
    tires = {}
    for tag, objects in sorted(wheels.items()):
        tire = join(objects, f"Tire_{tag}")
        hub = pivots[tag]
        tire.data.transform(Matrix.Translation(-hub))
        pivot = bpy.data.objects.new(f"Wheel_{tag}", None)
        bpy.context.scene.collection.objects.link(pivot)
        pivot.location = hub
        pivot.parent = root
        tire.parent = pivot
        tire.location = (0, 0, 0)
        tires[tag] = tire
        parts.append(tire)
    parts[0].parent = root
    for obj in [o for o in bpy.context.scene.objects if o.type == "EMPTY" and o not in (root, *[t.parent for t in tires.values()])]:
        bpy.data.objects.remove(obj, do_unlink=True)
    if not no_ao:
        common.try_bake(parts, distance=AO_DISTANCE, floor=AO_FLOOR)
    report = {f"Tire_{tag}": decimate(tire, WHEEL_LODS[level]) for tag, tire in tires.items()}
    report["Body"] = decimate(parts[0], LODS[level] - sum(report.values()))
    return report


def main():
    args = parse_args()
    source = os.path.abspath(args.input)
    for level in range(len(LODS)):
        report = build(source, level, args.no_ao)
        path = os.path.join(os.path.abspath(args.out), f"{args.name}_lod{level}.glb")
        export(path)
        print(f"[shorttrack] {os.path.basename(path)}: {sum(report.values())} triangles {json.dumps(report)}")


if __name__ == "__main__":
    main()
