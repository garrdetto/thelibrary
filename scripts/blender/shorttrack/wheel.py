"""Short Track Showdown: a detailed shared race wheel (15 in steel wheel, beadlock ring, slick tyre), run headless:

    blender -b --factory-startup -P scripts/blender/shorttrack/wheel.py -- --out assets-src/models/shorttrack

or with Blender as a Python module: python3 scripts/blender/shorttrack/wheel.py

The wheel is modelled at the stock car's size (tyre radius 0.352 m, width 0.46 m, the same as the
wheels in public/modules/shorttrack-car.bin) with its hub at the origin and the axle along glTF Z;
the outer face points to +Z, so it fits the car's left side as is and the right side turned 180°
about Y. Nodes are `Wheel_Shared` (pivot) with `Tire_Shared` (tyre) and `Rim_Shared` (wheel and
hardware) under it, so the asset pipeline keeps them apart. AO is baked into the `ao` colour
attribute with Cycles, then LODs are cut by collapse decimation to 6k / 2k / 400 triangles.
"""

import argparse
import math
import os
import sys

import bpy
import bmesh
from mathutils import Matrix, Vector

TYRE_R = 0.352
TYRE_W = 0.46
RIM_R = 0.19
LODS = (6000, 2000, 400)
SEGMENTS_BY_LOD = (72, 40, 12)
PROFILE_BY_LOD = (None, None, 8)
SEGMENTS = SEGMENTS_BY_LOD[0]


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", default="assets-src/models/shorttrack")
    parser.add_argument("--name", default="wheel_race")
    parser.add_argument("--no-ao", action="store_true")
    return parser.parse_args(argv)


def material(name, color, roughness, metallic):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    return mat


def lathe(bm, profile, segments, mat_index=0, closed=False):
    """Revolves (radius, y) points about the Blender Y axis (glTF Z): one ring of quads per profile edge."""
    rings = []
    for r, y in profile:
        ring = []
        for k in range(segments):
            a = 2 * math.pi * k / segments
            ring.append(bm.verts.new((r * math.cos(a), y, r * math.sin(a))))
        rings.append(ring)
    count = len(rings) if closed else len(rings) - 1
    for i in range(count):
        a, b = rings[i], rings[(i + 1) % len(rings)]
        for k in range(segments):
            f = bm.faces.new((a[k], a[(k + 1) % segments], b[(k + 1) % segments], b[k]))
            f.material_index = mat_index
            f.smooth = True
    return rings


def tyre_profile():
    half = TYRE_W / 2
    bead = RIM_R + 0.012
    pts = []
    for k in range(9):
        t = k / 8
        pts.append((bead + (TYRE_R - 0.045 - bead) * math.sin(t * math.pi / 2) ** 0.7, -half + 0.03 * math.sin(t * math.pi) + 0.006))
    for k in range(7):
        a = math.pi / 2 * (1 - k / 6)
        pts.append((TYRE_R - 0.045 + 0.045 * math.sin(math.pi / 2 - a), -half + 0.045 - 0.045 * math.cos(math.pi / 2 - a)))
    for k in range(1, 6):
        pts.append((TYRE_R + 0.0015 * math.sin(k / 6 * math.pi), -half + 0.045 + (TYRE_W - 0.09) * k / 6))
    mirrored = [(r, -y) for r, y in reversed(pts)]
    return pts + mirrored


def rim_profile():
    half = TYRE_W / 2 - 0.012
    return [
        (RIM_R + 0.016, -half), (RIM_R + 0.016, -half + 0.012), (RIM_R - 0.004, -half + 0.02),
        (RIM_R - 0.004, half - 0.05), (RIM_R + 0.004, half - 0.035),
        (RIM_R + 0.004, half - 0.012), (RIM_R + 0.03, half - 0.006), (RIM_R + 0.032, half + 0.004),
        (RIM_R - 0.02, half + 0.006), (RIM_R - 0.024, half - 0.004),
    ]


