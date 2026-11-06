"""Short Track Showdown: the stock Super Late Model as glTF, with LODs, run headless:

    blender -b --factory-startup -P scripts/blender/shorttrack/stock_car.py -- \
        --input public/modules/shorttrack-car.bin --out assets-src/models/shorttrack

or, with Blender as a Python module (pip install bpy):

    python3 scripts/blender/shorttrack/stock_car.py --input public/modules/shorttrack-car.bin

What it does:
  1. Reads the classic module's car file (magic "STC1", JSON header, quantised parts), the same
     decoding as parseCarAsset in modules-src/shorttrack/render-three/main.js.
  2. Builds the body with its six material slots in the classic order (paint, interior, glass,
     tire, rim, tail), the livery atlas UVs, the original normals and the baked shade as the `ao`
     colour attribute, and the four wheels as `Wheel_<FL|FR|RL|RR>` pivots at the hub with a
     `Tire_<..>` mesh under each, so the asset pipeline keeps them apart and they can spin.
  3. Writes the livery regions and the frame (x forward, y up, z to the left, model metres) as
     glTF extras on the scene root, so a renderer paints the livery exactly as the classic one.
  4. Exports LOD0 (the full body), LOD1 and LOD2 by collapse decimation within the Phase 5 budgets
     (60k / 18k / 4k triangles); UV seams are kept so the atlas regions stay intact.

`pnpm assets` then optimises assets-src/models/ into public/models/ (meshopt, WebP).
"""

import argparse
import json
import os
import struct
import sys

import bpy
import bmesh
from mathutils import Vector

LODS = (60000, 18000, 4000)
WHEEL_LODS = (6000, 2000, 400)
MATERIALS = (
    ("slm_paint", (1.0, 1.0, 1.0, 1.0), 0.3, 0.2, {"clearcoat": 1.0, "clearcoat_roughness": 0.08}),
    ("slm_interior", (1.0, 1.0, 1.0, 1.0), 0.85, 0.2, {}),
    ("slm_glass", (0.0103, 0.0185, 0.0242, 1.0), 0.05, 0.3, {"clearcoat": 1.0, "clearcoat_roughness": 0.03}),
    ("slm_tire", (0.0080, 0.0080, 0.0080, 1.0), 0.92, 0.0, {}),
    ("slm_rim", (0.3185, 0.3515, 0.3916, 1.0), 0.35, 0.8, {}),
    ("slm_tail", (0.1022, 0.0, 0.0024, 1.0), 0.1, 0.0, {"clearcoat": 1.0, "emission": (1.0, 0.0103, 0.0194), "emission_strength": 0.2}),
)
WHEEL_NAMES = {(True, True): "FL", (True, False): "FR", (False, True): "RL", (False, False): "RR"}


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--input", default="public/modules/shorttrack-car.bin")
    parser.add_argument("--out", default="assets-src/models/shorttrack")
    parser.add_argument("--name", default="car_slm")
    return parser.parse_args(argv)


