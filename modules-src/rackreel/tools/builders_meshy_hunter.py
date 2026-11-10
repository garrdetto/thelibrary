HUNTER_COMBOS = {
    ('jacket-camo', 'vest-blaze'): 'hunter-base',
    ('jacket-camo', 'vest-fishing'): 'hunter-camo-fishing-jeans',
    ('jacket-camo', 'vest-none'): 'hunter-camo-none-waders',
    ('jacket-flannel', 'vest-blaze'): 'hunter-flannel-blaze-camo',
    ('jacket-flannel', 'vest-fishing'): 'hunter-flannel-fishing-waders',
    ('jacket-flannel', 'vest-none'): 'hunter-flannel-none-jeans',
    ('jacket-canvas', 'vest-blaze'): 'hunter-canvas-blaze-jeans',
    ('jacket-canvas', 'vest-fishing'): 'hunter-canvas-fishing-camo',
    ('jacket-canvas', 'vest-none'): 'hunter-canvas-none-waders',
    ('jacket-blaze', 'vest-blaze'): 'hunter-blaze-full',
    ('jacket-blaze', 'vest-fishing'): 'hunter-blaze-full',
    ('jacket-blaze', 'vest-none'): 'hunter-blaze-full',
    ('jacket-angler', 'vest-blaze'): 'hunter-angler-blazevest',
    ('jacket-angler', 'vest-fishing'): 'hunter-angler-fishvest',
    ('jacket-angler', 'vest-none'): 'hunter-angler-khaki',
    ('jacket-tank', 'vest-blaze'): 'hunter-tank-blazevest',
    ('jacket-tank', 'vest-fishing'): 'hunter-tank-fishvest',
    ('jacket-tank', 'vest-none'): 'hunter-tank-khaki',
}
HUNTER_SKIN_ARMS = {'hunter-tank-khaki', 'hunter-tank-blazevest', 'hunter-tank-fishvest'}
HUNTER_PANTS = {'pants-camo': 'hunter-base', 'pants-jeans': 'hunter-flannel-none-jeans', 'pants-waders': 'hunter-canvas-none-waders',
                'pants-blaze': 'hunter-blaze-full', 'pants-khaki': 'hunter-angler-khaki'}
HUNTER_HATS = {'cap-blaze': 'hunter-cap-blaze', 'cap-camo': 'hunter-cap-camo', 'cap-bucket': 'hunter-cap-bucket',
               'cap-backwards': 'hunter-cap-backwards', 'cap-cowboy': 'hunter-hat-cowboy', 'cap-visor': 'hunter-hat-visor'}
HUNTER_HAT_BACKWARDS = {'cap-backwards'}
HUNTER_HAT_FIT = {'cap-cowboy': 1.0, 'cap-visor': 1.22}
HUNTER_HAT_FORWARD = {'cap-visor': 0.055}
HUNTER_PACK = 'hunter-pack'
HUNTER_PACK_PANEL_Y = 0.1
HUNTER_HAT_LIFT = {'cap-blaze': 0.06, 'cap-camo': 0.06, 'cap-bucket': 0.03, 'cap-backwards': 0.06, 'cap-cowboy': 0.075, 'cap-visor': -0.02}
HUNTER_HAT_SCALE = 0.85
HUNTER_HEM_SOURCE = 'hunter-flannel-none-jeans'
HUNTER_HIP = 0.98
HUNTER_BODY_TEXTURE = 1536
HUNTER_PROP_TEXTURE = 1024
BONE_JOINT = {
    'Hips': 'hips', 'Spine02': 'torso', 'Spine01': 'torso', 'Spine': 'torso', 'Shoulder': 'torso',
    'neck': 'head', 'Head': 'head', 'head_end': 'head', 'headfront': 'head',
    'Arm': 'upperArm', 'ForeArm': 'foreArm', 'Hand': 'foreArm', 'UpLeg': 'thigh', 'Leg': 'shin', 'Foot': 'shin', 'ToeBase': 'shin',
}
JOINT_PARENT = {'hips': None, 'torso': 'hips', 'head': 'torso', 'upperArmL': 'torso', 'upperArmR': 'torso', 'foreArmL': 'upperArmL', 'foreArmR': 'upperArmR',
                'thighL': 'hips', 'thighR': 'hips', 'shinL': 'thighL', 'shinR': 'thighR'}


def bone_joint(name):
    for prefix, side in (('Left', 'R'), ('Right', 'L')):
        if name.startswith(prefix):
            base = BONE_JOINT[name[len(prefix):]]
            return base if base == 'torso' else base + side
    return BONE_JOINT[name]


