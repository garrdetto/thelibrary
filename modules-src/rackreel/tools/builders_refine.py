def loft(stations, ring=24, power=0.85, cap_start=True, cap_end=True, side=Vector((1, 0, 0))):
    bm = new_bm()
    rows = []
    count = len(stations)
    for i, st in enumerate(stations):
        c = Vector(st[0])
        prev_c = Vector(stations[max(0, i - 1)][0])
        next_c = Vector(stations[min(count - 1, i + 1)][0])
        t = next_c - prev_c
        t = t.normalized() if t.length > 1e-6 else Vector((0, 1, 0))
        up = side.cross(t)
        up = up.normalized() if up.length > 1e-6 else Vector((0, 0, 1))
        sx = side - t * side.dot(t)
        sx = sx.normalized() if sx.length > 1e-6 else side
        w, htop, hbot = st[1], st[2], st[3]
        row = []
        for k in range(ring):
            a = k / ring * math.tau
            ca, sa = math.cos(a), math.sin(a)
            u = math.copysign(abs(ca) ** power, ca)
            v = math.copysign(abs(sa) ** power, sa)
            h = htop if u > 0 else hbot
            row.append(bm.verts.new(c + sx * (v * w) + up * (u * h)))
        rows.append(row)
    for i in range(count - 1):
        for k in range(ring):
            k2 = (k + 1) % ring
            bm.faces.new((rows[i][k], rows[i][k2], rows[i + 1][k2], rows[i + 1][k]))
    if cap_start:
        cv = bm.verts.new(Vector(stations[0][0]))
        for k in range(ring):
            bm.faces.new((rows[0][(k + 1) % ring], rows[0][k], cv))
    if cap_end:
        cv = bm.verts.new(Vector(stations[-1][0]))
        for k in range(ring):
            bm.faces.new((rows[-1][k], rows[-1][(k + 1) % ring], cv))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return bm


def resample(knots, n):
    out = []
    for i in range(n):
        t = i / (n - 1)
        for j in range(len(knots) - 1):
            a, b = knots[j], knots[j + 1]
            if a[0] <= t <= b[0] or j == len(knots) - 2:
                f = 0.0 if b[0] == a[0] else (t - a[0]) / (b[0] - a[0])
                f = max(0.0, min(1.0, f))
                f = f * f * (3 - 2 * f)
                out.append(tuple([t] + [lerp(a[k], b[k], f) for k in range(1, len(a))]))
                break
    return out


def deer_coat(co, n):
    hair = n3(Vector((co.x * 70, co.y * 9, co.z * 70)), 1.0) * 0.035
    side = mix((0.52, 0.44, 0.35), (0.47, 0.4, 0.32), smooth01(0.7, 1.15, co.z))
    back = smooth01(0.35, 0.95, n.z) * smooth01(0.13, 0.0, abs(co.x))
    c = mix(side, (0.33, 0.28, 0.23), back * 0.85)
    belly = smooth01(-0.2, -0.7, n.z) * smooth01(0.95, 0.75, co.z)
    c = mix(c, (0.9, 0.88, 0.84), belly)
    flankline = smooth01(-0.05, -0.35, n.z) * smooth01(0.85, 0.7, co.z)
    c = mix(c, (0.38, 0.31, 0.24), flankline * 0.35 * (1 - belly))
    if co.y < -0.5 and n.y < -0.3 and abs(co.x) < 0.09 and co.z < 1.04:
        c = mix(c, (0.92, 0.9, 0.86), 0.85)
    return (c[0] + hair, c[1] + hair, c[2] + hair * 0.8)


