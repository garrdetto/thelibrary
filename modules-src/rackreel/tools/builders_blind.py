def build_boxblind():
    m = Model('boxblind', ao_dist=0.6, ao_strength=0.6)
    FLOOR = 3.0
    S = 0.95
    H = 1.75
    ply = lambda co, n: camo(co, ((0.44, 0.38, 0.27), (0.33, 0.29, 0.2), (0.22, 0.21, 0.14), (0.13, 0.12, 0.09)), 0.9, 6.6)
    inner = lambda co, n: mix((0.2, 0.19, 0.16), (0.14, 0.13, 0.11), n3(Vector(co) * 8, 1) * 0.5 + 0.5)
    steel = grain((0.18, 0.17, 0.14), 0.05)
    lumber = wood((0.6, 0.47, 0.3), (0.46, 0.34, 0.2))
    roof_c = lambda co, n: (lambda c: mix(c, (0.09, 0.1, 0.08), 0.5) if abs(math.sin(co[0] * math.pi / 0.3)) < 0.1 else c)(mix((0.22, 0.25, 0.2), (0.3, 0.33, 0.27), n3(Vector(co) * 3, 1) * 0.5 + 0.5))

    def add(bm, col, smooth=True):
        m.add('blind', piece_from_bm(bm, col, smooth=smooth))

    for sx in (-1, 1):
        for sy in (-1, 1):
            leg = [(sx * 1.15, sy * 1.15, 0.0), (sx * 0.85, sy * 0.85, FLOOR - 0.05)]
            add(along(lambda L: rounded_box((0.09, 0.09, L), at=(0, 0, L / 2), bevel=0.012, segs=1), Vector(leg[0]), Vector(leg[1])), steel)
            add(rounded_box((0.26, 0.26, 0.02), at=(sx * 1.15, sy * 1.15, 0.01), bevel=0.005), steel)
    for z in (0.9, 1.9):
        f = z / FLOOR
        r = 1.15 - 0.3 * f
        for (a, b) in (((-r, -r), (r, -r)), ((r, -r), (r, r)), ((r, r), (-r, r)), ((-r, r), (-r, -r))):
            add(along(lambda L: rounded_box((0.05, 0.05, L), at=(0, 0, L / 2), bevel=0.008, segs=1), Vector((a[0], a[1], z)), Vector((b[0], b[1], z))), steel)
    for (a, b) in (((-1.15, -1.15, 0.1), (0.95, 0.95, 1.85)), ((1.15, -1.15, 0.1), (-0.95, 0.95, 1.85)), ((-1.15, 1.15, 0.1), (0.95, -0.95, 1.85)), ((1.15, 1.15, 0.1), (-0.95, -0.95, 1.85))):
        add(along(lambda L: rounded_box((0.04, 0.04, L), at=(0, 0, L / 2), bevel=0.006, segs=1), Vector(a), Vector(b)), steel)
    add(rounded_box((2.2, 2.2, 0.08), at=(0, 0, FLOOR - 0.04), bevel=0.015), lumber)
    win_lo, win_hi = FLOOR + 0.95, FLOOR + 1.42
    for (rot, wl) in ((0.0, 1.5), (math.pi / 2, 1.3), (math.pi, 1.0), (-math.pi / 2, 1.3)):
        R = Matrix.Rotation(rot, 4, 'Z')

        def panel(x0, x1, z0, z1):
            b = rounded_box((x1 - x0, 0.05, z1 - z0), at=((x0 + x1) / 2, S, (z0 + z1) / 2), bevel=0.012)
            xform(b, R)
            return b
        door = rot == math.pi
        add(panel(-S, S, FLOOR, win_lo) if not door else panel(-S, -0.35, FLOOR, win_lo), ply)
        if door:
            add(panel(0.35, S, FLOOR, win_lo), ply)
        add(panel(-S, -wl / 2, win_lo, win_hi), ply)
        add(panel(wl / 2, S, win_lo, win_hi), ply)
        add(panel(-S, S, win_hi, FLOOR + H + (0.2 if rot == 0.0 else 0.0 if abs(rot) > 1 else -0.2)), ply)
        for z in (win_lo, win_hi):
            add(xform(rounded_box((wl + 0.06, 0.08, 0.04), at=(0, S + 0.01, z), bevel=0.01), R), lumber)
        add(xform(rounded_box((wl, 0.012, 0.18), at=(0, S - 0.04, win_hi + 0.1), bevel=0.003), R), lambda co, n: (0.12, 0.13, 0.12))
        for x in (-S, S):
            add(xform(rounded_box((0.06, 0.07, H + 0.1), at=(x, S, FLOOR + H / 2), bevel=0.01), R), lumber)
    slope = math.atan2(0.4, 2 * S + 0.4)
    roof = rounded_box((2 * S + 0.5, (2 * S + 0.5) / math.cos(slope), 0.06), bevel=0.015)
    xform(roof, Matrix.Translation((0, 0, FLOOR + H + 0.05)) @ Matrix.Rotation(slope, 4, 'X'))
    add(roof, lambda co, n: roof_c(co, n) if n[2] > 0.3 else inner(co, n))
    inside = rounded_box((2 * S - 0.12, 2 * S - 0.12, 0.02), at=(0, 0, FLOOR + 0.02), bevel=0.005)
    add(inside, lambda co, n: (0.08, 0.08, 0.07) if (int((co[0] + 2) * 8) + int((co[1] + 2) * 8)) % 2 else (0.11, 0.11, 0.1))
    add(cone(0.04, 0.035, 0.42, 14, at=(0, 0.05, FLOOR)), steel)
    add(cone(0.22, 0.22, 0.03, 18, at=(0, 0.05, FLOOR)), steel)
    seat = subsurf(rounded_box((0.44, 0.42, 0.08), at=(0, 0.05, FLOOR + 0.46), bevel=0.03), 1)
    add(seat, lambda co, n: mix((0.08, 0.08, 0.08), (0.14, 0.14, 0.14), max(0.0, n[2])))
    add(subsurf(rounded_box((0.42, 0.07, 0.38), at=(0, -0.16, FLOOR + 0.72), bevel=0.03, rot=Matrix.Rotation(-0.15, 4, 'X')), 1), lambda co, n: (0.1, 0.1, 0.1))
    add(rounded_box((1.5, 0.3, 0.04), at=(0, S - 0.2, win_lo - 0.02), bevel=0.01), lumber)
    lt = Vector((0, -2.35, 0.0))
    lb = Vector((0, -S - 0.08, FLOOR))
    d = lb - lt
    for sx in (-0.22, 0.22):
        add(along(lambda L: rounded_box((0.045, 0.045, L), at=(0, 0, L / 2), bevel=0.01, segs=1), lt + Vector((sx, 0, 0)), lb + Vector((sx, 0, 0.9))), steel)
    steps = int(d.length / 0.3)
    for k in range(1, steps + 1):
        p = lt + d * (k / (steps + 1))
        add(rounded_box((0.44, 0.06, 0.025), at=tuple(p), bevel=0.006, segs=1), steel)
    add(rounded_box((0.8, 0.5, 0.05), at=(0, -S - 0.25, FLOOR - 0.03), bevel=0.01), lumber)
    for sx in (-0.42, 0.42):
        add(tube([(sx, -S - 0.5, FLOOR), (sx, -S - 0.5, FLOOR + 0.9), (sx, -S - 0.05, FLOOR + 0.9)], [0.02] * 3, 8), steel)
    write_model(m)
