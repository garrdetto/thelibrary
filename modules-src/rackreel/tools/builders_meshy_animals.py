ANIMAL_SPECS = {
    'deer': {'length': 1.95, 'tail': -0.8, 'neck': (0.69, 0.62), 'neck_normal': (0, 1.0, 0.7)},
    'bear': {'length': 2.04, 'tail': -0.83, 'neck': (0.8, 0.6), 'neck_normal': (0, 1.0, 0.15)},
}
ANTLER_WIDTH = 0.62


def orient_animal(bm, spec):
    ys = [v.co.y for v in bm.verts]
    length = max(ys) - min(ys)
    bmesh.ops.rotate(bm, verts=bm.verts[:], cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi, 3, 'Z'))
    s = spec['length'] / length
    bmesh.ops.scale(bm, vec=(s, s, s), verts=bm.verts[:])
    b = bounds([v.co for v in bm.verts])
    bmesh.ops.translate(bm, vec=(-(b[0][0] + b[0][1]) / 2, spec['tail'] - b[1][0], -b[2][0]), verts=bm.verts[:])


def leg_layout(bm):
    b = bounds([v.co for v in bm.verts])
    height = b[2][1] - b[2][0]
    low = [v.co.copy() for v in bm.verts if v.co.z < height * 0.2]
    mx = sorted(c.x for c in low)[len(low) // 2]
    my = sorted(c.y for c in low)[len(low) // 2]
    names = ('legFL', 'legFR', 'legBL', 'legBR')
    seeds = {n: Vector((mx + (0.1 if n[4] == 'L' else -0.1), my + (0.3 if n[3] == 'F' else -0.3), 0)) for n in names}
    for _ in range(12):
        buckets = {n: [] for n in names}
        for c in low:
            near = min(names, key=lambda n: (c.x - seeds[n].x) ** 2 + (c.y - seeds[n].y) ** 2)
            buckets[near].append(c)
        for n in names:
            if buckets[n]:
                seeds[n] = Vector((sum(c.x for c in buckets[n]) / len(buckets[n]), sum(c.y for c in buckets[n]) / len(buckets[n]), 0))
    legs = seeds
    front_y = (legs['legFL'].y + legs['legFR'].y) / 2
    back_y = (legs['legBL'].y + legs['legBR'].y) / 2
    mid_x = sum(l.x for l in legs.values()) / 4
    belly = [v.co.z for v in bm.verts if abs(v.co.x - mid_x) < 0.08 and back_y + 0.15 < v.co.y < front_y - 0.15 and v.co.z > height * 0.25]
    belly_z = min(belly) if belly else height * 0.4
    return legs, (front_y + back_y) / 2, belly_z


def animal_labels(bm, spec, legs, mid_y, cut_z):
    b = bounds([v.co for v in bm.verts])
    yf, zf = spec['neck']
    pivot = Vector((0, b[1][0] + yf * (b[1][1] - b[1][0]), b[2][0] + zf * (b[2][1] - b[2][0])))
    normal = Vector(spec['neck_normal']).normalized()
    labels = {}
    for f in bm.faces:
        c = f.calc_center_median()
        if c.z < cut_z:
            labels[f.index] = min(legs, key=lambda n: (c.x - legs[n].x) ** 2 + (c.y - legs[n].y) ** 2)
        elif (c - pivot).dot(normal) > 0:
            labels[f.index] = 'head'
        else:
            labels[f.index] = 'body'
    return labels, pivot


def leg_pivot(bm, labels, name, cut_z):
    pts = [v.co for f in bm.faces if labels[f.index] == name for v in f.verts if abs(v.co.z - cut_z) < 0.04]
    if not pts:
        pts = [v.co for f in bm.faces if labels[f.index] == name for v in f.verts]
    return Vector((sum(c.x for c in pts) / len(pts), sum(c.y for c in pts) / len(pts), cut_z))


def build_meshy_animal(name, fallback):
    src = meshy_source(name)
    if not src:
        return fallback()
    spec = ANIMAL_SPECS[name]
    bm, image = import_meshy(src)
    orient_animal(bm, spec)
    bm.faces.index_update()
    bm.normal_update()
    n0 = bm.verts.layers.float_vector.new('n0')
    for v in bm.verts:
        v[n0] = v.normal
    legs, mid_y, belly_z = leg_layout(bm)
    cut_z = belly_z - 0.03
    labels, head_pivot = animal_labels(bm, spec, legs, mid_y, cut_z)
    neighbors = face_neighbors(bm)
    smooth_labels(labels, neighbors, 2)
    everything = set(labels)
    groups = {}
    for i, lab in labels.items():
        groups.setdefault(lab, set()).add(i)
    pivots = {'body': (0, 0, 0), 'head': tuple(head_pivot)}
    for leg in ('legFL', 'legFR', 'legBL', 'legBR'):
        pivots[leg] = tuple(leg_pivot(bm, labels, leg, cut_z))
    tag = 'tex:' + name
    m = Model(name, ao_dist=0.3, ao_strength=0.3)
    m.bake = lambda model: None
    for part in ('body', 'head', 'legFL', 'legFR', 'legBL', 'legBR'):
        faces = grow(groups.get(part, set()), neighbors, everything, 0 if part == 'body' else 2)
        if not faces:
            continue
        region = region_bm(bm, faces)
        m.add(part, piece_from_textured(region), pivot=pivots[part], material=tag)
        region.free()
    b = bounds([v.co for v in bm.verts])
    midline = [v.co for f in bm.faces if labels[f.index] == 'head' for v in f.verts if abs(v.co.x) < 0.025]
    top = max(midline, key=lambda c: c.z).copy() if midline else Vector((0, 0.84, 1.6))
    b = [tuple(ax) for ax in b]
    bm.free()
    if image is not None:
        save_variant_texture(name, image, HUNTER_BODY_TEXTURE)
    write_model(m)
    print(name, 'bounds', [tuple(round(x, 3) for x in ax) for ax in b], 'belly', round(belly_z, 3), 'head pivot', tuple(round(x, 3) for x in head_pivot), 'skull top', tuple(round(x, 3) for x in top))
    return top


_procedural_deer = build_deer
_procedural_bear = build_bear
_procedural_antlers = build_antlers
DEER_SKULL_TOP = None


def build_deer():
    global DEER_SKULL_TOP
    DEER_SKULL_TOP = build_meshy_animal('deer', _procedural_deer)


def build_bear():
    build_meshy_animal('bear', _procedural_bear)


def build_antlers():
    src = meshy_source('antlers')
    if not src:
        return _procedural_antlers()
    base = DEER_SKULL_TOP or Vector((0, 0.84, 1.6))
    bm, image = import_meshy(src)
    bmesh.ops.rotate(bm, verts=bm.verts[:], cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi, 3, 'Z'))
    b = bounds([v.co for v in bm.verts])
    s = ANTLER_WIDTH / (b[0][1] - b[0][0])
    bmesh.ops.scale(bm, vec=(s, s, s), verts=bm.verts[:])
    b = bounds([v.co for v in bm.verts])
    low = [v.co for v in bm.verts if v.co.z < b[2][0] + 0.06 * (b[2][1] - b[2][0])]
    by = sum(c.y for c in low) / len(low)
    bmesh.ops.translate(bm, vec=(-(b[0][0] + b[0][1]) / 2, base.y - by, base.z - 0.02 - b[2][0]), verts=bm.verts[:])
    bm.normal_update()
    m = Model('antlers', ground=False, ao_dist=0.1, ao_strength=0.2)
    m.bake = lambda model: None
    m.add('antlers', piece_from_textured(bm), pivot=(0, 0.55, 1.1), material='tex:antlers')
    bm.free()
    if image is not None:
        save_variant_texture('antlers', image, HUNTER_PROP_TEXTURE)
    write_model(m)
    print('antler base', tuple(round(x, 3) for x in base))
