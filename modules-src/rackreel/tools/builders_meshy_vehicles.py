VEHICLE_SPECS = {
    'utv': {'height': 2.05, 'wheels': True},
    'quad': {'length': 2.3, 'wheels': True},
    'boat': {'length': 6.42, 'rear': -3.38, 'wheels': False},
}
VEHICLE_TEXTURE = 2048
VEHICLE_INFO = {}


def orient_vehicle(bm, spec):
    bmesh.ops.rotate(bm, verts=bm.verts[:], cent=(0, 0, 0), matrix=Matrix.Rotation(-math.pi / 2, 3, 'Z'))
    b = bounds([v.co for v in bm.verts])
    s = spec['height'] / (b[2][1] - b[2][0]) if 'height' in spec else spec['length'] / (b[1][1] - b[1][0])
    bmesh.ops.scale(bm, vec=(s, s, s), verts=bm.verts[:])
    b = bounds([v.co for v in bm.verts])
    rear = spec.get('rear', -(b[1][1] - b[1][0]) / 2)
    bmesh.ops.translate(bm, vec=(-(b[0][0] + b[0][1]) / 2, rear - b[1][0], -b[2][0]), verts=bm.verts[:])


def find_wheels(bm):
    b = bounds([v.co for v in bm.verts])
    half = (b[0][1] - b[0][0]) / 2
    low = [v.co.copy() for v in bm.verts if v.co.z < 0.25 and abs(v.co.x) > half * 0.45]
    my = sorted(c.y for c in low)[len(low) // 2]
    names = ('wheelFL', 'wheelFR', 'wheelBL', 'wheelBR')
    seeds = {n: Vector((half * 0.8 * (1 if n[6] == 'L' else -1), my + (0.9 if n[5] == 'F' else -0.9), 0)) for n in names}
    for _ in range(12):
        buckets = {n: [] for n in names}
        for c in low:
            buckets[min(names, key=lambda n: (c.x - seeds[n].x) ** 2 + (c.y - seeds[n].y) ** 2)].append(c)
        for n in names:
            if buckets[n]:
                seeds[n] = Vector((sum(c.x for c in buckets[n]) / len(buckets[n]), sum(c.y for c in buckets[n]) / len(buckets[n]), 0))
    wheels = {}
    for n in names:
        c = seeds[n]
        outer = [v.co for v in bm.verts if abs(v.co.y - c.y) < 0.6 and (v.co.x > 0) == (c.x > 0) and abs(v.co.x) > abs(c.x) - 0.05 and v.co.z < 0.9]
        tread = [v for v in outer if abs(v.y - c.y) < 0.06]
        radius = max(v.z for v in tread) / 2 if tread else 0.35
        ys = [v.y for v in outer if v.z < 0.05]
        cy = (min(ys) + max(ys)) / 2 if ys else c.y
        wheels[n] = (Vector((c.x, cy, radius)), radius)
    return wheels


def wheel_faces(bm, wheels):
    labels = {}
    for f in bm.faces:
        cen = f.calc_center_median()
        labels[f.index] = 'body'
        for n, (p, r) in wheels.items():
            if (cen.x > 0) != (p.x > 0):
                continue
            if abs(cen.x) < abs(p.x) - r * 0.75:
                continue
            if (cen.y - p.y) ** 2 + (cen.z - p.z) ** 2 < (r * 1.04) ** 2:
                labels[f.index] = n
                break
    return labels


def motor_faces(bm):
    hull = [v.co for v in bm.verts if abs(v.co.x) > 0.6]
    transom = min(c.y for c in hull)
    labels = {}
    top = max((v.co.z for v in bm.verts if 0.6 < abs(v.co.x) < 1.0 and transom < v.co.y < transom + 0.3), default=0.7)
    for f in bm.faces:
        c = f.calc_center_median()
        labels[f.index] = 'motor' if c.y < transom - 0.01 and abs(c.x) < 0.45 else 'hull'
    return labels, Vector((0, transom - 0.08, top))


def build_meshy_vehicle(name, fallback):
    src = meshy_source(name)
    if not src:
        return fallback()
    spec = VEHICLE_SPECS[name]
    bm, image = import_meshy(src)
    orient_vehicle(bm, spec)
    if not spec['wheels']:
        hull = [v.co.z for v in bm.verts if v.co.y > spec['rear'] + 0.9]
        bmesh.ops.translate(bm, vec=(0, 0, -min(hull)), verts=bm.verts[:])
    bm.faces.index_update()
    bm.normal_update()
    n0 = bm.verts.layers.float_vector.new('n0')
    for v in bm.verts:
        v[n0] = v.normal
    tag = 'tex:' + name
    m = Model(name, ao_dist=0.3, ao_strength=0.3)
    m.bake = lambda model: None
    info = {}
    if spec['wheels']:
        wheels = find_wheels(bm)
        labels = wheel_faces(bm, wheels)
        groups = {}
        for i, lab in labels.items():
            groups.setdefault(lab, set()).add(i)
        region = region_bm(bm, groups['body'])
        m.add('body', piece_from_textured(region), material=tag)
        region.free()
        for n, (p, r) in wheels.items():
            if n not in groups:
                continue
            region = region_bm(bm, groups[n])
            m.add(n, piece_from_textured(region), pivot=tuple(p), material=tag)
            region.free()
            info[n] = (tuple(round(x, 3) for x in p), round(r, 3), len(groups[n]))
    else:
        labels, pivot = motor_faces(bm)
        groups = {}
        for i, lab in labels.items():
            groups.setdefault(lab, set()).add(i)
        region = region_bm(bm, groups['hull'])
        m.add('hull', piece_from_textured(region), material=tag)
        region.free()
        region = region_bm(bm, groups['motor'])
        m.add('motor', piece_from_textured(region), pivot=tuple(pivot), material=tag)
        region.free()
        info['motor'] = (tuple(round(x, 3) for x in pivot), len(groups['motor']))
    b = bounds([v.co for v in bm.verts])
    bm.free()
    if image is not None:
        if spec.get('lift'):
            import numpy as np
            px = np.empty(image.size[0] * image.size[1] * 4, dtype=np.float32)
            image.pixels.foreach_get(px)
            px = px.reshape(-1, 4)
            px[:, :3] = np.clip(px[:, :3], 0, 1) ** spec['lift']
            image.pixels.foreach_set(px.ravel())
        save_variant_texture(name, image, VEHICLE_TEXTURE)
    write_model(m)
    VEHICLE_INFO[name] = info
    print(name, 'bounds', [tuple(round(x, 3) for x in ax) for ax in b], info)


_procedural_utv = build_utv
_procedural_quad = build_quad
_procedural_boat = build_boat


def build_utv():
    build_meshy_vehicle('utv', _procedural_utv)


def build_quad():
    build_meshy_vehicle('quad', _procedural_quad)


def build_boat():
    build_meshy_vehicle('boat', _procedural_boat)
