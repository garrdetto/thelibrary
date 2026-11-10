"""Builds the Pro Skater AI models in Blender.

  blender -b --factory-startup -P modules-src/proskater/tools/build-models.py -- [previewDir]

skater  assets-src/proskater/skater-meshy.glb (the Meshy-generated, Meshy-rigged rider: the
        only Meshy asset in the module) is cleaned up here: stray helper meshes and the
        bundled clip are dropped, the cloth material is made matte, and the result is written
        to assets-src/models/proskater/skater.glb.
board   the skateboard is modelled from scratch: a concave deck with kicktails (grip top,
        maple plies, a `DeckGraphic` underside the module paints at runtime), two trucks
        (baseplate, hanger, kingpin, bushings, axle, nuts), four urethane wheels with
        bearings (`Wheel_*` nodes so the module can spin them) and eight hardware bolts.
        Written to assets-src/models/proskater/board.glb. Sizes match the module's physics:
        0.80 x 0.21 m deck, deck top at 0.103 m, trucks at +-0.27 m, wheels 54 mm.

Run `pnpm assets` afterwards and commit public/models/proskater/ with the sources.
"""
import bpy
import bmesh
import math
import os
import sys
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
SRC = os.path.join(ROOT, 'assets-src', 'proskater', 'skater-meshy.glb')
OUT = os.path.join(ROOT, 'assets-src', 'models', 'proskater')
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
PREVIEW = ARGS[0] if ARGS else None


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def principled(mat):
    mat.use_nodes = True
    return next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')


def material(name, color, rough, metal=0.0):
    m = bpy.data.materials.new(name)
    b = principled(m)
    b.inputs['Base Color'].default_value = (*color, 1.0)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    return m


def export(path, selection_only=False):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=selection_only, export_animations=False,
                              export_skins=True, export_yup=True, export_apply=False, export_extras=False)
    print('wrote', path, os.path.getsize(path))


def render_preview(name, target, distance, height):
    if not PREVIEW:
        return
    scene = bpy.context.scene
    for engine in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE'):
        try:
            scene.render.engine = engine
            break
        except TypeError:
            continue
    scene.render.resolution_x = 900
    scene.render.resolution_y = 900
    world = bpy.data.worlds.new('preview') if not scene.world else scene.world
    scene.world = world
    world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == 'BACKGROUND')
    bg.inputs['Color'].default_value = (0.55, 0.6, 0.68, 1)
    bg.inputs['Strength'].default_value = 0.8
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(50), 0, math.radians(35))
    scene.collection.objects.link(sun)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scene.collection.objects.link(cam)
    scene.camera = cam
    for i, angle in enumerate((-25, 65, 200)):
        a = math.radians(angle)
        cam.location = Vector((target.x + math.sin(a) * distance, target.y - math.cos(a) * distance, target.z + height))
        direction = target - cam.location
        cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = os.path.join(PREVIEW, f'{name}-{i}.png')
        bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(sun)
    bpy.data.objects.remove(cam)


# --------------------------------------------------------------------------- skater
def build_skater():
    reset()
    bpy.ops.import_scene.gltf(filepath=SRC)
    for obj in list(bpy.data.objects):
        if obj.type == 'MESH' and not any(m.type == 'ARMATURE' for m in obj.modifiers) and obj.parent is None:
            bpy.data.objects.remove(obj)
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)
    armature = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    armature.name = 'Skater'
    armature.animation_data_clear()
    for bone in armature.pose.bones:
        bone.location = (0, 0, 0)
        bone.rotation_quaternion = (1, 0, 0, 0)
        bone.rotation_euler = (0, 0, 0)
        bone.scale = (1, 1, 1)
    body = next(o for o in bpy.data.objects if o.type == 'MESH')
    body.name = 'SkaterBody'
    for mat in body.data.materials:
        mat.name = 'SkaterCloth'
        b = principled(mat)
        b.inputs['Roughness'].default_value = 0.86
        b.inputs['Metallic'].default_value = 0.0
        for link in list(mat.node_tree.links):
            if link.to_socket in (b.inputs['Roughness'], b.inputs['Metallic']):
                mat.node_tree.links.remove(link)
    tris = sum(len(p.vertices) - 2 for p in body.data.polygons)
    print('skater triangles', tris, 'bones', len(armature.data.bones))
    dress_uniform(armature, body)
    export(os.path.join(OUT, 'skater.glb'))
    render_preview('skater', Vector((0, 0, 0.9)), 3.2, 0.3)


