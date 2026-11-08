def paint(base, hi):
    def f(co, n):
        flake = n3(Vector((co[0] * 400, co[1] * 400, co[2] * 400)), 1.0)
        c = mix(base, hi, max(0.0, n[2]) * 0.55 + 0.15)
        k = 1.0 + flake * 0.06
        return (c[0] * k, c[1] * k, c[2] * k)
    return f


def grain(c, s=0.04):
    def f(co, n):
        g = n3(Vector((co[0] * 220, co[1] * 220, co[2] * 220)), 1.0) * s
        k = 1.0 + g + max(0.0, n[2]) * 0.12
        return (c[0] * k, c[1] * k, c[2] * k)
    return f


def arc_path(center, R, a0, a1, steps):
    return [(center[0], center[1] + math.cos(a0 + (a1 - a0) * i / steps) * R, center[2] + math.sin(a0 + (a1 - a0) * i / steps) * R) for i in range(steps + 1)]


def cyl_x(r, length, at, seg=24, cap=True):
    return cone(r, r, length, seg, at=(at[0] - length / 2, at[1], at[2]), cap=cap, rot=Matrix.Rotation(math.pi / 2, 4, 'Y'))


def cyl_y(r, length, at, seg=24, cap=True, r2=None):
    return cone(r, r if r2 is None else r2, length, seg, at=(at[0], at[1] - length / 2, at[2]), cap=cap, rot=Matrix.Rotation(-math.pi / 2, 4, 'X'))


def along(bm_fn, a, b):
    a, b = Vector(a), Vector(b)
    d = b - a
    q = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4()
    bm = bm_fn(d.length)
    xform(bm, Matrix.Translation(a) @ q)
    return bm


def coilover(add, a, b, spring_c, steel, body_c):
    add(tube([tuple(a), tuple(b)], [0.018, 0.018], 10), steel)
    add(along(lambda L: helix((0, 0, 0), 0.042, 0.008, 0.06, L * 0.75, 6, seg=5), a, b), spring_c)
    add(along(lambda L: cone(0.028, 0.028, L * 0.45, 14, at=(0, 0, L * 0.5)), a, b), body_c)


