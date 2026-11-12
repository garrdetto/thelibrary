CABIN_W = 8.0
CABIN_D = 6.0
CABIN_FLOOR = 0.45
CABIN_WALL = 2.65
LOG_R = 0.15
LOG_STEP = 0.27
DOOR = (-0.5, 0.5, 2.15)
FRONT_WINDOWS = [(-2.9, -1.9), (1.9, 2.9)]
BACK_WINDOWS = [(-0.6, 0.6)]
SIDE_WINDOWS = [(-0.6, 0.6)]
WIN_Z = (1.35, 2.3)


def wood(base, dark):
    def f(co, n):
        grain = n3(Vector((co[0] * 2.5, co[1] * 2.5, co[2] * 40)), 1) * 0.5 + 0.5
        streak = n3(Vector((co[0] * 0.8, co[1] * 0.8, co[2] * 0.8)) * 6, 1) * 0.5 + 0.5
        return mix(base, dark, grain * 0.55 + streak * 0.25)
    return f


LOG_COL = ((0.62, 0.43, 0.24), (0.38, 0.24, 0.12))
END_GRAIN = ((0.78, 0.6, 0.38), (0.5, 0.34, 0.18))


def log_piece(a, b, r, seg=10, steps_per_m=2.2, seed=0.0):
    a, b = Vector(a), Vector(b)
    L = (b - a).length
    n = max(1, int(L * steps_per_m))
    pts = [a + (b - a) * (i / n) for i in range(n + 1)]
    radii = [r * (0.96 + 0.06 * n3(Vector((p.x * 1.7 + seed, p.y * 1.7, p.z * 1.7)), 1)) for p in pts]
    bm = tube([tuple(p) for p in pts], radii, seg, cap=False)
    axis = (b - a).normalized()

    def col(co, nn):
        c = Vector(co)
        u = (c - a).dot(axis)
        around = math.atan2(nn[2], nn[0] + nn[1])
        base = mix(LOG_COL[0], LOG_COL[1], n3(Vector((u * 0.6 + seed, around * 3, 0)), 1) * 0.5 + 0.45)
        check = abs(n3(Vector((u * 1.5 + seed, around * 6, 1)), 1)) < 0.04
        if check:
            base = mix(base, (0.2, 0.12, 0.06), 0.7)
        if nn[2] > 0.6:
            base = mix(base, (0.72, 0.56, 0.36), 0.2)
        return base
    piece = piece_from_bm(bm, col)
    for end, sgn in ((a, -1), (b, 1)):
        cap = cone(r * 0.98, r * 0.98, 0.01, seg, at=(0, 0, 0))
        q = Vector((0, 0, 1)).rotation_difference(axis * sgn).to_matrix().to_4x4()
        xform(cap, Matrix.Translation(end) @ q)

        def ring(co, nn, end=end):
            d = (Vector(co) - end).length
            k = 0.5 + 0.5 * math.sin(d * 140)
            return mix(END_GRAIN[0], END_GRAIN[1], k * 0.6 + (0.3 if d > r * 0.85 else 0.0))
        yield piece_from_bm(cap, ring, smooth=False)
    yield piece


def wall_spans(length, openings, z):
    cuts = sorted([(x0, x1) for (x0, x1, z0, z1) in openings if z0 - LOG_R * 0.6 < z < z1 + LOG_R * 0.6])
    spans = []
    start = -length / 2
    for x0, x1 in cuts:
        if x0 > start:
            spans.append((start, x0))
        start = max(start, x1)
    if start < length / 2:
        spans.append((start, length / 2))
    return spans


OUTFITTERS_W = 12.0
OUTFITTERS_D = 8.0
GARAGE_W = 6.0
GARAGE_FLOOR = 0.2
GARAGE_WALL = 2.75
OUTFITTERS_WINDOWS = [(-4.6, -3.6), (-2.5, -1.5), (1.5, 2.5), (3.6, 4.6)]