# --------------------------------------------------------------------------- uniform decals
DECALS = os.path.join(ROOT, 'assets-src', 'proskater', 'decals')
VARIANTS = os.path.join(ROOT, 'public', 'modules', 'proskater')


def load_decal(name):
    import numpy as np
    img = bpy.data.images.load(os.path.join(DECALS, name + '.png'))
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    return px.reshape(h, w, 4)


class Surface:
    """World-space rest mesh with UVs, a BVH for ray casts and the texture as an array."""

    def __init__(self, body):
        import numpy as np
        from mathutils.bvhtree import BVHTree
        me = body.data
        mw = body.matrix_world
        self.co = np.array([tuple(mw @ v.co) for v in me.vertices], dtype=np.float64)
        uv_layer = me.uv_layers.active.data
        self.tris = []
        for poly in me.polygons:
            loops = list(poly.loop_indices)
            for k in range(1, len(loops) - 1):
                ids = (loops[0], loops[k], loops[k + 1])
                self.tris.append(([me.loops[i].vertex_index for i in ids], [tuple(uv_layer[i].uv) for i in ids]))
        self.bvh = BVHTree.FromPolygons([tuple(c) for c in self.co], [p.vertices[:] for p in me.polygons])
        mat = me.materials[0]
        node = next(n for n in mat.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image)
        self.image = node.image
        self.W, self.H = self.image.size
        px = np.empty(self.W * self.H * 4, dtype=np.float32)
        self.image.pixels.foreach_get(px)
        self.tex = px.reshape(self.H, self.W, 4)

    def hit(self, origin, direction):
        loc, normal, _, _ = self.bvh.ray_cast(Vector(origin), Vector(direction).normalized(), 2.0)
        if loc is None:
            raise RuntimeError(f'decal ray missed the body from {tuple(origin)}')
        return loc

    def texels(self, select, pad=0.02):
        """Yields (rows, cols, world positions) for every texel inside the selected triangles."""
        import numpy as np
        for vids, uvs in self.tris:
            p = self.co[vids]
            if not select(p):
                continue
            uv = np.array(uvs) * (self.W, self.H)
            x0, y0 = np.floor(uv.min(0)).astype(int) - 1
            x1, y1 = np.ceil(uv.max(0)).astype(int) + 1
            x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, self.W - 1), min(y1, self.H - 1)
            if x1 < x0 or y1 < y0:
                continue
            gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
            (ax, ay), (bx, by), (cx, cy) = uv
            den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
            if abs(den) < 1e-9:
                continue
            l0 = ((by - cy) * (gx - cx) + (cx - bx) * (gy - cy)) / den
            l1 = ((cy - ay) * (gx - cx) + (ax - cx) * (gy - cy)) / den
            l2 = 1 - l0 - l1
            inside = (l0 >= -pad) & (l1 >= -pad) & (l2 >= -pad)
            if not inside.any():
                continue
            pos = l0[inside, None] * p[0] + l1[inside, None] * p[1] + l2[inside, None] * p[2]
            yield (gy[inside] - 0.5).astype(int), (gx[inside] - 0.5).astype(int), pos