def read_car(path):
    data = open(path, "rb").read()
    magic, header_len = struct.unpack_from("<II", data, 0)
    if magic != 0x31435453:
        raise SystemExit(f"{path} is not a Short Track car file")
    meta = json.loads(data[8:8 + header_len].decode("utf-8"))
    offset = 8 + header_len

    def take(fmt, size, count):
        nonlocal offset
        values = struct.unpack_from(f"<{count}{fmt}", data, offset)
        offset += -(-count * size // 4) * 4
        return values

    parts = []
    for part in meta["parts"]:
        v, n = part["v"], part["i"]
        q = take("h", 2, v * 3)
        nor = take("b", 1, v * 3)
        shade = take("B", 1, v)
        uv = take("H", 2, v * 2) if meta.get("uv") else None
        idx = take("I" if part["i32"] else "H", 4 if part["i32"] else 2, n)
        lo, hi = part["lo"], part["hi"]
        pos = [lo[k % 3] + (q[k] + 32768) / 65535 * (hi[k % 3] - lo[k % 3]) for k in range(v * 3)]
        parts.append({
            "name": part["name"],
            "center": part["center"],
            "pos": pos,
            "nor": [x / 127 for x in nor],
            "shade": [x / 255 for x in shade],
            "uv": [x / 65535 for x in uv] if uv else None,
            "idx": idx,
            "groups": part["groups"],
        })
    return meta, parts


def to_blender(x, y, z):
    return (x, -z, y)


def make_materials():
    made = []
    for name, color, rough, metal, extra in MATERIALS:
        mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        bsdf.inputs["Base Color"].default_value = color
        bsdf.inputs["Roughness"].default_value = rough
        bsdf.inputs["Metallic"].default_value = metal
        if "clearcoat" in extra:
            bsdf.inputs["Coat Weight"].default_value = extra["clearcoat"]
            bsdf.inputs["Coat Roughness"].default_value = extra.get("clearcoat_roughness", 0.03)
        if "emission" in extra:
            bsdf.inputs["Emission Color"].default_value = (*extra["emission"], 1.0)
            bsdf.inputs["Emission Strength"].default_value = extra["emission_strength"]
        made.append(mat)
    return made


def build_mesh(name, part, materials):
    verts = [to_blender(*part["pos"][i * 3:i * 3 + 3]) for i in range(len(part["pos"]) // 3)]
    faces = [tuple(part["idx"][i:i + 3]) for i in range(0, len(part["idx"]), 3)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    for mat in materials:
        mesh.materials.append(mat)
    tri_mat = [0] * len(faces)
    for start, count, mi in part["groups"]:
        for t in range(start // 3, (start + count) // 3):
            tri_mat[t] = mi
    mesh.polygons.foreach_set("material_index", tri_mat)
    loops = [i for face in faces for i in face]
    if part["uv"]:
        uv_layer = mesh.uv_layers.new(name="atlas")
        flat = []
        for vi in loops:
            flat.extend((part["uv"][vi * 2], 1.0 - part["uv"][vi * 2 + 1]))
        uv_layer.data.foreach_set("uv", flat)
    ao = mesh.color_attributes.new(name="ao", type="BYTE_COLOR", domain="POINT")
    ao.data.foreach_set("color", [c for s in part["shade"] for c in (s, s, s, 1.0)])
    mesh.polygons.foreach_set("use_smooth", [True] * len(faces))
    mesh.validate(clean_customdata=False)
    mesh.update()
    normals = [Vector(to_blender(*part["nor"][i * 3:i * 3 + 3])).normalized() for i in range(len(verts))]
    mesh.normals_split_custom_set_from_vertices(normals)
    work = bmesh.new()
    work.from_mesh(mesh)
    bmesh.ops.remove_doubles(work, verts=work.verts, dist=1e-5)
    work.to_mesh(mesh)
    work.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def triangle_count(obj):
    work = bmesh.new()
    work.from_mesh(obj.data)
    count = sum(len(face.verts) - 2 for face in work.faces)
    work.free()
    return count


def decimate(obj, budget, delimit):
    count = triangle_count(obj)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    for _ in range(6):
        if count <= budget:
            break
        modifier = obj.modifiers.new(name="lod", type="DECIMATE")
        modifier.decimate_type = "COLLAPSE"
        modifier.ratio = budget / count * 0.98
        modifier.use_collapse_triangulate = True
        modifier.delimit = delimit
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        after = triangle_count(obj)
        if after > count * 0.97:
            delimit = {"MATERIAL"}
        count = after
    return count


def build_car(meta, parts, level):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    materials = make_materials()
    root = bpy.data.objects.new("StockCar", None)
    bpy.context.scene.collection.objects.link(root)
    root["regions"] = json.dumps(meta["regions"])
    root["frame"] = "x forward, y up, z left, model metres (classic shorttrack-car.bin)"
    root["materials"] = json.dumps([m[0] for m in MATERIALS])
    root["lod"] = level
    report = {}
    wheel_budget = WHEEL_LODS[level]
    for part in parts:
        if part["center"] is None:
            body = build_mesh("Body", part, materials)
            body.parent = root
            report["Body"] = decimate(body, LODS[level] - wheel_budget, {"UV", "MATERIAL", "SEAM"})
            continue
        cx, cy, cz = part["center"]
        tag = WHEEL_NAMES[(cx > 0, cz > 0)]
        pivot = bpy.data.objects.new(f"Wheel_{tag}", None)
        bpy.context.scene.collection.objects.link(pivot)
        pivot.parent = root
        pivot.location = to_blender(cx, cy, cz)
        tire = build_mesh(f"Tire_{tag}", part, materials)
        tire.parent = pivot
        report[f"Tire_{tag}"] = decimate(tire, wheel_budget // 4, {"MATERIAL"})
    return root, report


def export(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_extras=True,
        export_attributes=True,
        export_vertex_color="ACTIVE",
        export_active_vertex_color_when_no_material=False,
        export_all_vertex_colors=True,
        export_normals=True,
        export_texcoords=True,
        export_draco_mesh_compression_enable=False,
    )


def main():
    args = parse_args()
    meta, parts = read_car(os.path.abspath(args.input))
    for level in range(len(LODS)):
        root, report = build_car(meta, parts, level)
        path = os.path.join(os.path.abspath(args.out), f"{args.name}_lod{level}.glb")
        export(path)
        total = sum(report.values())
        print(f"[shorttrack] {os.path.basename(path)}: {total} triangles {json.dumps(report)}")


if __name__ == "__main__":
    main()
