"""Turns the Meshy helicopter downloads into Life Sim's helicopters.

  blender -b --factory-startup -P modules-src/foxlake/tools/build-helicopter.py -- [kestrel|bubble]

PROFILES lists each one: the Meshy download in .meshy-cache/, the output, its length and how its rotors are told apart
(the Kestrel: a white two-seat light helicopter with a ducted tail fan; the bubble: a tiny two-seat "bug" with a glass
bubble canopy, an open truss tail boom and a side-mounted tail rotor). With no name, both are built.

The source is a Meshy text-to-3D smart-topology model (task ids in assets-src/models/foxlake/vehicles.meshy.json),
which comes in part-separated: every blade, the mast, the fan hub and so on is its own loose piece. The script

  1. finds the main rotor (the mast, hub and blades: pieces above the cabin roof, ahead of the fin) and the ducted tail
     fan (the small pieces inside the fin's duct, not the duct itself) by their loose pieces in Meshy's own frame,
  2. turns the model so its nose points along +x, scales it to the profile's length nose to tail, centres it across and sets
     the skids on the ground (z = 0) with x = 0 under the main rotor's mast,
  3. splits it into three objects: `body`, `rotor-main` (origin on the mast at the blade plane; Life Sim spins it about
     its up axis) and `rotor-tail` (origin at the fan's hub; spun about its side axis),
  4. welds and smooths every part (scripts/blender/smooth_normals.py), caps textures at TEXTURE px and writes
     the profile's .glb in assets-src/models/foxlake/, which `pnpm assets` optimizes into public/models/foxlake/.

It prints the measurements the vehicle record in modules-src/foxlake/vehicles/Helicopter.ts uses (chassis frame:
x forward, y up, z right, metres from the mast's foot on the ground).
"""
import bmesh
import bpy
import json
import math
import os
import sys
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../../scripts/blender')))
from smooth_normals import smooth_object  # noqa: E402

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '../../..'))
TEXTURE = 1024
# Numbers are in Meshy's frame after import (nose at -x, up +z, y left), where the models are about 1 unit long.
#   rotor_floor: loose pieces whose lowest point is above this (and ahead of fin_x) are the main rotor.
#   fan, fan_radius: the tail rotor's centre (x, z) and radius; thin pieces (under `thin` across y) inside it spin.
#   hub: 'mast' takes the main rotor's hub from its slimmest piece, 'bbox' from the middle of all its pieces, or an
#   (x, y) point names it (when the blades are lopsided about the mast).
PROFILES = {
    'kestrel': {'src': '.meshy-cache/helicopter.glb', 'out': 'assets-src/models/foxlake/helicopter.glb', 'length': 7.6,
                'rotor_floor': 0.12, 'fin_x': 0.33, 'fan': (0.437, 0.0), 'fan_radius': 0.06, 'thin': 0.03, 'hub': 'mast'},
    'bubble': {'src': '.meshy-cache/bubble-helicopter.glb', 'out': 'assets-src/models/foxlake/bubble-helicopter.glb', 'length': 10.5,
               'rotor_floor': 0.095, 'fin_x': 0.34, 'fan': (0.415, 0.046), 'fan_radius': 0.07, 'thin': 0.03, 'hub': (-0.103, 0.0)},
}


def clear():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)


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


def pieces(bm):
    """Loose pieces as lists of faces."""
    seen = set()
    out = []
    for f in bm.faces:
        if f.index in seen:
            continue
        stack = [f]
        seen.add(f.index)
        group = []
        while stack:
            a = stack.pop()
            group.append(a)
            for e in a.edges:
                for b in e.link_faces:
                    if b.index not in seen:
                        seen.add(b.index)
                        stack.append(b)
        out.append(group)
    return out


def box(faces):
    vs = {v for f in faces for v in f.verts}
    lo = Vector((min(v.co.x for v in vs), min(v.co.y for v in vs), min(v.co.z for v in vs)))
    hi = Vector((max(v.co.x for v in vs), max(v.co.y for v in vs), max(v.co.z for v in vs)))
    return lo, hi, vs


