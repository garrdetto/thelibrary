def stand_tree_r(z):
    return lerp(0.3, 0.24, max(0.0, min(1.0, (z + 0.3) / 4.3)))


def build_treestand():
    m = Model('treestand', ao_dist=0.5, ao_strength=0.55)
    TC = Vector((0, -0.25, 0))
    steel = lambda co, n: camo(co, ((0.36, 0.34, 0.26), (0.27, 0.25, 0.18), (0.19, 0.18, 0.13), (0.12, 0.11, 0.08)), 2.2, 9.1)
    cushion = lambda co, n: fabric(camo(co, ((0.46, 0.42, 0.31), (0.34, 0.31, 0.22), (0.24, 0.22, 0.15), (0.14, 0.12, 0.09)), 1.6, 3.3), co)
    black = grain((0.04, 0.04, 0.045), 0.04)
    strap = lambda co, n: (0.12, 0.12, 0.1) if int(co[2] * 400) % 7 == 0 else (0.85, 0.62, 0.08)
    rope = lambda co, n: (0.15, 0.3, 0.12) if int(math.atan2(co[1] - TC.y, co[0]) * 20) % 3 == 0 else (0.85, 0.82, 0.7)
    zinc = lambda co, n: mix((0.45, 0.46, 0.47), (0.72, 0.73, 0.74), max(0.0, n[2]))

    def add(bm, col, smooth=True):
        m.add('stand', piece_from_bm(bm, col, smooth=smooth))

    def sqtube(a, b, r):
        return along(lambda L: rounded_box((r * 2, r * 2, L), at=(0, 0, L / 2), bevel=r * 0.35, segs=1), a, b)

    top = Vector((0, 0.66, 4.2))
    base = Vector((0, 2.05, 0.0))
    d = top - base
    for s in (-1, 1):
        add(sqtube(base + Vector((s * 0.21, 0, 0)), top + Vector((s * 0.21, 0, 0)), 0.018), steel)
        for f in (0.33, 0.66):
            p = base + d * f + Vector((s * 0.21, 0, 0))
            add(along(lambda L: rounded_box((0.05, 0.05, 0.16), at=(0, 0, L / 2), bevel=0.008, segs=1), p - d.normalized() * 0.08, p + d.normalized() * 0.08), steel)
        add(rounded_box((0.09, 0.14, 0.03), at=tuple(base + Vector((s * 0.21, 0.02, 0.015))), bevel=0.01), black)
    steps = int(d.length / 0.3)
    for k in range(1, steps + 1):
        p = base + d * (k / (steps + 1))
        rung = rounded_box((0.44, 0.06, 0.022), at=tuple(p), bevel=0.006, segs=1, rot=Matrix.Rotation(0.0, 4, 'X'))
        add(rung, lambda co, n: zinc(co, n) if n[2] > 0.5 and int(co[0] * 120) % 2 else steel(co, n))
    plat = rounded_box((0.66, 0.68, 0.03), at=(0, 0.38, 4.2), bevel=0.01)

    def grate(co, n):
        g = math.sin(co[0] * 140) * math.sin(co[1] * 140 + co[0] * 70)
        return (0.06, 0.06, 0.05) if g > 0.35 else steel(co, n)
    add(subsurf(plat, 1), grate)
    for (a, b) in (((-0.33, 0.04, 4.19), (0.33, 0.04, 4.19)), ((-0.33, 0.72, 4.19), (0.33, 0.72, 4.19)), ((-0.33, 0.04, 4.19), (-0.33, 0.72, 4.19)), ((0.33, 0.04, 4.19), (0.33, 0.72, 4.19))):
        add(sqtube(Vector(a), Vector(b), 0.02), steel)
    for s in (-1, 1):
        add(sqtube(Vector((s * 0.14, 0.02, 3.6)), Vector((s * 0.14, 0.02, 5.25)), 0.018), steel)
        add(sqtube(Vector((s * 0.14, 0.02, 3.7)), Vector((s * 0.3, 0.6, 4.19)), 0.014), steel)
        for z in (4.0, 4.5, 5.1):
            add(along(lambda L: rounded_box((0.025, 0.025, L), at=(0, 0, L / 2), bevel=0.005, segs=1), Vector((s * 0.14, 0.02, z)), Vector((s * 0.2, -0.13, z))), steel)
            for k in range(3):
                add(cone(0.008, 0.0, 0.03, 6, at=(s * (0.2 - 0.02 * k), -0.12 - 0.02 * k, z - 0.015)), zinc)
    seat_frame = [(-0.27, 0.06, 4.62), (-0.27, 0.46, 4.62), (0.27, 0.46, 4.62), (0.27, 0.06, 4.62)]
    add(bent_tube(seat_frame, 0.016, bend=0.05, seg=8), steel)
    for s in (-1, 1):
        add(tube([(s * 0.27, 0.46, 4.62), (s * 0.29, 0.5, 4.21)], [0.014, 0.014], 8), steel)
        add(tube([(s * 0.27, 0.06, 4.62), (s * 0.14, 0.03, 4.62)], [0.014, 0.014], 8), steel)
    seat = subsurf(rounded_box((0.52, 0.42, 0.075), at=(0, 0.26, 4.665), bevel=0.03), 1)
    add(seat, cushion)
    back = subsurf(rounded_box((0.4, 0.06, 0.36), at=(0, 0.05, 4.95), bevel=0.025), 1)
    add(back, cushion)
    for s in (-1, 1):
        rail = [(s * 0.33, 0.06, 4.2), (s * 0.34, 0.2, 4.75), (s * 0.34, 0.32, 5.08), (s * 0.34, 0.72, 5.08)]
        add(bent_tube(rail, 0.017, bend=0.1, seg=8), steel)
    add(bent_tube([(-0.34, 0.72, 5.08), (-0.3, 0.8, 5.08), (0.3, 0.8, 5.08), (0.34, 0.72, 5.08)], 0.017, bend=0.06, seg=8), steel)
    pad = sweep([(-0.3, 0.8, 5.085), (0.3, 0.8, 5.085)], [(0.035, 0.035, 0.035), (0.035, 0.035, 0.035)], 14, front=(0, 0, 1))
    add(subsurf(pad, 1), black)
    for s in (-1, 1):
        pp = sweep([(s * 0.34, 0.35, 5.085), (s * 0.34, 0.7, 5.085)], [(0.032, 0.032, 0.032), (0.032, 0.032, 0.032)], 12, front=(0, 0, 1))
        add(subsurf(pp, 1), black)
    mid = base + d * 0.5
    for s in (-1, 1):
        a = mid + Vector((s * 0.21, 0, 0))
        b = Vector((s * 0.12, 0.03, mid.z + 0.25))
        add(sqtube(a, b, 0.016), steel)
        add(sqtube(a + (b - a) * 0.45, a + (b - a) * 0.75, 0.021), steel)
        add(along(lambda L: rounded_box((0.025, 0.025, L), at=(0, 0, L / 2), bevel=0.005, segs=1), b, Vector((s * 0.2, -0.12, mid.z + 0.25))), steel)
    for zc, w in ((4.55, 0.045), (mid.z + 0.25, 0.04), (5.15, 0.035)):
        R = stand_tree_r(zc) + 0.006
        ring = sweep([(TC.x + math.cos(t / 40 * math.tau) * R, TC.y + math.sin(t / 40 * math.tau) * R, zc) for t in range(41)], [(0.003, w / 2, w / 2, 0.4)] * 41, 6, cap0=False, cap1=False, front=(0, 0, 1))
        add(ring, strap)
        add(rounded_box((0.07, 0.03, 0.06), at=(TC.x + 0.0, TC.y + R + 0.02, zc), bevel=0.008), zinc)
    for zc in (4.55,):
        pass
    lifeline = []
    for k in range(25):
        z = 0.9 + (5.15 - 0.9) * k / 24
        R = stand_tree_r(z) + 0.012
        a = -2.2 + 0.25 * math.sin(k * 0.7)
        lifeline.append((TC.x + math.cos(a) * R, TC.y + math.sin(a) * R, z))
    add(tube(lifeline, [0.007] * len(lifeline), 6), rope)
    add(sphere(0.022, 10, 8, at=lifeline[12], scale=(1, 1, 1.6)), lambda co, n: (0.85, 0.82, 0.7))
    trunk = tube([(TC.x, TC.y, -0.3), (TC.x, TC.y, 4.2), (TC.x + 0.04, TC.y + 0.02, 11.0), (TC.x - 0.02, TC.y + 0.05, 20.5)], [0.3, 0.242, 0.15, 0.03], 14)
    m.add('trunk', piece_from_bm(trunk, bark))
    r = random.Random(41)
    for k in range(9):
        z = r.uniform(2.2, 8.2)
        if 3.4 < z < 5.6:
            z += 2.3
        ang = r.random() * math.tau
        dv = Vector((math.cos(ang), math.sin(ang), 0))
        L = r.uniform(0.12, 0.45)
        st = TC + dv * 0.2 + Vector((0, 0, z))
        m.add('trunk', piece_from_bm(tube([tuple(st), tuple(st + dv * L + Vector((0, 0, -0.05)))], [0.035, 0.012], 5), lambda co, n: (0.22, 0.19, 0.15)))
    whorls = 14
    ib = 0
    for w in range(whorls):
        t = w / (whorls - 1)
        z = lerp(8.6, 19.6, t) + r.uniform(-0.15, 0.15)
        for k in range(5 if t < 0.85 else 4):
            ib += 1
            ang = ib * 2.39996 + r.uniform(-0.25, 0.25)
            dv = Vector((math.cos(ang), math.sin(ang), 0))
            L = (1 - t) ** 0.85 * 3.0 + 0.6
            droop = -0.15 - 0.2 * (1 - t)
            mid = TC + Vector((dv.x * L * 0.55, dv.y * L * 0.55, z + droop * L * 0.3))
            side = Vector((-dv.y, dv.x, 0))
            shade = 0.72 + 0.28 * t + r.uniform(-0.08, 0.08)
            along_v = (dv * L + Vector((0, 0, droop * L))).normalized()
            ctr = TC + Vector((0, 0, z - 1.2))
            m.add('crown', card(mid, side, along_v, L * 0.62, L * 1.05, ATLAS[r.randrange(4)], ctr, shade), material='needles')
            tilt = (side * 0.55 + Vector((0, 0, 0.84))).normalized()
            m.add('crown', card(mid + Vector((0, 0, 0.05)), tilt, along_v, L * 0.5, L * 1.0, ATLAS[r.randrange(4)], ctr, shade * 0.95), material='needles')
    for k in range(3):
        ang = k * math.tau / 3
        m.add('crown', card(TC + Vector((0, 0, 19.8)), Vector((math.cos(ang), math.sin(ang), 0)), (0, 0, 1), 0.9, 1.6, ATLAS[k], TC + Vector((0, 0, 18.5)), 1.0, anchor_bottom=True), material='needles')
    write_model(m)
