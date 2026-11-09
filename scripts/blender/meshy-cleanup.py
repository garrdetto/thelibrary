"""Generic clean-up for a Meshy .glb, run headless by scripts/meshy-generate.mjs (or by hand):

    blender -b --factory-startup -P scripts/blender/meshy-cleanup.py -- \
        --input .meshy-cache/rowboat/refined.glb --out assets-src/models/angler --name rowboat --size 3.2

What it does, in order:
  1. Imports the .glb into an empty scene (cameras, lights and the importer's bone-display shapes are dropped).
  2. Stands it up: lowest point on the ground, centred on the origin, scaled so it is --height metres
     tall or --size metres along its longest side (rest pose for rigged models).
  3. Static models: bakes every transform into the vertices, so the export is plain meshes at the origin.
     Rigged models keep their armature, skin and clips under one root node that carries the fix.
  4. Decimates to --max-tris triangles (collapse, applied before the armature so skins survive).
  5. Renames animation clips ("Casual_Walk=walk,Idle=idle") so modules can look them up by short name.
  6. Exports <name>.glb, or <name>-lod0.glb, -lod1 … at the --lods triangle counts.

Then `pnpm assets` optimises it into public/models/ (meshopt, WebP).
"""

import argparse
import os
import sys

import bpy
import numpy as np
from mathutils import Matrix


def log(message):
    print(f"meshy-cleanup: {message}", flush=True)


