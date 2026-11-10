"""Fits a cleaned Meshy dart for the Darts module (run after scripts/meshy-generate.mjs):

    blender -b --factory-startup -P modules-src/darts/tools/fit-dart.py -- \
        --input assets-src/models/darts/dart-steel.glb --out assets-src/models/darts/dart-steel.glb --length 0.155

  1. Joins every mesh and finds the dart's long axis from its vertices (principal component).
  2. Turns it so the point is at the origin, the nose faces glTF -Z and the body runs back along
     glTF +Z (Blender -Y), the way render/Dart.ts flies it; the point is the thin end, the flights
     the wide one.
  0. Deletes loose pieces that float off the dart's axis.
  3. Centres the barrel on the axis, scales it to --length metres and pulls the flights in to
     --flight-span metres from the axis (regulation flights are about 21 mm).
  4. Moves the flight faces (wide, in the back half) onto a plain white material named "flight",
     so the module can paint them in each player's colour.
  5. Shrinks textures to --texture pixels (1024 is plenty for a 15 cm dart) and exports the .glb;
     then run `pnpm assets`. Keep the cleaned Meshy download (meshy-generate.mjs output) as --input,
     e.g. in .meshy-cache/, because --out overwrites the source model.
"""

import argparse
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector


def log(message):
    print(f"fit-dart: {message}", flush=True)


def parse():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--length", type=float, default=0.155)
    parser.add_argument("--flight-radius", type=float, default=0.0055, dest="flight_radius")
    parser.add_argument("--flight-span", type=float, default=0.021, dest="flight_span")
    parser.add_argument("--texture", type=int, default=1024)
    return parser.parse_args(argv)


