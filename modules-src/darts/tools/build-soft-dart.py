"""Builds the soft-tip dart for the Darts module:

    blender -b --factory-startup -P modules-src/darts/tools/build-soft-dart.py -- \
        --out assets-src/models/darts/dart-soft.glb [--meshy .meshy-cache/dart-soft-meshy/refined.glb] [--preview out.png]

The point, shaft and flights are modelled here so their shapes are exact: a moulded black plastic
point with a collar and a threaded shank, a black shaft with a ring at the flight slot, and four
white standard-shape flights in a cross (two folded sheets, so every fin is the same and meets
the shaft). The barrel is a lathed tungsten barrel with ring grooves and a diamond-knurled grip, shaped after
the Meshy soft-tip dart (scripts/meshy-generate.mjs, raw download in .meshy-cache/dart-soft-meshy/).
--meshy uses that download's own barrel instead, re-centred on the axis and sized between the point
and the shaft; Meshy's barrel facets badly up close and its flights come out as two fins, which is
why the default is the lathed one.
The barrel is metallic gunmetal gray, the point black and the flights white.

The nose is at the origin and the dart runs along glTF +Z, as render/Dart.ts expects. Materials
are named `barrel`, `shaft`, `tip` and `flight-white` (white flights stay white in the module;
only a material named `flight` takes the thrower's colour).
"""

import argparse
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

LENGTH = 0.155
TIP_END = 0.0245
BARREL_START = 0.0225
BARREL_END = 0.0685
SHAFT_END = 0.1235
FLIGHT_START = 0.1165
FLIGHT_END = LENGTH
FLIGHT_SPAN = 0.0172
SHAFT_RADIUS = 0.00165


def log(message):
    print(f"build-soft-dart: {message}", flush=True)


def parse():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--meshy")
    parser.add_argument("--preview")
    return parser.parse_args(argv)


def material(name, color, metallic, roughness, double=False):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    shader = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    shader.inputs["Base Color"].default_value = (*color, 1)
    shader.inputs["Metallic"].default_value = metallic
    shader.inputs["Roughness"].default_value = roughness
    mat.use_backface_culling = not double
    return mat


def lathe(name, profile, segments, mat, smooth=True):
    """Spins (distance from the nose, radius) pairs around the dart axis (Blender -Y)."""
    mesh = bpy.data.meshes.new(name)
    verts = []
    faces = []
    count = len(profile)
    for along, radius in profile:
        for s in range(segments):
            a = 2 * math.pi * s / segments
            verts.append((radius * math.cos(a), -along, radius * math.sin(a)))
    for r in range(count - 1):
        for s in range(segments):
            a = r * segments + s
            b = r * segments + (s + 1) % segments
            faces.append((a, b, b + segments, a + segments))
    if profile[0][1] > 0:
        verts.append((0, -profile[0][0], 0))
        centre = len(verts) - 1
        for s in range(segments):
            faces.append((centre, (s + 1) % segments, s))
    if profile[-1][1] > 0:
        verts.append((0, -profile[-1][0], 0))
        centre = len(verts) - 1
        base = (count - 1) * segments
        for s in range(segments):
            faces.append((centre, base + s, base + (s + 1) % segments))
    mesh.from_pydata(verts, [], faces)
    mesh.validate()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(mat)
    fix_normals(obj)
    if smooth:
        shade_smooth(obj, 35)
    return obj


def fix_normals(obj):
    mesh = bmesh.new()
    mesh.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(mesh, faces=mesh.faces)
    mesh.to_mesh(obj.data)
    mesh.free()


def shade_smooth(obj, angle):
    for poly in obj.data.polygons:
        poly.use_smooth = True
    mesh = bmesh.new()
    mesh.from_mesh(obj.data)
    for edge in mesh.edges:
        if len(edge.link_faces) == 2 and edge.calc_face_angle(0) > math.radians(angle):
            edge.smooth = False
    mesh.to_mesh(obj.data)
    mesh.free()
    if hasattr(obj.data, "set_sharp_from_angle"):
        obj.data.set_sharp_from_angle(angle=math.radians(angle))