def build_deer():
    m = Model('deer', ao_dist=0.35, ao_strength=0.45)
    body = [
        ((0, -0.665, 0.99), 0.035, 0.05, 0.05),
        ((0, -0.635, 0.98), 0.09, 0.12, 0.12),
        ((0, -0.58, 0.96), 0.135, 0.15, 0.2),
        ((0, -0.5, 0.94), 0.16, 0.17, 0.27),
        ((0, -0.4, 0.92), 0.162, 0.18, 0.25),
        ((0, -0.24, 0.91), 0.15, 0.17, 0.18),
        ((0, -0.08, 0.89), 0.163, 0.19, 0.2),
        ((0, 0.08, 0.88), 0.176, 0.21, 0.23),
        ((0, 0.22, 0.89), 0.172, 0.23, 0.25),
        ((0, 0.34, 0.92), 0.155, 0.25, 0.26),
        ((0, 0.44, 0.96), 0.13, 0.25, 0.23),
        ((0, 0.52, 1.01), 0.1, 0.2, 0.17),
        ((0, 0.57, 1.06), 0.075, 0.13, 0.12),
    ]
    m.add('body', piece_from_bm(loft(body, ring=28, power=0.8), deer_coat))
    tail = loft([((0, -0.64, 1.07), 0.03, 0.02, 0.02), ((0, -0.69, 1.05), 0.05, 0.025, 0.02), ((0, -0.76, 0.99), 0.045, 0.02, 0.018), ((0, -0.79, 0.94), 0.02, 0.01, 0.01)], ring=12, power=0.9)
    m.add('body', piece_from_bm(tail, lambda co, n: (0.42, 0.3, 0.2) if n.y < -0.3 and n.z > -0.2 and abs(co.x) < 0.03 else (0.95, 0.93, 0.9)))
    neck = [
        ((0, 0.46, 1.02), 0.12, 0.22, 0.22),
        ((0, 0.55, 1.13), 0.11, 0.17, 0.2),
        ((0, 0.62, 1.26), 0.094, 0.135, 0.155),
        ((0, 0.685, 1.38), 0.078, 0.108, 0.118),
        ((0, 0.74, 1.47), 0.068, 0.088, 0.09),
        ((0, 0.785, 1.535), 0.066, 0.07, 0.07),
        ((0, 0.84, 1.56), 0.074, 0.068, 0.075),
        ((0, 0.9, 1.555), 0.072, 0.062, 0.072),
        ((0, 0.96, 1.54), 0.058, 0.052, 0.06),
        ((0, 1.02, 1.52), 0.045, 0.043, 0.05),
        ((0, 1.07, 1.505), 0.036, 0.036, 0.042),
        ((0, 1.11, 1.495), 0.031, 0.031, 0.034),
        ((0, 1.135, 1.49), 0.022, 0.022, 0.024),
        ((0, 1.145, 1.488), 0.01, 0.01, 0.012),
    ]
    def head_col(co, n):
        c = deer_coat(co, n)
        c = mix(c, (0.47, 0.38, 0.29), 0.45)
        if co.y > 1.105:
            return (0.04, 0.035, 0.035)
        if co.y > 1.05 and co.z < 1.495:
            return (0.9, 0.88, 0.84)
        if 1.04 < co.y < 1.105 and n.z > 0.2:
            return mix(c, (0.24, 0.18, 0.13), 0.6)
        if 0.82 < co.y < 0.98 and n.z > 0.6:
            return mix(c, (0.3, 0.24, 0.18), 0.45)
        if 1.3 < co.z < 1.42 and 0.66 < co.y < 0.76 and n.y > 0.45 and n.z < 0.1:
            return (0.93, 0.91, 0.87)
        if co.y > 0.97 and n.z < -0.4:
            return (0.88, 0.86, 0.82)
        return c
    hp = (0, 0.55, 1.1)
    m.add('head', piece_from_bm(loft(neck, ring=24, power=0.82, cap_start=False), head_col), pivot=hp)
    for side in (-1, 1):
        ear = sphere(0.1, 14, 10, at=(0, 0, 0), scale=(0.38, 0.16, 1.0))
        for v in ear.verts:
            if v.co.y < 0:
                v.co.y *= 0.25
            v.co.y -= (abs(v.co.x) * 0.9) ** 2
            v.co.x *= 1.0 - max(0.0, v.co.z) * 2.2
        rot = Matrix.Rotation(side * 0.95, 4, 'Y') @ Matrix.Rotation(0.35, 4, 'X')
        bmesh.ops.transform(ear, matrix=Matrix.Translation((side * 0.085, 0.8, 1.64)) @ rot, verts=ear.verts)
        def ear_col(co, n):
            if abs(co.x) > 0.17 or co.z > 1.72:
                return (0.12, 0.1, 0.08)
            return (0.9, 0.86, 0.8) if n.y > 0.35 else (0.42, 0.34, 0.26)
        m.add('head', piece_from_bm(ear, ear_col), pivot=hp)
        eye = sphere(0.019, 12, 10, at=(side * 0.064, 0.925, 1.565), scale=(0.75, 1.0, 0.85))
        m.add('head', piece_from_bm(eye, lambda co, n: (0.015, 0.012, 0.012)), pivot=hp)
        ring_ = sphere(0.027, 12, 8, at=(side * 0.058, 0.923, 1.565), scale=(0.55, 1.0, 0.9))
        m.add('head', piece_from_bm(ring_, lambda co, n: (0.92, 0.9, 0.86)), pivot=hp)
        gland = sphere(0.012, 8, 6, at=(side * 0.06, 0.965, 1.548), scale=(0.6, 1.4, 0.7))
        m.add('head', piece_from_bm(gland, lambda co, n: (0.1, 0.08, 0.07)), pivot=hp)
        nostril = sphere(0.008, 8, 6, at=(side * 0.016, 1.142, 1.494), scale=(0.7, 0.5, 1.0))
        m.add('head', piece_from_bm(nostril, lambda co, n: (0.0, 0.0, 0.0)), pivot=hp)

    def leg_col_front(co, n):
        if co.z < 0.07:
            return (0.05, 0.045, 0.04)
        c = mix((0.6, 0.5, 0.39), (0.48, 0.4, 0.31), smooth01(0.25, 0.85, co.z))
        c = mix(c, deer_coat(co, n), smooth01(0.55, 0.78, co.z))
        if n.y > 0.4 and co.z < 0.6:
            c = mix(c, (0.33, 0.26, 0.19), 0.55)
        if n.y < -0.3 and co.z < 0.62:
            c = mix(c, (0.86, 0.83, 0.78), 0.55)
        if 0.07 < co.z < 0.14:
            c = mix(c, (0.85, 0.82, 0.76), 0.6)
        return c
    def leg_col_hind(co, n):
        c = leg_col_front(co, n)
        if 0.4 < co.z < 0.5 and n.y < -0.4:
            c = mix(c, (0.3, 0.22, 0.15), 0.6)
        if co.z > 0.62 and n.x * (1 if co.x > 0 else -1) < -0.2:
            c = mix(c, (0.9, 0.88, 0.84), 0.6)
        return c
    front = [(0.4, 0.9, 0.05, 0.085), (0.405, 0.84, 0.06, 0.095), (0.405, 0.7, 0.052, 0.078), (0.41, 0.58, 0.044, 0.062), (0.415, 0.5, 0.036, 0.045), (0.42, 0.47, 0.034, 0.04), (0.42, 0.4, 0.026, 0.032), (0.42, 0.25, 0.023, 0.028), (0.425, 0.14, 0.027, 0.034), (0.44, 0.1, 0.024, 0.03), (0.455, 0.065, 0.03, 0.036), (0.47, 0.03, 0.036, 0.046), (0.485, 0.0, 0.038, 0.052)]
    hind = [(-0.45, 0.9, 0.06, 0.12), (-0.43, 0.8, 0.07, 0.14), (-0.43, 0.72, 0.07, 0.13), (-0.5, 0.6, 0.05, 0.085), (-0.56, 0.5, 0.038, 0.06), (-0.585, 0.45, 0.033, 0.055), (-0.575, 0.4, 0.026, 0.034), (-0.565, 0.25, 0.023, 0.028), (-0.555, 0.13, 0.027, 0.034), (-0.545, 0.1, 0.024, 0.03), (-0.53, 0.065, 0.03, 0.036), (-0.515, 0.03, 0.036, 0.046), (-0.5, 0.0, 0.038, 0.052)]
    for name, x, chain, colfn in (('legFL', 0.085, front, leg_col_front), ('legFR', -0.085, front, leg_col_front), ('legBL', 0.078, hind, leg_col_hind), ('legBR', -0.078, hind, leg_col_hind)):
        st = [((x, p[0], p[1]), p[2], p[3], p[3]) for p in chain]
        piv = (x, chain[0][0], 0.95)
        m.add(name, piece_from_bm(loft(st, ring=14, power=1.0, cap_start=False, side=Vector((1, 0, 0))), colfn), pivot=piv)
        split = box((0.004, 0.06, 0.05), at=(x, chain[-2][0], 0.03))
        m.add(name, piece_from_bm(split, lambda co, n: (0.11, 0.1, 0.09)), pivot=piv)
        back = -1 if chain is front else 1
        for k in (-1, 1):
            dew = sphere(0.009, 6, 4, at=(x + k * 0.014, chain[8][0] - back * 0.035, 0.11), scale=(1, 1.4, 0.8))
            m.add(name, piece_from_bm(dew, lambda co, n: (0.06, 0.05, 0.05)), pivot=piv)
    write_model(m)


