from mathutils import Euler, Quaternion


def ell(co, a, b, c, rot=None, stiff=None):
    q = None
    if rot is not None:
        q = Euler(rot, 'XYZ').to_quaternion()
    return (co, 1.0, (a, b, c), stiff, q)


def bark(co, n):
    v = n3(Vector((co.x * 3, co.y * 3, co.z * 0.6)), 6) * 0.5 + 0.5
    ridge = abs(math.sin(math.atan2(co.y, co.x) * 9 + n3(co, 2) * 3))
    return mix((0.17, 0.13, 0.1), (0.36, 0.29, 0.22), v * 0.6 + ridge * 0.4)


ATLAS = [(0.0, 0.0, 0.5, 0.5), (0.5, 0.0, 1.0, 0.5), (0.0, 0.5, 0.5, 1.0), (0.5, 0.5, 1.0, 1.0)]


def card(center, right, up, w, h, rect, normal_from, shade=1.0, anchor_bottom=False):
    p = Piece()
    c = Vector(center)
    r = Vector(right).normalized() * (w / 2)
    u = Vector(up).normalized() * h
    base = c - u * (0.0 if anchor_bottom else 0.5)
    corners = [base - r, base + r, base + r + u, base - r + u]
    u0, v0, u1, v1 = rect
    p.uv = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
    for q in corners:
        n = (q - Vector(normal_from))
        n = n.normalized() if n.length > 1e-5 else Vector((0, 0, 1))
        n = (n * 0.75 + Vector((0, 0, 0.35))).normalized()
        p.pos.append(tuple(q))
        p.nor.append(tuple(n))
        p.col.append((shade, shade, shade))
    p.tris = [(0, 1, 2), (0, 2, 3)]
    return p


def build_pine():
    m = Model('pine', ao_dist=3.0, ao_strength=0.55)
    r = random.Random(11)
    trunk = tube([(0, 0, -0.3), (0.03, 0.02, 4.0), (-0.02, 0.04, 9.0), (0.02, 0.0, 15.2)], [0.3, 0.24, 0.15, 0.03], 9)
    m.add('trunk', piece_from_bm(trunk, bark))
    for z in [1.6, 2.1, 2.7]:
        for k in range(3):
            ang = r.random() * math.tau
            d = Vector((math.cos(ang), math.sin(ang), 0))
            L = r.uniform(0.6, 1.2)
            m.add('trunk', piece_from_bm(tube([(d.x * 0.15, d.y * 0.15, z), (d.x * L, d.y * L, z - 0.15)], [0.035, 0.01], 4), lambda co, n: (0.25, 0.22, 0.18)))
    whorls = 18
    golden = 2.39996
    i_branch = 0
    for w in range(whorls):
        t = w / (whorls - 1)
        z = lerp(3.0, 14.4, t) + r.uniform(-0.15, 0.15)
        count = 5 if t < 0.85 else 4
        for k in range(count):
            i_branch += 1
            ang = i_branch * golden + r.uniform(-0.25, 0.25)
            d = Vector((math.cos(ang), math.sin(ang), 0))
            L = (1 - t) ** 0.85 * 3.3 + 0.55
            droop = -0.18 - 0.25 * (1 - t)
            mid = Vector((d.x * L * 0.55, d.y * L * 0.55, z + droop * L * 0.3))
            side = Vector((-d.y, d.x, 0))
            shade = 0.72 + 0.28 * t + r.uniform(-0.08, 0.08)
            rect = ATLAS[r.randrange(4)]
            along = (d * L + Vector((0, 0, droop * L))).normalized()
            m.add('crown', card(mid, side, along, L * 0.62, L * 1.05, rect, (0, 0, z - 1.2), shade), material='needles')
            tilt = (side * 0.55 + Vector((0, 0, 0.84))).normalized()
            m.add('crown', card(mid + Vector((0, 0, 0.05)), tilt, along, L * 0.5, L * 1.0, ATLAS[r.randrange(4)], (0, 0, z - 1.2), shade * 0.95), material='needles')
            tilt2 = (side * -0.55 + Vector((0, 0, 0.84))).normalized()
            m.add('crown', card(mid - Vector((0, 0, 0.05)), tilt2, along, L * 0.5, L * 1.0, ATLAS[r.randrange(4)], (0, 0, z - 1.2), shade * 0.9), material='needles')
    for k in range(3):
        ang = k * math.tau / 3
        side = Vector((math.cos(ang), math.sin(ang), 0))
        m.add('crown', card((0, 0, 14.6), side, (0, 0, 1), 0.9, 1.6, ATLAS[k], (0, 0, 13.5), 1.0, anchor_bottom=True), material='needles')
    write_model(m)


def leafy_crown(m, r, clumps, count, size, material, center, shade_lo=0.75):
    for i in range(count):
        c, rad = clumps[r.randrange(len(clumps))]
        v = Vector((r.gauss(0, 1), r.gauss(0, 1), r.gauss(0, 0.8)))
        v = v.normalized() * rad * (r.random() ** 0.4)
        pos = Vector(c) + v
        ang = r.random() * math.tau
        side = Vector((math.cos(ang), math.sin(ang), r.uniform(-0.3, 0.3)))
        upv = Vector((-side.y * r.uniform(-0.6, 0.6), side.x * r.uniform(-0.6, 0.6), 1.0))
        upv = (upv - side * upv.dot(side.normalized())).normalized()
        outward = (pos - Vector(center))
        shade = lerp(shade_lo, 1.0, max(0.0, min(1.0, outward.z / (rad + 0.1) * 0.5 + 0.5)))
        s = size * r.uniform(0.75, 1.2)
        m.add('crown', card(pos, side, upv, s, s, ATLAS[r.randrange(4)], center, shade), material=material)


def build_hardwood():
    m = Model('hardwood', ao_dist=2.5, ao_strength=0.5)
    r = random.Random(23)
    m.add('trunk', piece_from_bm(tube([(0, 0, -0.3), (0.08, 0, 2.2), (0.05, 0.08, 4.4)], [0.38, 0.3, 0.24], 9), bark))
    limbs = []
    for k in range(5):
        ang = k * math.tau / 5 + r.uniform(-0.3, 0.3)
        d = Vector((math.cos(ang), math.sin(ang), 0))
        start = Vector((0.05, 0.05, 4.0 + k * 0.35))
        tip = start + d * r.uniform(2.0, 2.8) + Vector((0, 0, r.uniform(2.6, 4.2)))
        mid = (start + tip) / 2 + d * 0.35
        m.add('trunk', piece_from_bm(tube([start, mid, tip], [0.17, 0.1, 0.035], 6), bark))
        limbs.append((tip, 1.7))
        for j in range(2):
            a2 = ang + r.uniform(-0.9, 0.9)
            d2 = Vector((math.cos(a2), math.sin(a2), 0))
            s2 = mid
            t2 = s2 + d2 * r.uniform(1.0, 1.6) + Vector((0, 0, r.uniform(0.8, 1.6)))
            m.add('trunk', piece_from_bm(tube([s2, t2], [0.06, 0.015], 4), bark))
            limbs.append((t2, 1.2))
    limbs.append((Vector((0, 0, 9.3)), 2.0))
    leafy_crown(m, r, limbs, 210, 1.55, 'leaves', (0, 0, 7.0))
    write_model(m)


