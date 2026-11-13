"""Shared Blender helpers that give imported scans (Meshy, photo scans) clean, smooth shading.

Meshy and similar generators often export "triangle soup": every triangle (or small patch) has its own vertices, so
even faces marked smooth light up as separate facets, and a curved panel shows flat-shaded stripes in the game.

`smooth_object` fixes that on one mesh object:
  1. welds vertices that share a position (Merge by Distance; UVs live on the face corners, so UV seams survive),
  2. shades every face smooth,
  3. marks edges sharper than `angle` degrees as sharp (Auto Smooth / Smooth by Angle), so real creases stay crisp,
  4. applies a Weighted Normal modifier (face area, keep sharp), so big flat panels stay flat and fillets take the bend.

`split_wheels` finds the wheels of a vehicle scan (wheel-shaped parts at the bottom on both sides), moves each into
its own object named `wheel-<n>` whose origin is the wheel's centre (Origin to Geometry), so it spins on its true axle.

Import it from a script run with `blender -b -P` after putting this folder on `sys.path`.
"""

import math

import bmesh
import bpy
from mathutils import Matrix, Vector


def _weighted_normals(obj):
    modifier = obj.modifiers.new("smooth_weighted", "WEIGHTED_NORMAL")
    modifier.mode = "FACE_AREA"
    modifier.weight = 50
    modifier.keep_sharp = True
    with bpy.context.temp_override(object=obj, active_object=obj, selected_objects=[obj], selected_editable_objects=[obj]):
        bpy.ops.object.modifier_move_to_index(modifier=modifier.name, index=0)
        bpy.ops.object.modifier_apply(modifier=modifier.name)


def smooth_object(obj, angle=40.0, weld=0.0005, weighted=True):
    """Weld, shade smooth, sharpen creases over `angle` degrees and weight the normals. Returns (before, after) vertex counts."""
    if obj.type != "MESH":
        return (0, 0)
    if obj.data.users > 1:
        obj.data = obj.data.copy()
    mesh = obj.data
    before = len(mesh.vertices)
    bm = bmesh.new()
    bm.from_mesh(mesh)
    if weld > 0:
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=weld)
    bmesh.ops.dissolve_degenerate(bm, dist=weld * 0.1 if weld > 0 else 1e-6, edges=bm.edges)
    for face in bm.faces:
        face.smooth = True
    bm.to_mesh(mesh)
    bm.free()
    if hasattr(mesh, "set_sharp_from_angle"):
        mesh.set_sharp_from_angle(angle=math.radians(angle))
    else:
        mesh.use_auto_smooth = True
        mesh.auto_smooth_angle = math.radians(angle)
    if weighted and not (mesh.shape_keys and len(mesh.shape_keys.key_blocks) > 1):
        _weighted_normals(obj)
    mesh.update()
    return (before, len(mesh.vertices))


def smooth_all(objects, angle=40.0, weld=0.0005, weighted=True, log=print):
    for obj in objects:
        before, after = smooth_object(obj, angle=angle, weld=weld, weighted=weighted)
        log(f"smoothed {obj.name}: {before:,} -> {after:,} vertices, creases over {angle:g} degrees kept sharp")


def _islands(bm):
    bm.verts.ensure_lookup_table()
    seen = set()
    out = []
    for vert in bm.verts:
        if vert.index in seen:
            continue
        stack = [vert]
        seen.add(vert.index)
        part = []
        while stack:
            v = stack.pop()
            part.append(v.index)
            for edge in v.link_edges:
                other = edge.other_vert(v)
                if other.index not in seen:
                    seen.add(other.index)
                    stack.append(other)
        lo = Vector((min(bm.verts[i].co.x for i in part), min(bm.verts[i].co.y for i in part), min(bm.verts[i].co.z for i in part)))
        hi = Vector((max(bm.verts[i].co.x for i in part), max(bm.verts[i].co.y for i in part), max(bm.verts[i].co.z for i in part)))
        out.append({"verts": part, "lo": lo, "hi": hi})
    return out


def _inside(part, lo, hi, pad):
    return all(part["lo"][k] >= lo[k] - pad and part["hi"][k] <= hi[k] + pad for k in range(3))


def split_wheels(obj, count=4, log=print):
    """Separates up to `count` wheels (x forward, y sideways, z up, object at the origin) into centred `wheel-<n>` objects."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    parts = _islands(bm)
    floor = min(p["lo"].z for p in parts)
    wheels = []
    for part in sorted(parts, key=lambda p: -len(p["verts"])):
        size = part["hi"] - part["lo"]
        centre = (part["hi"] + part["lo"]) / 2
        if size.z < 0.18 or not 0.75 <= size.x / size.z <= 1.33 or size.y > 0.75 * size.z:
            continue
        if part["lo"].z > floor + 0.1 or abs(centre.y) < 0.15:
            continue
        if any(_inside(part, w["lo"], w["hi"], 0.02) or (centre - w["centre"]).length < 0.6 * size.z for w in wheels):
            continue
        wheels.append({"lo": part["lo"].copy(), "hi": part["hi"].copy(), "centre": centre, "parts": [part]})
        if len(wheels) == count:
            break
    for wheel in wheels:
        for part in parts:
            if part not in wheel["parts"] and _inside(part, wheel["lo"], wheel["hi"], 0.015):
                wheel["parts"].append(part)
    wheels.sort(key=lambda w: (-w["centre"].x, w["centre"].y))
    owner = {}
    for n, wheel in enumerate(wheels):
        for part in wheel["parts"]:
            for i in part["verts"]:
                owner[i] = n
    tags = [-1] * len(bm.faces)
    for face in bm.faces:
        ids = {owner.get(v.index, -1) for v in face.verts}
        if len(ids) == 1:
            tags[face.index] = ids.pop()
    bm.free()
    attribute = obj.data.attributes.new("wheel_id", "INT", "FACE")
    attribute.data.foreach_set("value", tags)
    made = []
    for n, wheel in enumerate(wheels):
        bpy.ops.object.select_all(action="DESELECT")
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.mode_set(mode="EDIT")
        edit = bmesh.from_edit_mesh(obj.data)
        layer = edit.faces.layers.int.get("wheel_id")
        for vert in edit.verts:
            vert.select = False
        for edge in edit.edges:
            edge.select = False
        for face in edit.faces:
            face.select = face[layer] == n
        edit.select_flush_mode()
        bmesh.update_edit_mesh(obj.data)
        bpy.ops.mesh.separate(type="SELECTED")
        bpy.ops.object.mode_set(mode="OBJECT")
        piece = next(o for o in bpy.context.selected_objects if o is not obj)
        centre = wheel["centre"]
        piece.data.transform(Matrix.Translation(-centre))
        piece.matrix_world = Matrix.Translation(centre)
        piece.name = f"wheel-{n}"
        piece.data.name = f"wheel-{n}"
        size = wheel["hi"] - wheel["lo"]
        log(f"wheel-{n}: centre ({centre.x:.3f}, {centre.y:.3f}, {centre.z:.3f}), radius {size.z / 2:.3f}, {len(wheel['parts'])} parts")
        made.append(piece)
    bpy.ops.object.select_all(action="DESELECT")
    for item in [obj, *made]:
        found = item.data.attributes.get("wheel_id")
        if found:
            item.data.attributes.remove(found)
    return made