def clear_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)


def load_rig(path):
    clear_scene()
    bpy.ops.import_scene.gltf(filepath=path)
    arm = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE'][0]
    me = [o for o in bpy.context.scene.objects if o.type == 'MESH' and o.vertex_groups][0]
    bones = {b.name: arm.matrix_world @ b.head_local for b in arm.data.bones}
    names = [g.name for g in me.vertex_groups]
    verts = [me.matrix_world @ v.co for v in me.data.vertices]
    vjoint = []
    for v in me.data.vertices:
        best = max(v.groups, key=lambda g: g.weight, default=None)
        vjoint.append(bone_joint(names[best.group]) if best else 'torso')
    polys = [tuple(p.vertices) for p in me.data.polygons]
    fjoint = []
    for p in polys:
        tally = {}
        for i in p:
            tally[vjoint[i]] = tally.get(vjoint[i], 0) + 1
        fjoint.append(max(tally, key=tally.get))
    return bones, verts, polys, fjoint


def bounds(points):
    return [(min(p[i] for p in points), max(p[i] for p in points)) for i in range(3)]


def fit_to(bm, target):
    b = bounds([v.co for v in bm.verts])
    s = (target[2][1] - target[2][0]) / (b[2][1] - b[2][0])
    bmesh.ops.scale(bm, vec=(s, s, s), verts=bm.verts[:])
    b = bounds([v.co for v in bm.verts])
    shift = Vector((
        (target[0][0] + target[0][1]) / 2 - (b[0][0] + b[0][1]) / 2,
        (target[1][0] + target[1][1]) / 2 - (b[1][0] + b[1][1]) / 2,
        target[2][0] - b[2][0],
    ))
    bmesh.ops.translate(bm, vec=shift, verts=bm.verts[:])


def to_game_frame(scale):
    return Matrix.Scale(scale, 4) @ Matrix.Rotation(math.pi, 4, 'Z')


def image_array(image):
    import numpy as np
    w, h = image.size
    arr = np.empty(w * h * 4, dtype=np.float32)
    image.pixels.foreach_get(arr)
    return arr.reshape(h, w, 4)


def face_uv(face, uv):
    u = sum(l[uv].uv.x for l in face.loops) / len(face.loops)
    v = sum(l[uv].uv.y for l in face.loops) / len(face.loops)
    return u, v


def find_hem(bm, labels, pixels):
    uv = bm.loops.layers.uv.active
    h, w = pixels.shape[0], pixels.shape[1]
    samples = []
    for f in bm.faces:
        j = labels[f.index]
        if j != 'hips' and not j.startswith('thigh'):
            continue
        u, v = face_uv(f, uv)
        r, g, b = pixels[int(v * h) % h, int(u * w) % w][:3]
        z = f.calc_center_median().z
        if r > b * 1.35 and r > g * 1.15:
            samples.append((z, 1))
        elif b > r * 1.1 and b > 0.08:
            samples.append((z, -1))
    best_z, best_err = None, 1e9
    zs = sorted(set(round(z, 3) for z, _ in samples))
    for cut in zs:
        err = sum(1 for z, k in samples if (k > 0 and z < cut) or (k < 0 and z >= cut))
        if err < best_err:
            best_err, best_z = err, cut
    return best_z


def straighten_arm(shoulder, elbow, hand, out_sign, upper_dir, fore_dir):
    ru = (elbow - shoulder).normalized().rotation_difference(Vector(upper_dir).normalized()).to_matrix()
    elbow2 = shoulder + ru @ (elbow - shoulder)
    hand2 = elbow2 + ru @ (hand - elbow)
    rf = (hand2 - elbow2).normalized().rotation_difference(Vector(fore_dir).normalized()).to_matrix()
    up = lambda p: shoulder + ru @ (p - shoulder)
    fore = lambda p: elbow2 + rf @ (up(p) - elbow2)
    return up, fore, elbow2


def region_bm(bm, keep):
    tmp = bm.copy()
    kill = [f for f, src in zip(tmp.faces, bm.faces) if src.index not in keep]
    bmesh.ops.delete(tmp, geom=kill, context='FACES')
    loose = [v for v in tmp.verts if not v.link_faces]
    bmesh.ops.delete(tmp, geom=loose, context='VERTS')
    return tmp


def face_neighbors(bm):
    out = {}
    for f in bm.faces:
        out[f.index] = {g.index for e in f.edges for g in e.link_faces if g is not f}
    return out