def build_tire_wheel(m, name, cx, cy, cz, side):
    R, W = 0.35, 0.27
    rubber = grain((0.055, 0.052, 0.05), 0.08)
    tire = new_bm()
    segs, prof = 48, 14
    rows = []
    for i in range(segs):
        a = i / segs * math.tau
        row = []
        for j in range(prof + 1):
            t = j / prof
            px = (t - 0.5) * W
            e = abs(t - 0.5) * 2
            r = R * (0.6 + 0.4 * (1 - e ** 5.0) ** 0.45) - 0.014
            if 0.25 < e < 0.4:
                r += 0.004
            row.append(tire.verts.new((cx + px, cy + math.cos(a) * r, cz + math.sin(a) * r)))
        rows.append(row)
    for i in range(segs):
        i2 = (i + 1) % segs
        for j in range(prof):
            tire.faces.new((rows[i][j], rows[i2][j], rows[i2][j + 1], rows[i][j + 1]))
    tire.normal_update()
    for f in tire.faces:
        c = f.calc_center_median() - Vector((cx, cy, cz))
        if Vector((0, c.y, c.z)).dot(f.normal) < 0:
            f.normal_flip()
    m.add(name, piece_from_bm(tire, rubber), pivot=(cx, cy, cz))
    lugs = 26
    for i in range(lugs):
        a = i / lugs * math.tau
        for half in (-1, 1):
            aa = a + (math.pi / lugs if half > 0 else 0.0)
            px = half * W * 0.2
            rot = Matrix.Rotation(aa - math.pi / 2, 4, 'X') @ Matrix.Rotation(half * 0.45, 4, 'Z')
            pos = (cx + px, cy + math.cos(aa) * (R - 0.004), cz + math.sin(aa) * (R - 0.004))
            lug = box((0.085, 0.042, 0.03), at=pos, rot=rot)
            m.add(name, piece_from_bm(lug, rubber, smooth=False), pivot=(cx, cy, cz))
    face = cx + side * 0.075
    alloy = lambda co, n: mix((0.42, 0.43, 0.45), (0.8, 0.81, 0.82), abs(n[0]) * 0.6 + max(0.0, n[2]) * 0.3)
    barrel = cone(0.205, 0.205, 0.22, 40, at=(cx - 0.11, cy, cz), cap=False, rot=Matrix.Rotation(math.pi / 2, 4, 'Y'))
    for f in barrel.faces:
        f.normal_flip()
    m.add(name, piece_from_bm(barrel, lambda co, n: (0.25, 0.25, 0.27)), pivot=(cx, cy, cz))
    ring = torus(0.2, 0.016, at=(face, cy, cz), seg=32, rseg=6, rot=Matrix.Rotation(math.pi / 2, 4, 'Y'))
    m.add(name, piece_from_bm(ring, lambda co, n: (0.1, 0.1, 0.11)), pivot=(cx, cy, cz))
    for k in range(10):
        a = k / 10 * math.tau
        bolt = cyl_x(0.007, 0.012, (face + side * 0.018, cy + math.cos(a) * 0.2, cz + math.sin(a) * 0.2), seg=6)
        m.add(name, piece_from_bm(bolt, lambda co, n: (0.7, 0.7, 0.72), smooth=False), pivot=(cx, cy, cz))
    disk = cyl_x(0.19, 0.02, (face - side * 0.05, cy, cz), seg=40)
    m.add(name, piece_from_bm(disk, lambda co, n: (0.16, 0.16, 0.17)), pivot=(cx, cy, cz))
    for k in range(12):
        a = k / 12 * math.tau + (0.12 if k % 2 else -0.12)
        mid = (face - side * 0.012, cy + math.cos(a) * 0.12, cz + math.sin(a) * 0.12)
        sp = rounded_box((0.03, 0.03, 0.16), at=mid, bevel=0.009, segs=1, rot=Matrix.Rotation(a - math.pi / 2, 4, 'X'))
        m.add(name, piece_from_bm(sp, alloy), pivot=(cx, cy, cz))
    m.add(name, piece_from_bm(cyl_x(0.055, 0.05, (face, cy, cz), seg=24), alloy), pivot=(cx, cy, cz))
    m.add(name, piece_from_bm(sphere(0.035, 16, 8, at=(face + side * 0.026, cy, cz), scale=(0.5, 1, 1)), lambda co, n: (0.12, 0.12, 0.13)), pivot=(cx, cy, cz))
    for k in range(4):
        a = k / 4 * math.tau + 0.4
        nut = cyl_x(0.009, 0.02, (face + side * 0.026, cy + math.cos(a) * 0.04, cz + math.sin(a) * 0.04), seg=6)
        m.add(name, piece_from_bm(nut, lambda co, n: (0.72, 0.72, 0.74), smooth=False), pivot=(cx, cy, cz))
    rotor = cyl_x(0.13, 0.012, (cx - side * 0.05, cy, cz), seg=32)
    m.add(name, piece_from_bm(rotor, lambda co, n: (0.45, 0.43, 0.42) if abs(n[0]) > 0.8 else (0.3, 0.29, 0.28)), pivot=(cx, cy, cz))


