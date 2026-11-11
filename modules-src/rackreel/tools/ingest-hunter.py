"""Turns the raw Meshy downloads for the skinned hunter into what the repo keeps.

  blender -b --factory-startup -P modules-src/rackreel/tools/ingest-hunter.py -- <cacheDir> [rig] [clips] [textures]

<cacheDir> holds rig.glb (the rigged character), walk.glb, run.glb, idle.glb and moves.glb (armatures with clips) and one folder
per outfit with Meshy's base_color.png. Writes assets-src/rackreel/meshy/hunter-rig.glb (mesh, weights and skeleton,
no textures), hunter-clips.json (every clip sampled at 30 fps as world-space bone turns from the bind pose) and the
outfit textures in public/modules/rackreel/models/. The tank tops' bare arms are repainted in the base texture's skin
tone (Meshy paints them sunburnt), keeping their shading. Task ids are in assets-src/rackreel/meshy/hunter.meshy.json.
"""
import bpy
import json
import os
import sys

ARGS = sys.argv[sys.argv.index('--') + 1:]
CACHE = os.path.abspath(ARGS[0])
STEPS = set(ARGS[1:]) or {'rig', 'clips', 'textures'}
HERE = os.path.dirname(os.path.abspath(__file__))
SOURCES = os.path.abspath(os.path.join(HERE, '../../../assets-src/rackreel/meshy'))
MODELS = os.path.abspath(os.path.join(HERE, '../../../public/modules/rackreel/models'))
CLIP_FPS = 30
COLOR_SIZE = 2048
BARE_ARMS = {'hunter-tank-khaki', 'hunter-tank-blazevest', 'hunter-tank-fishvest'}
ARM_BONES = ('Arm', 'ForeArm', 'Hand')
CLIP_FILES = {'walk.glb': {'walking': 'walk'}, 'run.glb': {'running': 'run'}, 'idle.glb': {'idle': 'idle'},
              'moves.glb': {'crouch_walk': 'crouchWalk', 'walk_backward': 'walkBack'}}


def clear():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for block in (bpy.data.meshes, bpy.data.armatures, bpy.data.actions, bpy.data.materials, bpy.data.images):
        for item in list(block):
            block.remove(item)


def ingest_rig():
    clear()
    bpy.ops.import_scene.gltf(filepath=os.path.join(CACHE, 'rig.glb'))
    for o in list(bpy.context.scene.objects):
        if o.type == 'MESH' and not o.vertex_groups:
            bpy.data.objects.remove(o, do_unlink=True)
    for o in bpy.context.scene.objects:
        if o.type == 'MESH':
            o.data.materials.clear()
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
        if not os.path.isfile(color):
            continue
        image, px = load_pixels(color, COLOR_SIZE)
        if name in BARE_ARMS:
            lum = px[..., :3] @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
            detail = np.clip(lum / max(float(lum[mask].mean()), 1e-3), 0.5, 1.4) ** 0.7
            px[..., :3] = np.where(mask[..., None], np.clip(skin[None, None, :] * detail[..., None], 0, 1), px[..., :3])
        save_webp(image, px, os.path.join(MODELS, name + '.webp'), 90)
        print('texture', name)


if 'rig' in STEPS:
    ingest_rig()
if 'clips' in STEPS:
    ingest_clips()
if 'textures' in STEPS:
    ingest_textures()