def smooth_labels(labels, neighbors, rounds=3):
    for _ in range(rounds):
        nxt = dict(labels)
        for i, ns in neighbors.items():
            tally = {}
            for n in ns:
                tally[labels[n]] = tally.get(labels[n], 0) + 1
            if tally:
                top = max(tally, key=tally.get)
                if top != labels[i] and tally[top] >= 2:
                    nxt[i] = top
        labels.update(nxt)


def grow(faces, neighbors, allowed, rings):
    out = set(faces)
    edge = set(faces)
    for _ in range(rings):
        nxt = set()
        for i in edge:
            for n in neighbors[i]:
                if n not in out and n in allowed:
                    nxt.add(n)
        out |= nxt
        edge = nxt
    return out


def anchor_piece(at):
    p = Piece()
    p.uv = [(0.0, 0.0)] * 3
    p.pos = [tuple(at)] * 3
    p.nor = [(0.0, 0.0, 1.0)] * 3
    p.col = [(1.0, 1.0, 1.0)] * 3
    p.tris = [(0, 1, 2)]
    return p


def load_prop(name, rotate):
    bm, image = import_meshy(meshy_source(name))
    if rotate:
        bmesh.ops.rotate(bm, verts=bm.verts[:], cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi, 3, 'Z'))
    return bm, image


def fit_hat(bm, head_top, head_center, head_width, lift, fit=1.0):
    zs = [v.co.z for v in bm.verts]
    z0, z1 = min(zs), max(zs)
    crown = [v.co for v in bm.verts if v.co.z > z0 + 0.55 * (z1 - z0)]
    cw = max(c.x for c in crown) - min(c.x for c in crown)
    s = head_width * 1.2 / cw * HUNTER_HAT_SCALE * fit
    bmesh.ops.scale(bm, vec=(s, s, s), verts=bm.verts[:])
    crown = [v.co for v in bm.verts if v.co.z > (z0 + 0.55 * (z1 - z0)) * s]
    cx = (max(c.x for c in crown) + min(c.x for c in crown)) / 2
    cy = (max(c.y for c in crown) + min(c.y for c in crown)) / 2
    top = max(v.co.z for v in bm.verts)
    bmesh.ops.translate(bm, vec=(head_center.x - cx, head_center.y - cy, head_top + lift - top), verts=bm.verts[:])


def fit_pack(bm, back_y, top_z):
    zs = [v.co.z for v in bm.verts]
    s = 0.46 / (max(zs) - min(zs))
    bmesh.ops.scale(bm, vec=(s, s, s), verts=bm.verts[:])
    xs = [v.co.x for v in bm.verts]
    contact = HUNTER_PACK_PANEL_Y * s
    bmesh.ops.translate(bm, vec=(-(min(xs) + max(xs)) / 2, back_y + 0.03 - contact, top_z - max(v.co.z for v in bm.verts)), verts=bm.verts[:])


def save_variant_texture(name, image, size):
    global FISH_TEXTURE_SIZE
    keep = FISH_TEXTURE_SIZE
    FISH_TEXTURE_SIZE = size
    save_texture(image, name)
    FISH_TEXTURE_SIZE = keep


def arm_skin_uvs(bm, labels, slot_of, B):
    uv = bm.loops.layers.uv.active
    wrist = {'L': B['RightHand'].z, 'R': B['LeftHand'].z}
    tris, hands = [], []
    for f in bm.faces:
        j = labels[f.index]
        if slot_of.get(f.index) != 'upper' or not (j.startswith('upperArm') or j.startswith('foreArm')):
            continue
        if j.startswith('foreArm') and f.calc_center_median().z < wrist[j[-1]] - 0.01:
            hands.append(face_uv(f, uv))
            continue
        loops = list(f.loops)
        for i in range(1, len(loops) - 1):
            tris.append([tuple(loops[0][uv].uv), tuple(loops[i][uv].uv), tuple(loops[i + 1][uv].uv)])
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