def stamp(surface, tex, decal, center, normal, up, width):
    """Projects `decal` along -normal onto the body, `width` metres wide, centred on `center`."""
    import numpy as np
    n = Vector(normal).normalized()
    u = (Vector(up) - n * Vector(up).dot(n)).normalized()
    r = (-n).cross(u).normalized()
    dh, dw = decal.shape[:2]
    height = width * dh / dw
    c = np.array(tuple(center))
    nn, uu, rr = np.array(tuple(n)), np.array(tuple(u)), np.array(tuple(r))
    reach = max(width, height) * 0.8

    def select(p):
        mid = p.mean(0)
        if np.linalg.norm(mid - c) > reach or abs((mid - c) @ nn) > 0.05:
            return False
        e = np.cross(p[1] - p[0], p[2] - p[0])
        length = np.linalg.norm(e)
        return length > 0 and (e / length) @ nn > 0.2

    for rows, cols, pos in surface.texels(select):
        d = pos - c
        s = d @ rr / width + 0.5
        t = d @ uu / height + 0.5
        ok = (s >= 0) & (s < 1) & (t >= 0) & (t < 1)
        if not ok.any():
            continue
        sx = np.clip((s[ok] * dw).astype(int), 0, dw - 1)
        sy = np.clip((t[ok] * dh).astype(int), 0, dh - 1)
        src = decal[sy, sx]
        a = src[:, 3:4]
        rr_, cc_ = rows[ok], cols[ok]
        tex[rr_, cc_, :3] = tex[rr_, cc_, :3] * (1 - a) + src[:, :3] * a


def recolor_hat(surface, tex, head_z):
    """The concept's orange beanie becomes black knit. Front-facing triangles change only above the
    brow, the sides and back a little lower, and only orange texels, so skin and hair stay."""
    import numpy as np

    def band(p):
        e = np.cross(p[1] - p[0], p[2] - p[0])
        length = np.linalg.norm(e)
        if length == 0:
            return None
        low = p[:, 2].min() - head_z
        if (e / length)[1] < -0.35:
            return 'loose' if low > 0.145 else 'strict' if low > 0.09 else None
        return 'loose' if low > 0.1 else 'strict' if low > 0.02 else None

    for kind, (gr, br) in (('loose', (0.74, 0.6)), ('strict', (0.58, 0.42))):
        for rows, cols, pos in surface.texels(lambda p: band(p) == kind, pad=0.12):
            px = tex[rows, cols]
            r, g, b = px[:, 0], px[:, 1], px[:, 2]
            orange = (r > 0.05) & (g < r * gr) & (b < r * br)
            lum = 0.3 * r + 0.59 * g + 0.11 * b
            dark = 0.03 + lum[orange] * 0.16
            tex[rows[orange], cols[orange], 0] = dark
            tex[rows[orange], cols[orange], 1] = dark
            tex[rows[orange], cols[orange], 2] = dark * 1.12


def dress_uniform(armature, body):
    import numpy as np
    surface = Surface(body)
    bones = {b.name: armature.matrix_world @ b.head_local for b in armature.data.bones}
    tex = surface.tex.copy()
    recolor_hat(surface, tex, bones['Head'].z)

    hat = surface.hit((0, -0.6, bones['Head'].z + 0.17), (0, 1, 0))
    stamp(surface, tex, load_decal('patch'), hat, (0, -1, 0.15), (0, 0, 1), 0.055)

    hip, knee = bones['LeftUpLeg'], bones['LeftLeg']
    flap = hip.lerp(knee, 0.34)
    side = surface.hit((flap.x + 0.6, flap.y, flap.z), (-1, 0, 0))
    stamp(surface, tex, load_decal('skate'), side, (1, 0, 0), hip - knee, 0.085)

    sleeves = []
    for arm, elbow, sign, patch in (('LeftArm', 'LeftForeArm', 1, 'patch'), ('RightArm', 'RightForeArm', -1, 'flag')):
        s, e = bones[arm], bones[elbow]
        d = (e - s).normalized()
        lateral = d.cross(Vector((0, -1, 0))).normalized()
        if lateral.x * sign < 0:
            lateral = -lateral
        up = s - e
        at = s.lerp(e, 0.3)
        hit = surface.hit(at + lateral * 0.5, -lateral)
        stamp(surface, tex, load_decal(patch), hit, lateral, up, 0.07 if patch == 'patch' else 0.075)
        sleeves.append((s.lerp(e, 0.62), lateral, up))

    def ranked(count):
        out = tex.copy()
        decal = load_decal(f'rank-{count}')
        for at, lateral, up in sleeves:
            hit = surface.hit(at + lateral * 0.5, -lateral)
            stamp(surface, out, decal, hit, lateral, up, 0.082)
        return out

    officer, sergeant = ranked(2), ranked(3)
    surface.image.pixels.foreach_set(officer.ravel())
    surface.image.update()
    surface.image.pack()
    os.makedirs(VARIANTS, exist_ok=True)
    for name, data in (('sergeant', sergeant),):
        img = bpy.data.images.new(f'skater-{name}', surface.W, surface.H, alpha=False)
        img.pixels.foreach_set(np.ascontiguousarray(data).ravel())
        img.filepath_raw = os.path.join(VARIANTS, f'skater-{name}.webp')
        img.file_format = 'WEBP'
        img.save()
        print('wrote', img.filepath_raw, os.path.getsize(img.filepath_raw))
        bpy.data.images.remove(img)