def build_birch():
    m = Model('birch', ao_dist=2.0, ao_strength=0.5)
    r = random.Random(31)
    def birch_bark(co, n):
        mark = n3(Vector((co.x * 3, co.y * 3, co.z * 11)), 1.0)
        base = mix((0.9, 0.89, 0.85), (0.75, 0.73, 0.68), n3(co, 5) * 0.5 + 0.5)
        if co.z < 0.6:
            base = mix((0.2, 0.18, 0.15), base, co.z / 0.6)
        return (0.1, 0.09, 0.08) if mark > 0.38 else base
    stems = [[(0, 0, -0.2), (0.15, 0.05, 3.0), (0.05, 0.12, 6.5), (0.3, 0.05, 10.2)], [(0.1, 0.05, -0.2), (0.5, 0.1, 2.5), (0.9, 0.3, 6.0), (1.3, 0.4, 9.0)]]
    tips = []
    for stem in stems:
        m.add('trunk', piece_from_bm(tube(stem, [0.17, 0.14, 0.1, 0.03], 8), birch_bark))
        for k in range(4):
            i = 1 + k % 2
            a = Vector(stem[i])
            ang = r.random() * math.tau
            tip = a + Vector((math.cos(ang) * 1.3, math.sin(ang) * 1.3, r.uniform(1.0, 2.4)))
            m.add('trunk', piece_from_bm(tube([a, tip], [0.05, 0.012], 4), lambda co, n: (0.28, 0.24, 0.2)))
            tips.append((tip, 1.1))
        tips.append((Vector(stem[-1]), 1.4))
    leafy_crown(m, r, tips, 140, 1.15, 'birchleaves', (0.5, 0.2, 7.5))
    write_model(m)


def deer_coat(co, n):
    hair = n3(Vector((co.x * 40, co.y * 6, co.z * 40)), 1.0) * 0.04
    back = smooth01(0.2, 0.95, n.z) * smooth01(0.14, 0.0, abs(co.x))
    c = mix((0.5, 0.41, 0.31), (0.44, 0.37, 0.29), smooth01(0.6, 1.2, co.z))
    c = mix(c, (0.3, 0.25, 0.2), back * 0.75)
    belly = smooth01(-0.25, -0.75, n.z)
    c = mix(c, (0.9, 0.87, 0.82), belly)
    if co.y < -0.55 and n.z < 0.2 and abs(co.x) < 0.12:
        c = mix(c, (0.92, 0.9, 0.86), 0.8)
    return (c[0] + hair, c[1] + hair, c[2] + hair)


def build_deer():
    m = Model('deer', ao_dist=0.45, ao_strength=0.7)
    body = metaball([
        ell((0, 0.4, 0.98), 0.17, 0.3, 0.25),
        ell((0, 0.02, 0.95), 0.18, 0.38, 0.22),
        ell((0, -0.32, 0.99), 0.16, 0.26, 0.19),
        ell((0.085, -0.5, 0.98), 0.11, 0.2, 0.22),
        ell((-0.085, -0.5, 0.98), 0.11, 0.2, 0.22),
        ell((0, -0.6, 1.06), 0.13, 0.13, 0.12),
        ell((0, 0.44, 1.17), 0.09, 0.2, 0.1),
        ell((0.115, 0.42, 0.96), 0.07, 0.15, 0.19),
        ell((-0.115, 0.42, 0.96), 0.07, 0.15, 0.19),
        ell((0, 0.58, 0.86), 0.11, 0.12, 0.13),
        ell((0, -0.1, 0.8), 0.13, 0.25, 0.08),
    ], 0.018, decimate=0.28)
    m.add('body', piece_from_bm(body, deer_coat))
    tail = metaball([ell((0, -0.73, 1.06), 0.05, 0.06, 0.11, rot=(0.5, 0, 0))], 0.012, decimate=0.5)
    m.add('body', piece_from_bm(tail, lambda co, n: (0.36, 0.25, 0.16) if n.y < -0.2 and n.z > 0 else (0.93, 0.91, 0.87)))
    head = metaball([
        ell((0, 0.58, 1.12), 0.125, 0.17, 0.21, rot=(-0.7, 0, 0)),
        ell((0, 0.68, 1.28), 0.105, 0.14, 0.18, rot=(-0.6, 0, 0)),
        ell((0, 0.76, 1.42), 0.085, 0.11, 0.13, rot=(-0.45, 0, 0)),
        ell((0, 0.84, 1.53), 0.08, 0.115, 0.09),
        ell((0, 0.99, 1.495), 0.054, 0.125, 0.06, rot=(0.25, 0, 0)),
        ell((0, 1.1, 1.465), 0.038, 0.045, 0.038),
        ell((0, 0.93, 1.455), 0.052, 0.09, 0.036, rot=(0.2, 0, 0)),
    ], 0.012, decimate=0.3)
    def head_col(co, n):
        c = deer_coat(co, n)
        c = mix(c, (0.46, 0.35, 0.24), 0.5)
        if co.y > 1.12:
            return (0.05, 0.045, 0.045)
        if co.y > 1.04 and co.z < 1.49:
            return (0.88, 0.86, 0.82)
        if 1.05 < co.y < 1.1 and co.z > 1.49:
            return mix(c, (0.2, 0.15, 0.1), 0.6)
        if co.z < 1.36 and co.y > 0.66 and n.y > 0.25 and n.z < 0.3:
            return (0.92, 0.9, 0.86)
        return c
    m.add('head', piece_from_bm(head, head_col), pivot=(0, 0.55, 1.1))
    for side in (-1, 1):
        ear = sphere(0.1, 12, 8, at=(0, 0, 0), scale=(0.35, 0.18, 1.0))
        for v in ear.verts:
            if v.co.y < 0:
                v.co.y *= 0.3
            v.co.y -= (abs(v.co.x) * 0.9) ** 2
        rot = Matrix.Rotation(side * 0.9, 4, 'Y') @ Matrix.Rotation(0.25, 4, 'X')
        bmesh.ops.transform(ear, matrix=Matrix.Translation((side * 0.11, 0.81, 1.64)) @ rot, verts=ear.verts)
        m.add('head', piece_from_bm(ear, lambda co, n, s=side: (0.88, 0.82, 0.76) if n.y > 0.4 else (0.38, 0.29, 0.2)), pivot=(0, 0.55, 1.1))
        eye = sphere(0.022, 10, 8, at=(side * 0.07, 0.92, 1.555))
        m.add('head', piece_from_bm(eye, lambda co, n: (0.02, 0.015, 0.015)), pivot=(0, 0.55, 1.1))
        ring = sphere(0.03, 10, 6, at=(side * 0.064, 0.918, 1.555), scale=(0.6, 1.0, 1.0))
        m.add('head', piece_from_bm(ring, lambda co, n: (0.9, 0.88, 0.84)), pivot=(0, 0.55, 1.1))
    legs = {'legFL': (0.1, 0.43, True), 'legFR': (-0.1, 0.43, True), 'legBL': (0.1, -0.47, False), 'legBR': (-0.1, -0.47, False)}
    for name, (x, y, front) in legs.items():
        if front:
            els = [ell((x, y, 0.86), 0.075, 0.1, 0.2), ell((x, y + 0.005, 0.66), 0.052, 0.065, 0.12), ell((x, y + 0.01, 0.53), 0.034, 0.04, 0.045), ell((x, y + 0.01, 0.34), 0.026, 0.032, 0.17), ell((x, y + 0.02, 0.13), 0.028, 0.034, 0.035), ell((x, y + 0.045, 0.045), 0.03, 0.05, 0.04, rot=(-0.4, 0, 0))]
        else:
            els = [ell((x, y, 0.86), 0.095, 0.16, 0.2), ell((x, y - 0.08, 0.6), 0.058, 0.075, 0.13, rot=(0.35, 0, 0)), ell((x, y - 0.13, 0.46), 0.03, 0.045, 0.04), ell((x, y - 0.11, 0.28), 0.024, 0.03, 0.17), ell((x, y - 0.08, 0.11), 0.028, 0.034, 0.035), ell((x, y - 0.055, 0.04), 0.03, 0.05, 0.04, rot=(-0.4, 0, 0))]
        bm = metaball(els, 0.011, decimate=0.32)
        def leg_col(co, n, front=front):
            if co.z < 0.075:
                return (0.06, 0.055, 0.05)
            c = mix((0.62, 0.5, 0.37), (0.47, 0.36, 0.25), smooth01(0.25, 0.8, co.z))
            if n.y > 0.5 and co.z < 0.5:
                c = mix(c, (0.35, 0.26, 0.18), 0.5)
            if n.y < -0.3 and co.z < 0.6 and front:
                c = mix(c, (0.85, 0.82, 0.76), 0.5)
            return c
        m.add(name, piece_from_bm(bm, leg_col), pivot=(x, y, 0.95))
    write_model(m)


