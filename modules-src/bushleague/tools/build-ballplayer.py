"""Builds the Bush League ballplayer bodies in Blender and exports one skinned .glb per body type.

Run headless:  blender -b -P modules-src/bushleague/tools/build-ballplayer.py
or from a running Blender (Text Editor or the MCP bridge) with exec(open(path).read()).

Each body is sculpted on the shared 21-bone skeleton from players/Rig.ts at its 1.85 m reference
(three.js +x is the player's left, +y up, +z forward; Blender gets (x, -z, y)), tagged per vertex
with the uniform slot the player material reads (`_slot`, exported as a glTF custom attribute), and
weighted to the bones. Outputs public/modules/bushleague/players/ballplayer-<body>.glb; commit them.
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

SLOT = {'skin': 0, 'jersey': 1, 'trim': 2, 'pants': 3, 'socks': 4, 'cleats': 5, 'cap': 6, 'belt': 7}

LAYOUT = {
    'hips': (None, (0, 0.98, 0)),
    'spine': ('hips', (0, 0.12, 0)),
    'chest': ('spine', (0, 0.2, 0)),
    'neck': ('chest', (0, 0.2, 0)),
    'head': ('neck', (0, 0.1, 0.01)),
    'shoulder.L': ('chest', (0.06, 0.15, 0)),
    'arm.L': ('shoulder.L', (0.13, 0, 0)),
    'forearm.L': ('arm.L', (0.29, 0, 0)),
    'hand.L': ('forearm.L', (0.26, 0, 0)),
    'shoulder.R': ('chest', (-0.06, 0.15, 0)),
    'arm.R': ('shoulder.R', (-0.13, 0, 0)),
    'forearm.R': ('arm.R', (-0.29, 0, 0)),
    'hand.R': ('forearm.R', (-0.26, 0, 0)),
    'thigh.L': ('hips', (0.1, -0.05, 0)),
    'shin.L': ('thigh.L', (0, -0.44, 0)),
    'foot.L': ('shin.L', (0, -0.43, 0)),
    'toe.L': ('foot.L', (0, -0.05, 0.15)),
    'thigh.R': ('hips', (-0.1, -0.05, 0)),
    'shin.R': ('thigh.R', (0, -0.44, 0)),
    'foot.R': ('shin.R', (0, -0.43, 0)),
    'toe.R': ('foot.R', (0, -0.05, 0.15)),
}
TAILS = {'head': (0, 0.2, 0), 'hand.L': (0.15, 0, 0), 'hand.R': (-0.15, 0, 0), 'toe.L': (0, 0, 0.06), 'toe.R': (0, 0, 0.06)}
CHILD = {'hips': 'spine', 'spine': 'chest', 'chest': 'neck', 'neck': 'head', 'shoulder.L': 'arm.L', 'arm.L': 'forearm.L', 'forearm.L': 'hand.L',
         'shoulder.R': 'arm.R', 'arm.R': 'forearm.R', 'forearm.R': 'hand.R', 'thigh.L': 'shin.L', 'shin.L': 'foot.L', 'foot.L': 'toe.L',
         'thigh.R': 'shin.R', 'shin.R': 'foot.R', 'foot.R': 'toe.R'}

BODIES = {
    'lean': {'girth': 0.92, 'shoulders': 1.0, 'belly': 0.0},
    'stocky': {'girth': 1.14, 'shoulders': 1.1, 'belly': 0.03},
    'belly': {'girth': 1.06, 'shoulders': 1.02, 'belly': 0.12},
}


def b(three):
    """three.js (x, y, z) to Blender (x, -z, y)."""
    x, y, z = three
    return Vector((x, -z, y))


def joint(name):
    parent, offset = LAYOUT[name]
    base = joint(parent) if parent else (0, 0, 0)
    return tuple(base[i] + offset[i] for i in range(3))


def clear():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for collection in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials):
        for item in list(collection):
            if item.users == 0:
                collection.remove(item)


def build_armature():
    data = bpy.data.armatures.new('Ballplayer')
    rig = bpy.data.objects.new('Ballplayer', data)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    for name in LAYOUT:
        bone = data.edit_bones.new(name)
        head = joint(name)
        tail = joint(CHILD[name]) if name in CHILD else tuple(head[i] + TAILS[name][i] for i in range(3))
        if name in ('shoulder.L', 'shoulder.R'):
            tail = joint(CHILD[name])
        bone.head = b(head)
        bone.tail = b(tail)
    for name, (parent, _) in LAYOUT.items():
        if parent:
            data.edit_bones[name].parent = data.edit_bones[parent]
    bpy.ops.object.mode_set(mode='OBJECT')
    return rig


def skin_body(body):
    """A skin-modifier cage along the skeleton: points with their (side, front) radii in three.js metres."""
    g = body['girth']
    sh = body['shoulders']
    points = []
    edges = []

    def add(position, radius, parent=None):
        # The subdivision pass pulls the skin cage in by about a third; these radii are the finished body's.
        points.append((position, (radius[0] * 1.55, radius[1] * 1.55)))
        index = len(points) - 1
        if parent is not None:
            edges.append((parent, index))
        return index

    pelvis = add((0, 0.86, 0), (0.165 * g, 0.115 * g))
    hips = add((0, 0.97, 0), (0.17 * g, 0.118 * g), pelvis)
    waist = add((0, 1.09, 0.005), (0.152 * g, 0.105 * g), hips)
    ribs = add((0, 1.21, 0.01), (0.168 * g, 0.115 * g), waist)
    chest = add((0, 1.33, 0.012), (0.188 * g * sh, 0.122 * g), ribs)
    yoke = add((0, 1.42, 0.0), (0.19 * g * sh, 0.11 * g), chest)
    neck0 = add((0, 1.49, 0.005), (0.064 * g, 0.066 * g), yoke)
    add((0, 1.64, 0.015), (0.05, 0.052), neck0)
    for side in (1, -1):
        shoulder = add((side * 0.17 * sh, 1.435, 0), (0.074 * g, 0.072 * g), yoke)
        bicep = add((side * 0.3 * sh, 1.45, 0), (0.066 * g, 0.062 * g), shoulder)
        elbow = add((side * (0.19 + 0.29), 1.45, 0), (0.044 * g, 0.044 * g), bicep)
        forearm = add((side * 0.58, 1.45, 0.003), (0.048 * g, 0.041 * g), elbow)
        wrist = add((side * 0.73, 1.45, 0), (0.032, 0.025), forearm)
        palm = add((side * 0.8, 1.45, 0), (0.046, 0.022), wrist)
        add((side * 0.89, 1.448, 0), (0.036, 0.016), palm)
        add((side * 0.775, 1.45, 0.04), (0.014, 0.014), wrist)
        hip = add((side * 0.1, 0.88, 0), (0.088 * g, 0.09 * g), pelvis)
        thigh = add((side * 0.1, 0.69, 0.008), (0.078 * g, 0.082 * g), hip)
        knee = add((side * 0.1, 0.49, 0.01), (0.054 * g, 0.056 * g), thigh)
        calf = add((side * 0.1, 0.35, -0.012), (0.056 * g, 0.06 * g), knee)
        ankle = add((side * 0.1, 0.1, 0), (0.034, 0.036), calf)
        heel = add((side * 0.1, 0.045, -0.02), (0.042, 0.05), ankle)
        add((side * 0.1, 0.035, 0.17), (0.045, 0.03), heel)
    mesh = bpy.data.meshes.new('cage')
    mesh.from_pydata([tuple(b(p)) for p, _ in points], edges, [])
    obj = bpy.data.objects.new('Body', mesh)
    bpy.context.scene.collection.objects.link(obj)
    skin = obj.modifiers.new('Skin', 'SKIN')
    skin.use_smooth_shade = True
    for index, (_, radius) in enumerate(points):
        obj.data.skin_vertices[0].data[index].radius = radius
    obj.data.skin_vertices[0].data[pelvis].use_root = True
    subdivision = obj.modifiers.new('Smooth', 'SUBSURF')
    subdivision.levels = 2
    subdivision.render_levels = 2
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier='Skin')
    bpy.ops.object.modifier_apply(modifier='Smooth')
    if body['belly'] > 0:
        for vertex in obj.data.vertices:
            x, y, z = vertex.co.x, vertex.co.z, -vertex.co.y
            if 0.92 < y < 1.36 and z > 0 and abs(x) < 0.2:
                swell = math.sin((y - 0.92) / 0.44 * math.pi) * body['belly'] * min(1, z / 0.09)
                vertex.co.y -= swell
    return obj


def head_parts():
    center = (0, 1.705, 0.01)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=20, radius=1, location=b(center))
    head = bpy.context.active_object
    head.name = 'Head'
    for vertex in head.data.vertices:
        x, y, z = vertex.co.x, vertex.co.z, -vertex.co.y
        rx = 0.094 * (0.86 if y < 0 else 1.0) * (1 - max(0, -y - 0.4) * 0.35)
        ry = 0.118
        rz = 0.104 * (1.05 if z > 0 else 0.98)
        vertex.co.x, vertex.co.y, vertex.co.z = x * rx, -(z * rz), y * ry
        if y < -0.35 and z > 0.2:
            vertex.co.y -= 0.012 * (z - 0.2)
    bpy.ops.object.transform_apply(location=True, scale=True)
    head.location = (0, 0, 0)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, radius=1, location=b((0, 1.69, 0.108)))
    nose = bpy.context.active_object
    nose.scale = (0.017, 0.022, 0.026)
    bpy.ops.object.transform_apply(scale=True)
    parts = [head, nose]
    for side in (1, -1):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=8, radius=1, location=b((side * 0.093, 1.7, -0.005)))
        ear = bpy.context.active_object
        ear.scale = (0.012, 0.022, 0.032)
        bpy.ops.object.transform_apply(scale=True)
        parts.append(ear)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=1, location=b((0, 1.74, 0.0)))
    cap = bpy.context.active_object
    cap.name = 'Cap'
    mesh = cap.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    for vertex in [v for v in bm.verts if v.co.z < -0.02]:
        bm.verts.remove(vertex)
    for vertex in bm.verts:
        vertex.co.x *= 0.101
        vertex.co.y *= 0.112
        vertex.co.z *= 0.1
    bm.to_mesh(mesh)
    bm.free()
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=1, depth=1, location=b((0, 1.742, 0.13)))
    bill = bpy.context.active_object
    bill.scale = (0.088, 0.075, 0.008)
    bill.rotation_euler = (math.radians(-8), 0, 0)
    bpy.ops.object.transform_apply(rotation=True, scale=True)
    parts += [cap, bill]
    return parts


def slot_for(co, part):
    x, y, z = co.x, co.z, -co.y
    ax = abs(x)
    if part in ('Cap', 'Cylinder'):
        return SLOT['cap']
    if part != 'Body':
        return SLOT['skin']
    if ax > 0.2 and y > 1.3:
        if ax < 0.335:
            return SLOT['jersey']
        if ax < 0.355:
            return SLOT['trim']
        return SLOT['skin']
    if y > 1.505:
        return SLOT['skin']
    if y > 1.475 and ax < 0.11:
        return SLOT['trim']
    if y > 1.0:
        return SLOT['jersey']
    if y > 0.955 and ax < 0.21:
        return SLOT['belt']
    if y > 0.4:
        return SLOT['pants']
    if y > 0.085:
        return SLOT['socks']
    return SLOT['cleats']


def bone_segments():
    segments = {}
    for name in LAYOUT:
        head = Vector(joint(name))
        tail = Vector(joint(CHILD[name])) if name in CHILD else head + Vector(TAILS[name])
        segments[name] = (head, tail)
    return segments


def segment_distance(point, head, tail):
    axis = tail - head
    t = max(0.0, min(1.0, (point - head).dot(axis) / max(1e-9, axis.length_squared)))
    return (point - (head + axis * t)).length


def allowed(name, x):
    if name.endswith('.L'):
        return x > -0.02
    if name.endswith('.R'):
        return x < 0.02
    return True


def weight(obj, rig, part):
    """Two-bone skinning by distance to each bone segment on the vertex's side, with the head and cap riding the head bone."""
    segments = bone_segments()
    groups = {name: obj.vertex_groups.new(name=name) for name in LAYOUT}
    for vertex in obj.data.vertices:
        p = Vector((vertex.co.x, vertex.co.z, -vertex.co.y))
        if part != 'Body' or p.y > 1.6:
            groups['head'].add([vertex.index], 1.0, 'REPLACE')
            continue
        scored = sorted((segment_distance(p, *segments[name]), name) for name in LAYOUT if allowed(name, p.x) and name != 'head')
        if abs(p.x) < 0.15 and p.y > 0.95:
            scored = [s for s in scored if s[1] in ('hips', 'spine', 'chest', 'neck')]
        if abs(p.x) > 0.17 and p.y > 1.32:
            scored = [s for s in scored if 'shoulder' in s[1] or 'arm' in s[1] or 'hand' in s[1] or s[1] == 'chest']
        if p.y < 0.86:
            scored = [s for s in scored if 'thigh' in s[1] or 'shin' in s[1] or 'foot' in s[1] or 'toe' in s[1] or s[1] == 'hips']
        (d0, n0), (d1, n1) = scored[0], scored[1]
        w0 = 1 / max(1e-4, d0) ** 3
        w1 = 1 / max(1e-4, d1) ** 3
        total = w0 + w1
        groups[n0].add([vertex.index], w0 / total, 'REPLACE')
        if w1 / total > 0.02:
            groups[n1].add([vertex.index], w1 / total, 'REPLACE')
    modifier = obj.modifiers.new('Armature', 'ARMATURE')
    modifier.object = rig
    obj.parent = rig


