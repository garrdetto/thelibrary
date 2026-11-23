"""Validates a Take Flight aircraft and exports every LOD plus its cockpit in one step; any violation fails the build.

Use from a builder script (`export_aircraft(root, cockpit, name=..., category=..., out_dir=...)`) or on a saved .blend:

    blender -b plane.blend -P export_aircraft.py -- --name wren --category trainer --out assets-src/models/takeflight

The .blend must hold an empty named <name> (exterior root) and, optionally, <name>_cockpit (interior root).

Checks: required node names (control surfaces, gear, props or fans, lights) and the allowed name pattern, no duplicate-suffixed
names, unit scale on every object, overall size for the category, landing gear below the CG reference, triangle budgets for
LOD0, LOD1, LOD2 and the cockpit, a material on every face, image textures that exist, at most 4K textures, and no overlapping
UV triangles inside one object. LOD1 and LOD2 come from collapse decimation of LOD0 with node names kept, so animation targets
match across files. The LOD3 billboard is rendered by the page from LOD2 at load time.
"""
import math
import os
import re
import sys

import bpy

BUDGETS = {
    'trainer': (40000, 15000, 4000),
    'complex': (60000, 20000, 6000),
    'twin': (60000, 20000, 6000),
    'turboprop': (90000, 30000, 8000),
    'bizjet': (120000, 40000, 10000),
    'cargo': (150000, 50000, 12000),
    'regional': (150000, 50000, 12000),
    'narrowbody': (150000, 50000, 12000),
    'widebody': (150000, 50000, 12000),
}
COCKPIT_BUDGET = 200000
SIZE = {'trainer': ((6, 12), (7, 16)), 'complex': ((7, 14), (9, 16)), 'twin': ((8, 16), (10, 20)), 'turboprop': ((9, 30), (12, 32)), 'bizjet': ((12, 35), (12, 34)), 'cargo': ((15, 75), (18, 70)), 'regional': ((25, 40), (20, 32)), 'narrowbody': ((30, 50), (28, 40)), 'widebody': ((50, 80), (50, 70))}
NAME_PATTERN = re.compile(r'^[a-z][a-z0-9_]*$')
MAX_TEXTURE = 4096
LOD_SHARE = {1: 0.45, 2: 0.18}


def required_patterns(category):
    patterns = [r'aileron_L', r'aileron_R', r'elevator', r'rudder', r'flap_L_\d+', r'flap_R_\d+', r'gear_nose', r'gear_main_L', r'gear_main_R', r'light_nav_L', r'light_nav_R', r'light_strobe_\w+', r'light_landing_\w+']
    patterns.append(r'(prop|fan)_\d+')
    if category in ('bizjet', 'cargo', 'regional', 'narrowbody', 'widebody'):
        patterns += [r'spoiler_\w+', r'door_\w+', r'gear_door_\w+']
    return [re.compile(f'^{p}$') for p in patterns]


def descendants(root):
    out = []
    stack = list(root.children)
    while stack:
        obj = stack.pop()
        out.append(obj)
        stack.extend(obj.children)
    return out


def triangles(objects, evaluated=True):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    total = 0
    for obj in objects:
        if obj.type != 'MESH':
            continue
        source = obj.evaluated_get(depsgraph) if evaluated else obj
        mesh = source.to_mesh()
        mesh.calc_loop_triangles()
        total += len(mesh.loop_triangles)
        source.to_mesh_clear()
    return total


def world_bounds(objects):
    lo = [math.inf] * 3
    hi = [-math.inf] * 3
    for obj in objects:
        if obj.type != 'MESH':
            continue
        for corner in obj.bound_box:
            world = obj.matrix_world @ __import__('mathutils').Vector(corner)
            for i in range(3):
                lo[i] = min(lo[i], world[i])
                hi[i] = max(hi[i], world[i])
    return lo, hi


def tri_overlap(a, b):
    """Separating-axis test for two 2D triangles; touching edges do not count as overlap."""
    eps = 1e-7
    for tri in (a, b):
        for i in range(3):
            p0 = tri[i]
            p1 = tri[(i + 1) % 3]
            nx = p1[1] - p0[1]
            ny = p0[0] - p1[0]
            amin = min(nx * p[0] + ny * p[1] for p in a)
            amax = max(nx * p[0] + ny * p[1] for p in a)
            bmin = min(nx * p[0] + ny * p[1] for p in b)
            bmax = max(nx * p[0] + ny * p[1] for p in b)
            length = math.hypot(nx, ny) or 1
            if amax - bmin <= eps * length or bmax - amin <= eps * length:
                return False
    return True


