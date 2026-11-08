"""Builds the Bush League fielder's glove and bat in Blender and exports them as vertex-coloured .glb files.

Run headless:  blender -b -P modules-src/bushleague/tools/build-gear.py
or from a running Blender with runpy.run_path(path, run_name='__main__').

Axes are three.js metres (Blender gets (x, -z, y)). The glove is the left-hand glove in the hand bone's frame:
fingers up (+y), pocket facing forward (+z), thumb toward the body (-x); the right-hand glove is its mirror,
made in players/Models.ts. The bat stands on its knob at the origin, barrel up (+y), 0.86 m long.
Outputs public/modules/bushleague/players/glove.glb and bat.glb; commit them.
"""
import math
import os

import bmesh
import bpy
from mathutils import Vector

try:
    REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
except NameError:
    REPO = os.environ.get('BUSHLEAGUE_REPO', os.getcwd())
OUT = os.path.join(REPO, 'public', 'modules', 'bushleague', 'players')

LEATHER = (0.2, 0.068, 0.022)
BINDING = (0.06, 0.022, 0.009)
LACE = (0.42, 0.22, 0.1)
PAD = (0.03, 0.012, 0.006)
WOOD = (0.52, 0.3, 0.13)
WOOD_DARK = (0.16, 0.07, 0.03)
GRIP = (0.012, 0.012, 0.015)


def b(three):
    x, y, z = three
    return Vector((x, -z, y))


def t(co):
    return co.x, co.z, -co.y


def clear():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for collection in (bpy.data.meshes, bpy.data.materials):
        for item in list(collection):
            if item.users == 0:
                collection.remove(item)


def skinned(name, points, edges, root=0, levels=2):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(b(p)) for p, _ in points], edges, [])
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    skin = obj.modifiers.new('Skin', 'SKIN')
    skin.use_smooth_shade = True
    for index, (_, radius) in enumerate(points):
        obj.data.skin_vertices[0].data[index].radius = (radius[0] * 1.55, radius[1] * 1.55)
    obj.data.skin_vertices[0].data[root].use_root = True
    subdivision = obj.modifiers.new('Smooth', 'SUBSURF')
    subdivision.levels = levels
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier='Skin')
    bpy.ops.object.modifier_apply(modifier='Smooth')
    return obj


def paint(obj, color_of):
    attribute = obj.data.color_attributes.new('Color', 'FLOAT_COLOR', 'POINT')
    for vertex in obj.data.vertices:
        r, g, bl = color_of(Vector(t(vertex.co)))
        attribute.data[vertex.index].color = (r, g, bl, 1.0)


def finish(objects, name):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    if len(objects) > 1:
        bpy.ops.object.join()
    obj = bpy.context.active_object
    obj.name = name
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    material = bpy.data.materials.new(name)
    obj.data.materials.clear()
    obj.data.materials.append(material)
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f'{name}.glb')
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_materials='PLACEHOLDER', export_texcoords=False,
                              export_vertex_color='ACTIVE', export_yup=True, export_apply=True)
    triangles = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    print(f'{name}: {triangles} tris -> {path} ({os.path.getsize(path) // 1024} KB)')
    return obj


FINGER_X = (-0.044, -0.0145, 0.015, 0.0435)
FINGER_TOP = (0.13, 0.14, 0.132, 0.114)


def capsule(name, start, end, rx, rz, segments=16, rings=13):
    """A rounded stall from start to end (three.js points) with the given side-to-side and front-to-back radii."""
    start, end = Vector(start), Vector(end)
    axis = end - start
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, radius=1, location=(0, 0, 0))
    obj = bpy.context.active_object
    obj.name = name
    half = axis.length / 2
    tip = min(rx, rz)
    for vertex in obj.data.vertices:
        x, y, z = t(vertex.co)
        vertex.co = b((x * rx, y * tip + math.copysign(half, y), z * rz))
    direction = axis.normalized()
    rotation = Vector((0, 1, 0)).rotation_difference(direction)
    centre = (start + end) / 2
    for vertex in obj.data.vertices:
        p = Vector(t(vertex.co))
        vertex.co = b(rotation @ p + centre)
    return obj