def tag_slots(obj, part):
    """Slots are decided per face, then the mesh is split along every boundary between slots, so no triangle blends one uniform colour through the slot numbers between it and the next."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    face_slot = {face.index: slot_for(face.calc_center_median(), part) for face in bm.faces}
    bm.faces.ensure_lookup_table()
    boundary = [edge for edge in bm.edges if len(edge.link_faces) == 2 and face_slot[edge.link_faces[0].index] != face_slot[edge.link_faces[1].index]]
    slots_by_face = {face: face_slot[face.index] for face in bm.faces}
    if boundary:
        bmesh.ops.split_edges(bm, edges=boundary)
    layer = bm.verts.layers.float.new('_slot')
    for face, slot in slots_by_face.items():
        for vertex in face.verts:
            vertex[layer] = float(slot)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


def build(body_name):
    clear()
    body = BODIES[body_name]
    rig = build_armature()
    torso = skin_body(body)
    parts = [torso] + head_parts()
    for part in parts:
        kind = 'Cap' if part.name.startswith('Cap') else 'Cylinder' if part.name.startswith('Cylinder') else 'Body' if part is torso else 'Head'
        tag_slots(part, kind)
        part['_kind'] = kind
    for part in parts:
        weight(part, rig, part['_kind'])
    bpy.ops.object.select_all(action='DESELECT')
    for part in parts:
        part.select_set(True)
    bpy.context.view_layer.objects.active = torso
    bpy.ops.object.join()
    torso.name = 'Ballplayer.body'
    for polygon in torso.data.polygons:
        polygon.use_smooth = True
    material = bpy.data.materials.new('uniform')
    torso.data.materials.clear()
    torso.data.materials.append(material)
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f'ballplayer-{body_name}.glb')
    bpy.ops.object.select_all(action='DESELECT')
    rig.select_set(True)
    torso.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_skins=True, export_animations=False,
                              export_attributes=True, export_apply=True, export_materials='PLACEHOLDER', export_texcoords=False,
                              export_yup=True)
    triangles = sum(len(p.vertices) - 2 for p in torso.data.polygons)
    print(f'{body_name}: {len(torso.data.vertices)} verts, {triangles} tris -> {path} ({os.path.getsize(path) // 1024} KB)')
    return torso


if __name__ == '__main__' or os.environ.get('BUSHLEAGUE_BUILD') == '1':
    for name in BODIES:
        build(name)