FISH = {
    'muskie': {'len_depth': 0.072, 'width': 0.6, 'shape': 'pike', 'gill': 0.72, 'jaw': 0.35, 'dorsal': (0.12, 0.26), 'anal': (0.1, 0.24), 'spiny': None, 'fork': 0.6, 'base': (0.66, 0.64, 0.5), 'back': (0.3, 0.33, 0.24), 'belly': (0.93, 0.91, 0.85), 'pattern': 'bars', 'fins': (0.7, 0.38, 0.2), 'eye': (0.78, 0.62, 0.28)},
    'pike': {'len_depth': 0.07, 'width': 0.6, 'shape': 'pike', 'gill': 0.72, 'jaw': 0.3, 'dorsal': (0.12, 0.25), 'anal': (0.1, 0.23), 'spiny': None, 'fork': 0.45, 'base': (0.32, 0.42, 0.22), 'back': (0.12, 0.18, 0.09), 'belly': (0.93, 0.92, 0.82), 'pattern': 'spots', 'fins': (0.5, 0.36, 0.18), 'eye': (0.82, 0.66, 0.2)},
    'walleye': {'len_depth': 0.098, 'width': 0.58, 'shape': 'perch', 'gill': 0.72, 'jaw': 0.08, 'dorsal': (0.22, 0.44), 'anal': (0.16, 0.3), 'spiny': (0.46, 0.68), 'fork': 0.7, 'base': (0.68, 0.6, 0.33), 'back': (0.34, 0.32, 0.17), 'belly': (0.94, 0.93, 0.88), 'pattern': 'mottle', 'fins': (0.52, 0.47, 0.32), 'eye': (0.88, 0.88, 0.82), 'tailtip': True},
    'smallmouth': {'len_depth': 0.135, 'width': 0.5, 'shape': 'bass', 'gill': 0.73, 'jaw': 0.12, 'dorsal': (0.2, 0.45), 'anal': (0.16, 0.32), 'spiny': (0.45, 0.68), 'fork': 0.35, 'base': (0.56, 0.46, 0.26), 'back': (0.3, 0.27, 0.14), 'belly': (0.86, 0.82, 0.68), 'pattern': 'vbars', 'fins': (0.46, 0.37, 0.21), 'eye': (0.8, 0.16, 0.08)},
    'perch': {'len_depth': 0.128, 'width': 0.5, 'shape': 'perch', 'gill': 0.73, 'jaw': 0.05, 'dorsal': (0.2, 0.42), 'anal': (0.16, 0.3), 'spiny': (0.44, 0.7), 'fork': 0.65, 'base': (0.84, 0.75, 0.3), 'back': (0.34, 0.37, 0.13), 'belly': (0.96, 0.94, 0.84), 'pattern': 'perchbars', 'fins': (0.94, 0.46, 0.12), 'eye': (0.82, 0.72, 0.3)},
}

