"""Turns the raw Meshy downloads for the skinned hunter into what the repo keeps.

  blender -b --factory-startup -P modules-src/rackreel/tools/ingest-hunter.py -- <cacheDir> [rig] [clips] [textures] [heads]

<cacheDir> holds rig.glb (the rigged character), walk.glb, run.glb, idle.glb and moves.glb (armatures with clips) and one folder
per outfit with Meshy's base_color.png. Writes assets-src/rackreel/meshy/hunter-rig.glb (mesh, weights and skeleton,
no textures), hunter-clips.json (every clip sampled at 30 fps as world-space bone turns from the bind pose) and the
outfit textures in public/modules/rackreel/models/. The tank tops' bare arms are repainted in the base texture's skin
tone (Meshy paints them sunburnt), keeping their shading.

The head gets an atlas of its own. `rig` unwraps the head's faces into a second UV set, and `heads` bakes each head in
`HEADS` from its 4K texture into a 1024 px `hunter-head-<id>.webp` (about four times the texels the head had in the body
texture), evens their skin tone to the base head so any face, hair and beard can be mixed, and writes
`hunter-head-masks.webp`: red is the hair region, green the beard region. Task ids are in
assets-src/rackreel/meshy/hunter.meshy.json.
"""
import bpy
import bmesh
import json
import math
import os
import sys

ARGS = sys.argv[sys.argv.index('--') + 1:]
CACHE = os.path.abspath(ARGS[0])
STEPS = set(ARGS[1:]) or {'rig', 'clips', 'textures', 'heads'}
HERE = os.path.dirname(os.path.abspath(__file__))
SOURCES = os.path.abspath(os.path.join(HERE, '../../../assets-src/rackreel/meshy'))
MODELS = os.path.abspath(os.path.join(HERE, '../../../public/modules/rackreel/models'))
CLIP_FPS = 30
COLOR_SIZE = 2048
BARE_ARMS = {'hunter-tank-khaki', 'hunter-tank-blazevest', 'hunter-tank-fishvest'}
ARM_BONES = ('Arm', 'ForeArm', 'Hand')
HEAD_BONES = ('Head', 'neck', 'head_end', 'headfront')
HEAD_SIZE = 1024
HEADS = {
    'base': 'hunter-base', 'soft': 'hunter-camo-fishing-jeans', 'brow': 'hunter-flannel-blaze-camo', 'stern': 'hunter-angler-fishvest',
    'auburn': 'hunter-flannel-none-jeans', 'black': 'hunter-tank-khaki', 'salt': 'hunter-angler-khaki',
    'elder': 'head-bald', 'young': 'head-buzz', 'blond': 'head-blond', 'silver': 'head-grey', 'ginger': 'head-ginger', 'sandy': 'head-sandy',
}
HEAD_CHIN = 1.536
HEAD_TOP = 1.8
HEAD_AXIS = -0.02
HEAD_DEPTH = 0.11
HAIR_LINE = ((-1.0, -1.0), (-0.43, -1.0), (-0.39, 0.24), (-0.2, 0.29), (-0.15, 0.5), (0.02, 0.5), (0.12, 0.47), (0.4, 0.47), (0.65, 0.72), (1.3, 0.72))
BEARD_LINE = ((-0.46, -1.0), (-0.42, 0.25), (0.06, 0.3), (0.14, 0.47), (0.4, 0.5), (0.7, 0.38), (0.9, 0.365), (1.0, 0.35), (1.08, 0.32), (1.3, 0.31))
MASK_FEATHER = 0.035
NECK_FOOT = (-0.02, -0.15)
CLIP_FILES = {'walk.glb': {'walking': 'walk'}, 'run.glb': {'running': 'run'}, 'idle.glb': {'idle': 'idle'},
              'moves.glb': {'crouch_walk': 'crouchWalk', 'walk_backward': 'walkBack'}}