def build_tip(mat):
    """A moulded soft tip: rounded nose, fluted taper, a collar and a threaded shank into the barrel."""
    profile = [(0.0, 0.0), (0.00015, 0.00045), (0.0005, 0.0008), (0.0012, 0.00098)]
    steps = 14
    for i in range(1, steps + 1):
        along = 0.0012 + (0.0175 - 0.0012) * i / steps
        profile.append((along, 0.00098 + (0.00128 - 0.00098) * i / steps))
    profile += [(0.0182, 0.0016), (0.0188, 0.00215), (0.0205, 0.00225), (0.0209, 0.0019)]
    along = 0.0209
    while along < TIP_END - 0.0004:
        profile += [(along + 0.0004, 0.00178), (along + 0.0008, 0.0019)]
        along += 0.0008
    profile.append((TIP_END, 0.0017))
    tip = lathe("tip", profile, 20, mat)
    flutes = bmesh.new()
    flutes.from_mesh(tip.data)
    for vert in flutes.verts:
        along = -vert.co.y
        if 0.002 < along < 0.0172:
            angle = math.atan2(vert.co.z, vert.co.x)
            squeeze = 1 - 0.07 * max(0.0, math.cos(angle * 5)) ** 4
            vert.co.x *= squeeze
            vert.co.z *= squeeze
    flutes.to_mesh(tip.data)
    flutes.free()
    return tip


def barrel_profile():
    """A torpedo tungsten barrel: tapered nose, ring grooves, a knurled middle, tapered back."""
    start, end = BARREL_START, BARREL_END
    peak = 0.0034
    profile = [(start, 0.0019), (start + 0.0006, 0.0024), (start + 0.0025, 0.0029)]
    along = start + 0.004
    while along < start + 0.0135:
        profile += [(along, 0.0031), (along + 0.0012, 0.00315), (along + 0.0014, 0.0027), (along + 0.0021, 0.0027)]
        along += 0.0024
    profile += [(along, 0.0032), (along + 0.0012, peak)]
    knurl_from = along + 0.0012
    knurl_to = end - 0.012
    profile += [(knurl_from + 0.0001, peak), (knurl_to - 0.0001, peak), (knurl_to, peak)]
    along = knurl_to + 0.0012
    while along < end - 0.0055:
        profile += [(along, peak - 0.0002), (along + 0.0011, peak - 0.0003), (along + 0.0013, peak - 0.0008), (along + 0.002, peak - 0.0008)]
        along += 0.0023
    profile += [(end - 0.0045, 0.003), (end - 0.0015, 0.0024), (end - 0.0004, 0.0021), (end, 0.0019)]
    return profile, knurl_from, knurl_to


def knurl(obj, start, end, depth=0.00028, count=24, pitch=0.0055):
    """Cuts a diamond knurl into the barrel between start and end (distance from the nose)."""
    mesh = bmesh.new()
    mesh.from_mesh(obj.data)
    for vert in mesh.verts:
        along = -vert.co.y
        if not (start < along < end):
            continue
        angle = math.atan2(vert.co.z, vert.co.x)
        u = angle * count / (2 * math.pi)
        v = along / pitch * 2
        a = abs(((u + v) % 1) - 0.5) * 2
        b = abs(((u - v) % 1) - 0.5) * 2
        cut = depth * (1 - min(a, b)) ** 1.5
        edge = min(along - start, end - along) / 0.0008
        cut *= min(1.0, edge)
        radius = math.hypot(vert.co.x, vert.co.z)
        scale = (radius - cut) / radius
        vert.co.x *= scale
        vert.co.z *= scale
    mesh.to_mesh(obj.data)
    mesh.free()


def build_barrel(mat):
    profile, knurl_from, knurl_to = barrel_profile()
    dense = []
    for (a0, r0), (a1, r1) in zip(profile, profile[1:]):
        dense.append((a0, r0))
        if knurl_from <= a0 < knurl_to and a1 - a0 > 0.0004:
            steps = int((a1 - a0) / 0.0003)
            for i in range(1, steps):
                t = i / steps
                dense.append((a0 + (a1 - a0) * t, r0 + (r1 - r0) * t))
    dense.append(profile[-1])
    barrel = lathe("barrel", dense, 96, mat)
    knurl(barrel, knurl_from, knurl_to)
    return barrel


def build_shaft(mat):
    profile = [
        (BARREL_END - 0.004, 0.0015), (BARREL_END - 0.0002, 0.0015), (BARREL_END, 0.00205), (BARREL_END + 0.0012, 0.00205),
        (BARREL_END + 0.0016, SHAFT_RADIUS), (FLIGHT_START + 0.0006, SHAFT_RADIUS), (FLIGHT_START + 0.0012, 0.0021),
        (FLIGHT_START + 0.0028, 0.0021), (FLIGHT_START + 0.0034, 0.0018), (SHAFT_END, 0.0017), (SHAFT_END + 0.0004, 0.0012),
    ]
    return lathe("shaft", profile, 24, mat)