def save_skin_arms(name, image, size, arm_tris, hand_uvs):
    """The tank tops: Meshy keeps the jacket's sleeves in the paint, so the arm texels are repainted with the hands' skin tone, keeping the shading."""
    import numpy as np
    copy = image.copy()
    copy.scale(size, size)
    px = np.empty(size * size * 4, dtype=np.float32)
    copy.pixels.foreach_get(px)
    px = px.reshape(size, size, 4)
    samples = np.array([px[int(v * size) % size, int(u * size) % size, :3] for u, v in hand_uvs]) if hand_uvs else np.array([[0.62, 0.42, 0.32]])
    skin = np.median(samples, axis=0)
    mask = uv_mask(arm_tris, size)
    lum = px[..., :3] @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    mean = float(lum[mask].mean()) if mask.any() else 0.5
    detail = np.clip(lum / max(mean, 1e-3), 0.55, 1.35) ** 0.6
    tinted = np.clip(skin[None, None, :] * detail[..., None], 0, 1)
    px[..., :3] = np.where(mask[..., None], tinted, px[..., :3])
    copy.pixels.foreach_set(px.ravel())
    out = os.path.join(OUT, name + '.webp')
    scene = bpy.context.scene
    settings = scene.render.image_settings
    saved = (settings.file_format, settings.quality, settings.color_mode)
    settings.file_format = 'WEBP'
    settings.quality = 88
    settings.color_mode = 'RGB'
    copy.save_render(out, scene=scene)
    settings.file_format, settings.quality, settings.color_mode = saved
    bpy.data.images.remove(copy)
    print('skin arms', name, 'skin', [round(float(c), 3) for c in skin], 'texels', int(mask.sum()))


_procedural_hunter = build_hunter