def uv_overlaps(obj, cell=1 / 32):
    mesh = obj.data
    if not mesh.uv_layers:
        return 0
    layer = mesh.uv_layers.active.data
    mesh.calc_loop_triangles()
    tris = []
    for tri in mesh.loop_triangles:
        pts = [tuple(layer[i].uv) for i in tri.loops]
        area = abs((pts[1][0] - pts[0][0]) * (pts[2][1] - pts[0][1]) - (pts[2][0] - pts[0][0]) * (pts[1][1] - pts[0][1]))
        if area > 1e-10:
            tris.append(pts)
    grid = {}
    for index, pts in enumerate(tris):
        x0 = int(min(p[0] for p in pts) / cell)
        x1 = int(max(p[0] for p in pts) / cell)
        y0 = int(min(p[1] for p in pts) / cell)
        y1 = int(max(p[1] for p in pts) / cell)
        for gx in range(x0, x1 + 1):
            for gy in range(y0, y1 + 1):
                grid.setdefault((gx, gy), []).append(index)
    seen = set()
    overlaps = 0
    for members in grid.values():
        for i in range(len(members)):
            for j in range(i + 1, len(members)):
                pair = (members[i], members[j])
                if pair in seen:
                    continue
                seen.add(pair)
                if tri_overlap(tris[pair[0]], tris[pair[1]]):
                    overlaps += 1
    return overlaps


def ensure_uvs(objects):
    for obj in objects:
        if obj.type != 'MESH' or obj.data.uv_layers:
            continue
        bpy.ops.object.select_all(action='DESELECT')
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.01)
        bpy.ops.object.mode_set(mode='OBJECT')
        obj.select_set(False)


def check_materials_and_textures(objects, errors):
    for obj in objects:
        if obj.type != 'MESH':
            continue
        if not obj.data.materials or any(slot is None for slot in obj.data.materials):
            errors.append(f'{obj.name}: missing material')
            continue
        count = len(obj.data.materials)
        if any(poly.material_index >= count for poly in obj.data.polygons):
            errors.append(f'{obj.name}: face uses an empty material slot')
        for mat in obj.data.materials:
            if not mat.use_nodes:
                continue
            for node in mat.node_tree.nodes:
                if node.type != 'TEX_IMAGE':
                    continue
                image = node.image
                if image is None:
                    errors.append(f'{obj.name}/{mat.name}: image node without an image')
                    continue
                if not image.packed_file and not os.path.exists(bpy.path.abspath(image.filepath)):
                    errors.append(f'{obj.name}/{mat.name}: texture file missing ({image.filepath})')
                if max(image.size) > MAX_TEXTURE:
                    errors.append(f'{obj.name}/{mat.name}: texture larger than 4K ({image.size[0]}x{image.size[1]})')


def validate(root, category, errors, warnings):
    objects = descendants(root)
    names = [obj.name for obj in objects]
    for obj in objects:
        if not NAME_PATTERN.match(obj.name) and not re.match(r'^(aileron|flap|gear|light|spoiler|door|wheel|fairing|wing|strut|prop|fan)_[A-Za-z0-9_]+$', obj.name):
            errors.append(f'{obj.name}: name must be lower-case letters, digits and underscores (side suffixes L/R allowed)')
        if re.search(r'\.\d{3}$', obj.name):
            errors.append(f'{obj.name}: duplicate name suffix')
        if any(abs(s - 1.0) > 1e-4 for s in obj.scale):
            errors.append(f'{obj.name}: scale is not applied ({tuple(round(s, 4) for s in obj.scale)})')
    for pattern in required_patterns(category):
        if not any(pattern.match(name) for name in names):
            errors.append(f'missing required node matching {pattern.pattern}')
    for prefix in ('door_',):
        if not any(name.startswith(prefix) for name in names):
            warnings.append(f'no {prefix}* nodes')
    lo, hi = world_bounds(objects)
    length = hi[0] - lo[0]
    span = hi[1] - lo[1]
    (lmin, lmax), (smin, smax) = SIZE[category]
    if not (lmin <= length <= lmax):
        errors.append(f'length {length:.2f} m outside {lmin}-{lmax} m for {category} (wrong units?)')
    if not (smin <= span <= smax):
        errors.append(f'span {span:.2f} m outside {smin}-{smax} m for {category} (wrong units?)')
    if lo[2] > -0.5 or lo[2] < -6:
        errors.append(f'lowest point {lo[2]:.2f} m: gear must hang below the CG reference')
    check_materials_and_textures(objects, errors)
    for obj in objects:
        if obj.type == 'MESH':
            overlaps = uv_overlaps(obj)
            if overlaps:
                errors.append(f'{obj.name}: {overlaps} overlapping UV triangles')
    return objects