def flight_outline():
    """One standard-shape fin as (distance from the nose, distance from the axis): a curved leading edge out to a square back."""
    root = SHAFT_RADIUS * 0.6
    length = FLIGHT_END - FLIGHT_START
    points = [(0.0, root)]
    for i in range(1, 15):
        t = i / 14
        along = length * 0.8 * (1 - (1 - t) ** 2)
        reach = root + (FLIGHT_SPAN - 0.0012 - root) * math.sin(t * math.pi / 2) ** 0.9
        points.append((along, reach))
    points += [(length * 0.86, FLIGHT_SPAN - 0.0004), (length * 0.94, FLIGHT_SPAN), (length - 0.0006, FLIGHT_SPAN - 0.0002),
               (length, FLIGHT_SPAN - 0.0009), (length, root)]
    return [(FLIGHT_START + a, r) for a, r in points]


def build_flights(mat, thickness=0.00022):
    """Two folded sheets make four fins at right angles; each fin is a thin solid so both faces light."""
    outline = flight_outline()
    mesh = bpy.data.meshes.new("flights")
    verts = []
    faces = []
    for fin in range(4):
        angle = math.pi / 4 + fin * math.pi / 2
        side = Vector((math.cos(angle), 0, math.sin(angle)))
        normal = Vector((-math.sin(angle), 0, math.cos(angle)))
        base = len(verts)
        for offset in (thickness / 2, -thickness / 2):
            for along, reach in outline:
                p = side * reach + normal * offset
                verts.append((p.x, -along, p.z))
        n = len(outline)
        faces.append(tuple(base + i for i in range(n)))
        faces.append(tuple(base + n + i for i in reversed(range(n))))
        for i in range(n):
            j = (i + 1) % n
            faces.append((base + i, base + n + i, base + n + j, base + j))
    mesh.from_pydata(verts, [], faces)
    mesh.validate()
    obj = bpy.data.objects.new("flights", mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(mat)
    tri = bmesh.new()
    tri.from_mesh(mesh)
    bmesh.ops.triangulate(tri, faces=[f for f in tri.faces if len(f.verts) > 4], quad_method="BEAUTY", ngon_method="EAR_CLIP")
    bmesh.ops.recalc_face_normals(tri, faces=tri.faces)
    tri.to_mesh(mesh)
    tri.free()
    return obj


def meshy_barrel(path, mat):
    """Cuts the barrel out of a raw Meshy dart: orients it along the axis, finds the widest metal stretch in the front half and fits it between the point and the shaft."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    imported = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in imported if o.type == "MESH"]
    if not meshes:
        return None
    for obj in bpy.context.selected_objects:
        obj.select_set(False)
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    dart = bpy.context.view_layer.objects.active
    dart.parent = None
    dart.data.transform(dart.matrix_world)
    dart.matrix_world = Matrix.Identity(4)
    for obj in imported:
        if obj is not dart and obj.name in bpy.data.objects:
            bpy.data.objects.remove(obj, do_unlink=True)
    count = len(dart.data.vertices)
    points = np.empty(count * 3)
    dart.data.vertices.foreach_get("co", points)
    points = points.reshape(count, 3)
    centre = points.mean(axis=0)
    _, _, vt = np.linalg.svd(points - centre, full_matrices=False)
    axis = vt[0]
    along = (points - centre) @ axis
    radial = np.linalg.norm((points - centre) - np.outer(along, axis), axis=1)
    low, high = along.min(), along.max()
    span = high - low
    if radial[along < low + span * 0.25].mean() > radial[along > high - span * 0.25].mean():
        axis, along = -axis, -along
        low, high = -high, -low
    t = (along - low) / span
    bins = 60
    profile = np.zeros(bins)
    for b in range(bins):
        inside = (t >= b / bins) & (t < (b + 1) / bins)
        if inside.sum() > 8:
            profile[b] = np.percentile(radial[inside], 90)
    front = profile[: int(bins * 0.62)]
    peak = int(np.argmax(front))
    limit = front[peak] * 0.5
    first = peak
    while first > 0 and front[first - 1] > limit:
        first -= 1
    last = peak
    while last < len(front) - 1 and front[last + 1] > limit:
        last += 1
    t0, t1 = first / bins, (last + 1) / bins
    if t1 - t0 < 0.12:
        log("no barrel found in the Meshy model")
        bpy.data.objects.remove(dart, do_unlink=True)
        return None
    keep = (t >= t0) & (t <= t1)
    core = (points[keep] - centre) - np.outer(along[keep], axis)
    offset = centre + core.mean(axis=0)
    y = Vector(axis.tolist()).normalized()
    helper = Vector((0, 0, 1)) if abs(y.z) < 0.9 else Vector((1, 0, 0))
    x = y.cross(helper).normalized()
    z = x.cross(y).normalized()
    rotation = Matrix((x, y, z)).to_4x4()
    length = (t1 - t0) * span
    scale = (BARREL_END - BARREL_START) / length
    start = low + t0 * span
    fix = (
        Matrix.Rotation(math.pi, 4, "Z")
        @ Matrix.Translation((0, BARREL_START, 0))
        @ Matrix.Scale(scale, 4)
        @ Matrix.Translation((0, -start, 0))
        @ rotation
        @ Matrix.Translation(-Vector(offset.tolist()))
    )
    dart.data.transform(fix)
    mesh = bmesh.new()
    mesh.from_mesh(dart.data)
    doomed = [f for f in mesh.faces if not (BARREL_START <= -f.calc_center_median().y <= BARREL_END)]
    bmesh.ops.delete(mesh, geom=doomed, context="FACES")
    loose = [v for v in mesh.verts if not v.link_faces]
    bmesh.ops.delete(mesh, geom=loose, context="VERTS")
    radius = max((math.hypot(v.co.x, v.co.z) for v in mesh.verts), default=0)
    if radius > 0:
        squeeze = 0.0034 / radius
        for vert in mesh.verts:
            vert.co.x *= squeeze
            vert.co.z *= squeeze
    mesh.to_mesh(dart.data)
    mesh.free()
    dart.data.materials.clear()
    dart.data.materials.append(mat)
    for poly in dart.data.polygons:
        poly.material_index = 0
    if dart.data.uv_layers:
        while dart.data.uv_layers:
            dart.data.uv_layers.remove(dart.data.uv_layers[0])
    dart.name = "barrel"
    log(f"Meshy barrel t {t0:.2f}–{t1:.2f}, {len(dart.data.polygons)} faces")
    return dart


def preview(path):
    """Renders the dart whole and the barrel close up (Cycles) to <path> and <path>-close.png."""
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 48
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 1800
    scene.render.resolution_y = 600
    world = bpy.data.worlds.new("studio")
    scene.world = world
    world.use_nodes = True
    background = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    background.inputs[0].default_value = (0.55, 0.57, 0.6, 1)
    background.inputs[1].default_value = 0.5
    for name, energy, location, size in (("key", 6, (0.1, -0.06, 0.3), 0.25), ("rim", 4, (-0.25, -0.1, 0.1), 0.3), ("under", 1.5, (0.05, -0.08, -0.25), 0.3)):
        light = bpy.data.lights.new(name, "AREA")
        light.energy = energy
        light.size = size
        obj = bpy.data.objects.new(name, light)
        obj.location = location
        obj.rotation_euler = (Vector((0, -0.075, 0)) - Vector(location)).to_track_quat("-Z", "Y").to_euler()
        scene.collection.objects.link(obj)
    camera = bpy.data.cameras.new("camera")
    camera.clip_start = 0.002
    cam = bpy.data.objects.new("camera", camera)
    scene.collection.objects.link(cam)
    scene.camera = cam
    root, _ = os.path.splitext(os.path.abspath(path))
    for suffix, lens, location, target in (("", 70, (0.3, -0.12, 0.2), (0, -0.08, 0)), ("-close", 90, (0.075, -0.03, 0.06), (0, -0.04, 0))):
        camera.lens = lens
        cam.location = location
        cam.rotation_euler = (Vector(target) - Vector(location)).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = root + suffix + ".png"
        bpy.ops.render.render(write_still=True)
    log(f"preview {path}")


def export(path):
    for obj in bpy.context.scene.objects:
        obj.select_set(obj.type == "MESH")
    wanted = {
        "filepath": path,
        "export_format": "GLB",
        "use_selection": True,
        "export_yup": True,
        "export_apply": True,
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


def main():
    args = parse()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    tungsten = material("barrel", (0.56, 0.57, 0.6), 1.0, 0.3)
    black_shaft = material("shaft", (0.02, 0.02, 0.022), 0.0, 0.42)
    tip_plastic = material("tip", (0.012, 0.012, 0.012), 0.0, 0.6)
    white = material("flight-white", (0.92, 0.92, 0.9), 0.0, 0.45, double=True)
    barrel = meshy_barrel(os.path.abspath(args.meshy), tungsten) if args.meshy else None
    if barrel is None:
        barrel = build_barrel(tungsten)
    build_tip(tip_plastic)
    build_shaft(black_shaft)
    build_flights(white)
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH":
            obj.data.transform(Matrix.Identity(4))
    triangles = sum(len(p.vertices) - 2 for o in bpy.context.scene.objects if o.type == "MESH" for p in o.data.polygons)
    log(f"{triangles} triangles")
    out = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    export(out)
    log(f"wrote {args.out}")
    if args.preview:
        preview(args.preview)


main()