def clear():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for block in (bpy.data.meshes, bpy.data.armatures, bpy.data.actions, bpy.data.materials, bpy.data.images):
        for item in list(block):
            block.remove(item)


def lead_bones(obj):
    names = [g.name for g in obj.vertex_groups]
    lead = []
    for v in obj.data.vertices:
        best = max(v.groups, key=lambda g: g.weight, default=None)
        lead.append(names[best.group] if best else '')
    return lead


def unwrap_head(obj):
    """A second UV set holding only the head: every face that touches a head or neck vertex, unwrapped on its own."""
    mesh = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-6)
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    lead = lead_bones(obj)
    head = {p.index for p in mesh.polygons if any(lead[i] in HEAD_BONES for i in p.vertices)}
    layer = mesh.uv_layers.new(name='HeadUV', do_init=False)
    for item in layer.data:
        item.uv = (0.0, 0.0)
    mesh.uv_layers.active = layer
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_mode(type='FACE')
    edit = bmesh.from_edit_mesh(mesh)
    edit.faces.ensure_lookup_table()
    for f in edit.faces:
        f.select_set(f.index in head)
    edit.select_flush_mode()
    bmesh.update_edit_mesh(mesh)
    bpy.ops.uv.smart_project(angle_limit=math.radians(75), island_margin=0.003, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.pack_islands(rotate=True, margin=0.003, shape_method='CONCAVE')
    bpy.ops.object.mode_set(mode='OBJECT')
    mesh.uv_layers.active = mesh.uv_layers[0]
    mesh.uv_layers[0].active_render = True
    print('head faces', len(head), 'of', len(mesh.polygons))


def ingest_rig():
    clear()
    bpy.ops.import_scene.gltf(filepath=os.path.join(CACHE, 'rig.glb'))
    for o in list(bpy.context.scene.objects):
        if o.type == 'MESH' and not o.vertex_groups:
            bpy.data.objects.remove(o, do_unlink=True)
    for o in bpy.context.scene.objects:
        if o.type == 'MESH':
            o.data.materials.clear()
            unwrap_head(o)
    out = os.path.join(SOURCES, 'hunter-rig.glb')
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_materials='NONE', export_animations=False, export_skins=True, export_yup=True, export_apply=False)
    print('rig', out, os.path.getsize(out))


def clip_name(action, names):
    key = action.name.lower()
    for needle, name in names.items():
        if needle in key:
            return name
    return None


def sample(arm, action, name):
    scene = bpy.context.scene
    if not arm.animation_data:
        arm.animation_data_create()
    arm.animation_data.action = action
    slots = getattr(action, 'slots', None)
    if slots and len(slots):
        arm.animation_data.action_slot = slots[0]
    f0, f1 = action.frame_range
    seconds = (f1 - f0) / scene.render.fps
    frames = max(2, round(seconds * CLIP_FPS))
    bones = [b.name for b in arm.data.bones]
    rest = {b.name: (arm.matrix_world @ b.matrix_local).to_3x3().normalized() for b in arm.data.bones}
    rot, hips = [], []
    for i in range(frames):
        t = f0 + (f1 - f0) * i / frames
        scene.frame_set(int(t), subframe=t - int(t))
        bpy.context.view_layer.update()
        row = []
        for b in bones:
            world = (arm.matrix_world @ arm.pose.bones[b].matrix).to_3x3().normalized()
            q = (world @ rest[b].inverted()).to_quaternion()
            row.append([round(q.w, 5), round(q.x, 5), round(q.y, 5), round(q.z, 5)])
        rot.append(row)
        h = arm.matrix_world @ arm.pose.bones['Hips'].head
        hips.append([round(h.x, 4), round(h.y, 4), round(h.z, 4)])
    rest_hips = arm.matrix_world @ arm.data.bones['Hips'].head_local
    print('clip', name, 'from', action.name, 'frames', frames, 'seconds', round(seconds, 3))
    return {'name': name, 'seconds': round(seconds, 4), 'frames': frames, 'bones': bones, 'restHips': [round(c, 4) for c in rest_hips], 'rot': rot, 'hips': hips}


