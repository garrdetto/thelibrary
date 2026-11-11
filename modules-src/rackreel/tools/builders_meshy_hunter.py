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
HUNTER_PANTS = {'pants-camo': 'hunter-base', 'pants-jeans': 'hunter-flannel-none-jeans', 'pants-waders': 'hunter-canvas-none-waders',
                'pants-blaze': 'hunter-blaze-full', 'pants-khaki': 'hunter-angler-khaki'}
HUNTER_HATS = {'cap-blaze': 'hunter-cap-blaze', 'cap-camo': 'hunter-cap-camo', 'cap-bucket': 'hunter-cap-bucket',
               'cap-backwards': 'hunter-cap-backwards', 'cap-cowboy': 'hunter-hat-cowboy', 'cap-visor': 'hunter-hat-visor'}
HUNTER_HAT_BACKWARDS = {'cap-backwards'}
HUNTER_PACK = 'hunter-pack'
HUNTER_PACK_PANEL_Y = 0.1
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