def select_tree(root):
    bpy.ops.object.select_all(action='DESELECT')
    root.select_set(True)
    for obj in descendants(root):
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root


def export_glb(root, path):
    select_tree(root)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True, export_texcoords=True, export_normals=True, export_materials='EXPORT', export_cameras=False, export_lights=False, export_animations=False)
    print(f'  wrote {path}')


def set_decimation(objects, ratio):
    for obj in objects:
        if obj.type != 'MESH':
            continue
        mod = obj.modifiers.get('lod') or obj.modifiers.new('lod', 'DECIMATE')
        mod.decimate_type = 'COLLAPSE'
        mod.use_collapse_triangulate = True
        polys = len(obj.data.polygons)
        mod.ratio = 1.0 if polys < 24 else ratio


def clear_decimation(objects):
    for obj in objects:
        mod = obj.modifiers.get('lod') if obj.type == 'MESH' else None
        if mod:
            obj.modifiers.remove(mod)


def export_aircraft(root, cockpit, name, category, out_dir):
    if category not in BUDGETS:
        print(f'unknown category {category}')
        return False
    errors = []
    warnings = []
    ensure_uvs(descendants(root) + (descendants(cockpit) if cockpit else []))
    objects = validate(root, category, errors, warnings)
    budget = BUDGETS[category]
    lod_tris = [triangles(objects, evaluated=False)]
    if lod_tris[0] > budget[0]:
        errors.append(f'LOD0 has {lod_tris[0]} triangles (budget {budget[0]})')
    cockpit_tris = 0
    if cockpit is not None:
        cockpit_objects = descendants(cockpit)
        cockpit_names = {obj.name for obj in cockpit_objects}
        for required in ('panel_screen', 'yoke_L', 'yoke_R'):
            if required not in cockpit_names:
                errors.append(f'cockpit is missing {required}')
        check_materials_and_textures(cockpit_objects, errors)
        cockpit_tris = triangles(cockpit_objects, evaluated=False)
        if cockpit_tris > COCKPIT_BUDGET:
            errors.append(f'cockpit has {cockpit_tris} triangles (budget {COCKPIT_BUDGET})')
    for w in warnings:
        print(f'  warning: {w}')
    if errors:
        print(f'FAILED {name}:')
        for e in errors:
            print(f'  - {e}')
        return False
    export_glb(root, os.path.join(out_dir, f'{name}_lod0.glb'))
    for level in (1, 2):
        ratio = min(budget[level] / max(1, lod_tris[0]) * 0.95, LOD_SHARE[level])
        for _ in range(8):
            set_decimation(objects, min(1.0, ratio))
            count = triangles(objects)
            if count <= budget[level]:
                break
            ratio *= budget[level] / count * 0.95
        else:
            clear_decimation(objects)
            print(f'FAILED {name}: LOD{level} cannot reach {budget[level]} triangles')
            return False
        lod_tris.append(count)
        export_glb(root, os.path.join(out_dir, f'{name}_lod{level}.glb'))
    clear_decimation(objects)
    if cockpit is not None:
        export_glb(cockpit, os.path.join(out_dir, f'{name}_cockpit.glb'))
    print(f'OK {name}: LOD triangles {lod_tris}, cockpit {cockpit_tris}')
    return True


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    options = {argv[i].lstrip('-'): argv[i + 1] for i in range(0, len(argv) - 1, 2)}
    name = options.get('name')
    root = bpy.data.objects.get(name or '')
    if root is None:
        print(f'no root empty named {name}')
        sys.exit(1)
    cockpit = bpy.data.objects.get(f'{name}_cockpit')
    ok = export_aircraft(root, cockpit, name=name, category=options.get('category', 'trainer'), out_dir=os.path.abspath(options.get('out', 'assets-src/models/takeflight')))
    sys.exit(0 if ok else 1)


if __name__ == '__main__' and '--name' in sys.argv:
    main()