def ingest_clips():
    clips = []
    for file, names in CLIP_FILES.items():
        clear()
        bpy.ops.import_scene.gltf(filepath=os.path.join(CACHE, file))
        arm = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE'][0]
        for action in bpy.data.actions:
            name = clip_name(action, names)
            if name:
                clips.append(sample(arm, action, name))
            else:
                print('skipped action', action.name)
    out = os.path.join(SOURCES, 'hunter-clips.json')
    with open(out, 'w', encoding='utf8') as f:
        json.dump({'fps': CLIP_FPS, 'clips': clips}, f, separators=(',', ':'))
    print('clips', out, os.path.getsize(out))


def load_pixels(path, size):
    import numpy as np
    image = bpy.data.images.load(path)
    if image.size[0] != size:
        image.scale(size, size)
    px = np.empty(size * size * 4, dtype=np.float32)
    image.pixels.foreach_get(px)
    return image, px.reshape(size, size, 4)


def save_webp(image, px, out, quality):
    image.pixels.foreach_set(px.ravel())
    image.file_format = 'WEBP'
    image.filepath_raw = out
    image.save(quality=quality)
    bpy.data.images.remove(image)


def arm_uvs():
    """UV triangles of the arms and the UV centres of the hands, from the rig's own weights."""
    clear()
    bpy.ops.import_scene.gltf(filepath=os.path.join(CACHE, 'rig.glb'))
    obj = [o for o in bpy.context.scene.objects if o.type == 'MESH' and o.vertex_groups][0]
    names = [g.name for g in obj.vertex_groups]
    mesh = obj.data
    uv = mesh.uv_layers.active.data
    lead = []
    for v in mesh.vertices:
        best = max(v.groups, key=lambda g: g.weight, default=None)
        lead.append(names[best.group] if best else '')
    tris, hands = [], []
    for poly in mesh.polygons:
        tally = {}
        for i in poly.vertices:
            tally[lead[i]] = tally.get(lead[i], 0) + 1
        bone = max(tally, key=tally.get)
        if not bone.endswith(ARM_BONES):
            continue
        loops = [tuple(uv[i].uv) for i in poly.loop_indices]
        for i in range(1, len(loops) - 1):
            tris.append((loops[0], loops[i], loops[i + 1]))
        if bone.endswith('Hand'):
            hands.append((sum(l[0] for l in loops) / len(loops), sum(l[1] for l in loops) / len(loops)))
    return tris, hands


def uv_mask(tris, size):
    import numpy as np
    mask = np.zeros((size, size), dtype=bool)
    for tri in tris:
        pts = np.array(tri) * size
        x0, y0 = (np.floor(pts.min(axis=0)).astype(int) - 1).tolist()
        x1, y1 = (np.ceil(pts.max(axis=0)).astype(int) + 1).tolist()
        x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, size - 1), min(y1, size - 1)
        if x1 < x0 or y1 < y0:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        (ax, ay), (bx, by), (cx, cy) = pts
        d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(d) < 1e-12:
            continue
        w1 = ((by - cy) * (xs - cx) + (cx - bx) * (ys - cy)) / d
        w2 = ((cy - ay) * (xs - cx) + (ax - cx) * (ys - cy)) / d
        pad = 1.5 / max(1.0, abs(d) ** 0.5)
        mask[y0:y1 + 1, x0:x1 + 1] |= (w1 >= -pad) & (w2 >= -pad) & (1 - w1 - w2 >= -pad)
    return mask


