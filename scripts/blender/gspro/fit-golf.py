"""Fits the Meshy golfer and clubs for the GSPro replay range.

blender -b --factory-startup -P scripts/blender/gspro/fit-golf.py -- <assets-src/models/gspro>

Clubs: finds the shaft (the longest principal axis) and the head (the wide end), then lays every club the same way:
grip butt at the origin, shaft down −Y, head at y = −length, toe toward +X. Golfer: drops stray helper meshes so only
the skinned body and its armature remain. Writes the files back in place.
"""
import bpy, bmesh, sys, os
from mathutils import Matrix, Vector

folder = sys.argv[sys.argv.index('--') + 1]

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def export(path, animations):
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_animations=animations, export_yup=True)

def principal_axis(points):
    centre = sum(points, Vector()) / len(points)
    cov = [[0.0] * 3 for _ in range(3)]
    for p in points:
        d = p - centre
        for i in range(3):
            for j in range(3):
                cov[i][j] += d[i] * d[j]
    axis = Vector((1, 1, 1)).normalized()
    m = Matrix(cov)
    for _ in range(60):
        axis = (m @ axis).normalized()
    return centre, axis

def fit_club(name):
    reset()
    path = os.path.join(folder, name + '.glb')
    bpy.ops.import_scene.gltf(filepath=path)
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes: o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1: bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.parent = None
    obj.data.transform(obj.matrix_world)
    obj.matrix_world = Matrix.Identity(4)
    points = [v.co.copy() for v in obj.data.vertices]
    centre, axis = principal_axis(points)
    proj = [(p - centre).dot(axis) for p in points]
    lo, hi = min(proj), max(proj)
    length = hi - lo
    def spread(sel):
        pts = [p for p, s in zip(points, proj) if sel(s)]
        if not pts: return 0, Vector()
        c = sum(pts, Vector()) / len(pts)
        radial = [((p - centre) - axis * (p - centre).dot(axis)) for p in pts]
        return max(r.length for r in radial), c
    lo_w, lo_c = spread(lambda s: s < lo + length * 0.12)
    hi_w, hi_c = spread(lambda s: s > hi - length * 0.12)
    if hi_w > lo_w:
        axis = -axis
        proj = [-s for s in proj]
        lo, hi = -hi, -lo
        head_c = hi_c
    else:
        head_c = lo_c
    butt = centre + axis * hi
    down = -axis
    toe = (head_c - centre)
    toe = toe - down * toe.dot(down)
    if toe.length < 1e-5: toe = down.orthogonal()
    toe.normalize()
    face = toe.cross(down).normalized()
    basis = Matrix((toe, -down, face)).to_4x4()
    to_local = basis @ Matrix.Translation(-butt)
    obj.data.transform(to_local)
    obj.data.update()
    obj.name = name
    obj.data.name = name
    print('club', name, 'length', round(length, 3), 'head width', round(max(lo_w, hi_w), 3))
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    export(path, False)

def fit_golfer():
    reset()
    path = os.path.join(folder, 'golfer.glb')
    bpy.ops.import_scene.gltf(filepath=path)
    for o in list(bpy.data.objects):
        if o.type == 'MESH' and not any(m.type == 'ARMATURE' for m in o.modifiers) and o.find_armature() is None:
            print('removing helper mesh', o.name)
            bpy.data.objects.remove(o, do_unlink=True)
    export(path, True)

for club in ('club-driver', 'club-wood', 'club-iron'):
    fit_club(club)
fit_golfer()