def glove():
    parts = []
    bpy.ops.mesh.primitive_uv_sphere_add(segments=28, ring_count=18, radius=1, location=(0, 0, 0))
    palm = bpy.context.active_object
    palm.name = 'Palm'
    for vertex in palm.data.vertices:
        x, y, z = t(vertex.co)
        px, py, pz = x * 0.064, y * 0.07 - 0.028, z * 0.03 - 0.008
        if z > 0:
            pz -= 0.016 * (1 - x * x) * (1 - y * y)
        vertex.co = b((px, py, pz))
    parts.append(palm)
    for x, top in zip(FINGER_X, FINGER_TOP):
        parts.append(capsule('Finger', (x * 0.95, 0.0, -0.006), (x * 1.04, top - 0.018, 0.012), 0.0158, 0.021))
    parts.append(capsule('Thumb', (-0.045, -0.06, -0.004), (-0.08, 0.04, 0.014), 0.019, 0.021))
    parts.append(capsule('Heel', (-0.055, -0.092, -0.01), (0.055, -0.092, -0.01), 0.022, 0.026, 18, 10))
    shell = parts
    bm = bmesh.new()
    rows, cols = 7, 5
    grid = []
    for i in range(rows + 1):
        row = []
        for j in range(cols + 1):
            u, v = j / cols, i / rows
            left = Vector((-0.062 - 0.018 * v, -0.005 + 0.05 * v, 0.018))
            right = Vector((-0.047, 0.03 + 0.075 * v, 0.02))
            p = left.lerp(right, u)
            p.z += 0.006 * math.sin(u * math.pi)
            row.append(bm.verts.new(b(p)))
        grid.append(row)
    for i in range(rows):
        for j in range(cols):
            bm.faces.new((grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]))
    web_mesh = bpy.data.meshes.new('web')
    bm.to_mesh(web_mesh)
    bm.free()
    web = bpy.data.objects.new('Web', web_mesh)
    bpy.context.scene.collection.objects.link(web)
    solid = web.modifiers.new('Solid', 'SOLIDIFY')
    solid.thickness = 0.006
    bpy.context.view_layer.objects.active = web
    bpy.ops.object.modifier_apply(modifier='Solid')

    def shell_color(p):
        x, y, z = p
        if y < -0.08:
            return PAD
        if z < -0.03 and abs(y + 0.035) < 0.005 and abs(x) < 0.05:
            return LACE
        if abs(x) > 0.06 and y < 0.02:
            return BINDING
        return LEATHER

    def web_color(p):
        x, y, z = p
        stripe = (y * 90) % 1.0
        return LACE if stripe < 0.28 else BINDING

    for part in shell:
        paint(part, shell_color)
    paint(web, web_color)
    return finish(shell + [web], 'glove')


BAT_PROFILE = (
    (0.0, 0.0), (0.0, 0.0175), (0.006, 0.0215), (0.014, 0.0205), (0.022, 0.0135), (0.05, 0.0122), (0.3, 0.0128), (0.42, 0.0155),
    (0.55, 0.022), (0.66, 0.029), (0.74, 0.0322), (0.95, 0.0332), (0.985, 0.031), (0.996, 0.024), (1.0, 0.0),
)


def bat(length=0.86, sides=16):
    bm = bmesh.new()
    rings = []
    for y, radius in BAT_PROFILE:
        if radius == 0:
            rings.append([bm.verts.new(b((0, y * length, 0)))])
            continue
        rings.append([bm.verts.new(b((math.cos(a) * radius, y * length, math.sin(a) * radius))) for a in (i / sides * math.tau for i in range(sides))])
    for lower, upper in zip(rings, rings[1:]):
        if len(lower) == 1:
            for i in range(sides):
                bm.faces.new((lower[0], upper[(i + 1) % sides], upper[i]))
        elif len(upper) == 1:
            for i in range(sides):
                bm.faces.new((lower[i], lower[(i + 1) % sides], upper[0]))
        else:
            for i in range(sides):
                bm.faces.new((lower[i], lower[(i + 1) % sides], upper[(i + 1) % sides], upper[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new('bat')
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new('Bat', mesh)
    bpy.context.scene.collection.objects.link(obj)
    subdivision = obj.modifiers.new('Smooth', 'SUBSURF')
    subdivision.levels = 1
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier='Smooth')

    def color(p):
        y = p.y / length
        if 0.024 < y < 0.3:
            return GRIP
        if y > 0.975 or y < 0.024:
            return WOOD_DARK
        grain = 0.04 * math.sin(p.y * 140 + math.atan2(p.z, p.x) * 3)
        return tuple(min(1, c + grain) for c in WOOD)

    paint(obj, color)
    return finish([obj], 'bat')


if __name__ == '__main__' or os.environ.get('BUSHLEAGUE_BUILD') == '1':
    clear()
    glove()
    clear()
    bat()