FISH_SHAPES = {
    'pike': [(0.0, 0.42, 0.42, 0.34), (0.08, 0.55, 0.55, 0.48), (0.25, 0.82, 0.86, 0.82), (0.45, 0.98, 1.0, 1.0), (0.6, 0.97, 0.98, 0.98), (0.7, 0.86, 0.9, 0.95), (0.78, 0.62, 0.7, 0.86), (0.86, 0.4, 0.5, 0.72), (0.93, 0.22, 0.3, 0.55), (0.98, 0.1, 0.14, 0.3), (1.0, 0.03, 0.05, 0.1)],
    'perch': [(0.0, 0.3, 0.3, 0.22), (0.08, 0.4, 0.38, 0.3), (0.25, 0.72, 0.66, 0.62), (0.45, 0.96, 0.84, 0.9), (0.58, 1.0, 0.86, 1.0), (0.7, 0.92, 0.82, 0.96), (0.8, 0.74, 0.7, 0.82), (0.88, 0.52, 0.52, 0.62), (0.95, 0.3, 0.32, 0.38), (1.0, 0.06, 0.08, 0.08)],
    'bass': [(0.0, 0.3, 0.3, 0.22), (0.08, 0.42, 0.4, 0.3), (0.25, 0.75, 0.68, 0.64), (0.45, 0.97, 0.86, 0.92), (0.58, 1.0, 0.88, 1.0), (0.7, 0.9, 0.84, 0.96), (0.8, 0.72, 0.74, 0.84), (0.88, 0.52, 0.58, 0.66), (0.95, 0.3, 0.36, 0.42), (1.0, 0.07, 0.1, 0.1)],
}


