def gauss3(p, c, r):
    d = (Vector(p) - Vector(c)).length / r
    return math.exp(-d * d)


def loft_piece(stations, color_fn, ring=28, power=0.85, tile=0.15, cap_start=True, cap_end=True, side=Vector((1, 0, 0)), disp=None, flip_uv=False):
    count = len(stations)
    frames = []
    for i, st in enumerate(stations):
        c = Vector(st[0])
        t = Vector(stations[min(count - 1, i + 1)][0]) - Vector(stations[max(0, i - 1)][0])
        t = t.normalized() if t.length > 1e-6 else Vector((0, 1, 0))
        up = side.cross(t)
        up = up.normalized() if up.length > 1e-6 else Vector((0, 0, 1))
        sx = side - t * side.dot(t)
        sx = sx.normalized() if sx.length > 1e-6 else side
        frames.append((c, sx, up, st[1], st[2], st[3]))
    grid = []
    for (c, sx, up, w, htop, hbot) in frames:
        row = []
        for k in range(ring + 1):
            a = (k % ring) / ring * math.tau
            ca, sa = math.cos(a), math.sin(a)
            u = math.copysign(abs(ca) ** power, ca)
            v = math.copysign(abs(sa) ** power, sa)
            h = htop if u > 0 else hbot
            p = c + sx * (v * w) + up * (u * h)
            row.append(p)
        grid.append(row)
    if disp:
        for i, (c, sx, up, w, htop, hbot) in enumerate(frames):
            for k in range(ring + 1):
                p = grid[i][k]
                out = (p - c)
                out = out.normalized() if out.length > 1e-6 else up
                grid[i][k] = p + out * disp(p, i / (count - 1), (k % ring) / ring)
            grid[i][ring] = grid[i][0].copy()
    length = [0.0]
    for i in range(1, count):
        length.append(length[-1] + (frames[i][0] - frames[i - 1][0]).length)
    circ = sum(math.pi * (3 * (f[3] + (f[4] + f[5]) / 2) - math.sqrt((3 * f[3] + (f[4] + f[5]) / 2) * (f[3] + 3 * (f[4] + f[5]) / 2))) for f in frames) / count
    reps = max(1, round(circ / tile))
    p = Piece()
    p.uv = []
    index = {}
    for i in range(count):
        for k in range(ring + 1):
            pos = grid[i][k]
            dv = grid[i][(k + 1) if k < ring else 1] - grid[i][(k - 1) if k > 0 else ring - 1]
            du = grid[min(count - 1, i + 1)][k] - grid[max(0, i - 1)][k]
            n = du.cross(dv)
            if n.length < 1e-9:
                n = pos - frames[i][0]
            n = n.normalized()
            if n.dot(pos - frames[i][0]) < 0:
                n = -n
            index[(i, k)] = len(p.pos)
            p.pos.append(tuple(pos))
            p.nor.append(tuple(n))
            p.col.append(color_fn(pos, n))
            uu = length[i] / tile
            vv = k / ring * reps
            p.uv.append((vv, uu) if flip_uv else (uu, vv))
    def tri(a, b, c, outward):
        pa, pb, pc = Vector(p.pos[a]), Vector(p.pos[b]), Vector(p.pos[c])
        fn = (pb - pa).cross(pc - pa)
        p.tris.append((a, b, c) if fn.dot(outward) >= 0 else (a, c, b))
    for i in range(count - 1):
        for k in range(ring):
            a, b, c, d = index[(i, k)], index[(i, k + 1)], index[(i + 1, k + 1)], index[(i + 1, k)]
            outward = Vector(p.nor[a]) + Vector(p.nor[c])
            tri(a, b, c, outward)
            tri(a, c, d, outward)
    for flag, i, sign in ((cap_start, 0, -1), (cap_end, count - 1, 1)):
        if not flag:
            continue
        c = frames[i][0]
        nrm = (frames[min(count - 1, i + 1)][0] - frames[max(0, i - 1)][0]).normalized() * sign
        ci = len(p.pos)
        p.pos.append(tuple(c))
        p.nor.append(tuple(nrm))
        p.col.append(color_fn(c, nrm))
        p.uv.append((length[i] / tile, 0.0))
        for k in range(ring):
            tri(index[(i, k)], index[(i, k + 1)], ci, nrm)
    return p