def build_cabin(name='cabin', W=CABIN_W, D=CABIN_D, garage=False, front_windows=FRONT_WINDOWS):
    """The log cabin; with `garage`, Fox Lake's Fox Outfitters: bigger, with store shelving and an open garage bay on the east side."""
    m = Model(name, ao_dist=0.9, ao_strength=0.6)
    F = CABIN_FLOOR
    stone = lambda co, n: mix((0.42, 0.41, 0.38), (0.25, 0.25, 0.24), n3(Vector(co) * 3, 1) * 0.5 + 0.5 + max(0.0, n[2]) * -0.2)
    planks = lambda co, n: mix((0.55, 0.38, 0.22), (0.36, 0.23, 0.12), (int((co[0] + 10) / 0.16) % 3) / 3 * 0.6 + n3(Vector((co[0] * 3, co[1] * 0.4, 0)), 1) * 0.3 + 0.2)
    porch_c = lambda co, n: mix((0.5, 0.42, 0.32), (0.32, 0.26, 0.19), (int((co[0] + 10) / 0.14) % 2) * 0.35 + n3(Vector((co[0] * 0.5, co[1] * 4, 0)), 1) * 0.3 + 0.2)
    iron = grain((0.06, 0.06, 0.065), 0.08)
    trim = wood((0.32, 0.2, 0.1), (0.22, 0.13, 0.06))

    def add(bm_or_piece, col=None, part='cabin', smooth=True):
        if col is None:
            m.add(part, bm_or_piece)
        else:
            m.add(part, piece_from_bm(bm_or_piece, col, smooth=smooth))

    for x in (-W / 2 + 0.3, -1.3, 1.3, W / 2 - 0.3):
        for y in (-D / 2 + 0.3, 0.0, D / 2 - 0.3, D / 2 + 1.9):
            pier = rounded_box((0.4, 0.4, F + 0.7), at=(x, y, F / 2 - 0.35), bevel=0.05)
            displace_local(pier, (x, y, F / 2 - 0.35), 0.03, 6)
            add(pier, stone)
    add(rounded_box((W - 0.1, D - 0.1, 0.06), at=(0, 0, F - 0.03), bevel=0.01), planks)
    add(rounded_box((W + 0.2, 2.2, 0.06), at=(0, D / 2 + 1.1, F - 0.03), bevel=0.01), porch_c)
    for k, z in enumerate((0.15, 0.3)):
        add(rounded_box((1.6, 0.3, 0.05), at=(0, D / 2 + 2.35 + 0.3 * k, z), bevel=0.01), porch_c)
    for side in (-1, 1):
        add(rounded_box((0.06, 0.62, 0.3), at=(side * 0.82, D / 2 + 2.45, 0.15), bevel=0.01), trim)

    walls = [
        ('front', (0, D / 2, 0), 0.0, W, [(DOOR[0], DOOR[1], 0, DOOR[2])] + [(a, b, WIN_Z[0], WIN_Z[1]) for a, b in front_windows]),
        ('back', (0, -D / 2, 0), 0.0, W, [(a, b, WIN_Z[0], WIN_Z[1]) for a, b in BACK_WINDOWS]),
        ('left', (-W / 2, 0, 0), math.pi / 2, D, [(a, b, WIN_Z[0], WIN_Z[1]) for a, b in SIDE_WINDOWS]),
        ('right', (W / 2, 0, 0), math.pi / 2, D, [(a, b, WIN_Z[0] - 0.1, WIN_Z[1]) for a, b in SIDE_WINDOWS]),
    ]
    courses = int(CABIN_WALL / LOG_STEP) + 1
    for name, center, rot, length, openings in walls:
        R = Matrix.Translation(center) @ Matrix.Rotation(rot, 4, 'Z')
        offset = 0.0 if rot == 0 else LOG_STEP / 2
        for c in range(courses):
            z = F + LOG_R + c * LOG_STEP + offset
            if z > F + CABIN_WALL + 0.1:
                break
            for (x0, x1) in wall_spans(length, openings, z - F):
                ext0 = 0.35 if x0 <= -length / 2 + 1e-6 else 0.0
                ext1 = 0.35 if x1 >= length / 2 - 1e-6 else 0.0
                a = R @ Vector((x0 - ext0, 0, z))
                b = R @ Vector((x1 + ext1, 0, z))
                for p in log_piece(tuple(a), tuple(b), LOG_R, seed=c * 3.1 + rot):
                    add(p)
        for (x0, x1, z0, z1) in openings:
            for x in (x0, x1):
                p = R @ Vector((x, 0, F + (z0 + z1) / 2))
                add(xform(rounded_box((0.09, LOG_R * 2.3, z1 - z0 + 0.12), bevel=0.01), Matrix.Translation(p) @ Matrix.Rotation(rot, 4, 'Z')), trim)
            for z in ((z0, z1) if z0 > 0 else (z1,)):
                p = R @ Vector(((x0 + x1) / 2, 0, F + z))
                add(xform(rounded_box((x1 - x0 + 0.18, LOG_R * 2.4, 0.09), bevel=0.01), Matrix.Translation(p) @ Matrix.Rotation(rot, 4, 'Z')), trim)
            if z0 > 0:
                pm = R @ Vector(((x0 + x1) / 2, 0, F + (z0 + z1) / 2))
                add(xform(box((x1 - x0, 0.035, 0.035)), Matrix.Translation(pm) @ Matrix.Rotation(rot, 4, 'Z')), trim)
                add(xform(box((0.035, 0.035, z1 - z0)), Matrix.Translation(pm) @ Matrix.Rotation(rot, 4, 'Z')), trim)
                for sgn in (-1, 1):
                    ps = R @ Vector((x0 - 0.3 if sgn < 0 else x1 + 0.3, LOG_R + 0.04, F + (z0 + z1) / 2))
                    if name != 'front':
                        ps = R @ Vector((x0 - 0.3 if sgn < 0 else x1 + 0.3, -(LOG_R + 0.04) if name == 'back' else (-(LOG_R + 0.04) if name == 'left' else LOG_R + 0.04), F + (z0 + z1) / 2))
                    shutter = rounded_box((0.5, 0.04, z1 - z0 + 0.1), bevel=0.01)
                    add(xform(shutter, Matrix.Translation(ps) @ Matrix.Rotation(rot, 4, 'Z')), lambda co, n: mix((0.15, 0.27, 0.17), (0.1, 0.19, 0.12), (int(co[2] * 12) % 2) * 0.4))
    eave = F + CABIN_WALL + 0.1
    ridge = eave + 1.75
    k = 0
    z = eave + LOG_R * 0.6
    while z < ridge - 0.12:
        half = (D / 2 + 0.05) * (1 - (z - eave) / (ridge - eave))
        for x in (-W / 2, W / 2):
            for p in log_piece((x, -half, z), (x, half, z), LOG_R * 0.92, seed=k * 2.3 + x):
                add(p)
        z += LOG_STEP * 0.95
        k += 1
    slope = math.atan2(ridge - eave, D / 2)
    run = (D / 2 + 0.6) / math.cos(slope)
    for s in (-1, 1):
        mid_y = s * (D / 2 + 0.6) / 2
        mid_z = (ridge + 0.1 + eave - 0.6 * math.tan(slope)) / 2 + 0.05
        rot = Matrix.Rotation(-s * slope, 4, 'X')
        slab = rounded_box((W + 1.0, run, 0.12), bevel=0.02)
        xform(slab, Matrix.Translation((0, mid_y, mid_z)) @ rot)

        def roof_col(co, n):
            if n[2] > 0.3:
                seam = abs(math.sin(co[0] * math.pi / 0.42)) < 0.08
                c = mix((0.2, 0.3, 0.22), (0.27, 0.38, 0.28), n3(Vector(co) * 2, 1) * 0.5 + 0.5)
                return mix(c, (0.12, 0.18, 0.13), 0.6) if seam else c
            return mix((0.58, 0.42, 0.26), (0.42, 0.29, 0.16), (int((co[1] + 10) / 0.14) % 2) * 0.4)
        add(slab, roof_col)
        fascia = rounded_box((W + 1.04, 0.05, 0.22), bevel=0.01)
        xform(fascia, Matrix.Translation((0, s * (D / 2 + 0.62), eave - 0.6 * math.tan(slope) + 0.02)))
        add(fascia, trim)
    add(rounded_box((W + 1.1, 0.24, 0.1), at=(0, 0, ridge + 0.13), bevel=0.03), lambda co, n: (0.14, 0.2, 0.15))
    p_slope = math.atan2(0.42, 2.0)
    porch_roof = rounded_box((W + 0.6, 2.05 / math.cos(p_slope), 0.1), bevel=0.02)
    xform(porch_roof, Matrix.Translation((0, D / 2 + 0.6 + 1.0, eave - 0.3)) @ Matrix.Rotation(-p_slope, 4, 'X'))
    add(porch_roof, lambda co, n: (mix((0.2, 0.3, 0.22), (0.12, 0.18, 0.13), 0.6) if abs(math.sin(co[0] * math.pi / 0.42)) < 0.08 else mix((0.2, 0.3, 0.22), (0.27, 0.38, 0.28), n3(Vector(co) * 2, 1) * 0.5 + 0.5)) if n[2] > 0.3 else mix((0.58, 0.42, 0.26), (0.42, 0.29, 0.16), (int((co[0] + 10) / 0.14) % 2) * 0.4))
    for p in log_piece((-W / 2, D / 2 + 2.05, eave - 0.52), (W / 2, D / 2 + 2.05, eave - 0.52), 0.11, seed=7.7):
        add(p)
    for k in range(5):
        x = -W / 2 + 0.25 + k * (W - 0.5) / 4
        add(rounded_box((0.14, D + 0.6, 0.18), at=(x, 0.0, eave - 0.05), bevel=0.03), trim)
    for x in (-W / 2 + 0.25, -1.4, 1.4, W / 2 - 0.25):
        for p in log_piece((x, D / 2 + 2.05, F), (x, D / 2 + 2.05, eave - 0.52), 0.1, seed=x):
            add(p)
    for side in (-1, 1):
        rail = [(side * (W / 2 - 0.25), D / 2 + 2.05, F + 0.9), (side * 0.85, D / 2 + 2.05, F + 0.9)]
        for p in log_piece(rail[0], rail[1], 0.06, seed=side):
            add(p)
        for k in range(9):
            x = side * (0.95 + k * (W / 2 - 1.3) / 8)
            add(rounded_box((0.05, 0.05, 0.86), at=(x, D / 2 + 2.05, F + 0.45), bevel=0.01), trim)
        for p in log_piece((side * (W / 2 + 0.05), D / 2 + 0.2, F + 0.9), (side * (W / 2 + 0.05), D / 2 + 2.05, F + 0.9), 0.06, seed=side + 3):
            add(p)
    ch = (-W / 2 - 0.55, -0.8)
    for k in range(26):
        z = -0.2 + k * 0.22
        if z > ridge + 0.9:
            break
        w = 1.1 if z < eave - 0.6 else 0.7
        for j in range(4):
            sx = ch[0] + (j - 1.5) * w / 4
            for jj in range(3):
                sy = ch[1] + (jj - 1) * (0.7 if z < eave - 0.6 else 0.5) / 3
                st = rounded_box((w / 4 - 0.02, (0.7 if z < eave - 0.6 else 0.5) / 3 - 0.02, 0.2), at=(sx + (0.02 if k % 2 else -0.02), sy, z + 0.1), bevel=0.03, segs=1)
                displace_local(st, (sx, sy, z + 0.1), 0.012, 9, seed=k * 3 + j + jj * 7)
                add(st, stone)
    add(cone(0.12, 0.12, 0.4, 16, at=(ch[0], ch[1], ridge + 1.0)), iron)

    door = rounded_box((1.0, 0.06, DOOR[2]), bevel=0.01)
    xform(door, Matrix.Translation((DOOR[0] + 0.03, D / 2 - 0.5, F + DOOR[2] / 2)) @ Matrix.Rotation(math.radians(95), 4, 'Z') @ Matrix.Translation((0.5, 0, 0)))
    add(door, lambda co, n: mix((0.42, 0.27, 0.14), (0.3, 0.18, 0.09), (int((co[1] + 10) / 0.16) % 2) * 0.4))
    for z in (0.5, 1.75):
        add(rounded_box((0.04, 0.5, 0.06), at=(DOOR[0] + 0.07, D / 2 - 0.35, F + z), bevel=0.01), iron)

    rug = cone(1.1, 1.1, 0.012, 40, at=(0.5, 0.2, F))
    bmesh.ops.scale(rug, vec=(1.0, 0.7, 1.0), verts=rug.verts)
    add(rug, lambda co, n: [(0.55, 0.18, 0.12), (0.2, 0.3, 0.45), (0.75, 0.65, 0.45), (0.3, 0.42, 0.22)][int(math.hypot(co[0] - 0.5, (co[1] - 0.2) / 0.7) / 0.15) % 4])
    sx, sy = -W / 2 + 0.75, -0.8
    add(rounded_box((0.62, 0.5, 0.55), at=(sx, sy, F + 0.42), bevel=0.03), iron)
    add(rounded_box((0.66, 0.54, 0.04), at=(sx, sy, F + 0.71), bevel=0.01), iron)
    add(rounded_box((0.04, 0.3, 0.25), at=(sx + 0.32, sy, F + 0.4), bevel=0.01), lambda co, n: (0.95, 0.45, 0.1) if n[0] > 0.7 else (0.05, 0.05, 0.05))
    for lx in (-0.25, 0.25):
        for ly in (-0.2, 0.2):
            add(cone(0.03, 0.02, 0.15, 8, at=(sx + lx, sy + ly, F)), iron)
    add(tube([(sx - 0.1, sy, F + 0.72), (sx - 0.1, sy, F + 1.8), (sx - 0.55, sy, F + 2.1)], [0.07, 0.07, 0.07], 14), iron)
    add(rounded_box((1.0, 0.6, 0.02), at=(sx + 0.2, sy, F + 0.005), bevel=0.005), stone)
    bx, by = 2.6, -D / 2 + 1.05
    add(rounded_box((2.1, 1.0, 0.3), at=(bx, by, F + 0.35), bevel=0.03), trim)
    quilt = rounded_box((2.0, 0.98, 0.14), at=(bx, by, F + 0.56), bevel=0.05)
    add(subsurf(quilt, 1), lambda co, n: [(0.6, 0.15, 0.12), (0.85, 0.78, 0.6), (0.2, 0.32, 0.45), (0.3, 0.42, 0.24)][(int((co[0] + 10) / 0.25) + int((co[1] + 10) / 0.25)) % 4])
    add(subsurf(rounded_box((0.5, 0.75, 0.12), at=(bx + 0.75, by, F + 0.68), bevel=0.05), 1), lambda co, n: (0.92, 0.9, 0.85))
    for px in (bx - 1.05, bx + 1.05):
        add(rounded_box((0.08, 1.04, 0.7 if px > bx else 0.45), at=(px, by, F + (0.35 if px > bx else 0.22)), bevel=0.02), trim)
    tx, ty = 0.4, 0.3
    add(rounded_box((1.4, 0.85, 0.06), at=(tx, ty, F + 0.76), bevel=0.015), wood((0.6, 0.42, 0.25), (0.42, 0.28, 0.15)))
    for lx in (-0.62, 0.62):
        for ly in (-0.36, 0.36):
            add(rounded_box((0.06, 0.06, 0.74), at=(tx + lx, ty + ly, F + 0.37), bevel=0.01), trim)
    for cx in (tx - 0.95, tx + 0.95):
        add(rounded_box((0.42, 0.42, 0.04), at=(cx, ty, F + 0.46), bevel=0.01), trim)
        back = rounded_box((0.04, 0.42, 0.5), at=(cx + (0.2 if cx > tx else -0.2), ty, F + 0.72), bevel=0.01)
        add(back, trim)
        for lx in (-0.18, 0.18):
            for ly in (-0.18, 0.18):
                add(rounded_box((0.04, 0.04, 0.45), at=(cx + lx, ty + ly, F + 0.22), bevel=0.008), trim)
    add(cone(0.06, 0.05, 0.22, 16, at=(tx, ty, F + 0.79)), lambda co, n: (0.65, 0.12, 0.08) if co[2] < F + 0.95 else (0.95, 0.85, 0.5))
    add(sphere(0.07, 14, 10, at=(tx, ty, F + 1.06)), lambda co, n: (1.0, 0.92, 0.65))
    wx, wy = -2.6, -D / 2 + 0.42
    arm = rounded_box((1.15, 0.55, 2.0), at=(wx, wy, F + 1.0), bevel=0.03)
    add(arm, wood((0.45, 0.28, 0.14), (0.3, 0.18, 0.08)))
    add(rounded_box((1.25, 0.6, 0.08), at=(wx, wy, F + 2.04), bevel=0.02), trim)
    for dxs in (-0.28, 0.28):
        add(rounded_box((0.52, 0.02, 1.7), at=(wx + dxs, wy + 0.28, F + 1.1), bevel=0.01), wood((0.5, 0.32, 0.17), (0.36, 0.22, 0.1)))
        add(sphere(0.02, 8, 6, at=(wx + dxs * 0.15, wy + 0.3, F + 1.15)), lambda co, n: (0.7, 0.6, 0.35))
    rx, ry = 1.1, -D / 2 + 0.2
    add(rounded_box((1.6, 0.06, 1.2), at=(rx, ry, F + 1.4), bevel=0.01), wood((0.5, 0.34, 0.2), (0.33, 0.21, 0.11)))
    for k, z in enumerate((1.1, 1.45, 1.8)):
        for hx in (rx - 0.65, rx + 0.65):
            add(tube([(hx, ry, F + z), (hx, ry + 0.12, F + z), (hx, ry + 0.14, F + z + 0.04)], [0.015] * 3, 6), trim)
    for zz, yy in ((1.47, 0.1), (1.82, 0.13)):
        add(tube([(rx - 0.8, ry + yy, F + zz), (rx + 0.8, ry + yy, F + zz)], [0.018, 0.01], 8), lambda co, n: (0.12, 0.15, 0.2))
        add(rounded_box((0.22, 0.04, 0.05), at=(rx - 0.55, ry + yy, F + zz), bevel=0.01), lambda co, n: (0.55, 0.42, 0.3))
        add(cyl_x(0.035, 0.05, (rx - 0.45, ry + yy, F + zz - 0.04), seg=14), lambda co, n: (0.6, 0.62, 0.66))
    add(rounded_box((1.2, 0.07, 0.07), at=(rx, ry + 0.11, F + 1.12), bevel=0.01), wood((0.32, 0.18, 0.08), (0.42, 0.26, 0.12)))
    add(rounded_box((0.5, 0.05, 0.05), at=(rx + 0.25, ry + 0.11, F + 1.17), bevel=0.01), iron)
    add(rounded_box((0.45, 0.3, 0.2), at=(rx + 1.1, ry + 0.25, F + 0.1), bevel=0.02), lambda co, n: (0.15, 0.32, 0.18) if co[2] < F + 0.17 else (0.75, 0.62, 0.15))
    dx, dy = W / 2 - 0.5, 1.2
    add(rounded_box((0.8, 1.5, 0.06), at=(dx, dy, F + 0.8), bevel=0.01), wood((0.58, 0.4, 0.22), (0.4, 0.26, 0.13)))
    add(rounded_box((0.7, 0.45, 0.72), at=(dx, dy - 0.45, F + 0.38), bevel=0.02), trim)
    add(rounded_box((0.7, 0.45, 0.72), at=(dx, dy + 0.45, F + 0.38), bevel=0.02), trim)
    add(rounded_box((0.32, 0.24, 0.03), at=(dx - 0.05, dy - 0.1, F + 0.845), bevel=0.005, rot=Matrix.Rotation(0.2, 4, 'Z')), lambda co, n: (0.85, 0.8, 0.65) if n[2] > 0.5 else (0.55, 0.12, 0.1))
    add(rounded_box((0.24, 0.32, 0.03), at=(dx, dy + 0.3, F + 0.845), bevel=0.005), lambda co, n: (0.92, 0.9, 0.82))
    add(cone(0.05, 0.04, 0.2, 12, at=(dx + 0.15, dy + 0.55, F + 0.83)), lambda co, n: (0.3, 0.4, 0.3))
    add(sphere(0.06, 12, 8, at=(dx + 0.15, dy + 0.55, F + 1.08)), lambda co, n: (1.0, 0.9, 0.6))
    add(rounded_box((0.06, 1.1, 0.75), at=(W / 2 - 0.2, dy, F + 1.6), bevel=0.01), lambda co, n: (0.3, 0.22, 0.14) if abs(co[1] - dy) > 0.5 or abs(co[2] - F - 1.6) > 0.33 else mix((0.66, 0.5, 0.32), (0.55, 0.4, 0.24), n3(Vector(co) * 30, 1) * 0.5 + 0.5))
    for k in range(5):
        px = dy - 0.38 + (k % 3) * 0.32
        pz = F + 1.75 - (k // 3) * 0.33
        add(rounded_box((0.012, 0.2, 0.24), at=(W / 2 - 0.17, px + (k * 0.03 % 0.05), pz), bevel=0.003, rot=Matrix.Rotation((k - 2) * 0.05, 4, 'X')), lambda co, n: [(0.95, 0.93, 0.85), (0.95, 0.9, 0.55), (0.85, 0.92, 0.95)][int(co[1] * 10) % 3])
    py_ = -0.8
    plaque = rounded_box((0.06, 0.32, 0.4), at=(-W / 2 + 0.22, py_, F + 2.05), bevel=0.03)
    add(plaque, wood((0.4, 0.22, 0.1), (0.28, 0.14, 0.06)))
    for s in (-1, 1):
        beam = [(-W / 2 + 0.3, py_ + s * 0.05, F + 2.15), (-W / 2 + 0.42, py_ + s * 0.2, F + 2.35), (-W / 2 + 0.45, py_ + s * 0.3, F + 2.6), (-W / 2 + 0.4, py_ + s * 0.25, F + 2.78)]
        add(tube(beam, [0.025, 0.02, 0.016, 0.008], 8), lambda co, n: (0.85, 0.78, 0.65))
        for t in range(3):
            b = Vector(beam[1 + min(t, 2)])
            add(tube([tuple(b), tuple(b + Vector((0.02, s * 0.03, 0.18 - t * 0.03)))], [0.012, 0.005], 6), lambda co, n: (0.88, 0.82, 0.7))
    for k in range(2):
        add(rounded_box((0.25, 1.2, 0.03), at=(-W / 2 + 0.25, 1.6, F + 1.4 + k * 0.42), bevel=0.005), trim)
        for j in range(4):
            add(cone(0.05, 0.045, 0.16, 10, at=(-W / 2 + 0.25, 1.15 + j * 0.3, F + 1.415 + k * 0.42)), lambda co, n, j=j: [(0.5, 0.65, 0.4), (0.7, 0.3, 0.15), (0.85, 0.75, 0.35), (0.4, 0.2, 0.3)][j])
    if garage:
        build_garage(add, W, D, stone, trim, iron)
        build_store_shelves(add, W, D, trim)
    else:
        for k in range(3):
            for j in range(5 - k):
                y = -D / 2 + 0.7 + j * 0.23 + k * 0.115
                for p in log_piece((W / 2 + 0.55, y, 0.11 + k * 0.2), (W / 2 + 1.05, y, 0.11 + k * 0.2), 0.1, steps_per_m=2, seed=k * 5 + j):
                    add(p)
        block = cone(0.24, 0.26, 0.45, 18, at=(W / 2 + 1.0, 0.6, 0.0))
        add(block, wood((0.55, 0.4, 0.25), (0.35, 0.22, 0.12)))
        add(tube([(W / 2 + 1.0, 0.6, 0.45), (W / 2 + 1.12, 0.62, 0.95)], [0.018, 0.016], 6), wood((0.6, 0.45, 0.28), (0.45, 0.32, 0.18)))
        add(rounded_box((0.16, 0.02, 0.12), at=(W / 2 + 1.0, 0.6, 0.49), bevel=0.005), lambda co, n: (0.6, 0.6, 0.62))
    for cx in (-2.2, 2.2):
        cy = D / 2 + 1.3
        add(rounded_box((0.6, 0.55, 0.05), at=(cx, cy, F + 0.38), bevel=0.01, rot=Matrix.Rotation(-0.15, 4, 'X')), lambda co, n: (0.25, 0.4, 0.3))
        add(rounded_box((0.6, 0.06, 0.7), at=(cx, cy - 0.32, F + 0.7), bevel=0.01, rot=Matrix.Rotation(0.35, 4, 'X')), lambda co, n: (0.25, 0.4, 0.3))
        for s in (-1, 1):
            add(rounded_box((0.08, 0.7, 0.04), at=(cx + s * 0.34, cy, F + 0.55), bevel=0.01), lambda co, n: (0.23, 0.38, 0.28))
    write_model(m)


def build_garage(add, W, D, stone, trim, iron):
    """The open garage bay on the east side where the side-by-side sits: concrete pad, log back and side walls, a lean-to
    roof, a header beam with the sign board, and a workbench, pegboard, drum and spare tyre inside."""
    x0, x1 = W / 2, W / 2 + GARAGE_W
    cx = (x0 + x1) / 2
    G = GARAGE_FLOOR
    concrete = lambda co, n: mix((0.56, 0.55, 0.52), (0.42, 0.41, 0.39), n3(Vector(co) * 1.6, 1) * 0.5 + 0.5 + (0.25 if abs(math.sin(co[1] * math.pi / 2.0)) < 0.02 else 0.0))
    add(rounded_box((GARAGE_W + 0.1, D + 0.6, 0.8), at=(cx, 0.3, G - 0.4), bevel=0.03), concrete)
    add(rounded_box((GARAGE_W - 0.3, 1.1, 0.06), at=(cx, D / 2 + 0.45, G - 0.02), bevel=0.02, rot=Matrix.Rotation(-0.12, 4, 'X')), concrete)
    courses = int(GARAGE_WALL / LOG_STEP)
    for c in range(courses):
        z = G + LOG_R + c * LOG_STEP
        for p in log_piece((x0 + 0.2, -D / 2, z), (x1 + 0.35, -D / 2, z), LOG_R, seed=c * 2.7 + 11):
            add(p)
        zs = z + LOG_STEP / 2
        if zs < G + GARAGE_WALL:
            for p in log_piece((x1, -D / 2 - 0.35, zs), (x1, D / 2 + 0.1, zs), LOG_R, seed=c * 1.9 + 23):
                add(p)
    top = G + GARAGE_WALL
    for p in log_piece((x1, D / 2, G), (x1, D / 2, top + 0.15), 0.16, seed=31):
        add(p)
    for p in log_piece((x0 + 0.1, D / 2 + 0.05, top), (x1 + 0.2, D / 2 + 0.05, top), 0.17, seed=37):
        add(p)
    board = rounded_box((GARAGE_W - 0.5, 0.08, 0.62), at=(cx, D / 2 + 0.24, top - 0.42), bevel=0.02)
    add(board, lambda co, n: mix((0.3, 0.18, 0.09), (0.2, 0.11, 0.05), (int((co[2] + 10) / 0.155) % 2) * 0.5 + 0.2) if n[1] < 0.6 else (0.24, 0.14, 0.07))
    for sx in (cx - (GARAGE_W - 0.5) / 2 - 0.05, cx + (GARAGE_W - 0.5) / 2 + 0.05):
        add(rounded_box((0.1, 0.12, 0.7), at=(sx, D / 2 + 0.24, top - 0.42), bevel=0.02), iron)
    slope = math.atan2(0.3, GARAGE_W)
    roof = rounded_box((GARAGE_W + 0.9, D + 1.5, 0.12), bevel=0.02)
    xform(roof, Matrix.Translation((cx + 0.2, 0.35, top + 0.32)) @ Matrix.Rotation(slope, 4, 'Y'))

    def roof_col(co, n):
        if n[2] > 0.3:
            seam = abs(math.sin(co[1] * math.pi / 0.42)) < 0.08
            c = mix((0.2, 0.3, 0.22), (0.27, 0.38, 0.28), n3(Vector(co) * 2, 1) * 0.5 + 0.5)
            return mix(c, (0.12, 0.18, 0.13), 0.6) if seam else c
        return mix((0.58, 0.42, 0.26), (0.42, 0.29, 0.16), (int((co[0] + 10) / 0.14) % 2) * 0.4)
    add(roof, roof_col)
    for k in range(4):
        y = -D / 2 + 0.3 + k * (D - 0.2) / 3
        add(rounded_box((GARAGE_W + 0.3, 0.14, 0.18), at=(cx, y, top + 0.16), bevel=0.03), trim)
    bench_y = -D / 2 + 0.5
    add(rounded_box((2.4, 0.7, 0.07), at=(cx - 0.6, bench_y, G + 0.92), bevel=0.01), wood((0.55, 0.4, 0.24), (0.4, 0.27, 0.14)))
    for lx in (-1.1, 1.1):
        for ly in (-0.28, 0.28):
            add(rounded_box((0.07, 0.07, 0.9), at=(cx - 0.6 + lx, bench_y + ly, G + 0.45), bevel=0.01), trim)
    add(rounded_box((2.3, 0.6, 0.04), at=(cx - 0.6, bench_y, G + 0.25), bevel=0.01), trim)
    add(rounded_box((2.4, 0.04, 1.0), at=(cx - 0.6, -D / 2 + 0.17, G + 1.65), bevel=0.01), lambda co, n: mix((0.62, 0.5, 0.34), (0.5, 0.39, 0.25), 0.4 if (int(co[0] * 25) + int(co[2] * 25)) % 5 == 0 else 0.0))
    for k, (tx, tz, col) in enumerate(((-1.5, 1.85, (0.75, 0.12, 0.1)), (-1.1, 1.5, (0.15, 0.25, 0.6)), (-0.6, 1.9, (0.2, 0.2, 0.22)), (-0.1, 1.45, (0.85, 0.65, 0.1)), (0.3, 1.8, (0.6, 0.6, 0.62)))):
        add(rounded_box((0.06, 0.04, 0.32), at=(cx + tx, -D / 2 + 0.21, G + tz), bevel=0.01, rot=Matrix.Rotation((k - 2) * 0.12, 4, 'Y')), lambda co, n, col=col: col)
    for k, col in enumerate(((0.75, 0.1, 0.08), (0.2, 0.35, 0.2))):
        add(rounded_box((0.42, 0.25, 0.22), at=(cx - 1.3 + k * 0.6, bench_y, G + 1.07), bevel=0.02), lambda co, n, col=col: col if n[2] < 0.7 else mix(col, (0.1, 0.1, 0.1), 0.4))
    dx_, dy_ = x1 - 0.55, -D / 2 + 0.6
    add(cone(0.29, 0.29, 0.88, 22, at=(dx_, dy_, G)), lambda co, n: (0.12, 0.3, 0.55) if abs(co[2] - G - 0.3) > 0.03 and abs(co[2] - G - 0.6) > 0.03 else (0.08, 0.2, 0.38))
    tyre = cone(0.34, 0.34, 0.22, 24, at=(0, 0, -0.11))
    xform(tyre, Matrix.Translation((x1 - 0.32, -0.6, G + 0.36)) @ Matrix.Rotation(math.pi / 2, 4, 'Y') @ Matrix.Rotation(0.15, 4, 'X'))
    add(tyre, lambda co, n: (0.07, 0.07, 0.075))
    for k in range(2):
        add(rounded_box((0.3, 1.6, 0.03), at=(x1 - 0.32, 1.4, G + 1.2 + k * 0.5), bevel=0.005), trim)
        for j in range(4):
            add(cone(0.08, 0.08, 0.22, 12, at=(x1 - 0.32, 0.8 + j * 0.4, G + 1.215 + k * 0.5)), lambda co, n, j=j, k=k: [(0.75, 0.12, 0.1), (0.85, 0.7, 0.15), (0.2, 0.45, 0.25), (0.6, 0.6, 0.62)][(j + k) % 4])


def build_store_shelves(add, W, D, trim):
    """A free-standing store gondola and a wall rack of goods: Fox Outfitters sells what the catalog lists."""
    F = CABIN_FLOOR
    gx, gy = -3.6, 1.6
    add(rounded_box((1.9, 0.55, 0.06), at=(gx, gy, F + 0.12), bevel=0.01), trim)
    add(rounded_box((1.9, 0.05, 1.5), at=(gx, gy, F + 0.85), bevel=0.01), trim)
    for side in (-1, 1):
        add(rounded_box((0.05, 0.55, 1.5), at=(gx + side * 0.95, gy, F + 0.85), bevel=0.01), trim)
    palette = [(0.72, 0.14, 0.1), (0.2, 0.36, 0.22), (0.85, 0.68, 0.18), (0.25, 0.3, 0.5), (0.55, 0.4, 0.25), (0.9, 0.5, 0.12)]
    for k, z in enumerate((0.45, 0.85, 1.25)):
        add(rounded_box((1.86, 0.5, 0.03), at=(gx, gy, F + z), bevel=0.005), trim)
        for side in (-1, 1):
            for j in range(6):
                col = palette[(j + k * 2 + (side > 0)) % len(palette)]
                h = 0.16 + ((j * 7 + k * 3) % 4) * 0.035
                add(rounded_box((0.24, 0.17, h), at=(gx - 0.75 + j * 0.3, gy + side * 0.14, F + z + 0.015 + h / 2), bevel=0.012), lambda co, n, col=col: col if n[2] < 0.7 else mix(col, (1, 1, 1), 0.2))
    wy = -D / 2 + 0.3
    for x in (-5.6, -4.0):
        add(rounded_box((0.06, 0.35, 2.0), at=(x, wy, F + 1.0), bevel=0.01), trim)
    for z in (0.6, 1.2, 1.8):
        add(rounded_box((1.66, 0.33, 0.03), at=(-4.8, wy, F + z), bevel=0.005), trim)
        for j in range(5):
            col = palette[(j + int(z * 10)) % len(palette)]
            add(rounded_box((0.25, 0.22, 0.2), at=(-5.45 + j * 0.32, wy, F + z + 0.115), bevel=0.012), lambda co, n, col=col: col)