def ingest_textures():
    import numpy as np
    tris, hands = arm_uvs()
    mask = uv_mask(tris, COLOR_SIZE)
    base, base_px = load_pixels(os.path.join(CACHE, 'hunter-base', 'base_color.png'), COLOR_SIZE)
    skin = np.median(np.array([base_px[int(v * COLOR_SIZE) % COLOR_SIZE, int(u * COLOR_SIZE) % COLOR_SIZE, :3] for u, v in hands]), axis=0)
    bpy.data.images.remove(base)
    print('skin', [round(float(c), 3) for c in skin], 'arm texels', int(mask.sum()))
    for name in sorted(os.listdir(CACHE)):
        color = os.path.join(CACHE, name, 'base_color.png')
        if not os.path.isfile(color) or name.startswith('head-'):
            continue
        image, px = load_pixels(color, COLOR_SIZE)
        if name in BARE_ARMS:
            lum = px[..., :3] @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
            detail = np.clip(lum / max(float(lum[mask].mean()), 1e-3), 0.5, 1.4) ** 0.7
            px[..., :3] = np.where(mask[..., None], np.clip(skin[None, None, :] * detail[..., None], 0, 1), px[..., :3])
        save_webp(image, px, os.path.join(MODELS, name + '.webp'), 90)
        print('texture', name)


def head_map():
    """For every texel of the head atlas: where it reads the body texture (u, v) and where it sits on the head (x, y, z)."""
    import numpy as np
    clear()
    bpy.ops.import_scene.gltf(filepath=os.path.join(SOURCES, 'hunter-rig.glb'))
    obj = [o for o in bpy.context.scene.objects if o.type == 'MESH' and o.vertex_groups][0]
    mesh = obj.data
    body = mesh.uv_layers[0].data
    atlas = mesh.uv_layers[1].data
    world = [obj.matrix_world @ v.co for v in mesh.vertices]
    size = HEAD_SIZE
    data = np.zeros((size, size, 5), dtype=np.float32)
    filled = np.zeros((size, size), dtype=bool)
    for poly in mesh.polygons:
        loops = list(poly.loop_indices)
        corners = [(np.array(atlas[i].uv) * size, np.array([body[i].uv[0], body[i].uv[1], *world[mesh.loops[i].vertex_index]], dtype=np.float32)) for i in loops]
        if max(abs(c[0]).max() for c in corners) < 1e-6:
            continue
        for k in range(1, len(corners) - 1):
            (a, va), (b, vb), (c, vc) = corners[0], corners[k], corners[k + 1]
            x0 = max(int(math.floor(min(a[0], b[0], c[0]))) - 1, 0)
            x1 = min(int(math.ceil(max(a[0], b[0], c[0]))) + 1, size - 1)
            y0 = max(int(math.floor(min(a[1], b[1], c[1]))) - 1, 0)
            y1 = min(int(math.ceil(max(a[1], b[1], c[1]))) + 1, size - 1)
            d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
            if x1 < x0 or y1 < y0 or abs(d) < 1e-9:
                continue
            xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
            w1 = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / d
            w2 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / d
            w3 = 1 - w1 - w2
            inside = (w1 >= -0.02) & (w2 >= -0.02) & (w3 >= -0.02)
            if not inside.any():
                continue
            value = w1[..., None] * va + w2[..., None] * vb + w3[..., None] * vc
            block = data[y0:y1 + 1, x0:x1 + 1]
            block[inside] = value[inside]
            filled[y0:y1 + 1, x0:x1 + 1] |= inside
    covered = int(filled.sum())
    for _ in range(10):
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            near = np.roll(filled, (dy, dx), axis=(0, 1))
            take = near & ~filled
            data[take] = np.roll(data, (dy, dx), axis=(0, 1))[take]
            filled |= take
    print('head atlas', covered, 'texels of', size * size)
    return data, filled


def line(points, f):
    import numpy as np
    return np.interp(f, [p[0] for p in points], [p[1] for p in points])