def deer_relief(p, s, a):
    x, y, z = p.x, p.y, p.z
    d = 0.0
    for sx in (-1, 1):
        d += 0.014 * gauss3(p, (sx * 0.13, 0.36, 1.02), 0.09)
        d += 0.012 * gauss3(p, (sx * 0.12, -0.33, 1.06), 0.05)
        d += 0.01 * gauss3(p, (sx * 0.13, -0.5, 0.93), 0.09)
        d += 0.006 * gauss3(p, (sx * 0.06, 0.93, 1.52), 0.03)
        if 0.0 < y < 0.32 and 0.72 < z < 1.0 and abs(x) > 0.1:
            d += 0.0035 * math.sin(y * 62) * smooth01(0.0, 0.08, y) * smooth01(0.32, 0.24, y)
        d -= 0.008 * gauss3(p, (sx * 0.07, 0.66, 1.25), 0.06) * (1 if z < 1.3 else 0.3)
    d -= 0.012 * gauss3(p, (0, -0.18, 0.74), 0.12)
    d += 0.008 * gauss3(p, (0, 0.44, 1.18), 0.06)
    d += n3(Vector((x * 18, y * 18, z * 18)), 1.0) * 0.003
    return d


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
    body = [st for st in resample_stations(body, 26)]
    m.add('body', loft_piece(body, deer_coat, ring=36, power=0.8, tile=0.16, disp=deer_relief), material='fur')
    tail = [((0, -0.64, 1.07), 0.03, 0.02, 0.02), ((0, -0.69, 1.05), 0.05, 0.025, 0.02), ((0, -0.76, 0.99), 0.045, 0.02, 0.018), ((0, -0.79, 0.94), 0.02, 0.01, 0.01)]
    m.add('body', loft_piece(tail, lambda co, n: (0.42, 0.3, 0.2) if n.y < -0.3 and n.z > -0.2 and abs(co.x) < 0.03 else (0.95, 0.93, 0.9), ring=14, power=0.9, tile=0.06), material='fur')
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
    neck = resample_stations(neck, 30)
    def head_col(co, n):
        c = deer_coat(co, n)
        c = mix(c, (0.47, 0.38, 0.29), 0.45)
        if co.y > 1.105:
            return (0.05, 0.045, 0.045)
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
    m.add('head', loft_piece(neck, head_col, ring=30, power=0.82, tile=0.1, cap_start=False, disp=deer_relief), pivot=hp, material='fur')
    for side in (-1, 1):
        ear = sphere(0.1, 16, 12, at=(0, 0, 0), scale=(0.38, 0.16, 1.0))
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
        gland = sphere(0.012, 8, 6, at=(side * 0.06, 0.965, 1.548), scale=(0.6, 1.4, 0.7))
        m.add('head', piece_from_bm(gland, lambda co, n: (0.1, 0.08, 0.07)), pivot=hp)
        ring_ = sphere(0.027, 12, 8, at=(side * 0.058, 0.923, 1.565), scale=(0.55, 1.0, 0.9))
        m.add('head', piece_from_bm(ring_, lambda co, n: (0.92, 0.9, 0.86)), pivot=hp)
        eye = sphere(0.019, 16, 12, at=(side * 0.064, 0.925, 1.565), scale=(0.75, 1.0, 0.85))
        m.add('headEyes', piece_from_bm(eye, lambda co, n: (0.03, 0.022, 0.018)), pivot=hp, material='eye')
        nostril = sphere(0.008, 8, 6, at=(side * 0.016, 1.142, 1.494), scale=(0.7, 0.5, 1.0))
        m.add('headEyes', piece_from_bm(nostril, lambda co, n: (0.0, 0.0, 0.0)), pivot=hp)
        nose = sphere(0.02, 12, 8, at=(side * 0.008, 1.133, 1.5), scale=(1.2, 0.8, 1.0))
        m.add('headEyes', piece_from_bm(nose, lambda co, n: (0.03, 0.028, 0.03)), pivot=hp)

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
        return c
    def leg_relief(p, s, a):
        d = 0.004 * gauss3(p, (p.x, p.y, 0.47), 0.03)
        d += n3(Vector((p.x * 30, p.y * 30, p.z * 30)), 1.0) * 0.0015
        return d
    front = [(0.4, 0.86, 0.044, 0.058), (0.405, 0.76, 0.047, 0.064), (0.405, 0.66, 0.045, 0.06), (0.41, 0.58, 0.04, 0.052), (0.415, 0.5, 0.036, 0.045), (0.42, 0.47, 0.034, 0.04), (0.42, 0.4, 0.026, 0.032), (0.42, 0.25, 0.023, 0.028), (0.425, 0.14, 0.027, 0.034), (0.44, 0.1, 0.024, 0.03), (0.455, 0.065, 0.03, 0.036), (0.47, 0.03, 0.036, 0.046), (0.485, 0.0, 0.038, 0.052)]
    hind = [(-0.46, 0.8, 0.052, 0.085), (-0.46, 0.72, 0.056, 0.09), (-0.5, 0.6, 0.048, 0.075), (-0.56, 0.5, 0.038, 0.06), (-0.585, 0.45, 0.033, 0.055), (-0.575, 0.4, 0.026, 0.034), (-0.565, 0.25, 0.023, 0.028), (-0.555, 0.13, 0.027, 0.034), (-0.545, 0.1, 0.024, 0.03), (-0.53, 0.065, 0.03, 0.036), (-0.515, 0.03, 0.036, 0.046), (-0.5, 0.0, 0.038, 0.052)]
    for name, x, chain, colfn in (('legFL', 0.085, front, leg_col_front), ('legFR', -0.085, front, leg_col_front), ('legBL', 0.078, hind, leg_col_hind), ('legBR', -0.078, hind, leg_col_hind)):
        st = resample_stations([((x, p[0], p[1]), p[2], p[3], p[3]) for p in chain], 22)
        piv = (x, chain[0][0], 0.95)
        m.add(name, loft_piece(st, colfn, ring=16, power=1.0, tile=0.08, cap_start=False, disp=leg_relief), pivot=piv, material='fur')
        back = -1 if chain is front else 1
        for k in (-1, 1):
            dew = sphere(0.009, 8, 6, at=(x + k * 0.014, chain[8][0] - back * 0.035, 0.11), scale=(1, 1.4, 0.8))
            m.add(name, piece_from_bm(dew, lambda co, n: (0.06, 0.05, 0.05)), pivot=piv)
        split = box((0.004, 0.06, 0.05), at=(x, chain[-2][0], 0.03))
        m.add(name, piece_from_bm(split, lambda co, n: (0.11, 0.1, 0.09)), pivot=piv)
    write_model(m)