def disc_profile():
    face = TYRE_W / 2 - 0.07
    front = [
        (RIM_R - 0.004, face + 0.012), (0.15, face + 0.008), (0.115, face - 0.012),
        (0.085, face - 0.016), (0.055, face - 0.012), (0.045, face + 0.004), (0.002, face + 0.006),
    ]
    back = [(r, y - 0.006) for r, y in reversed(front)]
    return front + back


def build_tyre(mats, points=None):
    profile = tyre_profile()
    if points:
        profile = [profile[round(i * (len(profile) - 1) / (points - 1))] for i in range(points)]
    bm = bmesh.new()
    lathe(bm, profile, SEGMENTS, 0)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    mesh = bpy.data.meshes.new("Tire_Shared")
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(mats["tire"])
    return mesh


def cylinder(bm, center, axis_y_len, radius, segments, mat_index, cap=True):
    x, y, z = center
    top, bot = [], []
    for k in range(segments):
        a = 2 * math.pi * k / segments
        top.append(bm.verts.new((x + radius * math.cos(a), y + axis_y_len, z + radius * math.sin(a))))
        bot.append(bm.verts.new((x + radius * math.cos(a), y, z + radius * math.sin(a))))
    for k in range(segments):
        f = bm.faces.new((bot[k], bot[(k + 1) % segments], top[(k + 1) % segments], top[k]))
        f.material_index = mat_index
        f.smooth = True
    if cap:
        for ring in (top, list(reversed(bot))):
            f = bm.faces.new(ring)
            f.material_index = mat_index


def build_rim(mats):
    bm = bmesh.new()
    lathe(bm, rim_profile(), SEGMENTS, 0)
    face = TYRE_W / 2 - 0.07
    for k in range(5):
        a = 2 * math.pi * k / 5
        cylinder(bm, (0.062 * math.cos(a), face - 0.012, 0.062 * math.sin(a)), 0.03, 0.011, 6, 2)
    cylinder(bm, (0, face - 0.006, 0), 0.034, 0.038, 24, 2)
    ring_y = TYRE_W / 2 - 0.006
    ring = bmesh.new()
    lathe(ring, [(RIM_R + 0.01, ring_y + 0.004), (RIM_R + 0.034, ring_y + 0.004), (RIM_R + 0.034, ring_y + 0.016), (RIM_R + 0.01, ring_y + 0.016)], SEGMENTS, 1, closed=True)
    for k in range(16):
        a = 2 * math.pi * (k + 0.5) / 16
        cylinder(ring, ((RIM_R + 0.022) * math.cos(a), ring_y + 0.016, (RIM_R + 0.022) * math.sin(a)), 0.008, 0.0055, 6, 2)
    tmp = bpy.data.meshes.new("ring")
    ring.to_mesh(tmp)
    ring.free()
    bm.from_mesh(tmp)
    bpy.data.meshes.remove(tmp)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new("Rim_Shared")
    bm.to_mesh(mesh)
    bm.free()
    for key in ("rim", "beadlock", "hardware"):
        mesh.materials.append(mats[key])
    obj = bpy.data.objects.new("Rim_Shared", mesh)
    bpy.context.scene.collection.objects.link(obj)
    disc_bm = bmesh.new()
    lathe(disc_bm, disc_profile(), SEGMENTS, 0, closed=True)
    bmesh.ops.remove_doubles(disc_bm, verts=disc_bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(disc_bm, faces=disc_bm.faces)
    disc_mesh = bpy.data.meshes.new("disc")
    disc_bm.to_mesh(disc_mesh)
    disc_bm.free()
    disc_mesh.materials.append(mats["rim"])
    disc = bpy.data.objects.new("disc", disc_mesh)
    bpy.context.scene.collection.objects.link(disc)
    cutter_mesh = bpy.data.meshes.new("vents")
    cb = bmesh.new()
    for k in range(8):
        a = 2 * math.pi * (k + 0.5) / 8
        cylinder(cb, (0.133 * math.cos(a), face - 0.06, 0.133 * math.sin(a)), 0.12, 0.022, 16, 0)
    bmesh.ops.recalc_face_normals(cb, faces=cb.faces)
    cb.to_mesh(cutter_mesh)
    cb.free()
    cutter = bpy.data.objects.new("vents", cutter_mesh)
    bpy.context.scene.collection.objects.link(cutter)
    mod = disc.modifiers.new("vents", "BOOLEAN")
    mod.operation = "DIFFERENCE"
    mod.solver = "EXACT"
    mod.object = cutter
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = disc
    disc.select_set(True)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter, do_unlink=True)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.join()
    return obj