# --------------------------------------------------------------------------- board
DECK_L, DECK_W, DECK_T = 0.80, 0.21, 0.013
DECK_TOP = 0.103
TRUCK_Y = 0.27
WHEEL_R, WHEEL_W, WHEEL_X = 0.027, 0.032, 0.095


def half_width(y):
    straight = DECK_L / 2 - DECK_W / 2
    a = abs(y)
    if a <= straight:
        return DECK_W / 2
    k = min(1.0, (a - straight) / (DECK_W / 2))
    return max(0.004, DECK_W / 2 * math.sqrt(max(0.0, 1 - k * k)))


def deck_height(x, y):
    concave = 0.0055 * (x / (DECK_W / 2)) ** 2
    a, start = abs(y), TRUCK_Y + 0.025
    kick = 0.0 if a < start else 0.058 * ((a - start) / (DECK_L / 2 - start)) ** 1.7
    return DECK_TOP + concave + kick


def build_deck(mats):
    nu, nv = 18, 72
    bm = bmesh.new()
    rows = []
    for j in range(nv + 1):
        y = -DECK_L / 2 + DECK_L * j / nv
        hw = half_width(y)
        row = []
        for i in range(nu + 1):
            x = -hw + 2 * hw * i / nu
            row.append(bm.verts.new((x, y, deck_height(x, y))))
        rows.append(row)
    for j in range(nv):
        for i in range(nu):
            bm.faces.new((rows[j][i], rows[j][i + 1], rows[j + 1][i + 1], rows[j + 1][i]))
    mesh = bpy.data.meshes.new('Deck')
    bm.to_mesh(mesh)
    bm.free()
    deck = bpy.data.objects.new('Deck', mesh)
    bpy.context.scene.collection.objects.link(deck)
    for m in (mats['grip'], mats['graphic'], mats['ply']):
        mesh.materials.append(m)
    solid = deck.modifiers.new('solid', 'SOLIDIFY')
    solid.thickness = DECK_T
    solid.offset = -1
    solid.use_even_offset = True
    bevel = deck.modifiers.new('round', 'BEVEL')
    bevel.width = 0.0025
    bevel.segments = 2
    bevel.limit_method = 'ANGLE'
    bpy.context.view_layer.objects.active = deck
    deck.select_set(True)
    bpy.ops.object.modifier_apply(modifier='solid')
    bpy.ops.object.modifier_apply(modifier='round')
    me = deck.data
    uv = me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        nz = poly.normal.z
        poly.material_index = 0 if nz > 0.55 else 1 if nz < -0.55 else 2
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            if poly.material_index == 2:
                uv.data[li].uv = (co.z * 18.0, co.y / DECK_L + 0.5)
            else:
                uv.data[li].uv = (co.x / DECK_W + 0.5, 0.5 - co.y / DECK_L)
    for poly in me.polygons:
        poly.use_smooth = True
    deck.select_set(False)
    return deck