def resample_stations(stations, n):
    pts = [Vector(s[0]) for s in stations]
    seg = [0.0]
    for i in range(1, len(pts)):
        seg.append(seg[-1] + (pts[i] - pts[i - 1]).length)
    total = seg[-1]
    out = []
    for j in range(n):
        target = total * j / (n - 1)
        i = 1
        while i < len(seg) - 1 and seg[i] < target:
            i += 1
        a, b = i - 1, i
        f = 0.0 if seg[b] == seg[a] else (target - seg[a]) / (seg[b] - seg[a])
        p0 = pts[max(0, a - 1)]
        p1, p2 = pts[a], pts[b]
        p3 = pts[min(len(pts) - 1, b + 1)]
        t = f
        t2, t3 = t * t, t * t * t
        pos = 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
        s = f * f * (3 - 2 * f)
        out.append((tuple(pos), lerp(stations[a][1], stations[b][1], s), lerp(stations[a][2], stations[b][2], s), lerp(stations[a][3], stations[b][3], s)))
    return out


def fin_piece(roots, tips, color, rows=8, normal_hint=Vector((1, 0, 0)), ridge=0.0012, tint=None):
    p = Piece()
    p.uv = []
    cols = len(roots)
    normal = normal_hint.normalized()
    for i in range(cols):
        rr, tt = Vector(roots[i]), Vector(tips[i])
        for j in range(rows + 1):
            f = j / rows
            pos = rr.lerp(tt, f)
            pos = pos + normal * (ridge * (0.5 if i % 2 == 0 else -0.5) * (1 - f))
            p.pos.append(tuple(pos))
            p.nor.append(tuple(normal))
            edge = smooth01(0.55, 1.0, f)
            cc = mix(color, (min(1, color[0] * 1.2), min(1, color[1] * 1.18), min(1, color[2] * 1.12)), edge * 0.6)
            if tint:
                cc = tint(i / (cols - 1), f, cc)
            p.col.append(cc)
            p.uv.append((f, i / (cols - 1)))
    for i in range(cols - 1):
        for j in range(rows):
            a = i * (rows + 1) + j
            b = (i + 1) * (rows + 1) + j
            p.tris.append((a, b, b + 1))
            p.tris.append((a, b + 1, a + 1))
    return p


_previous_build_fish = build_fish


