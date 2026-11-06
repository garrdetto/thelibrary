"""Bush League Baseball asset clean-up, run headless on the admin's machine:

    blender -b -P scripts/blender/bushleague/cleanup.py -- \
        --input meshy-player.glb --name player-lean --kind player --out assets-src/models/bushleague

What it does, in order:
  1. Imports the Meshy .glb into an empty scene and joins its meshes.
  2. Stands it up: feet on the ground, centred, scaled to 1.85 m (players) or kept at size (props).
     glTF's +Z forward is Blender's -Y, so a model that faces +Z in the page faces -Y here.
  3. Renames a Meshy or Mixamo-style armature to the shared Bush League skeleton (players/Rig.ts),
     so every clip plays on every body type.
  4. Writes the `_slot` vertex attribute (skin, jersey, trim, pants, socks, cleats, cap, belt) from
     height bands and arm reach, the starting point the uniform shader reads; fix edge cases by hand.
  5. Bakes ambient occlusion into the `ao` colour attribute (Cycles, low samples).
  6. Builds the LOD chain by collapse decimation (players 25k / 8k / 2k triangles, props 15k / 5k / 1.5k)
     and exports one .glb per LOD with skins, animations and custom attributes.

`pnpm assets` then optimises everything in assets-src/models/ into public/models/ (meshopt, WebP).
"""

import argparse
import math
import os
import sys

import bpy
import bmesh
from mathutils import Vector

PLAYER_HEIGHT = 1.85
LODS = {"player": (25000, 8000, 2000), "prop": (15000, 5000, 1500)}

# Shared skeleton (modules-src/bushleague/players/Rig.ts) <- common Meshy / Mixamo bone names.
BONE_MAP = {
    "hips": ["Hips", "mixamorig:Hips", "pelvis", "Pelvis"],
    "spine": ["Spine", "mixamorig:Spine", "spine_01", "Spine01"],
    "chest": ["Spine1", "Spine2", "mixamorig:Spine2", "spine_03", "Spine02", "Chest"],
    "neck": ["Neck", "neck", "mixamorig:Neck", "neck_01"],
    "head": ["Head", "head", "mixamorig:Head"],
    "shoulder.L": ["LeftShoulder", "mixamorig:LeftShoulder", "clavicle_l"],
    "arm.L": ["LeftArm", "mixamorig:LeftArm", "upperarm_l"],
    "forearm.L": ["LeftForeArm", "mixamorig:LeftForeArm", "lowerarm_l"],
    "hand.L": ["LeftHand", "mixamorig:LeftHand", "hand_l"],
    "shoulder.R": ["RightShoulder", "mixamorig:RightShoulder", "clavicle_r"],
    "arm.R": ["RightArm", "mixamorig:RightArm", "upperarm_r"],
    "forearm.R": ["RightForeArm", "mixamorig:RightForeArm", "lowerarm_r"],
    "hand.R": ["RightHand", "mixamorig:RightHand", "hand_r"],
    "thigh.L": ["LeftUpLeg", "mixamorig:LeftUpLeg", "thigh_l"],
    "shin.L": ["LeftLeg", "mixamorig:LeftLeg", "calf_l"],
    "foot.L": ["LeftFoot", "mixamorig:LeftFoot", "foot_l"],
    "toe.L": ["LeftToeBase", "mixamorig:LeftToeBase", "ball_l"],
    "thigh.R": ["RightUpLeg", "mixamorig:RightUpLeg", "thigh_r"],
    "shin.R": ["RightLeg", "mixamorig:RightLeg", "calf_r"],
    "foot.R": ["RightFoot", "mixamorig:RightFoot", "foot_r"],
    "toe.R": ["RightToeBase", "mixamorig:RightToeBase", "ball_r"],
}

SLOT = {"skin": 0, "jersey": 1, "trim": 2, "pants": 3, "socks": 4, "cleats": 5, "cap": 6, "belt": 7}


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description="Clean up a Meshy export for Bush League Baseball.")
    parser.add_argument("--input", required=True)
    parser.add_argument("--name", required=True, help="output base name, e.g. player-lean")
    parser.add_argument("--kind", choices=["player", "prop"], default="player")
    parser.add_argument("--out", default="assets-src/models/bushleague")
    parser.add_argument("--no-ao", action="store_true", help="skip the AO bake (faster)")
    return parser.parse_args(argv)