def build_utv():
    m = Model('utv', ao_dist=0.55, ao_strength=0.6)
    green = paint((0.1, 0.22, 0.12), (0.2, 0.36, 0.22))
    plastic = grain((0.065, 0.065, 0.068))
    cage_c = grain((0.045, 0.045, 0.05), 0.02)
    steel = lambda co, n: mix((0.32, 0.33, 0.35), (0.66, 0.67, 0.69), max(0.0, n[2]))
    seat_c = lambda co, n: mix((0.13, 0.13, 0.14), (0.2, 0.2, 0.21), max(0.0, n[2])) if n3(Vector((co[0] * 30, co[1] * 30, 0)), 1) < 0.55 else (0.09, 0.09, 0.095)
    spring_c = lambda co, n: (0.85, 0.6, 0.08)
    shock_c = lambda co, n: (0.75, 0.15, 0.08)

    def add(bm, col, smooth=True):
        m.add('body', piece_from_bm(bm, col, smooth=smooth))

    for x in (-0.42, 0.42):
        add(tube([(x, -1.48, 0.4), (x, -0.6, 0.38), (x, 0.6, 0.38), (x, 1.32, 0.42), (x * 0.9, 1.5, 0.5)], [0.035] * 5, 10), cage_c)
    for y in (-1.4, -0.6, 0.0, 0.6, 1.3):
        add(tube([(-0.42, y, 0.39), (0.42, y, 0.39)], [0.025, 0.025], 8), cage_c)
    add(rounded_box((0.86, 2.6, 0.02), at=(0, 0.0, 0.33), bevel=0.01), grain((0.2, 0.2, 0.21), 0.05))

    hood_st = [(0.52, 0.55, 1.04, 0.47), (0.7, 0.55, 1.02, 0.47), (0.95, 0.56, 0.99, 0.47), (1.2, 0.57, 0.95, 0.46), (1.4, 0.58, 0.9, 0.45), (1.52, 0.6, 0.84, 0.42), (1.58, 0.62, 0.78, 0.34)]
    path = [(0, y, (lo + hi) / 2) for (y, lo, hi, w) in hood_st]
    prof = [(w, (hi - lo) / 2, (hi - lo) / 2, 0.28) for (y, lo, hi, w) in hood_st]
    hood = subsurf(sweep(path, prof, 24, front=(0, 0, 1)), 2)

    def hood_col(co, n):
        if co[2] < 0.63 or (co[1] > 1.5 and co[2] < 0.76 and n[1] > 0.3):
            return plastic(co, n)
        c = green(co, n)
        if n[2] > 0.6 and abs(abs(co[0]) - 0.32) < 0.006:
            c = mix(c, (0.03, 0.05, 0.03), 0.6)
        return c
    add(hood, hood_col)
    bulge = subsurf(sweep([(0, 0.65, 1.0), (0, 0.9, 0.99), (0, 1.15, 0.955), (0, 1.33, 0.915)], [(0.2, 0.025, 0.01, 0.4), (0.22, 0.03, 0.01, 0.4), (0.2, 0.028, 0.01, 0.4), (0.15, 0.012, 0.01, 0.4)], 24, front=(0, 0, 1)), 1)
    add(bulge, green)
    for k in range(5):
        add(rounded_box((0.035, 0.18, 0.012), at=(-0.12 + k * 0.06, 1.0, 1.035), bevel=0.004, rot=Matrix.Rotation(-0.12, 4, 'X')), lambda co, n: (0.02, 0.025, 0.02))

    def grille_col(co, n):
        hx = math.sin(co[0] * 120) * math.sin(co[2] * 140)
        return (0.015, 0.015, 0.016) if hx > 0.2 else (0.09, 0.09, 0.1)
    add(rounded_box((0.56, 0.04, 0.17), at=(0, 1.585, 0.69), bevel=0.012), grille_col)
    for k in range(4):
        add(rounded_box((0.58, 0.02, 0.012), at=(0, 1.61, 0.63 + k * 0.042), bevel=0.004), plastic)
    for s in (-1, 1):
        hx = s * 0.33
        add(subsurf(cyl_y(0.075, 0.07, (hx, 1.565, 0.83), seg=32), 1), plastic)
        add(cone(0.066, 0.03, 0.04, 32, at=(hx, 1.6, 0.83), rot=Matrix.Rotation(math.pi / 2, 4, 'X')), lambda co, n: (0.85, 0.86, 0.88))
        lens = sphere(0.066, 24, 12, at=(hx, 1.6, 0.83), scale=(1, 0.25, 1))
        bmesh.ops.delete(lens, geom=[v for v in lens.verts if v.co.y < 1.599], context='VERTS')
        add(lens, lambda co, n: (1.0, 0.99, 0.94))
        add(rounded_box((0.12, 0.015, 0.018), at=(s * 0.33, 1.6, 0.74), bevel=0.006), lambda co, n: (1.0, 0.98, 0.9))
    for s in (-1, 1):
        for yc in (1.0, -0.95):
            arc = arc_path((s * 0.64, yc, 0.35), 0.43, 0.12, math.pi - 0.12, 18)
            add(subsurf(sweep(arc, [(0.014, 0.17, 0.17, 0.25)] * len(arc), 8, front=(1, 0, 0)), 1), green)
            lip = arc_path((s * 0.805, yc, 0.35), 0.445, 0.1, math.pi - 0.1, 20)
            add(tube(lip, [0.02] * len(lip), 8), plastic)
            liner = arc_path((s * 0.5, yc, 0.35), 0.42, 0.3, math.pi - 0.3, 18)
            add(sweep(liner, [(0.01, 0.03, 0.03, 0.5)] * len(liner), 8, front=(1, 0, 0)), plastic)
    for s in (-1, 1):
        add(rounded_box((0.06, 1.05, 0.14), at=(s * 0.6, 0.02, 0.5), bevel=0.02), plastic)

        def door_col(co, n):
            if co[2] > 0.92:
                return plastic(co, n)
            c = green(co, n)
            if abs(co[2] - 0.78) < 0.005 and abs(co[0]) > 0.6:
                c = mix(c, (0.04, 0.06, 0.04), 0.7)
            return c
        add(rounded_box((0.05, 0.62, 0.36), at=(s * 0.615, 0.16, 0.76), bevel=0.025), door_col)
        add(rounded_box((0.02, 0.1, 0.025), at=(s * 0.645, -0.05, 0.86), bevel=0.008), plastic)
        add(rounded_box((0.06, 0.16, 0.12), at=(s * 0.63, 0.56, 0.75), bevel=0.02), green)

    def diamond(co, n):
        a = math.sin((co[0] + co[1]) * 90) * math.sin((co[0] - co[1]) * 90)
        return (0.32, 0.33, 0.34) if a > 0.6 else (0.18, 0.18, 0.19)
    floor = subsurf(box((1.1, 1.18, 0.03), at=(0, 0.02, 0.45)), 2)
    add(floor, diamond)
    add(rounded_box((1.12, 0.3, 0.3), at=(0, 0.52, 0.86), bevel=0.06), plastic)
    add(rounded_box((0.3, 0.12, 0.12), at=(-0.3, 0.42, 1.04), bevel=0.04, rot=Matrix.Rotation(0.4, 4, 'X')), plastic)
    for gx, gz, gr in ((-0.37, 1.05, 0.04), (-0.23, 1.05, 0.04), (-0.3, 1.0, 0.024)):
        gauge = cyl_y(gr, 0.012, (gx, 0.36, gz), seg=24)
        add(gauge, lambda co, n: (0.92, 0.92, 0.88) if n[1] < -0.5 else (0.6, 0.6, 0.62))
        add(tube([(gx, 0.352, gz), (gx + gr * 0.7, 0.352, gz + gr * 0.3)], [0.002, 0.002], 4), lambda co, n: (0.9, 0.15, 0.05))
    add(rounded_box((0.26, 0.04, 0.12), at=(0.28, 0.38, 0.92), bevel=0.012), plastic)
    add(tube([(-0.3, 0.46, 0.92), (-0.3, 0.33, 1.14)], [0.025, 0.022], 12), plastic)
    wheel_c = Vector((-0.3, 0.3, 1.18))
    tilt = Matrix.Translation(wheel_c) @ Matrix.Rotation(-0.95, 4, 'X')
    add(xform(torus(0.165, 0.018, seg=40, rseg=10), tilt), grain((0.05, 0.05, 0.05), 0.08))
    for k in range(3):
        a = k / 3 * math.tau + math.pi / 2
        add(xform(rounded_box((0.15, 0.03, 0.012), at=(math.cos(a) * 0.08, math.sin(a) * 0.08, 0), bevel=0.005, rot=Matrix.Rotation(a, 4, 'Z')), tilt), plastic)
    add(xform(cone(0.045, 0.04, 0.03, 20), tilt), lambda co, n: (0.1, 0.1, 0.11))
    for px, w in ((-0.4, 0.06), (-0.25, 0.1)):
        add(rounded_box((w, 0.02, 0.09), at=(px, 0.47, 0.56), bevel=0.006, rot=Matrix.Rotation(0.5, 4, 'X')), steel)
    add(rounded_box((0.18, 0.5, 0.2), at=(0, 0.05, 0.56), bevel=0.03), plastic)
    add(tube([(0.0, 0.2, 0.66), (0.02, 0.24, 0.84)], [0.01, 0.009], 8), steel)
    add(sphere(0.025, 12, 8, at=(0.02, 0.245, 0.86)), plastic)
    for cy in (-0.15, -0.05):
        add(cyl_y(0.03, 0.01, (0.0, cy, 0.665), seg=16), lambda co, n: (0.02, 0.02, 0.02))
    for x in (-0.3, 0.3):
        add(rounded_box((0.46, 0.46, 0.11), at=(x, -0.06, 0.78), bevel=0.04), seat_c)
        for s in (-1, 1):
            add(rounded_box((0.07, 0.42, 0.1), at=(x + s * 0.2, -0.07, 0.84), bevel=0.03), seat_c)
            add(rounded_box((0.07, 0.12, 0.42), at=(x + s * 0.2, -0.28, 1.1), bevel=0.03, rot=Matrix.Rotation(0.14, 4, 'X')), seat_c)
        add(rounded_box((0.46, 0.11, 0.56), at=(x, -0.31, 1.1), bevel=0.04, rot=Matrix.Rotation(0.14, 4, 'X')), seat_c)
        add(rounded_box((0.26, 0.09, 0.17), at=(x, -0.37, 1.48), bevel=0.035), seat_c)
        add(rounded_box((0.5, 0.42, 0.14), at=(x, -0.06, 0.66), bevel=0.01), plastic)
        add(rounded_box((0.05, 0.012, 0.5), at=(x + 0.12, -0.24, 1.12), bevel=0.003, rot=Matrix.Rotation(0.14, 4, 'X') @ Matrix.Rotation(0.4, 4, 'Y')), lambda co, n: (0.12, 0.12, 0.13))
    for s in (-1, 1):
        hoop = [(s * 0.62, 0.62, 0.92), (s * 0.6, 0.42, 1.55), (s * 0.58, 0.2, 1.86), (s * 0.58, -0.52, 1.88), (s * 0.6, -0.62, 1.6), (s * 0.62, -0.64, 0.96)]
        add(bent_tube(hoop, 0.032, bend=0.12, seg=12, steps=6), cage_c)
        add(tube([(s * 0.6, -0.62, 1.6), (s * 0.5, -1.05, 1.06)], [0.026, 0.026], 10), cage_c)
        add(tube([(s * 0.6, 0.42, 1.55), (s * 0.62, 0.39, 1.6), (s * 0.69, 0.37, 1.62)], [0.012, 0.012, 0.012], 8), cage_c)
        add(rounded_box((0.04, 0.03, 0.09), at=(s * 0.72, 0.36, 1.62), bevel=0.012), lambda co, n: (0.6, 0.66, 0.7) if n[1] < -0.6 else (0.06, 0.06, 0.065))
    for y, z in ((0.2, 1.86), (-0.52, 1.88)):
        add(tube([(-0.58, y, z), (0.58, y, z)], [0.03, 0.03], 12), cage_c)
    add(tube([(-0.6, -0.62, 1.32), (0.6, -0.62, 1.32)], [0.026, 0.026], 12), cage_c)
    add(tube([(-0.6, -0.62, 1.32), (0.6, -0.62, 1.6)], [0.02, 0.02], 10), cage_c)

    def roof_col(co, n):
        c = plastic(co, n)
        if n[2] > 0.5 and int((co[0] + 0.7) / 0.2) % 2 == 0 and abs(co[1] + 0.15) < 0.36:
            c = (c[0] * 1.25, c[1] * 1.25, c[2] * 1.25)
        return c
    add(rounded_box((1.26, 0.86, 0.045), at=(0, -0.15, 1.93), bevel=0.02), roof_col)
    for k in range(4):
        add(rounded_box((0.06, 0.74, 0.025), at=(-0.45 + k * 0.3, -0.15, 1.965), bevel=0.01), plastic)
    add(rounded_box((0.96, 0.08, 0.075), at=(0, 0.26, 1.98), bevel=0.02), plastic)
    for k in range(12):
        add(sphere(0.026, 10, 6, at=(-0.42 + k * 0.0764, 0.3, 1.98), scale=(1, 0.4, 1)), lambda co, n: (1.0, 0.98, 0.92) if n[1] > 0.3 else (0.7, 0.7, 0.72))
    add(rounded_box((0.2, 0.025, 0.06), at=(0, 0.2, 1.8), bevel=0.01), lambda co, n: (0.55, 0.6, 0.65) if n[1] < -0.6 else (0.06, 0.06, 0.065))
    for gz in (1.18, 1.48):
        for gx in (-0.42, 0.42):
            add(tube([(gx, -0.64, gz - 0.02), (gx, -0.72, gz - 0.02), (gx, -0.74, gz + 0.05)], [0.016, 0.016, 0.016], 8), lambda co, n: (0.05, 0.05, 0.05))
            add(rounded_box((0.07, 0.06, 0.03), at=(gx, -0.69, gz - 0.035), bevel=0.012), lambda co, n: (0.15, 0.1, 0.06))
    add(rounded_box((1.24, 0.94, 0.04), at=(0, -1.02, 0.95), bevel=0.01), plastic)
    for k in range(7):
        add(rounded_box((0.025, 0.9, 0.018), at=(-0.5 + k * 0.1667, -1.02, 0.975), bevel=0.006), grain((0.09, 0.09, 0.095)))
    for s in (-1, 1):
        add(rounded_box((0.05, 0.96, 0.3), at=(s * 0.63, -1.02, 1.1), bevel=0.02), green)
        add(rounded_box((0.08, 0.98, 0.03), at=(s * 0.63, -1.02, 1.26), bevel=0.012), plastic)
        for py in (-0.7, -1.3):
            add(box((0.05, 0.07, 0.012), at=(s * 0.63, py, 1.278)), lambda co, n: (0.01, 0.01, 0.01))
        add(rounded_box((0.02, 0.04, 0.04), at=(s * 0.66, -0.64, 1.05), bevel=0.008), lambda co, n: (0.95, 0.55, 0.05))
    add(rounded_box((1.3, 0.05, 0.32), at=(0, -0.54, 1.1), bevel=0.02), green)

    def gate_col(co, n):
        c = green(co, n)
        if n[1] < -0.6 and 1.0 < co[2] < 1.18 and abs(co[0]) < 0.45:
            c = mix(c, (0.05, 0.08, 0.05), 0.5 if int((co[0] + 0.5) * 12) % 2 else 0.2)
        return c
    add(rounded_box((1.24, 0.05, 0.3), at=(0, -1.5, 1.1), bevel=0.02), gate_col)
    add(rounded_box((0.22, 0.03, 0.05), at=(0, -1.53, 1.2), bevel=0.012), plastic)
    for s in (-1, 1):
        add(rounded_box((0.06, 0.03, 0.2), at=(s * 0.6, -1.535, 1.1), bevel=0.012), lambda co, n: (0.9, 0.06, 0.04) if n[1] < -0.4 else (0.35, 0.03, 0.02))
    add(rounded_box((0.5, 0.34, 0.3), at=(0.25, -1.15, 1.13), bevel=0.04), lambda co, n: (0.9, 0.9, 0.86) if co[2] > 1.25 else (0.42, 0.45, 0.33))
    add(tube([(0.04, -1.15, 1.2), (0.04, -1.15, 1.32), (0.46, -1.15, 1.32), (0.46, -1.15, 1.2)], [0.008] * 4, 6), plastic)
    add(rounded_box((0.16, 0.26, 0.3), at=(-0.35, -0.85, 1.13), bevel=0.03), lambda co, n: (0.75, 0.1, 0.06))
    add(cyl_y(0.02, 0.06, (-0.35, -0.72, 1.32), seg=10), lambda co, n: (0.85, 0.7, 0.1))
    guard = [(-0.5, 1.5, 0.52), (-0.52, 1.7, 0.55), (-0.45, 1.75, 0.95), (0.45, 1.75, 0.95), (0.52, 1.7, 0.55), (0.5, 1.5, 0.52)]
    add(bent_tube(guard, 0.032, bend=0.1, seg=12, steps=6), cage_c)
    add(tube([(-0.52, 1.72, 0.62), (0.52, 1.72, 0.62)], [0.03, 0.03], 12), cage_c)
    for x in (-0.25, 0.25):
        add(tube([(x, 1.72, 0.62), (x, 1.74, 0.93)], [0.022, 0.022], 10), cage_c)
    add(cyl_x(0.06, 0.34, (0, 1.64, 0.55), seg=24), lambda co, n: (0.12, 0.12, 0.13))
    for k in range(6):
        add(torus(0.062, 0.006, at=(-0.12 + k * 0.048, 1.64, 0.55), seg=14, rseg=5, rot=Matrix.Rotation(math.pi / 2, 4, 'Y')), lambda co, n: (0.5, 0.5, 0.52))
    add(rounded_box((0.16, 0.04, 0.07), at=(0, 1.73, 0.55), bevel=0.01), steel)
    add(tube([(0, 1.75, 0.55), (0, 1.8, 0.53), (0.0, 1.8, 0.47), (0.02, 1.78, 0.45)], [0.008] * 4, 8), steel)
    add(bent_tube([(-0.55, -1.5, 0.75), (-0.58, -1.62, 0.72), (0.58, -1.62, 0.72), (0.55, -1.5, 0.75)], 0.032, bend=0.08, seg=12), cage_c)
    add(rounded_box((0.06, 0.18, 0.06), at=(0, -1.66, 0.62), bevel=0.008), cage_c)
    add(cyl_y(0.022, 0.03, (0, -1.73, 0.62), seg=12), steel)
    add(sphere(0.025, 14, 10, at=(0, -1.73, 0.665)), steel)
    add(cyl_y(0.07, 0.42, (0.3, -1.25, 0.66), seg=24), lambda co, n: mix((0.3, 0.3, 0.32), (0.55, 0.55, 0.57), max(0.0, n[2])))
    add(cyl_y(0.025, 0.2, (0.3, -1.52, 0.66), seg=12), lambda co, n: (0.15, 0.12, 0.1))
    for s in (-1, 1):
        for y0 in (0.85, 1.15):
            add(tube([(s * 0.3, y0, 0.38), (s * 0.55, 1.0, 0.31)], [0.018, 0.018], 8), cage_c)
            add(tube([(s * 0.33, y0 * 0.98 + 0.02, 0.6), (s * 0.54, 1.0, 0.5)], [0.016, 0.016], 8), cage_c)
        add(rounded_box((0.05, 0.08, 0.24), at=(s * 0.55, 1.0, 0.4), bevel=0.012), cage_c)
        add(tube([(s * 0.12, 1.0, 0.4), (s * 0.52, 1.0, 0.35)], [0.016, 0.016], 8), steel)
        add(sweep([(s * 0.44, 1.0, 0.363), (s * 0.5, 1.0, 0.354)], [(0.03, 0.03, 0.03), (0.02, 0.02, 0.02)], 12, front=(0, 0, 1)), plastic)
        coilover(add, Vector((s * 0.47, 0.98, 0.35)), Vector((s * 0.33, 0.92, 0.88)), spring_c, steel, shock_c)
        add(tube([(s * 0.42, -0.4, 0.42), (s * 0.58, -0.95, 0.35)], [0.024, 0.02], 10), cage_c)
        add(tube([(s * 0.3, -0.75, 0.4), (s * 0.56, -0.95, 0.33)], [0.016, 0.016], 8), cage_c)
        add(tube([(s * 0.12, -0.9, 0.42), (s * 0.52, -0.95, 0.35)], [0.016, 0.016], 8), steel)
        coilover(add, Vector((s * 0.5, -0.92, 0.38)), Vector((s * 0.4, -0.72, 0.96)), spring_c, steel, shock_c)
    for name, (x, y) in {'wheelFL': (0.66, 1.0), 'wheelFR': (-0.66, 1.0), 'wheelBL': (0.66, -0.95), 'wheelBR': (-0.66, -0.95)}.items():
        build_tire_wheel(m, name, x, y, 0.35, 1 if x > 0 else -1)
    write_model(m)
