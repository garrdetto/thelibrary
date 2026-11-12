"""Turns the Meshy vehicle downloads into the Fox Plains built-in vehicle bodies.

  blender -b --factory-startup -P modules-src/foxlake/tools/build-vehicles.py -- <cacheDir> <specs.json> [kind,kind]

<cacheDir> holds <kind>.glb from Meshy (text-to-3D smart topology, refined with PBR; task ids in
assets-src/models/foxlake/vehicles.meshy.json). <specs.json> gives each kind's body box from the shared tuning
(front, rear, width, height, wheel centre height and axles; scripts/foxlake-vehicle-specs.mjs writes it). Each model
is joined into one mesh, turned so its front points along +x (they come in facing -x), scaled uniformly so
its length matches the built-in's body and centred across the track, and set down so its lowest point sits on the
ground under the built-in's wheels. Materials keep Meshy's color, normal, metal and roughness maps; textures are
capped at 1024 px. The result replaces assets-src/models/maplestreet/vehicles/<kind>.glb, which `pnpm assets`
optimizes into public/models/. Wheels stay part of the body (physics are the built-in's; nothing else changes).
"""
import bpy
import json
import math
import os
import sys
from mathutils import Matrix, Vector

ARGS = sys.argv[sys.argv.index('--') + 1:]
CACHE = os.path.abspath(ARGS[0])
SPECS = json.load(open(ARGS[1]))
ONLY = set(ARGS[2].split(',')) if len(ARGS) > 2 and ARGS[2] else None
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, '../../../assets-src/models/maplestreet/vehicles'))
TEXTURE = 1024
# Meshy faces these fronts along -x after import (checked against renders): turn about z to put them on +x.
TURN = {'golfcart': math.pi, 'atv': math.pi, 'zeroturn': math.pi, 'mower': math.pi, 'trailer': math.pi}


def clear():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.images):
        for item in list(block):
            block.remove(item)


def joined():
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for o in list(bpy.data.objects):
        if o is not obj:
            bpy.data.objects.remove(o, do_unlink=True)
    obj.parent = None
    return obj


def bounds(obj):
    xs = [v.co.x for v in obj.data.vertices]
    ys = [v.co.y for v in obj.data.vertices]
    zs = [v.co.z for v in obj.data.vertices]
    return Vector((min(xs), min(ys), min(zs))), Vector((max(xs), max(ys), max(zs)))


def build(kind, spec):
    clear()
    src = os.path.join(CACHE, kind + '.glb')
    bpy.ops.import_scene.gltf(filepath=src)
    obj = joined()
    obj.data.transform(Matrix.Rotation(TURN.get(kind, 0.0), 4, 'Z'))
    lo, hi = bounds(obj)
    length = hi.x - lo.x
    front = spec['tongue']['x'] + 0.05 if spec.get('tongue') else spec['front']
    target = front - spec['rear']
    s = target / max(length, 1e-6)
    ground = min(spec['wheelCenterY'] - a[2] for a in spec['axles'])
    centre_y = (lo.y + hi.y) / 2
    obj.data.transform(Matrix.Translation(Vector((-lo.x, -centre_y, -lo.z))))
    obj.data.transform(Matrix.Scale(s, 4))
    obj.data.transform(Matrix.Translation(Vector((spec['rear'], 0.0, ground))))
    lo, hi = bounds(obj)
    obj.name = kind
    obj.data.name = kind
    for mat in obj.data.materials:
        if not mat or not mat.node_tree:
            continue
        for node in mat.node_tree.nodes:
            if node.type == 'TEX_IMAGE' and node.image and max(node.image.size) > TEXTURE:
                node.image.scale(TEXTURE, TEXTURE)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(40))
    os.makedirs(OUT, exist_ok=True)
    out = os.path.join(OUT, kind + '.glb')
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=False, export_apply=True, export_yup=True, export_image_format='WEBP')
    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    print('vehicle', kind, 'scale', round(s, 4), 'length', round(hi.x - lo.x, 3), 'width', round(hi.y - lo.y, 3), 'height', round(hi.z - lo.z, 3),
          'body width', spec['width'], 'body height', spec['height'], 'tris', tris)


for kind, spec in SPECS.items():
    if ONLY and kind not in ONLY:
        continue
    build(kind, spec)