def build_antlers():
    m = Model('antlers', ground=False, ao_dist=0.15, ao_strength=0.35)
    def col(co, n):
        tip = smooth01(1.68, 2.03, co.z)
        grain = n3(Vector((co.x * 60, co.y * 60, co.z * 60)), 1.0) * 0.05
        c = mix((0.36, 0.29, 0.2), (0.9, 0.85, 0.74), tip)
        return (c[0] + grain, c[1] + grain, c[2] + grain)
    piv = (0, 0.55, 1.1)
    for side in (-1, 1):
        beam = []
        for i in range(12):
            t = i / 11
            ang = t * 2.3
            beam.append((side * (0.07 + 0.3 * math.sin(ang * 0.72)), 0.82 + 0.36 * math.sin(ang) + 0.01, 1.61 + 0.3 * math.sin(t * 2.5) + 0.05 * t))
        m.add('antlers', piece_from_bm(tube(beam, [0.034 - 0.026 * (i / 11) for i in range(12)], 8), col), pivot=piv)
        burr = sphere(0.04, 10, 6, at=beam[0], scale=(1, 1, 0.5))
        m.add('antlers', piece_from_bm(burr, lambda co, n: (0.3, 0.24, 0.17)), pivot=piv)
        b1 = beam[1]
        m.add('antlers', piece_from_bm(tube([b1, (b1[0] + side * 0.015, b1[1] + 0.05, b1[2] + 0.08), (b1[0] + side * 0.02, b1[1] + 0.07, b1[2] + 0.15)], [0.016, 0.011, 0.004], 6), col), pivot=piv)
        for k, i in enumerate((3, 6, 9)):
            b = beam[i]
            h = 0.3 - k * 0.06
            tine = [b, (b[0] - side * 0.005, b[1] + 0.015, b[2] + h * 0.45), (b[0] - side * 0.02, b[1] + 0.04, b[2] + h * 0.8), (b[0] - side * 0.03, b[1] + 0.06, b[2] + h)]
            m.add('antlers', piece_from_bm(tube(tine, [0.019, 0.014, 0.009, 0.003], 6), col), pivot=piv)
    write_model(m)


def bear_fur(co, n):
    g = n3(Vector((co.x * 30, co.y * 30, co.z * 30)), 1.0) * 0.5 + 0.5
    tip = max(0.0, n.z) * 0.06
    c = mix((0.035, 0.03, 0.028), (0.1, 0.085, 0.07), g)
    return (c[0] + tip, c[1] + tip * 0.8, c[2] + tip * 0.6)


def build_bear():
    m = Model('bear', ao_dist=0.55, ao_strength=0.7)
    body = metaball([
        ell((0, 0.28, 0.86), 0.32, 0.42, 0.36),
        ell((0, -0.25, 0.86), 0.33, 0.45, 0.37),
        ell((0, 0.42, 1.08), 0.2, 0.22, 0.16),
        ell((0, -0.58, 0.88), 0.25, 0.22, 0.28),
        ell((0.18, 0.4, 0.78), 0.12, 0.2, 0.26),
        ell((-0.18, 0.4, 0.78), 0.12, 0.2, 0.26),
    ], 0.025, decimate=0.28)
    for v in body.verts:
        d = n3(Vector((v.co.x * 14, v.co.y * 14, v.co.z * 14)), 1.0) * 0.02
        v.co += v.normal * d
    m.add('body', piece_from_bm(body, bear_fur))
    head = metaball([
        ell((0, 0.72, 1.0), 0.19, 0.2, 0.2),
        ell((0, 0.88, 1.03), 0.17, 0.17, 0.16),
        ell((0, 1.05, 0.98), 0.085, 0.14, 0.08, rot=(0.15, 0, 0)),
        ell((0, 1.16, 0.97), 0.05, 0.04, 0.045),
    ], 0.015, decimate=0.32)
    def head_col(co, n):
        if co.y > 1.16:
            return (0.02, 0.02, 0.02)
        if co.y > 0.99:
            return mix((0.48, 0.36, 0.24), (0.34, 0.25, 0.16), smooth01(0.95, 1.05, co.z))
        return bear_fur(co, n)
    m.add('head', piece_from_bm(head, head_col), pivot=(0, 0.68, 1.0))
    for side in (-1, 1):
        ear = sphere(0.065, 10, 8, at=(side * 0.13, 0.84, 1.2), scale=(1, 0.55, 1))
        m.add('head', piece_from_bm(ear, bear_fur), pivot=(0, 0.68, 1.0))
        m.add('head', piece_from_bm(sphere(0.018, 8, 6, at=(side * 0.075, 1.0, 1.08)), lambda co, n: (0.01, 0.01, 0.01)), pivot=(0, 0.68, 1.0))
    for name, (x, y, front) in {'legFL': (0.2, 0.42, True), 'legFR': (-0.2, 0.42, True), 'legBL': (0.21, -0.5, False), 'legBR': (-0.21, -0.5, False)}.items():
        els = [ell((x, y, 0.65), 0.12, 0.14, 0.22), ell((x, y + 0.01, 0.34), 0.095, 0.1, 0.18), ell((x, y + 0.06, 0.07), 0.1, 0.15, 0.07)]
        if not front:
            els[0] = ell((x, y - 0.02, 0.66), 0.14, 0.19, 0.24)
        bm = metaball(els, 0.016, decimate=0.32)
        m.add(name, piece_from_bm(bm, lambda co, n: (0.55, 0.5, 0.42) if co.z < 0.04 and n.y > 0.5 else bear_fur(co, n)), pivot=(x, y, 0.85))
        for c in range(4):
            cx = x + (c - 1.5) * 0.035
            m.add(name, piece_from_bm(tube([(cx, y + 0.17, 0.05), (cx, y + 0.21, 0.03), (cx, y + 0.22, 0.0)], [0.009, 0.006, 0.002], 4), lambda co, n: (0.7, 0.66, 0.58)), pivot=(x, y, 0.85))
    write_model(m)


