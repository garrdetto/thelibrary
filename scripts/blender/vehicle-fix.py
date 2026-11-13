"""Smooth shading and centred, separately spinning wheels for a vehicle scan (Meshy or photo scan):

    blender -b --factory-startup -P scripts/blender/vehicle-fix.py -- \
        --input assets-src/models/maplestreet/vehicles/trailer.glb --out assets-src/models/maplestreet/vehicles/trailer.glb --wheels 2

1. Welds the triangle soup, shades smooth, keeps creases over --angle degrees sharp and applies weighted normals
   (smooth_normals.smooth_object), so curved panels no longer show flat facets.
2. With --wheels N: separates the N wheels into `wheel-<n>` objects with their origin at the wheel's centre
   (Origin to Geometry). Fox Lake hangs each one on its own steer/spin pivot at that centre, so wheels turn on their
   true axle instead of wobbling, and stay exactly where the model drew them.
3. Exports the .glb (x forward, y up as before); then run `pnpm assets`.
"""

import argparse
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from smooth_normals import smooth_all, split_wheels  # noqa: E402


def log(message):
    print(f"vehicle-fix: {message}", flush=True)


def parse():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description="Smooth a vehicle scan and separate its wheels.")
    parser.add_argument("--input", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--wheels", type=int, default=0)
    parser.add_argument("--angle", type=float, default=40.0)
    return parser.parse_args(argv)


def main():
    args = parse()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(args.input))
    for obj in list(bpy.context.scene.objects):
        if obj.type in {"CAMERA", "LIGHT"}:
            bpy.data.objects.remove(obj, do_unlink=True)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    for obj in meshes:
        if obj.parent is not None or obj.matrix_world != obj.matrix_world.Identity(4):
            world = obj.matrix_world.copy()
            obj.parent = None
            if obj.data.users > 1:
                obj.data = obj.data.copy()
            obj.data.transform(world)
            obj.matrix_world.identity()
    for obj in list(bpy.context.scene.objects):
        if obj.type == "EMPTY":
            bpy.data.objects.remove(obj, do_unlink=True)
    smooth_all(meshes, angle=args.angle, log=log)
    if args.wheels:
        body = max(meshes, key=lambda o: len(o.data.vertices))
        made = split_wheels(body, args.wheels, log=log)
        if len(made) != args.wheels:
            log(f"found {len(made)} of {args.wheels} wheels")
    out = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    wanted = {
        "filepath": out,
        "export_format": "GLB",
        "export_yup": True,
        "export_apply": False,
        "export_texcoords": True,
        "export_normals": True,
        "export_materials": "EXPORT",
        "export_animations": False,
        "export_draco_mesh_compression_enable": False,
        "export_cameras": False,
        "export_lights": False,
    }
    known = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    bpy.ops.export_scene.gltf(**{key: value for key, value in wanted.items() if key in known})
    log(f"wrote {os.path.relpath(out)}")


main()