def build_fish(kind, spec):
    m = Model('fish-' + kind, ground=False, ao_dist=0.06, ao_strength=0.35)
    D = spec['len_depth']
    W = D * spec['width']
    y0, y1 = -0.42, 0.5
    N = 72
    prof = resample(FISH_SHAPES[spec['shape']], N)
    gill = spec['gill']
    stations = []
    for (t, top, bot, wid) in prof:
        y = lerp(y0, y1, t)
        bump = 1.0 + 0.045 * smooth01(gill - 0.035, gill - 0.004, t) * (1 - smooth01(gill - 0.004, gill + 0.004, t))
        jaw = -spec['jaw'] * D * smooth01(0.82, 1.0, t)
        cz = (top - bot) * 0.5 * D + jaw * 0.5
        h = max(0.002, (top + bot) * 0.5 * D * bump)
        stations.append(((0, y, cz), max(0.002, wid * W * bump), h, h))
    bm = loft(stations, ring=34, power=0.92)
    gy = lerp(y0, y1, gill)
    mouth_y = lerp(y0, y1, 0.9)
    mouth_z = stations[N - 6][0][2]
    def col(co, n):
        top = smooth01(-0.2, 0.8, n.z)
        c = mix(spec['base'], spec['back'], top)
        p = spec['pattern']
        body = co.y < gy
        sideways = n.z > -0.4
        if p == 'bars' and body and sideways:
            v = n3(Vector((co.y * 26, co.z * 34, 3)), 1.0) + 0.6 * math.sin(co.y * 58 + co.z * 25)
            if v > 0.35:
                c = mix(c, (0.2, 0.22, 0.14), 0.6)
        elif p == 'spots' and body and sideways:
            sp = n3(Vector((co.y * 40, co.z * 70, 0)), 1.0)
            if sp > 0.22:
                c = mix(c, (0.88, 0.86, 0.62), 0.85)
        elif p == 'mottle' and sideways:
            if n3(Vector((co.y * 22, co.z * 30, 1)), 1.0) > 0.12:
                c = mix(c, (0.22, 0.2, 0.09), 0.5)
            if body and n.z > 0.25 and math.sin(co.y * 26 + 0.8) > 0.55:
                c = mix(c, (0.18, 0.16, 0.07), 0.55)
        elif p == 'vbars' and body and sideways:
            if math.sin(co.y * 44 + n3(co, 8) * 2.5) > 0.4:
                c = mix(c, (0.25, 0.2, 0.08), 0.42)
        elif p == 'perchbars' and body and sideways and n.z > -0.25:
            bar = math.sin(co.y * 40 - 0.6)
            if bar > 0.15:
                c = mix(c, (0.16, 0.19, 0.06), 0.72 * smooth01(0.15, 0.5, bar))
        belly = smooth01(-0.2, -0.75, n.z)
        c = mix(c, spec['belly'], belly)
        if body:
            sc = 0.5 + 0.5 * math.sin(co.y * 420) * math.sin(co.z * 420)
            k = 0.95 + 0.05 * sc
            c = (c[0] * k, c[1] * k, c[2] * k)
        if abs(co.y - gy) < 0.006 and abs(n.x) > 0.3:
            c = mix(c, (0.1, 0.09, 0.07), 0.7)
        if gy < co.y < gy + 0.06 and abs(n.x) > 0.6 and co.z < 0:
            c = mix(c, (min(1, c[0] * 1.15), min(1, c[1] * 1.1), min(1, c[2] * 1.05)), 0.6)
        if co.y > mouth_y and abs(n.x) > 0.5 and abs(co.z - mouth_z) < D * 0.06:
            c = mix(c, (0.08, 0.06, 0.05), 0.8)
        if body and abs(co.z - D * 0.12) < 0.0035 and abs(n.x) > 0.7:
            c = mix(c, (0.3, 0.28, 0.22), 0.45)
        g = n3(Vector((co.y * 160, co.z * 160, co.x * 160)), 1.0) * 0.025
        return (c[0] + g, c[1] + g, c[2] + g)
    m.add('body', piece_from_bm(bm, col))
    eye_t = gill + (1 - gill) * 0.42
    ey = lerp(y0, y1, eye_t)
    est = stations[int(eye_t * (N - 1))]
    for side in (-1, 1):
        r = D * 0.17 + 0.006
        ex = side * est[1] * 0.82
        ez = est[0][2] + est[2] * 0.35
        ball = sphere(r, 20, 14, at=(ex, ey, ez), scale=(0.5, 1, 1))
        rim = (spec['eye'][0] * 0.35, spec['eye'][1] * 0.3, spec['eye'][2] * 0.25)
        m.add('body', piece_from_bm(ball, lambda co, n, s=side: spec['eye'] if n.x * s > 0.55 else rim))
        pupil = sphere(r * 0.48, 14, 10, at=(ex + side * r * 0.36, ey, ez), scale=(0.35, 1, 1))
        m.add('body', piece_from_bm(pupil, lambda co, n: (0.01, 0.01, 0.012)))
    fc = spec['fins']

    def ray_fin(part, roots, tips, spiny=False, thickness=0.0016, normal_hint=Vector((1, 0, 0)), color=None):
        color = color or fc
        cols = len(roots)
        rows = 7
        normal = normal_hint.normalized()
        mid = len(roots) // 2
        reach = max(1e-4, (Vector(tips[mid]) - Vector(roots[mid])).length)
        def fcol(co, n):
            best = 1e9
            for rr in roots:
                best = min(best, (Vector(co) - Vector(rr)).length)
            edge = smooth01(0.6, 1.0, best / reach)
            c = mix(color, (color[0] * 0.55, color[1] * 0.55, color[2] * 0.55), 0.35)
            c = mix(c, (min(1, color[0] * 1.25), min(1, color[1] * 1.2), min(1, color[2] * 1.15)), edge * 0.5)
            if spiny:
                c = mix(c, (0.14, 0.12, 0.1), 0.25)
            return c
        for flip in (1, -1):
            b = new_bm()
            grid = []
            for i in range(cols):
                ray = i % 2 == 0
                rr = Vector(roots[i])
                tt = Vector(tips[i])
                pts = []
                for j in range(rows + 1):
                    f = j / rows
                    off = thickness * (1.7 if ray else 0.9) * (1 - f * 0.7)
                    pts.append(b.verts.new(rr.lerp(tt, f) + normal * off * flip))
                grid.append(pts)
            for i in range(cols - 1):
                for j in range(rows):
                    q = (grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1])
                    b.faces.new(q if flip > 0 else q[::-1])
            m.add(part, piece_from_bm(b, fcol))

    def st_at(t):
        return stations[max(0, min(N - 1, int(t * (N - 1))))]
    def top_z(t):
        st = st_at(t)
        return st[0][2] + st[2] * 0.95
    def bot_z(t):
        st = st_at(t)
        return st[0][2] - st[3] * 0.95
    n_tail = 17
    roots, tips = [], []
    fork = spec['fork']
    for i in range(n_tail):
        s = i / (n_tail - 1) * 2 - 1
        roots.append((0, y0 + 0.012, s * D * 0.3))
        lobe = abs(s) ** 1.4
        L = 0.11 + 0.07 * lobe - fork * 0.05 * (1 - abs(s)) ** 2
        tips.append((0, y0 - L, s * D * (0.75 + 0.4 * lobe)))
    ray_fin('tail', roots, tips)
    if spec.get('tailtip'):
        tip = sphere(0.012, 8, 6, at=(0, y0 - 0.17, -D * 1.05), scale=(0.2, 1.5, 0.8))
        m.add('tail', piece_from_bm(tip, lambda co, n: (0.95, 0.95, 0.92)))
    d0, d1 = spec['dorsal']
    n = 13
    roots = [(0, lerp(y0, y1, lerp(d0, d1, i / (n - 1))), top_z(lerp(d0, d1, i / (n - 1))) - 0.002) for i in range(n)]
    tips = [(0, r_[1] - 0.025, r_[2] + D * (0.55 + 0.35 * math.sin(i / (n - 1) * math.pi * 0.9 + 0.3))) for i, r_ in enumerate(roots)]
    ray_fin('body', roots, tips)
    if spec['spiny']:
        s0, s1 = spec['spiny']
        n = 17
        roots = [(0, lerp(y0, y1, lerp(s0, s1, i / (n - 1))), top_z(lerp(s0, s1, i / (n - 1))) - 0.002) for i in range(n)]
        tips = [(0, r_[1] - 0.012, r_[2] + D * (0.5 + 0.45 * math.sin(i / (n - 1) * math.pi * 0.85 + 0.25)) * (1.0 if i % 2 == 0 else 0.72)) for i, r_ in enumerate(roots)]
        ray_fin('body', roots, tips, spiny=True)
        if kind == 'walleye':
            spot = sphere(0.012, 8, 6, at=(0, lerp(y0, y1, s0 + 0.02), top_z(s0 + 0.02) + D * 0.35), scale=(0.15, 1.6, 1.0))
            m.add('body', piece_from_bm(spot, lambda co, n: (0.06, 0.05, 0.04)))
    a0, a1 = spec['anal']
    n = 11
    roots = [(0, lerp(y0, y1, lerp(a0, a1, i / (n - 1))), bot_z(lerp(a0, a1, i / (n - 1))) + 0.002) for i in range(n)]
    tips = [(0, r_[1] - 0.03, r_[2] - D * (0.45 + 0.25 * math.sin(i / (n - 1) * math.pi))) for i, r_ in enumerate(roots)]
    ray_fin('body', roots, tips)
    n = 9
    for side in (-1, 1):
        pt = gill - 0.04
        st = st_at(pt)
        base_y = lerp(y0, y1, pt)
        bx = side * st[1] * 0.85
        bz = st[0][2] - st[3] * 0.35
        roots = [(bx, base_y - 0.006 * i / (n - 1), bz + D * 0.12 * (i / (n - 1) - 0.5)) for i in range(n)]
        tips = [(bx + side * D * 0.35, r_[1] - D * (0.9 + 0.3 * math.sin(i / (n - 1) * math.pi)), r_[2] - D * 0.25) for i, r_ in enumerate(roots)]
        ray_fin('body', roots, tips, normal_hint=Vector((0, 0.3, 1)))
        pv = gill - 0.12
        st = st_at(pv)
        py = lerp(y0, y1, pv)
        px = side * st[1] * 0.4
        pz = st[0][2] - st[3] * 0.9
        roots = [(px, py - 0.03 * i / (n - 1), pz) for i in range(n)]
        tips = [(px + side * D * 0.25, r_[1] - D * (0.7 + 0.25 * math.sin(i / (n - 1) * math.pi)), pz - D * 0.4) for i, r_ in enumerate(roots)]
        ray_fin('body', roots, tips, normal_hint=Vector((side * 0.3, 0, 1)))
    m.pivots['tail'] = (0, -0.4, 0)
    write_model(m)


