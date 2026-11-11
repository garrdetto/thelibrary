"""The skinned hunter (`hunter.rrs`): Meshy's rigged mesh kept whole and weighted to its 22-joint skeleton, split only
into the face, the upper garment and the lower garment so each can wear its own texture, with the hats and the pack
riding the head and the torso. Clips come from `hunter-clips.json` (see `ingest-hunter.py`).

Every joint is stored axis-aligned at a reference pose (the bind pose with the arms hanging at the sides), so a joint
turn means the same thing it does on the 11-joint rigid rigs: `Avatar`'s hand-written poses and the arm reach apply
unchanged. The turn from the bind pose to that reference lives in each joint's bind matrix, never in the vertices."""

SKIN_BONES = [
    ('hips', 'Hips', None), ('torso', 'Spine02', 'hips'), ('spine1', 'Spine01', 'torso'), ('spine2', 'Spine', 'spine1'),
    ('neck', 'neck', 'spine2'), ('head', 'Head', 'neck'),
    ('shoulderR', 'LeftShoulder', 'spine2'), ('upperArmR', 'LeftArm', 'shoulderR'), ('foreArmR', 'LeftForeArm', 'upperArmR'), ('handR', 'LeftHand', 'foreArmR'),
    ('shoulderL', 'RightShoulder', 'spine2'), ('upperArmL', 'RightArm', 'shoulderL'), ('foreArmL', 'RightForeArm', 'upperArmL'), ('handL', 'RightHand', 'foreArmL'),
    ('thighR', 'LeftUpLeg', 'hips'), ('shinR', 'LeftLeg', 'thighR'), ('footR', 'LeftFoot', 'shinR'), ('toeR', 'LeftToeBase', 'footR'),
    ('thighL', 'RightUpLeg', 'hips'), ('shinL', 'RightLeg', 'thighL'), ('footL', 'RightFoot', 'shinL'), ('toeL', 'RightToeBase', 'footL'),
]
SKIN_BONE_ALIAS = {'head_end': 'Head', 'headfront': 'Head'}
SKIN_ARM_REST = {'upper': (0.15, -0.03, -1.0), 'fore': (0.08, 0.06, -1.0)}
SKIN_LOOPS = {'walk': True, 'run': True, 'crouchWalk': True, 'walkBack': True, 'idle': True}
SKIN_GAITS = ('walk', 'run', 'crouchWalk', 'walkBack')
SKIN_CLIPS = os.path.join(MESHY_DIR, 'hunter-clips.json')
SKIN_HEM_TEXTURE = 'hunter-flannel-none-jeans'
SKIN_COLLAR_TEXTURE = 'hunter-blaze-full'
SKIN_HEAD_RELAX = 2
SKIN_HEAD_NORMAL_RELAX = 8


def skin_axes(k):
    """Blender world (z up, facing -y) to the module's frame (y up, facing +z), as a 3x3 with the hip-height scale apart."""
    import numpy as np
    swap = np.array([[1.0, 0, 0], [0, 0, 1.0], [0, 1.0, 0]])
    turn = np.diag([-1.0, -1.0, 1.0])
    return swap @ turn


def arc(a, b):
    import numpy as np
    a = a / np.linalg.norm(a)
    b = b / np.linalg.norm(b)
    v = np.cross(a, b)
    c = float(np.dot(a, b))
    s2 = float(np.dot(v, v))
    if s2 < 1e-12:
        return np.eye(3)
    vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + vx + vx @ vx * ((1 - c) / s2)


def quat_of(m):
    q = Matrix([list(map(float, r)) for r in m]).to_quaternion()
    return (q.x, q.y, q.z, q.w)


def load_skinned(path):
    clear_scene()
    bpy.ops.import_scene.gltf(filepath=path)
    arm = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE'][0]
    obj = [o for o in bpy.context.scene.objects if o.type == 'MESH' and o.vertex_groups][0]
    heads = {b.name: arm.matrix_world @ b.head_local for b in arm.data.bones}
    groups = [g.name for g in obj.vertex_groups]
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.transform(obj.matrix_world)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-6)
    return heads, groups, bm


def vertex_weights(bm, groups, index_of):
    layer = bm.verts.layers.deform.active
    out = {}
    for v in bm.verts:
        tally = {}
        for g, w in v[layer].items():
            bone = SKIN_BONE_ALIAS.get(groups[g], groups[g])
            if bone in index_of and w > 0:
                tally[index_of[bone]] = tally.get(index_of[bone], 0.0) + w
        top = sorted(tally.items(), key=lambda kv: -kv[1])[:4]
        total = sum(w for _, w in top) or 1.0
        out[v.index] = [(j, w / total) for j, w in top] or [(0, 1.0)]
    return out