FISH = {
    'muskie': {'depth': 0.078, 'width': 0.047, 'snout': 0.42, 'flat': 0.55, 'dorsal': (-0.18, -0.34), 'spiny': None, 'fork': 0.35, 'base': (0.68, 0.66, 0.5), 'back': (0.33, 0.36, 0.26), 'belly': (0.92, 0.9, 0.84), 'pattern': 'bars', 'fins': (0.62, 0.36, 0.2), 'eye': (0.75, 0.62, 0.25)},
    'pike': {'depth': 0.076, 'width': 0.046, 'snout': 0.42, 'flat': 0.6, 'dorsal': (-0.2, -0.34), 'spiny': None, 'fork': 0.25, 'base': (0.33, 0.43, 0.22), 'back': (0.14, 0.2, 0.1), 'belly': (0.92, 0.9, 0.8), 'pattern': 'spots', 'fins': (0.48, 0.38, 0.2), 'eye': (0.8, 0.65, 0.2)},
    'walleye': {'depth': 0.1, 'width': 0.056, 'snout': 0.3, 'flat': 0.2, 'dorsal': (-0.06, -0.3), 'spiny': (0.22, -0.02), 'fork': 0.45, 'base': (0.68, 0.6, 0.32), 'back': (0.35, 0.33, 0.17), 'belly': (0.93, 0.92, 0.86), 'pattern': 'mottle', 'fins': (0.5, 0.45, 0.3), 'eye': (0.85, 0.85, 0.8)},
    'smallmouth': {'depth': 0.145, 'width': 0.068, 'snout': 0.25, 'flat': 0.1, 'dorsal': (-0.02, -0.3), 'spiny': (0.25, 0.0), 'fork': 0.25, 'base': (0.55, 0.45, 0.25), 'back': (0.3, 0.27, 0.14), 'belly': (0.86, 0.82, 0.68), 'pattern': 'vbars', 'fins': (0.45, 0.36, 0.2), 'eye': (0.75, 0.15, 0.08)},
    'perch': {'depth': 0.13, 'width': 0.062, 'snout': 0.24, 'flat': 0.1, 'dorsal': (-0.02, -0.28), 'spiny': (0.26, 0.0), 'fork': 0.4, 'base': (0.82, 0.74, 0.3), 'back': (0.36, 0.38, 0.14), 'belly': (0.95, 0.93, 0.82), 'pattern': 'perchbars', 'fins': (0.9, 0.45, 0.12), 'eye': (0.8, 0.7, 0.3)},
}


def fish_profile(spec, t):
    head = spec['snout']
    if t > 1 - head:
        k = (t - (1 - head)) / head
        h = max(0.0, math.cos(k * math.pi / 2)) ** (0.6 + spec["flat"])
        w = max(0.0, math.cos(k * math.pi / 2)) ** (0.5 + spec["flat"] * 0.5)
    else:
        k = t / (1 - head)
        h = 0.32 + 0.68 * math.sin(k * math.pi / 2) ** 0.9
        w = 0.35 + 0.65 * math.sin(k * math.pi / 2) ** 0.9
    return h * spec['depth'], w * spec['width']


def build_fish(kind, spec):
    m = Model('fish-' + kind, ground=False, ao_dist=0.08, ao_strength=0.4)
    stations, ring = 44, 22
    bm = new_bm()
    grid = []
    for i in range(stations + 1):
        t = i / stations
        y = -0.42 + t * 0.92
        h, w = fish_profile(spec, t)
        h = max(h, 0.004)
        w = max(w, 0.003)
        sag = -h * 0.12
        row = []
        for k in range(ring):
            a = k / ring * math.tau
            x = math.sin(a) * w
            z = math.cos(a) * h + sag
            if math.cos(a) < 0:
                z = math.cos(a) * h * 1.05 + sag
            row.append(bm.verts.new((x, y, z)))
        grid.append(row)
    for i in range(stations):
        for k in range(ring):
            k2 = (k + 1) % ring
            bm.faces.new((grid[i][k], grid[i][k2], grid[i + 1][k2], grid[i + 1][k]))
    bm.faces.new(grid[0][::-1])
    tip = bm.verts.new((0, 0.505, -0.002))
    for k in range(ring):
        bm.faces.new((grid[-1][k], grid[-1][(k + 1) % ring], tip))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    head_start = 0.5 - spec['snout'] * 0.92
    def col(co, n):
        top = smooth01(-0.2, 0.75, n.z)
        c = mix(spec['base'], spec['back'], top)
        p = spec['pattern']
        side = n.z > -0.35
        if p == 'bars' and side and co.y < head_start:
            if n3(Vector((co.y * 22, co.z * 30, 3)), 1.0) > 0.12 or math.sin(co.y * 55 + co.z * 20) > 0.55:
                c = mix(c, (0.22, 0.24, 0.16), 0.55)
        elif p == 'spots' and side and co.y < head_start:
            sp = n3(Vector((co.y * 32, co.z * 52, 0)), 1.0)
            if sp > 0.28:
                c = mix(c, (0.86, 0.84, 0.6), 0.8)
        elif p == 'mottle' and side:
            if n3(Vector((co.y * 18, co.z * 26, 1)), 1.0) > 0.15:
                c = mix(c, (0.24, 0.21, 0.1), 0.55)
            if co.y < -0.15 and math.sin(co.y * 30) > 0.6 and n.z > 0.3:
                c = mix(c, (0.2, 0.18, 0.08), 0.5)
        elif p == 'vbars' and side and co.y < head_start:
            if math.sin(co.y * 42 + n3(co, 8) * 2) > 0.45:
                c = mix(c, (0.24, 0.2, 0.08), 0.45)
        elif p == 'perchbars' and side and co.y < head_start and n.z > -0.2:
            if math.sin(co.y * 38) > 0.25:
                c = mix(c, (0.18, 0.2, 0.06), 0.7)
        belly = smooth01(-0.25, -0.75, n.z)
        c = mix(c, spec['belly'], belly)
        if abs(co.y - head_start) < 0.012 and abs(co.z) < spec['depth'] * 0.8:
            c = mix(c, (0.15, 0.13, 0.1), 0.55)
        if co.y > 0.49 or (co.y > head_start + 0.06 and abs(co.z + 0.01) < 0.006 and co.y > 0.4):
            c = mix(c, (0.12, 0.1, 0.08), 0.7)
        lateral = abs(co.z - 0.01) < 0.004 and co.y < head_start and abs(n.x) > 0.6
        if lateral:
            c = mix(c, (0.25, 0.23, 0.18), 0.4)
        g = n3(Vector((co.y * 120, co.z * 120, co.x * 120)), 1.0) * 0.03
        return (c[0] + g, c[1] + g, c[2] + g)
    m.add('body', piece_from_bm(bm, col))
    for side in (-1, 1):
        ey, ez = 0.5 - spec['snout'] * 0.42, spec['depth'] * 0.35
        _, ww = fish_profile(spec, (ey + 0.42) / 0.92)
        eye = sphere(0.016 + spec['depth'] * 0.06, 12, 8, at=(side * ww * 0.85, ey, ez), scale=(0.6, 1, 1))
        m.add('body', piece_from_bm(eye, lambda co, n, s=side: (0.02, 0.02, 0.02) if n.x * s > 0.9 else spec['eye']))
    fin_col = spec['fins']
    def fin(points, part, rays=True, spiny=False):
        cx = sum(p[1] for p in points) / len(points)
        cz = sum(p[2] for p in points) / len(points)
        root = points[0]
        def fc(co, n):
            ang = math.atan2(co.z - root[2], co.y - root[1])
            ray = 0.5 + 0.5 * math.sin(ang * 60) if rays else 0.5
            d = math.hypot(co.y - root[1], co.z - root[2])
            c = mix(fin_col, (fin_col[0] * 0.6, fin_col[1] * 0.6, fin_col[2] * 0.6), ray * 0.6)
            if spiny:
                c = mix(c, (0.15, 0.13, 0.1), 0.3)
            return mix(c, (min(1, fin_col[0] * 1.2), min(1, fin_col[1] * 1.2), min(1, fin_col[2] * 1.2)), smooth01(0.0, 0.12, d) * 0.2)
        for flip in (False, True):
            b2 = new_bm()
            vs = [b2.verts.new(Vector(p) + Vector((0.0015 if not flip else -0.0015, 0, 0))) for p in (points if not flip else points[::-1])]
            b2.faces.new(vs)
            bmesh.ops.triangulate(b2, faces=b2.faces[:])
            sub = bmesh.ops.subdivide_edges(b2, edges=b2.edges[:], cuts=3, use_grid_fill=True)
            m.add(part, piece_from_bm(b2, fc, smooth=False))
    D = spec['depth']
    f = spec['fork']
    tail = [(0, -0.4, 0.0), (0, -0.52, D * 0.25), (0, -0.6, D * 1.0), (0, -0.565, D * 0.55), (0, -0.53, D * (0.1 + f * 0.1)), (0, -0.565, -D * 0.55), (0, -0.6, -D * 1.0), (0, -0.52, -D * 0.25)]
    fin(tail, 'tail')
    d0, d1 = spec['dorsal']
    fin([(0, d0, D * 0.82), (0, d0 - 0.04, D * 1.6), (0, (d0 + d1) / 2, D * 1.55), (0, d1, D * 1.2), (0, d1 + 0.01, D * 0.75)], 'body')
    if spec['spiny']:
        s0, s1 = spec['spiny']
        pts = [(0, s0, D * 0.9)]
        steps = 8
        for j in range(steps + 1):
            y = s0 + (s1 - s0) * j / steps
            pts.append((0, y, D * (1.75 if j % 2 == 0 else 1.45) - j * 0.01))
        pts.append((0, s1, D * 0.95))
        fin(pts, 'body', spiny=True)
    fin([(0, -0.18, -D * 0.85), (0, -0.24, -D * 1.45), (0, -0.33, -D * 1.25), (0, -0.33, -D * 0.7)], 'body')
    for side in (-1, 1):
        px = side * spec['width'] * 0.9
        pts = [(px, 0.24, -D * 0.25), (px + side * 0.07, 0.14, -D * 0.6), (px + side * 0.05, 0.1, -D * 0.4), (px + side * 0.005, 0.2, -D * 0.2)]
        fin(pts, 'body')
        vx = side * spec['width'] * 0.5
        fin([(vx, 0.12, -D * 0.85), (vx + side * 0.04, 0.02, -D * 1.25), (vx + side * 0.01, 0.0, -D * 1.0)], 'body')
    m.pivots['tail'] = (0, -0.4, 0)
    write_model(m)