def parse():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description="Ground, size, decimate and export a Meshy model.")
    parser.add_argument("--input", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--height", type=float)
    parser.add_argument("--size", type=float)
    parser.add_argument("--max-tris", type=int, dest="max_tris")
    parser.add_argument("--lods", default="")
    parser.add_argument("--clips", default="")
    return parser.parse_args(argv)


def scene_objects():
    return list(bpy.context.scene.objects)


def meshes():
    return [o for o in scene_objects() if o.type == "MESH"]


def armatures():
    return [o for o in scene_objects() if o.type == "ARMATURE"]


def triangles(objects):
    total = 0
    for obj in objects:
        obj.data.calc_loop_triangles()
        total += len(obj.data.loop_triangles)
    return total


def import_glb(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    for obj in scene_objects():
        if obj.type in {"CAMERA", "LIGHT"}:
            bpy.data.objects.remove(obj, do_unlink=True)
    shapes = set()
    for arm in armatures():
        for bone in arm.pose.bones:
            if bone.custom_shape:
                shapes.add(bone.custom_shape)
                bone.custom_shape = None
    for shape in shapes:
        bpy.data.objects.remove(shape, do_unlink=True)
    if not meshes():
        raise SystemExit("meshy-cleanup: the file has no meshes")


def rest_bounds():
    """World-space bounds of every mesh in the armature's rest pose."""
    saved = [(arm, arm.data.pose_position) for arm in armatures()]
    for arm, _ in saved:
        arm.data.pose_position = "REST"
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    lo = np.full(3, np.inf)
    hi = np.full(3, -np.inf)
    for obj in meshes():
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        count = len(mesh.vertices)
        if count:
            co = np.empty(count * 3, dtype=np.float64)
            mesh.vertices.foreach_get("co", co)
            co = co.reshape(-1, 3)
            world = np.array(evaluated.matrix_world)
            co = co @ world[:3, :3].T + world[:3, 3]
            lo = np.minimum(lo, co.min(axis=0))
            hi = np.maximum(hi, co.max(axis=0))
        evaluated.to_mesh_clear()
    for arm, position in saved:
        arm.data.pose_position = position
    bpy.context.view_layer.update()
    return lo, hi


def placement(args):
    lo, hi = rest_bounds()
    dims = hi - lo
    scale = 1.0
    if args.height:
        scale = args.height / max(dims[2], 1e-6)
    elif args.size:
        scale = args.size / max(float(dims.max()), 1e-6)
    centre = (lo + hi) / 2
    offset = (-centre[0] * scale, -centre[1] * scale, -lo[2] * scale)
    return Matrix.Translation(offset) @ Matrix.Scale(scale, 4), scale, dims


def bake_static(fix):
    """No armature: put every transform into the vertices and drop the empties."""
    for obj in meshes():
        world = obj.matrix_world.copy()
        if obj.data.users > 1:
            obj.data = obj.data.copy()
        obj.parent = None
        obj.data.transform(fix @ world)
        obj.matrix_world = Matrix.Identity(4)
    for obj in scene_objects():
        if obj.type == "EMPTY":
            bpy.data.objects.remove(obj, do_unlink=True)


def wrap_rigged(fix, name):
    """Rigged: one root node carries the fix, so bones, skins and clip curves stay untouched."""
    root = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(root)
    for obj in scene_objects():
        if obj is not root and obj.parent is None:
            world = obj.matrix_world.copy()
            obj.parent = root
            obj.matrix_parent_inverse = Matrix.Identity(4)
            obj.matrix_world = world
    root.matrix_world = fix
    bpy.context.view_layer.update()


def decimate(budget):
    objects = meshes()
    total = triangles(objects)
    if total <= budget:
        return total
    ratio = budget / total
    for obj in objects:
        if obj.data.shape_keys:
            log(f"{obj.name} has shape keys, so it is left at full detail")
            continue
        if obj.data.users > 1:
            obj.data = obj.data.copy()
        modifier = obj.modifiers.new("cleanup_decimate", "DECIMATE")
        modifier.decimate_type = "COLLAPSE"
        modifier.ratio = ratio
        modifier.use_collapse_triangulate = True
        with bpy.context.temp_override(object=obj, active_object=obj, selected_objects=[obj], selected_editable_objects=[obj]):
            bpy.ops.object.modifier_move_to_index(modifier=modifier.name, index=0)
            bpy.ops.object.modifier_apply(modifier=modifier.name)
    return triangles(objects)


def rename_clips(spec):
    if not spec:
        return
    wanted = []
    for pair in spec.split(","):
        if "=" in pair:
            source, label = pair.split("=", 1)
            wanted.append((source.strip().lower().replace("_", ""), label.strip()))
    renamed = {}
    for action in list(bpy.data.actions):
        key = action.name.lower().replace("_", "")
        for source, label in wanted:
            if source and source in key and label not in renamed.values():
                renamed[action.name] = label
                action.name = label
                break
    for arm in armatures():
        if arm.animation_data:
            for track in arm.animation_data.nla_tracks:
                for strip in track.strips:
                    if strip.action and strip.action.name in renamed.values():
                        track.name = strip.action.name
                        strip.name = strip.action.name
    missing = [label for _, label in wanted if label not in renamed.values()]
    log(f"clips: {', '.join(sorted(renamed.values())) or 'none matched'}" + (f" (not found: {', '.join(missing)})" if missing else ""))


def export(path):
    wanted = {
        "filepath": path,
        "export_format": "GLB",
        "export_yup": True,
        "export_apply": False,
        "export_texcoords": True,
        "export_normals": True,
        "export_materials": "EXPORT",
        "export_skins": True,
        "export_animations": True,
        "export_animation_mode": "ACTIONS",
        "export_force_sampling": True,
        "export_draco_mesh_compression_enable": False,
        "export_cameras": False,
        "export_lights": False,
    }
    known = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    bpy.ops.export_scene.gltf(**{key: value for key, value in wanted.items() if key in known})


def main():
    args = parse()
    import_glb(os.path.abspath(args.input))
    rigged = bool(armatures())
    fix, scale, dims = placement(args)
    log(f"source {dims[0]:.2f} × {dims[1]:.2f} × {dims[2]:.2f} m, {triangles(meshes()):,} triangles, {'rigged' if rigged else 'static'}")
    if rigged:
        wrap_rigged(fix, args.name)
    else:
        bake_static(fix)
    lo, hi = rest_bounds()
    size = hi - lo
    log(f"placed {size[0]:.2f} × {size[1]:.2f} × {size[2]:.2f} m (scale {scale:.3f}), feet at {lo[2]:.3f}")
    rename_clips(args.clips)

    out = os.path.abspath(args.out)
    os.makedirs(out, exist_ok=True)
    lods = sorted({int(n) for n in args.lods.split(",") if n.strip()}, reverse=True)
    if lods:
        for level, budget in enumerate(lods):
            count = decimate(budget)
            path = os.path.join(out, f"{args.name}-lod{level}.glb")
            export(path)
            log(f"wrote {os.path.relpath(path)} ({count:,} triangles)")
    else:
        count = decimate(args.max_tris) if args.max_tris else triangles(meshes())
        path = os.path.join(out, f"{args.name}.glb")
        export(path)
        log(f"wrote {os.path.relpath(path)} ({count:,} triangles)")


main()