def smooth_head(bm, weights, head_joints):
    """Meshy's face is lumpy at the scale of a few millimetres, which lights as blotches. The head's skin (its one big
    shell, never the eyes) is relaxed a little, and its shading normals come from a copy relaxed a lot more."""
    layer = bm.verts.layers.float_vector.new('n0')
    bm.verts.ensure_lookup_table()
    shell = {}
    sizes = []
    for v in bm.verts:
        if v.index in shell:
            continue
        stack = [v]
        shell[v.index] = len(sizes)
        count = 1
        while stack:
            a = stack.pop()
            for e in a.link_edges:
                b = e.other_vert(a)
                if b.index not in shell:
                    shell[b.index] = len(sizes)
                    stack.append(b)
                    count += 1
        sizes.append(count)
    main = max(range(len(sizes)), key=lambda i: sizes[i])
    head = [v for v in bm.verts if shell[v.index] == main and sum(w for j, w in weights[v.index] if j in head_joints) > 0.5]
    for _ in range(SKIN_HEAD_RELAX):
        bmesh.ops.smooth_vert(bm, verts=head, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    bm.normal_update()
    copy = bm.copy()
    copy.verts.ensure_lookup_table()
    picked = [copy.verts[v.index] for v in head]
    for _ in range(SKIN_HEAD_NORMAL_RELAX):
        bmesh.ops.smooth_vert(copy, verts=picked, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    copy.normal_update()
    for v in head:
        v[layer] = copy.verts[v.index].normal
    copy.free()
    return len(head)


def skinned_part(bm, weights, faces=None):
    """Triangles of `faces` (all when None) as flat vertex streams: a vertex is split where its UVs differ."""
    uv = bm.loops.layers.uv.active
    n0 = bm.verts.layers.float_vector.get('n0')
    pos, nor, uvs, skin, tris = [], [], [], [], []
    index = {}
    for f in bm.faces:
        if faces is not None and f.index not in faces:
            continue
        loops = list(f.loops)
        for i in range(1, len(loops) - 1):
            tri = []
            for loop in (loops[0], loops[i], loops[i + 1]):
                u, v = loop[uv].uv if uv else (0.0, 0.0)
                key = (loop.vert.index, round(u, 5), round(v, 5))
                if key not in index:
                    index[key] = len(pos)
                    pos.append(tuple(loop.vert.co))
                    nor.append(tuple(loop.vert[n0]) if n0 and loop.vert[n0].length > 0.5 else tuple(loop.vert.normal))
                    uvs.append((u, v))
                    skin.append(weights[loop.vert.index])
                tri.append(index[key])
            tris.append(tuple(tri))
    return {'pos': pos, 'nor': nor, 'uv': uvs, 'skin': skin, 'tris': tris}


def rigid_part(piece, joint):
    return {'pos': list(piece.pos), 'nor': list(piece.nor), 'uv': list(piece.uv), 'skin': [[(joint, 1.0)]] * len(piece.pos), 'tris': list(piece.tris)}


def pack_part(part):
    chunk = bytearray()
    for (x, y, z) in part['pos']:
        chunk += struct.pack('<3f', x, z, y)
    for (x, y, z) in part['nor']:
        l = math.sqrt(x * x + y * y + z * z) or 1.0
        chunk += struct.pack('<3b', int(round(x / l * 127)), int(round(z / l * 127)), int(round(y / l * 127)))
    while len(chunk) % 4:
        chunk += b'\0'
    for (u, v) in part['uv']:
        chunk += struct.pack('<2f', u, v)
    for skin in part['skin']:
        bytes_ = [int(round(w * 255)) for _, w in skin]
        bytes_[0] += 255 - sum(bytes_)
        joints = [j for j, _ in skin] + [0] * (4 - len(skin))
        chunk += struct.pack('<4B', *joints)
        chunk += struct.pack('<4B', *(bytes_ + [0] * (4 - len(bytes_))))
    wide = len(part['pos']) > 65535
    for (a, b, c) in part['tris']:
        chunk += struct.pack('<3I' if wide else '<3H', a, c, b)
    while len(chunk) % 4:
        chunk += b'\0'
    return bytes(chunk), wide


def write_skinned(name, joints, parts, clips, meta):
    header = {'name': name, 'joints': joints, 'parts': [], 'clips': [], 'meta': meta}
    blobs = []
    offset = 0
    for part in parts:
        chunk, wide = pack_part(part)
        header['parts'].append({'name': part['name'], 'material': part['material'], 'vertices': len(part['pos']), 'indices': len(part['tris']) * 3, 'wide': wide,
                                'offset': offset, 'bytes': len(chunk), **({'item': part['item']} if part.get('item') else {})})
        blobs.append(chunk)
        offset += len(chunk)
    for clip in clips:
        chunk = bytearray()
        for p in clip['hips']:
            chunk += struct.pack('<3f', *p)
        for row in clip['rot']:
            for q in row:
                chunk += struct.pack('<4h', *(max(-32767, min(32767, int(round(c * 32767)))) for c in q))
        while len(chunk) % 4:
            chunk += b'\0'
        header['clips'].append({'name': clip['name'], 'seconds': clip['seconds'], 'frames': clip['frames'], 'loop': clip['loop'], 'speed': clip['speed'], 'offset': offset, 'bytes': len(chunk)})
        blobs.append(bytes(chunk))
        offset += len(chunk)
    hj = json.dumps(header, separators=(',', ':')).encode('utf8')
    while (len(hj) + 8) % 4:
        hj += b' '
    path = os.path.join(OUT, name + '.rrs')
    with open(path, 'wb') as f:
        f.write(b'RRS1')
        f.write(struct.pack('<I', len(hj)))
        f.write(hj)
        for b in blobs:
            f.write(b)
    tris = sum(p['indices'] for p in header['parts']) // 3
    print('wrote %s  parts=%d  tris=%d  clips=%d  bytes=%d' % (name, len(header['parts']), tris, len(clips), os.path.getsize(path)))


def texel(pixels, u, v):
    h, w = pixels.shape[0], pixels.shape[1]
    return pixels[int(v * h) % h, int(u * w) % w][:3]


def model_texture(name):
    return image_array(bpy.data.images.load(os.path.join(OUT, name + '.webp')))


def skin_slots(bm, dominant, names, head_z, hem_pixels, collar_pixels):
    """Face index → 'face', 'upper' or 'lower'. The hem is the height that best parts the red shirt from the blue jeans in
    one outfit; the collar is whatever turns blaze orange on the neck in another."""
    uv = bm.loops.layers.uv.active
    samples = []
    for f in bm.faces:
        j = names[dominant[f.index]]
        if j not in ('hips', 'torso') and not j.startswith('thigh'):
            continue
        r, g, b = texel(hem_pixels, *face_uv(f, uv))
        z = f.calc_center_median().z
        if r > b * 1.35 and r > g * 1.15:
            samples.append((z, 1))
        elif b > r * 1.1 and b > 0.08:
            samples.append((z, -1))
    hem, best = None, 1e9
    for cut in sorted(set(round(z, 3) for z, _ in samples)):
        err = sum(1 for z, s in samples if (s > 0 and z < cut) or (s < 0 and z >= cut))
        if err < best:
            best, hem = err, cut
    slots = {}
    for f in bm.faces:
        j = names[dominant[f.index]]
        z = f.calc_center_median().z
        if j in ('head', 'neck'):
            r, g, b = texel(collar_pixels, *face_uv(f, uv))
            cloth = z < head_z + 0.05 and r > 0.4 and r > b * 3 and r - g > 0.2
            slots[f.index] = 'upper' if cloth else 'face'
        elif j in ('hips', 'torso') or j.startswith('thigh'):
            slots[f.index] = 'upper' if z >= hem else 'lower'
        elif j.startswith(('shin', 'foot', 'toe')):
            slots[f.index] = 'lower'
        else:
            slots[f.index] = 'upper'
    smooth_labels(slots, face_neighbors(bm), rounds=4)
    return slots, hem


def gait_speed(feet, seconds):
    """Ground speed of an in-place gait: how fast the planted foot slides back under the hips."""
    frames = len(feet)
    low = min(min(l[1], r[1]) for l, r in feet)
    total, count = 0.0, 0
    for i in range(frames):
        a, b = feet[i], feet[(i + 1) % frames]
        side = 0 if a[0][1] <= a[1][1] else 1
        if a[side][1] > low + 0.05 or b[side][1] > low + 0.05:
            continue
        total += a[side][2] - b[side][2]
        count += 1
    return (total / count) * frames / seconds if count else 0.0


def build_skinned_hunter():
    import numpy as np
    heads, groups, bm = load_skinned(meshy_source('hunter-rig'))
    k = HUNTER_HIP / heads['Hips'].z
    bm.transform(to_game_frame(k))
    bm.normal_update()
    bm.faces.index_update()
    bm.verts.index_update()
    bm.faces.ensure_lookup_table()
    axes = skin_axes(k)
    names = [j for j, _, _ in SKIN_BONES]
    parent = [names.index(p) if p else -1 for _, _, p in SKIN_BONES]
    index_of = {bone: i for i, (_, bone, _) in enumerate(SKIN_BONES)}
    bind = [axes @ np.array(heads[bone]) * k for _, bone, _ in SKIN_BONES]

    ref = [np.eye(3) for _ in names]
    for side, s in (('L', 1.0), ('R', -1.0)):
        up, fore, hand = names.index('upperArm' + side), names.index('foreArm' + side), names.index('hand' + side)
        ux, uy, uz = SKIN_ARM_REST['upper']
        fx, fy, fz = SKIN_ARM_REST['fore']
        ru = arc(bind[fore] - bind[up], np.array([s * ux, uz, uy]))
        rf = arc(ru @ (bind[hand] - bind[fore]), np.array([s * fx, fz, fy]))
        ref[up] = ru
        ref[fore] = rf @ ru
        ref[hand] = rf @ ru
    rest = [None] * len(names)
    for i in range(len(names)):
        rest[i] = bind[i] if parent[i] < 0 else rest[parent[i]] + ref[parent[i]] @ (bind[i] - bind[parent[i]])

    weights = vertex_weights(bm, groups, index_of)
    bm.verts.ensure_lookup_table()
    smoothed = smooth_head(bm, weights, {names.index('head'), names.index('neck')})
    dominant = {}
    for f in bm.faces:
        tally = {}
        for v in f.verts:
            for j, w in weights[v.index]:
                tally[j] = tally.get(j, 0.0) + w
        dominant[f.index] = max(tally, key=tally.get)
    head_z = float(bind[names.index('head')][1])
    slots, hem = skin_slots(bm, dominant, names, head_z, model_texture(SKIN_HEM_TEXTURE), model_texture(SKIN_COLLAR_TEXTURE))
    parts = []
    for slot in ('face', 'upper', 'lower'):
        faces = {i for i, s in slots.items() if s == slot}
        part = skinned_part(bm, weights, faces)
        part.update(name=slot, material='tex:hunter-base')
        parts.append(part)

    face_verts = [v.co.copy() for f in bm.faces if slots[f.index] == 'face' for v in f.verts]
    head_top = max(c.z for c in face_verts)
    crown = [c for c in face_verts if c.z > head_top - 0.09]
    head_center = Vector((sum(c.x for c in crown) / len(crown), sum(c.y for c in crown) / len(crown), 0))
    band = [c for c in face_verts if head_top - 0.13 < c.z < head_top - 0.05]
    head_width = max(c.x for c in band) - min(c.x for c in band)
    torso_back = [v.co.y for f in bm.faces if slots[f.index] == 'upper' and names[dominant[f.index]] in ('torso', 'spine1', 'spine2') for v in f.verts if 1.1 < v.co.z < 1.35]
    shoulder_z = float(bind[names.index('upperArmL')][1])
    hands = {}
    for side in ('L', 'R'):
        h = names.index('hand' + side)
        own = [np.array([v.co.x, v.co.z, v.co.y]) for v in bm.verts if any(j == h and w > 0.6 for j, w in weights[v.index])]
        centre = sum(own) / len(own)
        hands[side] = rest[h] + ref[h] @ (centre - bind[h])
    bm.free()

    for item, src in HUNTER_HATS.items():
        if not meshy_source(src):
            continue
        hb, img = load_prop(src, rotate=item not in HUNTER_HAT_BACKWARDS)
        fit_hat(hb, head_top, head_center, head_width, HUNTER_HAT_LIFT.get(item, 0.025) * HUNTER_HAT_SCALE, HUNTER_HAT_FIT.get(item, 1.0))
        if item in HUNTER_HAT_FORWARD:
            bmesh.ops.translate(hb, vec=(0, HUNTER_HAT_FORWARD[item], 0), verts=hb.verts[:])
        part = rigid_part(piece_from_textured(hb), names.index('head'))
        part.update(name='hat:' + item, material='tex:' + src, item=item)
        parts.append(part)
        hb.free()
    if meshy_source(HUNTER_PACK):
        pb, img = load_prop(HUNTER_PACK, rotate=False)
        fit_pack(pb, min(torso_back), shoulder_z + 0.02)
        part = rigid_part(piece_from_textured(pb), names.index('spine1'))
        part.update(name='pack:pack-hunting', material='tex:' + HUNTER_PACK, item='pack-hunting')
        parts.append(part)
        pb.free()

    joints = []
    for i, name in enumerate(names):
        offset = rest[i] if parent[i] < 0 else rest[i] - rest[parent[i]]
        joints.append({'name': name, 'parent': parent[i], 'rest': [round(float(c), 5) for c in offset], 'bind': [round(float(c), 5) for c in bind[i]],
                       'ref': [round(c, 6) for c in quat_of(ref[i])]})

    with open(SKIN_CLIPS, encoding='utf8') as f:
        source = json.load(f)
    clips = []
    hips = names.index('hips')
    for clip in source['clips']:
        order = [clip['bones'].index(bone) for _, bone, _ in SKIN_BONES]
        rest_hips = axes @ np.array(clip['restHips']) * k
        frames = []
        for row, hp in zip(clip['rot'], clip['hips']):
            world = []
            for i, b in enumerate(order):
                w, x, y, z = row[b]
                turn = np.array(Quaternion((w, x, y, z)).to_matrix())
                world.append(axes @ turn @ axes.T @ ref[i].T)
            local = [world[i] if parent[i] < 0 else world[parent[i]].T @ world[i] for i in range(len(names))]
            at = rest[hips] + (axes @ np.array(hp) * k - rest_hips)
            pos = [None] * len(names)
            for i in range(len(names)):
                pos[i] = at if parent[i] < 0 else pos[parent[i]] + world[parent[i]] @ (rest[i] - rest[parent[i]])
            frames.append({'local': local, 'hips': at, 'feet': (pos[names.index('footL')], pos[names.index('footR')])})
        name = clip['name']
        speed = 0.0
        if name in SKIN_GAITS:
            lead = max(range(len(frames)), key=lambda i: frames[i]['feet'][0][2] - frames[i]['hips'][2])
            frames = frames[lead:] + frames[:lead]
            speed = gait_speed([f['feet'] for f in frames], clip['seconds'])
        mean_x = sum(f['hips'][0] for f in frames) / len(frames)
        mean_z = sum(f['hips'][2] for f in frames) / len(frames)
        out_hips = [(float(f['hips'][0] - mean_x), float(f['hips'][1]), float(f['hips'][2] - mean_z + rest[hips][2])) for f in frames]
        out_rot = []
        last = [None] * len(names)
        for f in frames:
            row = []
            for i, m in enumerate(f['local']):
                q = quat_of(m)
                if last[i] is not None and sum(a * b for a, b in zip(q, last[i])) < 0:
                    q = tuple(-c for c in q)
                last[i] = q
                row.append(q)
            out_rot.append(row)
        clips.append({'name': name, 'seconds': clip['seconds'], 'frames': len(frames), 'loop': SKIN_LOOPS.get(name, False), 'speed': round(speed, 4), 'hips': out_hips, 'rot': out_rot})
        print('clip', name, 'frames', len(frames), 'speed', round(speed, 3), 'hip height', round(min(h[1] for h in out_hips), 3), round(max(h[1] for h in out_hips), 3))

    arms = {}
    for side in ('L', 'R'):
        up, fore = names.index('upperArm' + side), names.index('foreArm' + side)
        arms[side] = {'elbow': [round(float(c), 4) for c in rest[fore] - rest[up]], 'palm': [round(float(c), 4) for c in hands[side] - rest[fore]]}
    upper = {jacket + '+' + vest: 'tex:' + tex for (jacket, vest), tex in HUNTER_COMBOS.items()}
    lower = {pants: 'tex:' + tex for pants, tex in HUNTER_PANTS.items()}
    meta = {'arms': arms, 'hip': round(float(rest[hips][1]), 4), 'height': round(head_top, 4), 'wear': {'upper': upper, 'lower': lower}}
    write_skinned('hunter', joints, parts, clips, meta)
    print('hunter hem', round(hem, 3), 'head', round(head_top, 3), 'smoothed', smoothed, 'arms', arms)


build_hunter = build_skinned_hunter