def build_hunter():
    m = Model('hunter', ao_dist=0.35, ao_strength=0.65)
    def orange(co, n):
        weave = n3(Vector((co.x * 80, co.y * 80, co.z * 80)), 1.0) * 0.05
        c = mix((0.98, 0.38, 0.06), (0.78, 0.24, 0.04), smooth01(0.3, -0.6, n.z))
        return (c[0] + weave, c[1] + weave, c[2] + weave)
    skin = lambda co, n: mix((0.82, 0.62, 0.5), (0.68, 0.48, 0.38), smooth01(0.3, -0.5, n.y))
    torso = metaball([ell((0, 0, 1.3), 0.21, 0.13, 0.2), ell((0, 0, 1.08), 0.19, 0.13, 0.17), ell((0, 0.01, 0.9), 0.18, 0.12, 0.1), ell((0, 0, 1.47), 0.23, 0.12, 0.07), ell((0, 0, 1.53), 0.07, 0.07, 0.06)], 0.018, decimate=0.25)
    def jacket(co, n):
        c = orange(co, n)
        if co.z < 0.9:
            return (0.12, 0.1, 0.08)
        if abs(co.x) < 0.012 and n.y > 0.5:
            return (0.3, 0.12, 0.03)
        if 0.95 < co.z < 1.05 and abs(co.x) > 0.06 and n.y > 0.5:
            return mix(c, (0.5, 0.18, 0.03), 0.5)
        return c
    m.add('torso', piece_from_bm(torso, jacket))
    head = metaball([ell((0, 0.01, 1.68), 0.085, 0.095, 0.11), ell((0, 0.045, 1.6), 0.06, 0.06, 0.05), ell((0, 0.095, 1.67), 0.014, 0.025, 0.025)], 0.009, decimate=0.4)
    def head_col(co, n):
        c = skin(co, n)
        if co.z < 1.63 and n.y > 0.1:
            return mix(c, (0.35, 0.25, 0.18), 0.55)
        if abs(co.z - 1.695) < 0.012 and n.y > 0.7 and abs(co.x) > 0.02:
            return (0.1, 0.08, 0.07)
        return c
    m.add('torso', piece_from_bm(head, head_col))
    for side in (-1, 1):
        m.add('torso', piece_from_bm(sphere(0.022, 8, 6, at=(side * 0.085, 0.0, 1.68), scale=(0.5, 1, 1.3)), skin))
    cap = sphere(0.1, 16, 10, at=(0, 0.0, 1.73), scale=(0.95, 1.05, 0.75))
    bmesh.ops.delete(cap, geom=[v for v in cap.verts if v.co.z < 1.725], context='VERTS')
    m.add('torso', piece_from_bm(cap, orange))
    brim = cone(0.075, 0.075, 0.012, 14, at=(0, 0.11, 1.73), rot=Matrix.Rotation(0.1, 4, 'X'))
    bmesh.ops.scale(brim, vec=(1.0, 0.8, 1.0), verts=brim.verts)
    m.add('torso', piece_from_bm(brim, lambda co, n: (0.85, 0.3, 0.05)))
    m.add('torso', piece_from_bm(tube([(0, 0, 0.9), (0, 0, 0.88)], [0.185, 0.185], 16, cap=False), lambda co, n: (0.15, 0.1, 0.06)))
    pants = lambda co, n: mix((0.32, 0.3, 0.24), (0.22, 0.21, 0.17), n3(Vector((co.x * 50, co.y * 50, co.z * 50)), 1) * 0.5 + 0.5)
    for side, name in ((1, 'armL'), (-1, 'armR')):
        arm = metaball([ell((side * 0.24, 0, 1.36), 0.065, 0.065, 0.12), ell((side * 0.27, 0.02, 1.13), 0.055, 0.055, 0.13), ell((side * 0.28, 0.05, 0.98), 0.05, 0.05, 0.06)], 0.012, decimate=0.4)
        m.add(name, piece_from_bm(arm, orange), pivot=(side * 0.24, 0, 1.45))
        glove = metaball([ell((side * 0.285, 0.06, 0.89), 0.035, 0.03, 0.06), ell((side * 0.27, 0.085, 0.9), 0.012, 0.03, 0.012)], 0.008, decimate=0.5)
        m.add(name, piece_from_bm(glove, lambda co, n: (0.2, 0.16, 0.12)), pivot=(side * 0.24, 0, 1.45))
    for side, name in ((1, 'legL'), (-1, 'legR')):
        leg = metaball([ell((side * 0.1, 0, 0.72), 0.085, 0.09, 0.2), ell((side * 0.105, 0.01, 0.4), 0.065, 0.07, 0.2)], 0.012, decimate=0.4)
        m.add(name, piece_from_bm(leg, pants), pivot=(side * 0.1, 0, 0.9))
        boot = metaball([ell((side * 0.105, 0.0, 0.16), 0.06, 0.07, 0.1), ell((side * 0.105, 0.07, 0.05), 0.055, 0.12, 0.05)], 0.01, decimate=0.45)
        m.add(name, piece_from_bm(boot, lambda co, n: (0.08, 0.06, 0.04) if co.z < 0.025 else (0.3, 0.2, 0.11)), pivot=(side * 0.1, 0, 0.9))
    write_model(m)