def build_antlers():
    m = Model('antlers', ground=False, ao_dist=0.15, ao_strength=0.35)
    def col(co, n):
        tip = smooth01(1.66, 1.92, co.z)
        grain = n3(Vector((co.x * 60, co.y * 60, co.z * 60)), 1.0) * 0.05
        c = mix((0.36, 0.29, 0.2), (0.9, 0.85, 0.74), tip)
        return (c[0] + grain, c[1] + grain, c[2] + grain)
    piv = (0, 0.55, 1.1)
    def beam_at(side, t):
        x = side * (0.06 + 0.25 * math.sin(t * math.pi * 0.62))
        y = 0.82 - 0.11 * math.sin(t * math.pi * 0.9) + 0.34 * t * t
        z = 1.6 + 0.15 * math.sin(t * math.pi * 0.75) - 0.03 * t
        return (x, y, z)
    for side in (-1, 1):
        steps = 14
        beam = [beam_at(side, i / (steps - 1)) for i in range(steps)]
        m.add('antlers', piece_from_bm(tube(beam, [0.032 - 0.024 * (i / (steps - 1)) for i in range(steps)], 8), col), pivot=piv)
        burr = sphere(0.038, 10, 6, at=beam[0], scale=(1, 1, 0.45))
        m.add('antlers', piece_from_bm(burr, lambda co, n: (0.3, 0.24, 0.17)), pivot=piv)
        b = beam_at(side, 0.1)
        m.add('antlers', piece_from_bm(tube([b, (b[0] - side * 0.005, b[1] + 0.03, b[2] + 0.06), (b[0] - side * 0.01, b[1] + 0.05, b[2] + 0.11)], [0.015, 0.01, 0.004], 6), col), pivot=piv)
        for t, h in ((0.34, 0.24), (0.55, 0.21), (0.76, 0.15)):
            b = beam_at(side, t)
            tine = [b, (b[0] - side * 0.006, b[1] + 0.012, b[2] + h * 0.4), (b[0] - side * 0.018, b[1] + 0.03, b[2] + h * 0.78), (b[0] - side * 0.028, b[1] + 0.045, b[2] + h)]
            m.add('antlers', piece_from_bm(tube(tine, [0.018, 0.014, 0.009, 0.003], 6), col), pivot=piv)
    write_model(m)