def empty_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_glb(path):
    bpy.ops.import_scene.gltf(filepath=path)
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    armature = next((obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"), None)
    if not meshes:
        raise SystemExit(f"{path} has no meshes")
    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    mesh = bpy.context.view_layer.objects.active
    return mesh, armature


def world_bounds(obj):
    corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    low = Vector((min(c.x for c in corners), min(c.y for c in corners), min(c.z for c in corners)))
    high = Vector((max(c.x for c in corners), max(c.y for c in corners), max(c.z for c in corners)))
    return low, high


def stand_up(mesh, armature, kind):
    root = armature or mesh
    low, high = world_bounds(mesh)
    height = high.z - low.z
    if height <= 0:
        raise SystemExit("model has no height")
    scale = PLAYER_HEIGHT / height if kind == "player" else 1.0
    root.scale = [s * scale for s in root.scale]
    bpy.context.view_layer.update()
    low, high = world_bounds(mesh)
    center = (low + high) / 2
    root.location.x -= center.x
    root.location.y -= center.y
    root.location.z -= low.z
    bpy.context.view_layer.update()
    for obj in [o for o in (armature, mesh) if o]:
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def rename_bones(armature):
    if not armature:
        return []
    lookup = {alias.lower(): ours for ours, aliases in BONE_MAP.items() for alias in aliases}
    renamed = []
    for bone in armature.data.bones:
        ours = lookup.get(bone.name.lower())
        if ours and ours != bone.name:
            renamed.append((bone.name, ours))
            bone.name = ours
    missing = [name for name in BONE_MAP if name not in armature.data.bones]
    if missing:
        print(f"[bushleague] armature is missing shared bones: {', '.join(missing)}")
    return renamed


def slot_for(point, height):
    """Height-band guess at a uniform slot for a vertex of an A-posed 1.85 m player."""
    h = point.z / height
    reach = abs(point.x) / height
    if h > 0.93:
        return SLOT["cap"]
    if h > 0.84:
        return SLOT["skin"]
    if reach > 0.2 and h > 0.5:
        return SLOT["skin"] if reach > 0.28 else SLOT["jersey"]
    if h > 0.82:
        return SLOT["trim"]
    if h > 0.55:
        return SLOT["jersey"]
    if h > 0.52:
        return SLOT["belt"]
    if h > 0.26:
        return SLOT["pants"]
    if h > 0.05:
        return SLOT["socks"]
    return SLOT["cleats"]


def write_slots(mesh, kind):
    if kind != "player":
        return
    data = mesh.data
    if "_slot" in data.attributes:
        data.attributes.remove(data.attributes["_slot"])
    attribute = data.attributes.new(name="_slot", type="FLOAT", domain="POINT")
    low, high = world_bounds(mesh)
    height = max(1e-6, high.z - low.z)
    for index, vertex in enumerate(data.vertices):
        attribute.data[index].value = slot_for(mesh.matrix_world @ vertex.co, height)


def bake_ao(mesh):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 32
    scene.cycles.device = "CPU"
    data = mesh.data
    if "ao" not in data.color_attributes:
        data.color_attributes.new(name="ao", type="BYTE_COLOR", domain="CORNER")
    data.color_attributes.active_color = data.color_attributes["ao"]
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.bake(type="AO", target="VERTEX_COLORS")


def triangle_count(mesh):
    work = bmesh.new()
    work.from_mesh(mesh.data)
    count = sum(len(face.verts) - 2 for face in work.faces)
    work.free()
    return count


def make_lod(mesh, budget, suffix):
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.duplicate()
    copy = bpy.context.view_layer.objects.active
    copy.name = f"{mesh.name}_{suffix}"
    count = triangle_count(copy)
    if count > budget:
        modifier = copy.modifiers.new(name="lod", type="DECIMATE")
        modifier.decimate_type = "COLLAPSE"
        modifier.ratio = budget / count
        modifier.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    print(f"[bushleague] {copy.name}: {triangle_count(copy)} triangles (budget {budget})")
    return copy


def export(objects, armature, path):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    if armature:
        armature.select_set(True)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_attributes=True,
        export_skins=True,
        export_animations=True,
        export_draco_mesh_compression_enable=False,
    )
    print(f"[bushleague] wrote {path}")


def main():
    args = parse_args()
    empty_scene()
    mesh, armature = import_glb(os.path.abspath(args.input))
    mesh.name = args.name
    stand_up(mesh, armature, args.kind)
    renamed = rename_bones(armature)
    if renamed:
        print(f"[bushleague] renamed {len(renamed)} bones to the shared skeleton")
    write_slots(mesh, args.kind)
    if not args.no_ao:
        try:
            bake_ao(mesh)
        except RuntimeError as error:
            print(f"[bushleague] AO bake skipped: {error}")
    budgets = LODS[args.kind]
    for level, budget in enumerate(budgets):
        lod = make_lod(mesh, budget, f"lod{level}")
        export([lod], armature, os.path.join(os.path.abspath(args.out), f"{args.name}-lod{level}.glb"))
        bpy.data.objects.remove(lod, do_unlink=True)
    print(f"[bushleague] done: {args.name} ({math.fsum(budgets):.0f} triangles across {len(budgets)} LODs at most)")


if __name__ == "__main__":
    main()