def revolve_tire(cx, cy, cz, radius, width, segs=36, prof=10):
    bm = new_bm()
    rings = []
    for i in range(segs):
        a = i / segs * math.tau
        row = []
        for j in range(prof + 1):
            t = j / prof
            px = (t - 0.5) * width
            bulge = math.sin(t * math.pi)
            r = radius * (0.72 + 0.28 * bulge ** 0.35)
            tread = 0.0
            if 0.12 < t < 0.88 and bulge > 0.6:
                block = (i + (1 if t > 0.5 else 0)) % 2
                tread = 0.022 * block
            r += tread
            row.append(bm.verts.new((cx + px, cy + math.cos(a) * r, cz + math.sin(a) * r)))
        rings.append(row)
    for i in range(segs):
        i2 = (i + 1) % segs
        for j in range(prof):
            bm.faces.new((rings[i][j], rings[i2][j], rings[i2][j + 1], rings[i][j + 1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return bm


def build_utv():
    m = Model('utv', ao_dist=0.7, ao_strength=0.6)
    green = lambda co, n: mix((0.13, 0.26, 0.13), (0.22, 0.38, 0.2), max(0.0, n.z) * 0.8 + 0.1)
    black = lambda co, n: (0.05, 0.05, 0.055)
    plastic = lambda co, n: (0.09, 0.09, 0.09)
    seat = lambda co, n: mix((0.12, 0.11, 0.1), (0.2, 0.18, 0.16), max(0.0, n.z))
    steel = lambda co, n: mix((0.35, 0.36, 0.38), (0.7, 0.71, 0.72), max(0.0, n.z))
    def bevel_box(size, at, color, rot=None, bevel=0.03):
        b = box(size, at, rot)
        bmesh.ops.bevel(b, geom=b.edges[:], offset=bevel, segments=2, affect='EDGES')
        m.add('body', piece_from_bm(b, color, smooth=True))
    bevel_box((1.1, 2.7, 0.12), (0, 0, 0.42), black, bevel=0.02)
    bevel_box((1.36, 0.95, 0.36), (0, 0.98, 0.76), green)
    hood = box((1.32, 0.78, 0.07), at=(0, 1.0, 0.98), rot=Matrix.Rotation(-0.2, 4, 'X'))
    bmesh.ops.bevel(hood, geom=hood.edges[:], offset=0.025, segments=2, affect='EDGES')
    m.add('body', piece_from_bm(hood, green))
    bevel_box((1.1, 0.08, 0.3), (0, 1.47, 0.72), lambda co, n: (0.03, 0.03, 0.03) if abs(co.x) < 0.42 and 0.62 < co.z < 0.82 else (0.07, 0.07, 0.07))
    for k in range(6):
        m.add('body', piece_from_bm(box((0.8, 0.02, 0.012), at=(0, 1.515, 0.64 + k * 0.035)), lambda co, n: (0.12, 0.12, 0.12)))
    m.add('body', piece_from_bm(tube([(-0.68, 1.58, 0.52), (-0.62, 1.66, 0.55), (0.62, 1.66, 0.55), (0.68, 1.58, 0.52)], [0.035] * 4, 8, cap=False), black))
    m.add('body', piece_from_bm(tube([(-0.5, 1.66, 0.55), (-0.5, 1.62, 0.85)], [0.03, 0.03], 8, cap=False), black))
    m.add('body', piece_from_bm(tube([(0.5, 1.66, 0.55), (0.5, 1.62, 0.85)], [0.03, 0.03], 8, cap=False), black))
    for side in (-1, 1):
        lamp = cone(0.08, 0.075, 0.05, 14, at=(side * 0.44, 1.36, 0.93), rot=Matrix.Rotation(-math.pi / 2, 4, 'X'))
        m.add('body', piece_from_bm(lamp, lambda co, n: (1.0, 0.98, 0.88) if n.y > 0.7 else (0.1, 0.1, 0.1)))
        m.add('body', piece_from_bm(box((0.1, 0.03, 0.07), at=(side * 0.5, -1.47, 0.9)), lambda co, n: (0.85, 0.08, 0.05)))
        fender = []
        for i in range(9):
            a = math.pi * i / 8
            fender.append((side * 0.66, 1.0 + math.cos(a) * 0.44, 0.36 + math.sin(a) * 0.44))
        m.add('body', piece_from_bm(tube(fender, [0.07] * 9, 6, cap=False), plastic))
        fender_r = [(side * 0.66, -0.95 + math.cos(math.pi * i / 8) * 0.44, 0.36 + math.sin(math.pi * i / 8) * 0.44) for i in range(9)]
        m.add('body', piece_from_bm(tube(fender_r, [0.07] * 9, 6, cap=False), plastic))
        bevel_box((0.05, 0.75, 0.38), (side * 0.66, 0.05, 0.72), green)
        bevel_box((0.05, 0.75, 0.08), (side * 0.67, 0.05, 0.94), black, bevel=0.015)
        cage = [(side * 0.62, 0.55, 0.92), (side * 0.6, 0.38, 1.55), (side * 0.58, 0.2, 1.82), (side * 0.58, -0.45, 1.84), (side * 0.6, -0.55, 1.6), (side * 0.62, -0.6, 0.98)]
        m.add('body', piece_from_bm(tube(cage, [0.034] * 6, 8, cap=False), black))
        m.add('body', piece_from_bm(tube([(side * 0.6, -0.55, 1.6), (side * 0.62, -0.3, 1.05)], [0.025, 0.025], 6, cap=False), black))
        for (y0, y1, zt) in ((1.0, 0.85, 0.36), (-0.95, -0.85, 0.36)):
            m.add('body', piece_from_bm(tube([(side * 0.15, y1, 0.48), (side * 0.6, y0, zt)], [0.022, 0.022], 6, cap=False), black))
            m.add('body', piece_from_bm(tube([(side * 0.15, y1 + 0.15, 0.48), (side * 0.6, y0 + 0.05, zt)], [0.02, 0.02], 6, cap=False), black))
            coil = [(side * (0.38 + 0.03 * math.cos(k * 1.2)), y0 - 0.12 + 0.03 * math.sin(k * 1.2), 0.45 + k * 0.035) for k in range(12)]
            m.add('body', piece_from_bm(tube(coil, [0.012] * 12, 5, cap=False), lambda co, n: (0.8, 0.55, 0.1)))
            m.add('body', piece_from_bm(tube([(side * 0.38, y0 - 0.12, 0.42), (side * 0.38, y0 - 0.12, 0.88)], [0.02, 0.02], 6, cap=False), steel))
    for y in (0.2, -0.45):
        m.add('body', piece_from_bm(tube([(-0.58, y, 1.83), (0.58, y, 1.83)], [0.034, 0.034], 8, cap=False), black))
    m.add('body', piece_from_bm(tube([(-0.58, -0.45, 1.83), (0.58, 0.2, 1.83)], [0.022, 0.022], 6, cap=False), black))
    roof = box((1.16, 0.7, 0.02), at=(0, -0.12, 1.87))
    m.add('body', piece_from_bm(roof, lambda co, n: (0.08, 0.08, 0.08)))
    bevel_box((1.2, 0.3, 0.32), (0, 0.48, 0.92), plastic)
    m.add('body', piece_from_bm(tube([(0.3, 0.42, 1.05), (0.3, 0.32, 1.22)], [0.018, 0.018], 6), black))
    wheel = []
    for k in range(17):
        a = k / 16 * math.tau
        wheel.append((0.3 + math.cos(a) * 0.16, 0.31 - math.sin(a) * 0.035, 1.24 + math.sin(a) * 0.15))
    m.add('body', piece_from_bm(tube(wheel, [0.018] * 17, 6, cap=False), black))
    m.add('body', piece_from_bm(tube([(0.14, 0.3, 1.24), (0.46, 0.32, 1.24)], [0.012, 0.012], 4), black))
    for x in (-0.3, 0.3):
        bevel_box((0.5, 0.48, 0.13), (x, -0.05, 0.78), seat)
        bevel_box((0.5, 0.11, 0.5), (x, -0.31, 1.08), seat, rot=Matrix.Rotation(0.12, 4, 'X'))
        bevel_box((0.26, 0.09, 0.18), (x, -0.36, 1.42), seat)
    bevel_box((1.3, 0.9, 0.06), (0, -0.98, 0.98), lambda co, n: (0.1, 0.11, 0.1))
    for side in (-1, 1):
        bevel_box((0.05, 0.9, 0.28), (side * 0.66, -0.98, 1.12), green)
    bevel_box((1.3, 0.05, 0.28), (0, -1.45, 1.12), green)
    bevel_box((1.3, 0.05, 0.28), (0, -0.52, 1.12), green)
    m.add('body', piece_from_bm(tube([(-0.45, -1.52, 0.6), (0.45, -1.52, 0.6)], [0.035, 0.035], 8, cap=False), black))
    m.add('body', piece_from_bm(box((0.06, 0.12, 0.06), at=(0, -1.58, 0.55)), steel))
    for name, (x, y) in {'wheelFL': (0.66, 1.0), 'wheelFR': (-0.66, 1.0), 'wheelBL': (0.66, -0.95), 'wheelBR': (-0.66, -0.95)}.items():
        side = 1 if x > 0 else -1
        tire = revolve_tire(x, y, 0.35, 0.35, 0.27)
        m.add(name, piece_from_bm(tire, lambda co, n: (0.055, 0.055, 0.055) if abs(n.x) < 0.8 else (0.08, 0.08, 0.08)), pivot=(x, y, 0.35))
        rim = cone(0.2, 0.2, 0.18, 20, at=(x - 0.09, y, 0.35), rot=Matrix.Rotation(math.pi / 2, 4, 'Y'))
        m.add(name, piece_from_bm(rim, lambda co, n: (0.18, 0.18, 0.19) if abs(n.x) > 0.7 else (0.12, 0.12, 0.13)), pivot=(x, y, 0.35))
        for k in range(5):
            a = k / 5 * math.tau
            sp = box((0.04, 0.05, 0.2), at=(x + side * 0.085, y + math.cos(a) * 0.09, 0.35 + math.sin(a) * 0.09), rot=Matrix.Rotation(-a + math.pi / 2, 4, 'X'))
            m.add(name, piece_from_bm(sp, lambda co, n: (0.6, 0.6, 0.62), smooth=False), pivot=(x, y, 0.35))
        hub = cone(0.05, 0.035, 0.05, 10, at=(x + side * 0.08, y, 0.35), rot=Matrix.Rotation(side * math.pi / 2, 4, 'Y'))
        m.add(name, piece_from_bm(hub, lambda co, n: (0.5, 0.5, 0.52)), pivot=(x, y, 0.35))
    write_model(m)


def build_boat():
    m = Model('boat', ground=False, ao_dist=0.7, ao_strength=0.55)
    L = 5.0
    stations = 26
    sections = []
    for i in range(stations + 1):
        y = -L / 2 + L * i / stations
        sections.append((y, hull_section(y, L)))
    bm = new_bm()
    inner = new_bm()
    grid, igrid = [], []
    for y, pts in sections:
        row, irow = [], []
        full = [(-x, z) for x, z in reversed(pts[1:])] + pts
        for x, z in full:
            row.append(bm.verts.new((x, y, z)))
            sgn = 1 if x >= 0 else -1
            irow.append(inner.verts.new((x - sgn * min(abs(x), 0.035), y, z + 0.03)))
        grid.append(row)
        igrid.append(irow)
    cols = len(grid[0])
    for i in range(stations):
        for k in range(cols - 1):
            bm.faces.new((grid[i][k], grid[i][k + 1], grid[i + 1][k + 1], grid[i + 1][k]))
            inner.faces.new((igrid[i][k + 1], igrid[i][k], igrid[i + 1][k], igrid[i + 1][k + 1]))
    bm.faces.new(grid[0][::-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    def hull_col(co, n):
        rib = abs(math.sin((co.y + 2.5) * math.pi / 0.42)) < 0.06
        rivet = abs(co.z - 0.42) < 0.008 or abs(co.z - 0.2) < 0.006
        if co.z > 0.46:
            c = mix((0.13, 0.25, 0.17), (0.2, 0.35, 0.24), max(0.0, n.z) * 0.6 + 0.3)
            if 0.5 < co.z < 0.56:
                c = (0.85, 0.82, 0.7)
            return c
        c = mix((0.5, 0.52, 0.54), (0.72, 0.74, 0.76), n3(co, 3) * 0.3 + 0.5 + max(0.0, n.z) * 0.2)
        if rib:
            c = mix(c, (0.38, 0.4, 0.42), 0.6)
        if rivet:
            c = mix(c, (0.3, 0.31, 0.33), 0.7)
        return c
    m.add('hull', piece_from_bm(bm, hull_col))
    m.add('hull', piece_from_bm(inner, lambda co, n: mix((0.48, 0.5, 0.5), (0.36, 0.38, 0.38), n3(co, 4) * 0.5 + 0.5)))
    for i in range(stations):
        a, b = sections[i], sections[i + 1]
        for side in (-1, 1):
            p1 = (side * a[1][-1][0], a[0], a[1][-1][1] + 0.01)
            p2 = (side * b[1][-1][0], b[0], b[1][-1][1] + 0.01)
            m.add('hull', piece_from_bm(tube([p1, p2], [0.032, 0.032], 6, cap=False), lambda co, n: (0.78, 0.8, 0.8)))
    carpet = lambda co, n: mix((0.16, 0.2, 0.17), (0.2, 0.25, 0.21), n3(Vector((co.x * 40, co.y * 40, 0)), 1) * 0.5 + 0.5)
    def deck(size, at, color, bevel=0.015):
        b = box(size, at)
        bmesh.ops.bevel(b, geom=b.edges[:], offset=bevel, segments=2, affect='EDGES')
        m.add('hull', piece_from_bm(b, color))
    deck((1.62, 3.9, 0.04), (0, -0.4, 0.24), carpet)
    deck((1.3, 0.9, 0.2), (0, 1.45, 0.48), carpet)
    deck((1.8, 0.7, 0.16), (0, -2.15, 0.48), carpet)
    deck((0.42, 0.55, 0.62), (0.52, 0.2, 0.55), lambda co, n: (0.85, 0.85, 0.82) if co.z < 0.8 else (0.1, 0.1, 0.1))
    ws = box((0.46, 0.03, 0.22), at=(0.52, 0.45, 0.95), rot=Matrix.Rotation(-0.45, 4, 'X'))
    m.add('hull', piece_from_bm(ws, lambda co, n: (0.25, 0.32, 0.36)))
    wheel = []
    for k in range(17):
        a = k / 16 * math.tau
        wheel.append((0.52 + math.cos(a) * 0.12, 0.08, 0.98 + math.sin(a) * 0.12))
    m.add('hull', piece_from_bm(tube(wheel, [0.014] * 17, 6, cap=False), lambda co, n: (0.08, 0.08, 0.08)))
    deck((0.6, 0.2, 0.04), (0.52, 0.32, 0.88), lambda co, n: (0.05, 0.05, 0.05))
    for (x, y) in ((0.45, -0.6), (-0.1, 1.45), (0.0, -1.7)):
        m.add('hull', piece_from_bm(tube([(x, y, 0.26), (x, y, 0.62)], [0.03, 0.03], 8, cap=False), lambda co, n: (0.6, 0.6, 0.62)))
        b = box((0.42, 0.4, 0.09), at=(x, y, 0.68))
        bmesh.ops.bevel(b, geom=b.edges[:], offset=0.04, segments=3, affect='EDGES')
        m.add('hull', piece_from_bm(b, lambda co, n: (0.88, 0.87, 0.82) if n.z > 0.6 else (0.25, 0.25, 0.25)))
        bb = box((0.42, 0.08, 0.36), at=(x, y - 0.2, 0.9), rot=Matrix.Rotation(0.15, 4, 'X'))
        bmesh.ops.bevel(bb, geom=bb.edges[:], offset=0.035, segments=3, affect='EDGES')
        m.add('hull', piece_from_bm(bb, lambda co, n: (0.88, 0.87, 0.82) if n.y > 0.4 else (0.25, 0.25, 0.25)))
    for (x, y) in ((-0.8, -1.4), (0.8, -1.4), (-0.85, 0.6)):
        m.add('hull', piece_from_bm(tube([(x, y, 0.5), (x * 0.98, y - 0.05, 0.62)], [0.025, 0.028], 8, cap=False), lambda co, n: (0.15, 0.15, 0.15)))
    m.add('hull', piece_from_bm(tube([(0, 2.35, 0.82), (0, 2.35, 1.4)], [0.012, 0.01], 6), lambda co, n: (0.85, 0.85, 0.85)))
    m.add('hull', piece_from_bm(sphere(0.035, 8, 6, at=(0, 2.35, 1.42)), lambda co, n: (1.0, 1.0, 0.9)))
    m.add('hull', piece_from_bm(tube([(0.25, 2.25, 0.62), (0.3, 2.65, 0.75), (0.3, 2.62, -0.25)], [0.022, 0.02, 0.02], 6), lambda co, n: (0.1, 0.1, 0.1)))
    m.add('hull', piece_from_bm(tube([(0.3, 2.6, -0.32), (0.3, 2.72, -0.32)], [0.045, 0.04], 10), lambda co, n: (0.1, 0.1, 0.1)))
    motor_col = lambda co, n: (0.92, 0.92, 0.9) if co.z > 0.85 and abs(co.z - 1.0) > 0.015 else (0.15, 0.15, 0.16) if co.z > 0.6 else (0.22, 0.22, 0.23)
    cowl = metaball([ell((0, -2.82, 0.98), 0.2, 0.3, 0.24), ell((0, -2.72, 0.85), 0.16, 0.22, 0.12)], 0.02, decimate=0.5)
    m.add('motor', piece_from_bm(cowl, motor_col), pivot=(0, -2.62, 0.8))
    leg = metaball([ell((0, -2.78, 0.5), 0.05, 0.11, 0.3), ell((0, -2.76, 0.05), 0.07, 0.2, 0.06), ell((0, -2.8, -0.08), 0.008, 0.08, 0.12)], 0.012, decimate=0.5)
    m.add('motor', piece_from_bm(leg, motor_col), pivot=(0, -2.62, 0.8))
    m.add('motor', piece_from_bm(tube([(0, -2.55, 0.92), (0, -2.25, 0.85)], [0.02, 0.02], 6), lambda co, n: (0.1, 0.1, 0.1)), pivot=(0, -2.62, 0.8))
    for k in range(3):
        a = k / 3 * math.tau
        blade = box((0.12, 0.012, 0.06), at=(math.cos(a) * 0.07, -2.97, 0.05 + math.sin(a) * 0.07), rot=Matrix.Rotation(a, 4, 'Y') @ Matrix.Rotation(0.5, 4, 'Z'))
        m.add('motor', piece_from_bm(blade, lambda co, n: (0.55, 0.56, 0.58), smooth=False), pivot=(0, -2.62, 0.8))
    write_model(m)


def build_pine_cards_lo():
    m = Model('pine-lo', ao_dist=3.0, ao_strength=0.45)
    r = random.Random(12)
    m.add('trunk', piece_from_bm(cone(0.3, 0.04, 15.0, 5), bark))
    whorls = 8
    for w in range(whorls):
        t = w / (whorls - 1)
        z = lerp(3.2, 14.0, t)
        for k in range(3):
            ang = w * 1.1 + k * math.tau / 3
            d = Vector((math.cos(ang), math.sin(ang), 0))
            L = (1 - t) ** 0.85 * 3.4 + 0.7
            mid = Vector((d.x * L * 0.5, d.y * L * 0.5, z - 0.25 * L * 0.3))
            side = Vector((-d.y, d.x, 0))
            along = (d * L + Vector((0, 0, -0.3 * L))).normalized()
            tilt = (side * 0.4 + Vector((0, 0, 0.9))).normalized()
            m.add('crown', card(mid, tilt, along, L * 0.9, L * 1.15, ATLAS[r.randrange(4)], (0, 0, z - 1.2), 0.8 + 0.2 * t), material='needles')
    for k in range(2):
        side = Vector((math.cos(k * 1.57), math.sin(k * 1.57), 0))
        m.add('crown', card((0, 0, 14.0), side, (0, 0, 1), 1.0, 1.8, ATLAS[k], (0, 0, 13), 1.0, anchor_bottom=True), material='needles')
    write_model(m)


def build_leafy_lo(name, material, trunk_h, trunk_r, clumps, count, size, center):
    m = Model(name, ao_dist=2.5, ao_strength=0.45)
    r = random.Random(len(name))
    tc = (lambda co, n: (0.82, 0.8, 0.75)) if material == 'birchleaves' else bark
    m.add('trunk', piece_from_bm(cone(trunk_r, 0.06, trunk_h, 5), tc))
    leafy_crown(m, r, clumps, count, size, material, center)
    write_model(m)