def add_prim(kind, name, mat, **kw):
    if kind == 'cyl':
        bpy.ops.mesh.primitive_cylinder_add(**kw)
    else:
        bpy.ops.mesh.primitive_cube_add(**kw)
    obj = bpy.context.active_object
    obj.name = name
    obj.data.materials.append(mat)
    for poly in obj.data.polygons:
        poly.use_smooth = kind == 'cyl'
    return obj


def bevelled(obj, width, segments=2):
    mod = obj.modifiers.new('bevel', 'BEVEL')
    mod.width = width
    mod.segments = segments
    mod.limit_method = 'ANGLE'
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier='bevel')
    return obj


def build_wheel(name, x, y, mats):
    tire = add_prim('cyl', name, mats['urethane'], vertices=28, radius=WHEEL_R, depth=WHEEL_W, location=(x, y, WHEEL_R), rotation=(0, math.radians(90), 0))
    bevelled(tire, 0.007, 3)
    core = add_prim('cyl', name + '_core', mats['bearing'], vertices=20, radius=0.0115, depth=WHEEL_W + 0.002, location=(x, y, WHEEL_R), rotation=(0, math.radians(90), 0))
    bevelled(core, 0.0015, 1)
    shield = add_prim('cyl', name + '_shield', mats['shield'], vertices=20, radius=0.0085, depth=WHEEL_W + 0.003, location=(x, y, WHEEL_R), rotation=(0, math.radians(90), 0))
    for part in (core, shield):
        bpy.ops.object.select_all(action='DESELECT')
        part.select_set(True)
        tire.select_set(True)
        bpy.context.view_layer.objects.active = tire
        bpy.ops.object.join()
    bpy.ops.object.select_all(action='DESELECT')
    tire.select_set(True)
    bpy.context.view_layer.objects.active = tire
    bpy.ops.object.origin_set(type='ORIGIN_GEOMETRY', center='BOUNDS')
    return tire


def build_truck(y, mats, parts):
    base = add_prim('cube', 'Baseplate', mats['truck'], size=1, location=(0, y, DECK_TOP - DECK_T - 0.004))
    base.scale = (0.052, 0.078, 0.008)
    parts.append(bevelled(apply_scale(base), 0.0025))
    pivot = 1 if y > 0 else -1
    yoke = add_prim('cube', 'Yoke', mats['truck'], size=1, location=(0, y - pivot * 0.006, DECK_TOP - DECK_T - 0.02))
    yoke.scale = (0.036, 0.03, 0.026)
    parts.append(bevelled(apply_scale(yoke), 0.005))
    hanger = add_prim('cyl', 'Hanger', mats['truck'], vertices=20, radius=0.0115, depth=0.142, location=(0, y, WHEEL_R + 0.008), rotation=(0, math.radians(90), 0))
    parts.append(bevelled(hanger, 0.003))
    wedge = add_prim('cube', 'HangerWedge', mats['truck'], size=1, location=(0, y, WHEEL_R + 0.018))
    wedge.scale = (0.05, 0.026, 0.022)
    parts.append(bevelled(apply_scale(wedge), 0.006, 3))
    axle = add_prim('cyl', 'Axle', mats['steel'], vertices=12, radius=0.004, depth=0.214, location=(0, y, WHEEL_R), rotation=(0, math.radians(90), 0))
    parts.append(axle)
    for sx in (-1, 1):
        nut = add_prim('cyl', 'AxleNut', mats['steel'], vertices=6, radius=0.0062, depth=0.006, location=(sx * 0.105, y, WHEEL_R), rotation=(0, math.radians(90), 0))
        parts.append(nut)
    king = add_prim('cyl', 'Kingpin', mats['steel'], vertices=10, radius=0.0042, depth=0.04, location=(0, y - pivot * 0.012, DECK_TOP - DECK_T - 0.022), rotation=(math.radians(-pivot * 28), 0, 0))
    parts.append(king)
    for dz in (-0.006, 0.006):
        bush = add_prim('cyl', 'Bushing', mats['bushing'], vertices=16, radius=0.0105, depth=0.009, location=(0, y - pivot * 0.012, DECK_TOP - DECK_T - 0.022 + dz), rotation=(math.radians(-pivot * 28), 0, 0))
        parts.append(bevelled(bush, 0.002))
    for bx in (-0.017, 0.017):
        for by in (-0.024, 0.024):
            bolt = add_prim('cyl', 'Bolt', mats['steel'], vertices=10, radius=0.0042, depth=0.0016, location=(bx, y + by, deck_height(bx, y + by) + 0.0006))
            parts.append(bolt)


