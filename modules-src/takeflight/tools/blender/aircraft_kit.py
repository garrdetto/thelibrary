"""Shape helpers for Take Flight aircraft built in Blender.

Authoring frame (matches the flight model's body axes after glTF export): +X forward (nose), +Y left wing, +Z up, metres,
origin at the centre-of-gravity reference. glTF export maps Blender (x, y, z) to (x, z, -y), so +Y left becomes body -Z (left),
and the model loads with its nose on body +X without any extra rotation.
"""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 1.0
    return scene


def material(name, color, roughness, metallic=0.0, emission=None, alpha=1.0, double_sided=False):
    """A Principled BSDF material. Follows the library's gloss rule: callers pass high roughness for matte surfaces."""
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.use_backface_culling = not double_sided
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1.0)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    if 'Specular IOR Level' in bsdf.inputs and roughness > 0.85:
        bsdf.inputs['Specular IOR Level'].default_value = 0.0
    if emission is not None:
        bsdf.inputs['Emission Color'].default_value = (*emission, 1.0)
        bsdf.inputs['Emission Strength'].default_value = 1.0
    if alpha < 1.0:
        bsdf.inputs['Alpha'].default_value = alpha
        mat.blend_method = 'BLEND' if hasattr(mat, 'blend_method') else None
    return mat


def new_object(name, bm, mat=None, parent=None, collection=None):
    mesh = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    (collection or bpy.context.scene.collection).objects.link(obj)
    if mat is not None:
        obj.data.materials.append(mat)
    if parent is not None:
        obj.parent = parent
    for poly in obj.data.polygons:
        poly.use_smooth = True
    return obj


def empty(name, location, parent=None, collection=None, size=0.1):
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_size = size
    obj.location = Vector(location)
    (collection or bpy.context.scene.collection).objects.link(obj)
    if parent is not None:
        obj.parent = parent
    return obj


def set_origin(obj, point):
    """Moves the object's origin to `point` (world) without moving its geometry: hinges and pivots."""
    point = Vector(point)
    offset = obj.matrix_world.inverted() @ point
    obj.data.transform(Matrix.Translation(-offset))
    obj.matrix_world = obj.matrix_world @ Matrix.Translation(offset)


def superellipse_ring(half_width, top, bottom, segments, exponent=2.6):
    """Points of a closed cross-section (y, z) that is round on top and squarer at the bottom like a light-aircraft fuselage."""
    points = []
    centre = (top + bottom) * 0.5
    half_height = (top - bottom) * 0.5
    for i in range(segments):
        angle = 2 * math.pi * i / segments
        c = math.cos(angle)
        s = math.sin(angle)
        y = half_width * math.copysign(abs(c) ** (2 / exponent), c)
        z = centre + half_height * math.copysign(abs(s) ** (2 / exponent), s)
        points.append((y, z))
    return points


def loft(sections, segments, cap_front=True, cap_back=True):
    """Builds a closed loft through sections given as (x, half_width, top, bottom[, exponent]); half_width 0 makes a point."""
    bm = bmesh.new()
    rings = []
    for section in sections:
        x, half_width, top, bottom = section[:4]
        exponent = section[4] if len(section) > 4 else 2.6
        if half_width <= 1e-4:
            rings.append([bm.verts.new((x, 0.0, (top + bottom) * 0.5))])
            continue
        rings.append([bm.verts.new((x, y, z)) for (y, z) in superellipse_ring(half_width, top, bottom, segments, exponent)])
    for a, b in zip(rings, rings[1:]):
        if len(a) == 1 and len(b) == 1:
            continue
        if len(a) == 1:
            for i in range(segments):
                bm.faces.new((a[0], b[(i + 1) % segments], b[i]))
        elif len(b) == 1:
            for i in range(segments):
                bm.faces.new((a[i], a[(i + 1) % segments], b[0]))
        else:
            for i in range(segments):
                bm.faces.new((a[i], a[(i + 1) % segments], b[(i + 1) % segments], b[i]))
    if cap_front and len(rings[0]) > 1:
        bm.faces.new(list(reversed(rings[0])))
    if cap_back and len(rings[-1]) > 1:
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def naca4(code, points):
    """Upper and lower surface (x, z) of a NACA 4-digit airfoil at unit chord, from leading to trailing edge."""
    m = int(code[0]) / 100
    p = int(code[1]) / 10
    t = int(code[2:]) / 100
    upper = []
    lower = []
    for i in range(points + 1):
        beta = math.pi * i / points
        x = (1 - math.cos(beta)) / 2
        yt = 5 * t * (0.2969 * math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4)
        if m > 0 and x < p:
            yc = m / (p * p) * (2 * p * x - x * x)
            dyc = 2 * m / (p * p) * (p - x)
        elif m > 0:
            yc = m / ((1 - p) ** 2) * ((1 - 2 * p) + 2 * p * x - x * x)
            dyc = 2 * m / ((1 - p) ** 2) * (p - x)
        else:
            yc = 0
            dyc = 0
        theta = math.atan(dyc)
        upper.append((x - yt * math.sin(theta), yc + yt * math.cos(theta)))
        lower.append((x + yt * math.sin(theta), yc - yt * math.cos(theta)))
    return upper, lower