def classify(obj, prof):
    """Face index -> 'main', 'tail' or 'body', from Meshy's loose pieces."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.to_mesh(obj.data)
    bm.free()
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    role = {}
    main_boxes = []
    for group in pieces(bm):
        lo, hi, vs = box(group)
        kind = 'body'
        fan = prof['fan']
        if lo.z >= prof['rotor_floor'] and hi.x < prof['fin_x']:
            kind = 'main'
            main_boxes.append((lo, hi))
        elif hi.y - lo.y < prof['thin'] and all(math.hypot(v.co.x - fan[0], v.co.z - fan[1]) < prof['fan_radius'] for v in vs):
            kind = 'tail'
        for f in group:
            role[f.index] = kind
    bm.free()
    if isinstance(prof['hub'], tuple):
        hub = Vector((prof['hub'][0], prof['hub'][1], 0.0))
    elif prof['hub'] == 'mast':
        mast = min(main_boxes, key=lambda b: (b[1].x - b[0].x) + (b[1].y - b[0].y) - (b[1].z - b[0].z))
        hub = Vector(((mast[0].x + mast[1].x) / 2, (mast[0].y + mast[1].y) / 2, 0.0))
    else:
        lo = Vector((min(b[0].x for b in main_boxes), min(b[0].y for b in main_boxes), 0.0))
        hi = Vector((max(b[1].x for b in main_boxes), max(b[1].y for b in main_boxes), 0.0))
        hub = (lo + hi) / 2
    return role, hub


def part(src, role, name, keep):
    obj = src.copy()
    obj.data = src.data.copy()
    obj.name = name
    obj.data.name = name
    bpy.context.collection.objects.link(obj)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if role.get(f.index) != keep], context='FACES')
    bm.to_mesh(obj.data)
    bm.free()
    return obj


def bounds(objs):
    vs = [o.matrix_world @ v.co for o in objs for v in o.data.vertices]
    return (Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs))),
            Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs))))


def set_origin(obj, at):
    obj.data.transform(Matrix.Translation(-at))
    obj.location = at


def game(v):
    """Blender (x forward, y left, z up) to the chassis frame (x forward, y up, z right)."""
    return {'x': round(v.x, 3), 'y': round(v.z, 3), 'z': round(-v.y, 3)}


def build(name):
    prof = PROFILES[name]
    out = os.path.join(ROOT, prof['out'])
    clear()
    bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, prof['src']))
    src = joined()
    role, hub = classify(src, prof)
    lo, hi = bounds([src])
    s = prof['length'] / (hi.x - lo.x)
    centre_y = (lo.y + hi.y) / 2
    turn = Matrix.Rotation(math.pi, 4, 'Z')
    to_game = Matrix.Scale(s, 4) @ turn @ Matrix.Translation(Vector((-hub.x, -centre_y, -lo.z)))
    src.data.transform(to_game)
    for mat in src.data.materials:
        if not mat or not mat.node_tree:
            continue
        for node in mat.node_tree.nodes:
            if node.type == 'TEX_IMAGE' and node.image and max(node.image.size) > TEXTURE:
                node.image.scale(TEXTURE, TEXTURE)
    body = part(src, role, 'body', 'body')
    main = part(src, role, 'rotor-main', 'main')
    tail = part(src, role, 'rotor-tail', 'tail')
    bpy.data.objects.remove(src, do_unlink=True)
    mlo, mhi = bounds([main])
    blades = [v for v in main.data.vertices if math.hypot(v.co.x, v.co.y) > 0.6]
    plane = sum(v.co.z for v in blades) / max(1, len(blades))
    set_origin(main, Vector((0.0, 0.0, plane)))
    tlo, thi = bounds([tail])
    set_origin(tail, (tlo + thi) / 2)
    for obj in (body, main, tail):
        smooth_object(obj, angle=40.0)
    blo, bhi = bounds([body])
    skid = [v.co for v in body.data.vertices if v.co.z < 0.12]
    cabin = [v.co for v in body.data.vertices if v.co.x > -1.2]
    rotor_radius = max(math.hypot(v.co.x, v.co.y) for v in main.data.vertices)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=False, export_apply=True, export_yup=True, export_image_format='WEBP')
    tris = sum(len(p.vertices) - 2 for o in (body, main, tail) for p in o.data.polygons)
    print('HELI', name, json.dumps({
        'scale': round(s, 4),
        'length': round(bhi.x - blo.x, 3), 'height': round(max(bhi.z, mhi.z), 3), 'width': round(bhi.y - blo.y, 3),
        'nose': round(bhi.x, 3), 'tail': round(blo.x, 3),
        'rotorMain': game(main.location), 'rotorRadius': round(rotor_radius, 3),
        'rotorTail': game(tail.location), 'tailRadius': round(max((thi - tlo).x, (thi - tlo).z) / 2, 3),
        'skid': {'front': round(max(v.x for v in skid), 3), 'rear': round(min(v.x for v in skid), 3), 'halfTrack': round(max(abs(v.y) for v in skid), 3)},
        'cabin': {'front': round(max(v.x for v in cabin), 3), 'rear': round(min(v.x for v in cabin), 3),
                  'halfWidth': round(max(abs(v.y) for v in cabin), 3),
                  'bottom': round(min(v.z for v in cabin if v.z > 0.25), 3), 'top': round(max(v.z for v in cabin), 3)},
        'tris': tris,
    }))


for name in (ARGS[:1] if ARGS else PROFILES):
    build(name)