def build_hunter():
    rig_path = meshy_source('hunter-rig')
    if not rig_path or not meshy_source('hunter-base'):
        return _procedural_hunter()
    bones, rverts, rpolys, fjoint = load_rig(rig_path)
    tree = BVHTree.FromPolygons(rverts, rpolys, epsilon=0.0)
    bm, base_image = import_meshy(meshy_source('hunter-base'))
    fit_to(bm, bounds(rverts))
    bm.faces.index_update()
    bm.faces.ensure_lookup_table()
    labels = {}
    for f in bm.faces:
        _, _, idx, _ = tree.find_nearest(f.calc_center_median())
        labels[f.index] = fjoint[idx] if idx is not None else 'torso'
    neighbors = face_neighbors(bm)
    smooth_labels(labels, neighbors)
    k = HUNTER_HIP / bones['Hips'].z
    frame = to_game_frame(k)
    bm.transform(frame)
    B = {n: frame @ p for n, p in bones.items()}
    bm.normal_update()
    n0 = bm.verts.layers.float_vector.new('n0')
    for v in bm.verts:
        v[n0] = v.normal
    hem_bm, hem_image = import_meshy(meshy_source(HUNTER_HEM_SOURCE))
    hem_bm.free()
    hem = find_hem(bm, labels, image_array(hem_image))
    collar = B['neck'].z + 0.035 * k
    slots = {}
    slot_of = {}
    for f in bm.faces:
        j = labels[f.index]
        z = f.calc_center_median().z
        if j == 'head':
            slot = 'face' if z >= collar else 'upper'
        elif j.startswith('shin'):
            slot = 'lower'
        elif j == 'hips' or j.startswith('thigh'):
            slot = 'upper' if z >= hem else 'lower'
            if slot == 'upper' and j != 'hips':
                # Jacket and vest hang from the hips: left on a thigh they would swing out with each step.
                j = 'hips'
                labels[f.index] = j
        else:
            slot = 'upper'
        slot_of[f.index] = slot
        slots.setdefault((j, slot), set()).add(f.index)
    by_slot = {}
    for i, s in slot_of.items():
        by_slot.setdefault(s, set()).add(i)
    slots = {key: grow(faces, neighbors, by_slot[key[1]], 2) for key, faces in slots.items()}
    pivots = {
        'hips': B['Hips'], 'torso': B['Spine02'], 'head': B['neck'],
        'upperArmL': B['RightArm'], 'upperArmR': B['LeftArm'], 'foreArmL': B['RightForeArm'], 'foreArmR': B['LeftForeArm'],
        'thighL': B['RightUpLeg'], 'thighR': B['LeftUpLeg'], 'shinL': B['RightLeg'], 'shinR': B['LeftLeg'],
    }
    arm_fix = {}
    for side, s, bone in (('L', 1, 'Right'), ('R', -1, 'Left')):
        up, fore, elbow = straighten_arm(B[bone + 'Arm'], B[bone + 'ForeArm'], B[bone + 'Hand'], s, (s * 0.15, -0.03, -1.0), (s * 0.08, 0.06, -1.0))
        arm_fix['upperArm' + side] = up
        arm_fix['foreArm' + side] = fore
        pivots['foreArm' + side] = elbow
    m = Model('hunter', ao_dist=0.2, ao_strength=0.3)
    m.bake = lambda model: None
    m.aliases = {}
    for joint, parent in JOINT_PARENT.items():
        if joint != 'head':
            m.add(joint, anchor_piece(pivots[joint]), pivot=tuple(pivots[joint]), material='tex:hunter-base', parent=parent)
    default_upper = 'jacket-camo+vest-blaze'
    for (joint, slot), faces in sorted(slots.items()):
        part = region_bm(bm, faces)
        if joint in arm_fix:
            fix = arm_fix[joint]
            layer = part.verts.layers.float_vector.get('n0')
            for v in part.verts:
                p = v.co.copy()
                v[layer] = (fix(p + Vector(v[layer])) - fix(p)).normalized()
                v.co = fix(p)
        piece = piece_from_textured(part)
        part.free()
        piv = tuple(pivots[joint])
        if slot == 'face':
            m.add('head', piece, pivot=piv, material='tex:hunter-base', parent='torso')
        elif slot == 'upper':
            src = joint + ':' + default_upper
            m.add(src, piece, pivot=piv, material='tex:hunter-base', parent=joint)
            for (jacket, vest), tex in HUNTER_COMBOS.items():
                name = joint + ':' + jacket + '+' + vest
                if name != src:
                    m.aliases[name] = (src, 'tex:' + tex, piv, joint)
        else:
            src = joint + ':pants-camo'
            m.add(src, piece, pivot=piv, material='tex:hunter-base', parent=joint)
            for pants, tex in HUNTER_PANTS.items():
                name = joint + ':' + pants
                if name != src:
                    m.aliases[name] = (src, 'tex:' + tex, piv, joint)
    face_set = slots.get(('head', 'face'), set())
    face_verts = [v.co.copy() for f in bm.faces if f.index in face_set for v in f.verts]
    head_top = max(c.z for c in face_verts)
    crown = [c for c in face_verts if c.z > head_top - 0.09]
    head_center = Vector((sum(c.x for c in crown) / len(crown), sum(c.y for c in crown) / len(crown), 0))
    band = [c for c in face_verts if head_top - 0.13 < c.z < head_top - 0.05]
    head_width = max(c.x for c in band) - min(c.x for c in band)
    for item, src in HUNTER_HATS.items():
        if not meshy_source(src):
            continue
        hb, img = load_prop(src, rotate=item not in HUNTER_HAT_BACKWARDS)
        fit_hat(hb, head_top, head_center, head_width, HUNTER_HAT_LIFT.get(item, 0.025) * HUNTER_HAT_SCALE, HUNTER_HAT_FIT.get(item, 1.0))
        if item in HUNTER_HAT_FORWARD:
            bmesh.ops.translate(hb, vec=(0, HUNTER_HAT_FORWARD[item], 0), verts=hb.verts[:])
        m.add('head:' + item, piece_from_textured(hb), pivot=tuple(pivots['head']), material='tex:' + src, parent='head')
        hb.free()
        if img is not None:
            save_variant_texture(src, img, HUNTER_PROP_TEXTURE)
    if meshy_source(HUNTER_PACK):
        torso_back = [v.co.y for f in bm.faces if labels[f.index] == 'torso' for v in f.verts if 1.1 < v.co.z < 1.35]
        pb, img = load_prop(HUNTER_PACK, rotate=False)
        fit_pack(pb, min(torso_back), pivots['upperArmL'].z + 0.02)
        m.add('torso:pack-hunting', piece_from_textured(pb), pivot=tuple(pivots['torso']), material='tex:' + HUNTER_PACK, parent='torso')
        pb.free()
        if img is not None:
            save_variant_texture(HUNTER_PACK, img, HUNTER_PROP_TEXTURE)
    arm_tris, hand_uvs = arm_skin_uvs(bm, labels, slot_of, B)
    bm.free()
    for tex in sorted(set(HUNTER_COMBOS.values()) | set(HUNTER_PANTS.values())):
        if not meshy_source(tex):
            continue
        tb, img = import_meshy(meshy_source(tex))
        tb.free()
        if img is not None and tex in HUNTER_SKIN_ARMS:
            save_skin_arms(tex, img, HUNTER_BODY_TEXTURE, arm_tris, hand_uvs)
        elif img is not None:
            save_variant_texture(tex, img, HUNTER_BODY_TEXTURE)
    write_model(m)
    print('hunter hem', round(hem, 3), 'collar', round(collar, 3), 'parts', len(m.parts), 'aliases', len(m.aliases))