def build_fish(kind, spec):
    m = Model('fish-' + kind, ground=False, ao_dist=0.06, ao_strength=0.3)
    D = spec['len_depth']
    W = D * spec['width']
    y0, y1 = -0.42, 0.5
    N = 90
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
    gy = lerp(y0, y1, gill)
    mouth_y = lerp(y0, y1, 0.9)
    mouth_z = stations[N - 7][0][2]
    def relief(p, s, a):
        d = 0.0
        if p.y < gy:
            d -= 0.0012 * math.exp(-((p.z - D * 0.12) / 0.004) ** 2)
        if gy - 0.01 < p.y < gy + 0.004:
            d += 0.0012
        d += n3(Vector((p.x * 90, p.y * 90, p.z * 90)), 1.0) * 0.0006
        return d
    def col(co, n):
        top = smooth01(-0.2, 0.8, n.z)
        c = mix(spec['base'], spec['back'], top)
        pat = spec['pattern']
        body = co.y < gy
        sideways = n.z > -0.4
        if pat == 'bars' and body and sideways:
            v = n3(Vector((co.y * 26, co.z * 34, 3)), 1.0) + 0.6 * math.sin(co.y * 58 + co.z * 25)
            c = mix(c, (0.2, 0.22, 0.14), 0.6 * smooth01(0.25, 0.45, v))
        elif pat == 'spots' and body and sideways:
            sp = n3(Vector((co.y * 40, co.z * 70, 0)), 1.0)
            c = mix(c, (0.88, 0.86, 0.62), 0.85 * smooth01(0.16, 0.3, sp))
        elif pat == 'mottle' and sideways:
            c = mix(c, (0.22, 0.2, 0.09), 0.5 * smooth01(0.05, 0.2, n3(Vector((co.y * 22, co.z * 30, 1)), 1.0)))
            if body and n.z > 0.25:
                c = mix(c, (0.18, 0.16, 0.07), 0.55 * smooth01(0.45, 0.7, math.sin(co.y * 26 + 0.8)))
        elif pat == 'vbars' and body and sideways:
            c = mix(c, (0.25, 0.2, 0.08), 0.42 * smooth01(0.3, 0.55, math.sin(co.y * 44 + n3(co, 8) * 2.5)))
        elif pat == 'perchbars' and body and sideways and n.z > -0.25:
            c = mix(c, (0.16, 0.19, 0.06), 0.72 * smooth01(0.1, 0.45, math.sin(co.y * 40 - 0.6)))
        belly = smooth01(-0.2, -0.75, n.z)
        c = mix(c, spec['belly'], belly)
        if abs(co.y - gy) < 0.005 and abs(n.x) > 0.3:
            c = mix(c, (0.12, 0.1, 0.08), 0.6)
        if gy < co.y < gy + 0.07 and abs(n.x) > 0.5:
            c = mix(c, (min(1, c[0] * 1.12), min(1, c[1] * 1.1), min(1, c[2] * 1.06)), 0.5)
        if co.y > mouth_y and abs(n.x) > 0.5 and abs(co.z - mouth_z) < D * 0.05:
            c = mix(c, (0.08, 0.06, 0.05), 0.8)
        g = n3(Vector((co.y * 160, co.z * 160, co.x * 160)), 1.0) * 0.02
        return (c[0] + g, c[1] + g, c[2] + g)
    m.add('body', loft_piece(stations, col, ring=40, power=0.92, tile=0.07, disp=relief), material='scales')
    eye_t = gill + (1 - gill) * 0.42
    ey = lerp(y0, y1, eye_t)
    est = stations[int(eye_t * (N - 1))]
    for side in (-1, 1):
        r = D * 0.17 + 0.006
        ex = side * est[1] * 0.82
        ez = est[0][2] + est[2] * 0.35
        ball = sphere(r, 20, 14, at=(ex, ey, ez), scale=(0.5, 1, 1))
        m.add('eyes', piece_from_bm(ball, lambda co, n, s=side: spec['eye'] if n.x * s > 0.55 else (spec['eye'][0] * 0.35, spec['eye'][1] * 0.3, spec['eye'][2] * 0.25)), material='eye')
        pupil = sphere(r * 0.48, 14, 10, at=(ex + side * r * 0.36, ey, ez), scale=(0.35, 1, 1))
        m.add('eyes', piece_from_bm(pupil, lambda co, n: (0.01, 0.01, 0.012)), material='eye')
    fc = spec['fins']
    def st_at(t):
        return stations[max(0, min(N - 1, int(t * (N - 1))))]
    def top_z(t):
        st = st_at(t)
        return st[0][2] + st[2] * 0.92
    def bot_z(t):
        st = st_at(t)
        return st[0][2] - st[3] * 0.92
    n_tail = 19
    roots, tips = [], []
    fork = spec['fork']
    for i in range(n_tail):
        s = i / (n_tail - 1) * 2 - 1
        roots.append((0, y0 + 0.014, s * D * 0.3))
        lobe = abs(s) ** 1.4
        L = 0.11 + 0.07 * lobe - fork * 0.05 * (1 - abs(s)) ** 2
        tips.append((0, y0 - L, s * D * (0.75 + 0.4 * lobe)))
    white_tip = (lambda v, f, c: mix(c, (0.96, 0.96, 0.93), smooth01(0.6, 0.85, f) * smooth01(0.2, 0.05, v))) if spec.get('tailtip') else None
    m.add('tail', fin_piece(roots, tips, fc, tint=white_tip), material='fin')
    d0, d1 = spec['dorsal']
    n = 13
    roots = [(0, lerp(y0, y1, lerp(d0, d1, i / (n - 1))), top_z(lerp(d0, d1, i / (n - 1)))) for i in range(n)]
    tips = [(0, r_[1] - 0.025, r_[2] + D * (0.55 + 0.35 * math.sin(i / (n - 1) * math.pi * 0.9 + 0.3))) for i, r_ in enumerate(roots)]
    m.add('fins', fin_piece(roots, tips, fc), material='fin')
    if spec['spiny']:
        s0, s1 = spec['spiny']
        n = 17
        roots = [(0, lerp(y0, y1, lerp(s0, s1, i / (n - 1))), top_z(lerp(s0, s1, i / (n - 1)))) for i in range(n)]
        tips = [(0, r_[1] - 0.012, r_[2] + D * (0.5 + 0.45 * math.sin(i / (n - 1) * math.pi * 0.85 + 0.25)) * (1.0 if i % 2 == 0 else 0.8)) for i, r_ in enumerate(roots)]
        m.add('fins', fin_piece(roots, tips, mix(fc, (0.15, 0.13, 0.1), 0.25)), material='fin')
        if kind == 'walleye':
            spot = sphere(0.011, 10, 8, at=(0, lerp(y0, y1, s0 + 0.025), top_z(s0 + 0.025) + D * 0.16), scale=(0.12, 1.5, 1.0))
            m.add('fins', piece_from_bm(spot, lambda co, n: (0.06, 0.05, 0.04)), material='fin')
    a0, a1 = spec['anal']
    n = 11
    roots = [(0, lerp(y0, y1, lerp(a0, a1, i / (n - 1))), bot_z(lerp(a0, a1, i / (n - 1)))) for i in range(n)]
    tips = [(0, r_[1] - 0.03, r_[2] - D * (0.45 + 0.25 * math.sin(i / (n - 1) * math.pi))) for i, r_ in enumerate(roots)]
    m.add('fins', fin_piece(roots, tips, fc), material='fin')
    n = 9
    for side in (-1, 1):
        pt = gill - 0.04
        st = st_at(pt)
        base_y = lerp(y0, y1, pt)
        bx = side * st[1] * 0.85
        bz = st[0][2] - st[3] * 0.35
        roots = [(bx, base_y - 0.006 * i / (n - 1), bz + D * 0.12 * (i / (n - 1) - 0.5)) for i in range(n)]
        roots = [(bx, base_y - 0.004 * i / (n - 1), bz + D * 0.28 * (i / (n - 1) - 0.5)) for i in range(n)]
        tips = [(bx + side * D * 0.18, r_[1] - D * (0.85 + 0.35 * math.sin(i / (n - 1) * math.pi)), r_[2] - D * 0.18 + D * 0.15 * (i / (n - 1) - 0.5)) for i, r_ in enumerate(roots)]
        m.add('fins', fin_piece(roots, tips, fc, normal_hint=Vector((side, 0.15, 0.3))), material='fin')
        pv = gill - 0.12
        st = st_at(pv)
        py = lerp(y0, y1, pv)
        px = side * st[1] * 0.4
        pz = st[0][2] - st[3] * 0.9
        roots = [(px, py - 0.03 * i / (n - 1), pz) for i in range(n)]
        tips = [(px + side * D * 0.25, r_[1] - D * (0.7 + 0.25 * math.sin(i / (n - 1) * math.pi)), pz - D * 0.4) for i, r_ in enumerate(roots)]
        m.add('fins', fin_piece(roots, tips, fc, normal_hint=Vector((side * 0.3, 0, 1))), material='fin')
    m.pivots['tail'] = (0, -0.4, 0)
    write_model(m)