def to_gltf_axes(obj):
    """Modelled with the axle on Blender Y; the exporter maps Blender -Y to glTF +Z, so flip to face +Z."""
    obj.data.transform(Matrix.Rotation(math.pi, 4, "Z"))
    obj.data.update()


def triangle_count(obj):
    work = bmesh.new()
    work.from_mesh(obj.data)
    count = sum(len(face.verts) - 2 for face in work.faces)
    work.free()
    return count


def bake_ao(objects):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 48
    scene.cycles.device = "CPU"
    for obj in objects:
        data = obj.data
        attr = data.color_attributes.get("ao") or data.color_attributes.new(name="ao", type="BYTE_COLOR", domain="CORNER")
        data.color_attributes.active_color = attr
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.bake(type="AO", target="VERTEX_COLORS")


def decimate(obj, budget):
    count = triangle_count(obj)
    for _ in range(6):
        if count <= budget:
            break
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        mod = obj.modifiers.new("lod", "DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.ratio = budget / count * 0.98
        mod.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=mod.name)
        count = triangle_count(obj)
    return count


def build(level, no_ao):
    global SEGMENTS
    SEGMENTS = SEGMENTS_BY_LOD[level]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats = {
        "tire": material("wheel_tire", (0.012, 0.012, 0.013, 1), 0.88, 0.0),
        "rim": material("wheel_rim", (0.8, 0.8, 0.8, 1), 0.38, 0.55),
        "beadlock": material("wheel_beadlock", (0.55, 0.57, 0.6, 1), 0.3, 0.85),
        "hardware": material("wheel_hardware", (0.75, 0.76, 0.78, 1), 0.2, 1.0),
    }
    pivot = bpy.data.objects.new("Wheel_Shared", None)
    bpy.context.scene.collection.objects.link(pivot)
    pivot["axle"] = "glTF Z; outer face +Z; hub at origin; metres"
    pivot["tyre"] = {"radius": TYRE_R, "width": TYRE_W, "rim_radius": RIM_R}
    tyre = bpy.data.objects.new("Tire_Shared", build_tyre(mats, PROFILE_BY_LOD[level]))
    bpy.context.scene.collection.objects.link(tyre)
    rim = build_rim(mats)
    for obj in (tyre, rim):
        to_gltf_axes(obj)
        obj.data.set_sharp_from_angle(angle=math.radians(35))
        obj.parent = pivot
    if not no_ao:
        try:
            bake_ao([tyre, rim])
        except RuntimeError as error:
            print(f"[shorttrack] AO bake skipped: {error}")
    budget = LODS[level]
    counts = {"Tire_Shared": decimate(tyre, budget * 0.43), "Rim_Shared": decimate(rim, budget * 0.57)}
    return counts


def main():
    args = parse_args()
    for level in range(len(LODS)):
        counts = build(level, args.no_ao)
        path = os.path.join(os.path.abspath(args.out), f"{args.name}_lod{level}.glb")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_yup=True, export_apply=True, export_extras=True,
                                  export_vertex_color="ACTIVE", export_all_vertex_colors=True, export_draco_mesh_compression_enable=False)
        print(f"[shorttrack] {os.path.basename(path)}: {sum(counts.values())} triangles {counts}")


if __name__ == "__main__":
    main()