def import_dart(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    objects = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    for obj in list(bpy.context.scene.objects):
        if obj.type != "MESH":
            bpy.data.objects.remove(obj, do_unlink=True)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    if len(objects) > 1:
        bpy.ops.object.join()
    dart = bpy.context.view_layer.objects.active
    dart.parent = None
    dart.data.transform(dart.matrix_world)
    dart.matrix_world = Matrix.Identity(4)
    dart.name = "dart"
    return dart


def vertices(dart):
    count = len(dart.data.vertices)
    flat = np.empty(count * 3)
    dart.data.vertices.foreach_get("co", flat)
    return flat.reshape(count, 3)


def principal_axis(points):
    centre = points.mean(axis=0)
    _, _, vt = np.linalg.svd(points - centre, full_matrices=False)
    return centre, vt[0]


def drop_strays(dart):
    """Deletes loose pieces that float off the dart's axis (Meshy sometimes adds a spare flight)."""
    mesh = bmesh.new()
    mesh.from_mesh(dart.data)
    mesh.verts.ensure_lookup_table()
    parent = list(range(len(mesh.verts)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(a, b):
        a, b = find(a), find(b)
        if a != b:
            parent[a] = b

    size = max(mesh.verts[0].co.length, 1e-6)
    for vert in mesh.verts:
        size = max(size, vert.co.length)
    grid = {}
    for vert in mesh.verts:
        key = tuple(round(c / size * 1e5) for c in vert.co)
        if key in grid:
            union(vert.index, grid[key])
        else:
            grid[key] = vert.index
    for edge in mesh.edges:
        union(edge.verts[0].index, edge.verts[1].index)
    groups = {}
    for vert in mesh.verts:
        groups.setdefault(find(vert.index), []).append(vert)
    islands = sorted(groups.values(), key=len, reverse=True)
    core = np.array([v.co[:] for v in islands[0]])
    centre, axis = principal_axis(core)
    span = np.ptp((core - centre) @ axis)
    doomed = []
    for island in islands[1:]:
        points = np.array([v.co[:] for v in island]) - centre
        along = points @ axis
        radial = np.linalg.norm(points - np.outer(along, axis), axis=1)
        if radial.min() > span * 0.04:
            doomed.extend(island)
    if doomed:
        bmesh.ops.delete(mesh, geom=doomed, context="VERTS")
        mesh.to_mesh(dart.data)
        log(f"dropped {len(doomed)} stray vertices")
    mesh.free()


def shrink_flights(dart, length, radius, root=0.003):
    """Pulls the flights in towards the shaft so their tips sit at most `radius` metres from the axis."""
    points = vertices(dart)
    tail = points[:, 1] > length * 0.55
    r = np.hypot(points[:, 0], points[:, 2])
    widest = r[tail].max()
    if widest <= radius:
        return
    k = (radius - root) / (widest - root)
    grow = tail & (r > root)
    scale = np.ones(len(points))
    scale[grow] = (root + (r[grow] - root) * k) / r[grow]
    points[:, 0] *= scale
    points[:, 2] *= scale
    dart.data.vertices.foreach_set("co", points.ravel())
    dart.data.update()
    log(f"flights {widest * 1000:.1f} → {radius * 1000:.1f} mm from the axis")


def orient(dart, length):
    points = vertices(dart)
    centre = points.mean(axis=0)
    _, _, vt = np.linalg.svd(points - centre, full_matrices=False)
    axis = vt[0]
    along = (points - centre) @ axis
    radial = np.linalg.norm((points - centre) - np.outer(along, axis), axis=1)
    low, high = along.min(), along.max()
    span = high - low
    near_low = radial[along < low + span * 0.25].mean()
    near_high = radial[along > high - span * 0.25].mean()
    if near_low > near_high:
        axis = -axis
        along = -along
        low, high = -high, -low
    tip = centre + axis * low
    barrel = (along > low + span * 0.2) & (along < low + span * 0.5)
    offset = (points[barrel] - centre) - np.outer(along[barrel], axis)
    tip = tip + offset.mean(axis=0)
    y = Vector(axis.tolist()).normalized()
    helper = Vector((0, 0, 1)) if abs(y.z) < 0.9 else Vector((1, 0, 0))
    x = y.cross(helper).normalized()
    z = x.cross(y).normalized()
    rotation = Matrix((x, y, z))
    scale = length / span
    fix = Matrix.Scale(scale, 4) @ rotation.to_4x4() @ Matrix.Translation(-Vector(tip.tolist()))
    dart.data.transform(fix)
    log(f"length {span:.4f} → {length} m (scale {scale:.4f})")


def split_flights(dart, length, flight_radius):
    flight = bpy.data.materials.new("flight")
    flight.use_nodes = True
    shader = flight.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (1, 1, 1, 1)
    shader.inputs["Roughness"].default_value = 0.45
    shader.inputs["Metallic"].default_value = 0
    dart.data.materials.append(flight)
    index = len(dart.data.materials) - 1
    mesh = bmesh.new()
    mesh.from_mesh(dart.data)
    moved = 0
    for face in mesh.faces:
        c = face.calc_center_median()
        if c.y > length * 0.55 and (c.x * c.x + c.z * c.z) ** 0.5 > flight_radius:
            face.material_index = index
            moved += 1
    mesh.to_mesh(dart.data)
    mesh.free()
    log(f"{moved} flight faces of {len(dart.data.polygons)}")


def shrink_textures(limit):
    for image in bpy.data.images:
        width, height = image.size
        if max(width, height) > limit:
            image.scale(min(width, limit), min(height, limit))
            image.pack()
            log(f"texture {image.name} {width} → {limit}")


def export(path):
    bpy.ops.object.select_all(action="SELECT")
    wanted = {
        "filepath": path,
        "export_format": "GLB",
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
    dart = import_dart(os.path.abspath(args.input))
    drop_strays(dart)
    orient(dart, args.length)
    shrink_flights(dart, args.length, args.flight_span)
    split_flights(dart, args.length, args.flight_radius)
    dart.data.transform(Matrix.Rotation(math.pi, 4, "Z"))
    shrink_textures(args.texture)
    export(os.path.abspath(args.out))
    log(f"wrote {args.out}")


main()