def smoothstep(e0, e1, x):
    import numpy as np
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def head_regions(data):
    """Hair above its line and beard below its line, each as 0..1, the patch of bare skin used to even skin tones, and the
    foot of the neck, which every head takes from the base head so no other outfit's collar shows on it."""
    import numpy as np
    x, y, z = data[..., 2], data[..., 3], data[..., 4]
    h = (z - HEAD_CHIN) / (HEAD_TOP - HEAD_CHIN)
    f = -(y - HEAD_AXIS) / HEAD_DEPTH
    hair = smoothstep(-MASK_FEATHER, MASK_FEATHER, h - line(HAIR_LINE, f))
    beard = smoothstep(-MASK_FEATHER, MASK_FEATHER, line(BEARD_LINE, f) - h)
    side = np.abs(x)
    skin = ((h > 0.4) & (h < 0.5) & (f > 0.75) & (side > 0.025) & (side < 0.055)) | ((h > 0.6) & (h < 0.7) & (f > 0.8) & (side < 0.04))
    front = smoothstep(0.35, 0.6, f) * (1 - smoothstep(0.04, 0.06, side))
    neck = smoothstep(-MASK_FEATHER, MASK_FEATHER, NECK_FOOT[0] + (NECK_FOOT[1] - NECK_FOOT[0]) * front - h)
    return hair, beard, skin, neck


def sample(px, u, v):
    import numpy as np
    hgt, wid = px.shape[0], px.shape[1]
    x = np.clip(u * wid - 0.5, 0, wid - 1.001)
    y = np.clip(v * hgt - 0.5, 0, hgt - 1.001)
    x0 = np.floor(x).astype(np.int32)
    y0 = np.floor(y).astype(np.int32)
    fx = (x - x0)[..., None]
    fy = (y - y0)[..., None]
    top = px[y0, x0, :3] * (1 - fx) + px[y0, x0 + 1, :3] * fx
    bottom = px[y0 + 1, x0, :3] * (1 - fx) + px[y0 + 1, x0 + 1, :3] * fx
    return top * (1 - fy) + bottom * fy


def save_rgb(rgb, out, quality):
    import numpy as np
    size = rgb.shape[0]
    image = bpy.data.images.new('out', size, size, alpha=False)
    px = np.ones((size, size, 4), dtype=np.float32)
    px[..., :3] = np.clip(rgb, 0, 1)
    save_webp(image, px, out, quality)


def ingest_heads():
    import numpy as np
    data, filled = head_map()
    hair, beard, skin, neck = head_regions(data)
    skin &= filled
    masks = np.zeros((HEAD_SIZE, HEAD_SIZE, 3), dtype=np.float32)
    masks[..., 0] = hair * filled
    masks[..., 1] = beard * filled
    save_rgb(masks, os.path.join(MODELS, 'hunter-head-masks.webp'), 92)
    tone = None
    foot = None
    for head, source in HEADS.items():
        image = bpy.data.images.load(os.path.join(CACHE, source, 'base_color.png'))
        wid, hgt = image.size
        px = np.empty(wid * hgt * 4, dtype=np.float32)
        image.pixels.foreach_get(px)
        px = px.reshape(hgt, wid, 4)
        bpy.data.images.remove(image)
        rgb = sample(px, data[..., 0], data[..., 1]) * filled[..., None]
        own = np.median(rgb[skin], axis=0)
        if tone is None:
            tone = own
        gain = np.clip(tone / np.maximum(own, 1e-3), 0.7, 1.4)
        rgb = rgb * gain
        if foot is None:
            foot = rgb
        else:
            rgb = rgb * (1 - neck[..., None]) + foot * neck[..., None]
        save_rgb(rgb, os.path.join(MODELS, 'hunter-head-%s.webp' % head), 90)
        print('head', head, 'from', source, 'gain', [round(float(g), 3) for g in gain])


if 'rig' in STEPS:
    ingest_rig()
if 'clips' in STEPS:
    ingest_clips()
if 'textures' in STEPS:
    ingest_textures()
if 'heads' in STEPS:
    ingest_heads()