def airfoil_loop(code, points, start=0.0, end=1.0):
    """A closed loop (x, z) of the part of an airfoil between chord fractions `start` and `end`, clockwise seen from +Y."""
    upper, lower = naca4(code, points)

    def clip(curve):
        out = []
        for i in range(len(curve) - 1):
            (x0, z0), (x1, z1) = curve[i], curve[i + 1]
            if x0 <= start <= x1 and x1 > x0 and (not out):
                t = (start - x0) / (x1 - x0)
                out.append((start, z0 + (z1 - z0) * t))
            if start <= x0 <= end and (not out or out[-1][0] < x0):
                out.append((x0, z0))
            if x0 <= end <= x1 and x1 > x0:
                t = (end - x0) / (x1 - x0)
                out.append((end, z0 + (z1 - z0) * t))
                break
        return out

    top = clip(upper)
    bottom = clip(lower)
    if start <= 0:
        bottom = bottom[1:]
    loop = top + list(reversed(bottom))
    if end >= 1:
        loop = loop[:-1] if abs(loop[-1][1] - loop[len(top) - 1][1]) < 1e-6 else loop
    return loop


def wing_panel(stations, code='2412', points=14, start=0.0, end=1.0, cap_root=True, cap_tip=True):
    """A lofted wing panel through stations (y, leading_edge_x, chord, z, twist_deg) using the airfoil part [start, end].

    Chord runs aft from the leading edge (toward -X). Returns a bmesh.
    """
    bm = bmesh.new()
    loops = []
    shape = airfoil_loop(code, points, start, end)
    for (y, le_x, chord, z, twist) in stations:
        twist_rad = math.radians(twist)
        ring = []
        for (cx, cz) in shape:
            px = -cx * chord
            pz = cz * chord
            rx = px * math.cos(twist_rad) - pz * math.sin(twist_rad)
            rz = px * math.sin(twist_rad) + pz * math.cos(twist_rad)
            ring.append(bm.verts.new((le_x + rx, y, z + rz)))
        loops.append(ring)
    n = len(shape)
    for a, b in zip(loops, loops[1:]):
        for i in range(n):
            bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
    if cap_root:
        bm.faces.new(loops[0])
    if cap_tip:
        bm.faces.new(list(reversed(loops[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def mirror_y(bm):
    """Mirrors a bmesh across the XZ plane (left part to right part) and fixes the winding."""
    bmesh.ops.scale(bm, vec=(1, -1, 1), verts=bm.verts)
    bmesh.ops.reverse_faces(bm, faces=bm.faces)
    return bm


def cylinder(radius, depth, segments, axis='Y', cap=True):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=segments, radius1=radius, radius2=radius, depth=depth)
    if axis == 'Y':
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(90), 3, 'X'))
    elif axis == 'X':
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(90), 3, 'Y'))
    return bm


def torus(major, minor, major_segments, minor_segments):
    """A torus around the Y axis (a tyre)."""
    bm = bmesh.new()
    rings = []
    for i in range(major_segments):
        a = 2 * math.pi * i / major_segments
        ring = []
        for j in range(minor_segments):
            b = 2 * math.pi * j / minor_segments
            r = major + minor * math.cos(b)
            ring.append(bm.verts.new((r * math.cos(a), minor * math.sin(b), r * math.sin(a))))
        rings.append(ring)
    for i in range(major_segments):
        a = rings[i]
        b = rings[(i + 1) % major_segments]
        for j in range(minor_segments):
            bm.faces.new((a[j], b[j], b[(j + 1) % minor_segments], a[(j + 1) % minor_segments]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def strut(start, end, width, thickness, segments=8):
    """A streamlined strut (elliptical section) between two points."""
    start = Vector(start)
    end = Vector(end)
    axis = end - start
    length = axis.length
    bm = bmesh.new()
    rings = []
    for t in (0.0, 1.0):
        ring = []
        for i in range(segments):
            a = 2 * math.pi * i / segments
            ring.append(bm.verts.new((width * 0.5 * math.cos(a), thickness * 0.5 * math.sin(a), t * length)))
        rings.append(ring)
    for i in range(segments):
        bm.faces.new((rings[0][i], rings[0][(i + 1) % segments], rings[1][(i + 1) % segments], rings[1][i]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[1])
    rotation = Vector((0, 0, 1)).rotation_difference(axis.normalized()).to_matrix()
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=rotation)
    bmesh.ops.translate(bm, verts=bm.verts, vec=start)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def box(size, centre):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    bmesh.ops.translate(bm, verts=bm.verts, vec=centre)
    return bm


def transform(bm, matrix):
    bmesh.ops.transform(bm, matrix=matrix, verts=bm.verts)
    return bm


def merge(*bms):
    """Joins several bmeshes into the first."""
    target = bms[0]
    for other in bms[1:]:
        mesh = bpy.data.meshes.new('tmp')
        other.to_mesh(mesh)
        other.free()
        target.from_mesh(mesh)
        bpy.data.meshes.remove(mesh)
    return target


def smart_uv(obj, angle=66.0, margin=0.01):
    """Unwraps an object with Smart UV Project so every part has its own non-overlapping island (livery layout)."""
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=margin)
    bpy.ops.object.mode_set(mode='OBJECT')
    obj.select_set(False)