def apply_scale(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return obj


def build_board():
    reset()
    mats = {
        'grip': material('Grip', (0.03, 0.03, 0.035), 0.97),
        'graphic': material('DeckGraphic', (0.85, 0.66, 0.42), 0.55),
        'ply': material('DeckPly', (0.78, 0.6, 0.38), 0.7),
        'truck': material('TruckAlloy', (0.72, 0.74, 0.77), 0.32, 1.0),
        'steel': material('Steel', (0.5, 0.52, 0.55), 0.25, 1.0),
        'bushing': material('Bushing', (0.95, 0.62, 0.12), 0.6),
        'urethane': material('Urethane', (0.95, 0.92, 0.82), 0.42),
        'bearing': material('Bearing', (0.08, 0.08, 0.09), 0.35, 0.6),
        'shield': material('BearingShield', (0.85, 0.2, 0.15), 0.4, 0.3),
    }
    ply = mats['ply']
    b = principled(ply)
    tex = ply.node_tree.nodes.new('ShaderNodeTexWave')
    tex.wave_type = 'BANDS'
    tex.inputs['Scale'].default_value = 6
    ramp = ply.node_tree.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = (0.55, 0.38, 0.2, 1)
    ramp.color_ramp.elements[1].color = (0.86, 0.68, 0.45, 1)
    ply.node_tree.links.new(tex.outputs['Fac'], ramp.inputs['Fac'])
    ply.node_tree.links.new(ramp.outputs['Color'], b.inputs['Base Color'])

    deck = build_deck(mats)
    parts = []
    for y in (-TRUCK_Y, TRUCK_Y):
        build_truck(y, mats, parts)
    hardware = parts[0]
    bpy.ops.object.select_all(action='DESELECT')
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = hardware
    bpy.ops.object.join()
    hardware.name = 'Trucks'
    wheels = []
    for y, end in ((-TRUCK_Y, 'Tail'), (TRUCK_Y, 'Nose')):
        for x, side in ((-WHEEL_X, 'L'), (WHEEL_X, 'R')):
            wheels.append(build_wheel(f'Wheel_{end}{side}', x, y, mats))
    bake_ply_texture(ply)
    root = bpy.data.objects.new('Board', None)
    bpy.context.scene.collection.objects.link(root)
    for obj in [deck, hardware, *wheels]:
        obj.parent = root
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in [deck, hardware, *wheels])
    print('board triangles', tris)
    export(os.path.join(OUT, 'board.glb'))
    render_preview('board', Vector((0, 0, 0.06)), 0.9, 0.35)


def bake_ply_texture(ply):
    """Replaces the procedural ply bands with a tiny image so the glTF keeps them."""
    size = 64
    img = bpy.data.images.new('DeckPlyBands', size, size)
    px = []
    for y in range(size):
        for x in range(size):
            band = (math.sin(x / size * math.pi * 2 * 6) * 0.5 + 0.5)
            dark, light = (0.55, 0.38, 0.2), (0.86, 0.68, 0.45)
            c = [dark[k] + (light[k] - dark[k]) * band for k in range(3)]
            px.extend((*c, 1.0))
    img.pixels = px
    img.filepath_raw = os.path.join(bpy.app.tempdir, 'deck_ply.png')
    img.file_format = 'PNG'
    img.save()
    nodes, links = ply.node_tree.nodes, ply.node_tree.links
    for n in [n for n in nodes if n.type in ('TEX_WAVE', 'VALTORGB')]:
        nodes.remove(n)
    node = nodes.new('ShaderNodeTexImage')
    node.image = img
    links.new(node.outputs['Color'], principled(ply).inputs['Base Color'])


build_skater()
build_board()
