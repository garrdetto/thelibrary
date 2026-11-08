BOAT_Y0 = -2.72
BOAT_Y1 = 2.95


def boat_t(y):
    return (y - BOAT_Y0) / (BOAT_Y1 - BOAT_Y0)


def boat_beam(y):
    t = boat_t(y)
    b = 1.12 * (1 - 0.06 * smooth01(0.0, 0.25, 0.25 - t))
    bow = smooth01(0.5, 1.0, t)
    return b * (1 - bow ** 1.7 * 0.985) ** 0.85


def boat_sheer(y):
    return 0.7 + 0.12 * smooth01(0.55, 1.0, boat_t(y)) ** 1.5


def boat_keel(y):
    return 0.48 * smooth01(0.6, 1.0, boat_t(y)) ** 2.2


def boat_section(y):
    b = boat_beam(y)
    zk = boat_keel(y)
    zs = boat_sheer(y)
    t = boat_t(y)
    chine_x = b * 0.84
    dead = 0.34 + 0.25 * smooth01(0.5, 1.0, t)
    zc = min(zk + chine_x * dead, zs - 0.08)
    pts = [(0.0, zk), (0.06 * b, zk + 0.004), (0.1 * b, zk + 0.02)]
    for k in range(1, 7):
        f = k / 7
        x = 0.1 * b + (chine_x - 0.1 * b) * f
        z = zk + 0.02 + (zc - zk - 0.02) * f
        if k in (2, 5):
            pts.append((x - 0.006, z - 0.01))
            pts.append((x + 0.006, z + 0.003))
        else:
            pts.append((x, z))
    pts.append((chine_x + 0.035, zc - 0.006))
    pts.append((chine_x + 0.05, zc + 0.02))
    for k in range(1, 6):
        f = k / 5
        pts.append((chine_x + 0.05 + (b - chine_x - 0.05) * math.sin(f * math.pi / 2), zc + 0.02 + (zs - zc - 0.02) * f))
    return pts


def flaked(base_lo, base_hi, sparkle=0.22):
    def f(co, n):
        c = mix(base_lo, base_hi, max(0.0, n[2]) * 0.5 + 0.4)
        k = 1 + sparkle * (1 if n3(Vector((co[0] * 600, co[1] * 600, co[2] * 600)), 1) > 0.35 else 0) + 0.06 * n3(Vector((co[0] * 90, co[1] * 90, co[2] * 90)), 1)
        return (c[0] * k, c[1] * k, c[2] * k)
    return f


def build_boat():
    m = Model('boat', ground=False, ao_dist=0.6, ao_strength=0.55)
    flake_red = flaked((0.42, 0.03, 0.03), (0.7, 0.08, 0.06))
    charcoal = flaked((0.08, 0.08, 0.09), (0.11, 0.11, 0.12), 0.15)
    silver = lambda co, n: mix((0.55, 0.56, 0.58), (0.85, 0.86, 0.87), max(0.0, n[2]))
    chrome = lambda co, n: mix((0.35, 0.36, 0.38), (0.95, 0.95, 0.96), max(0.0, n[2]) * 0.7 + abs(n[0]) * 0.3)
    carpet = lambda co, n: mix((0.17, 0.18, 0.2), (0.22, 0.23, 0.26), n3(Vector((co[0] * 120, co[1] * 120, 0)), 1) * 0.5 + 0.5)
    glass = lambda co, n: mix((0.82, 0.83, 0.82), (0.92, 0.92, 0.9), max(0.0, n[2]))
    black = grain((0.035, 0.035, 0.04), 0.05)
    vinyl = lambda co, n: mix((0.82, 0.8, 0.76), (0.92, 0.9, 0.86), max(0.0, n[2]))
    accent = (0.6, 0.06, 0.05)
    tint = lambda co, n: (0.12, 0.15, 0.17)

    def add(bm, col, smooth=True):
        m.add('hull', piece_from_bm(bm, col, smooth=smooth))

    N = 44
    ys = [BOAT_Y0 + (BOAT_Y1 - BOAT_Y0) * (1 - (1 - i / N) ** 1.15) for i in range(N + 1)]
    hull = new_bm()
    grid = []
    for y in ys[:-1]:
        sec = boat_section(y)
        full = [(-x, z) for x, z in reversed(sec[1:])] + sec
        grid.append([hull.verts.new((x, y, z)) for x, z in full])
    tip = hull.verts.new((0, BOAT_Y1, boat_sheer(BOAT_Y1) - 0.02))
    cols = len(grid[0])
    for i in range(len(grid) - 1):
        for k in range(cols - 1):
            hull.faces.new((grid[i][k], grid[i][k + 1], grid[i + 1][k + 1], grid[i + 1][k]))
    for k in range(cols - 1):
        hull.faces.new((grid[-1][k], grid[-1][k + 1], tip))
    hull.faces.new(grid[0][::-1])
    hull.normal_update()
    for f in hull.faces:
        c = f.calc_center_median()
        if abs(c.y - BOAT_Y0) < 0.01:
            if f.normal.y > 0:
                f.normal_flip()
        elif f.normal.dot(Vector((c.x, 0, c.z - 0.45))) < 0:
            f.normal_flip()
    hull = subsurf(hull, 1)

    def hull_col(co, n):
        y, z = co[1], co[2]
        zs = boat_sheer(y)
        stripe = zs - 0.17 - 0.08 * smooth01(-1.0, 2.0, y) + 0.05 * math.sin(y * 1.3)
        if y < BOAT_Y0 + 0.01:
            return charcoal(co, n)
        return flake_red(co, n) if z > stripe else charcoal(co, n)
    add(hull, hull_col)

    def stripe_z(y):
        return boat_sheer(y) - 0.17 - 0.08 * smooth01(-1.0, 2.0, y) + 0.05 * math.sin(y * 1.3)

    def side_x(y, z):
        sec = boat_section(y)
        for (x0, z0), (x1, z1) in zip(sec, sec[1:]):
            if z0 <= z <= z1 and z1 > z0:
                return x0 + (x1 - x0) * (z - z0) / (z1 - z0)
        return sec[-1][0]
    for s in (-1, 1):
        for (dz0, dz1, col) in ((-0.022, 0.022, silver), (-0.052, -0.038, lambda co, n: (0.9, 0.9, 0.9))):
            rib = new_bm()
            rr = []
            for y in [BOAT_Y0 + 0.01 + (2.55 - BOAT_Y0) * k / 60 for k in range(61)]:
                z0 = stripe_z(y) + dz0
                z1 = stripe_z(y) + dz1
                rr.append((rib.verts.new((s * (side_x(y, z0) + 0.004), y, z0)), rib.verts.new((s * (side_x(y, z1) + 0.004), y, z1))))
            for k in range(60):
                rib.faces.new((rr[k][0], rr[k + 1][0], rr[k + 1][1], rr[k][1]))
            rib.normal_update()
            for f in rib.faces:
                if f.normal.x * s < 0:
                    f.normal_flip()
            add(rib, col)

    def deck_outline(y, inset):
        return max(0.0, boat_beam(y) - inset)

    def deck_patch(y0, y1, z_fn, inset, col, steps=24, xs=10):
        bm = new_bm()
        rows = []
        for i in range(steps + 1):
            y = y0 + (y1 - y0) * i / steps
            w = deck_outline(y, inset)
            rows.append([bm.verts.new((-w + 2 * w * j / xs, y, z_fn(y))) for j in range(xs + 1)])
        for i in range(steps):
            for j in range(xs):
                bm.faces.new((rows[i][j], rows[i][j + 1], rows[i + 1][j + 1], rows[i + 1][j]))
        bm.normal_update()
        for f in bm.faces:
            if f.normal.z < 0:
                f.normal_flip()
        add(bm, col)

    for s in (-1, 1):
        gun = new_bm()
        rows = []
        for y in ys[:-2]:
            b = boat_beam(y)
            zs = boat_sheer(y)
            pts = [(b + 0.005, zs + 0.005), (b - 0.03, zs + 0.03), (max(0.0, b - 0.16), zs + 0.03), (max(0.0, b - 0.18), zs - 0.02)]
            rows.append([gun.verts.new((s * x, y, z)) for x, z in pts])
        for i in range(len(rows) - 1):
            for k in range(3):
                gun.faces.new((rows[i][k], rows[i + 1][k], rows[i + 1][k + 1], rows[i][k + 1]))
        gun.normal_update()
        for f in gun.faces:
            if f.normal.z < -0.2 or (abs(f.normal.z) < 0.2 and f.normal.x * s < 0 and f.calc_center_median().x * s > boat_beam(f.calc_center_median().y) - 0.05):
                f.normal_flip()
        add(gun, glass)
        rail = [(s * (boat_beam(y) + 0.012), y, boat_sheer(y)) for y in ys[:-3]]
        add(tube(rail, [0.018] * len(rail), 8), black)
    front_z = lambda y: 0.69 + 0.1 * smooth01(1.8, 2.95, y)
    deck_patch(0.45, 2.7, front_z, 0.17, carpet, 30, 12)
    deck_patch(-1.4, 0.45, lambda y: 0.36, 0.2, carpet, 14, 12)
    deck_patch(-2.68, -1.4, lambda y: 0.67, 0.17, carpet, 10, 12)
    for (yw, z0, z1) in ((0.45, 0.36, 0.69), (-1.4, 0.36, 0.67)):
        w = deck_outline(yw, 0.2)
        add(box((w * 2, 0.03, z1 - z0), at=(0, yw, (z0 + z1) / 2)), glass)
    for s in (-1, 1):
        liner = new_bm()
        r = []
        for k in range(12):
            y = -1.4 + 1.85 * k / 11
            x = s * deck_outline(y, 0.18)
            r.append((liner.verts.new((x, y, 0.36)), liner.verts.new((x, y, boat_sheer(y) + 0.02))))
        for k in range(11):
            liner.faces.new((r[k][0], r[k + 1][0], r[k + 1][1], r[k][1]))
        liner.normal_update()
        for f in liner.faces:
            if f.normal.x * s > 0:
                f.normal_flip()
        add(liner, glass)
    for (lx, ly, lw, ll) in ((-0.55, 1.4, 0.28, 1.6), (0.0, 1.5, 0.5, 0.55), (0.55, 1.4, 0.28, 1.6), (0.0, 2.2, 0.36, 0.35), (-0.5, -2.05, 0.4, 0.5), (0.5, -2.05, 0.4, 0.5), (0.0, -2.2, 0.36, 0.42)):
        z = front_z(ly) if ly > 0 else 0.67
        add(rounded_box((lw, ll, 0.012), at=(lx, ly, z + 0.006), bevel=0.005, segs=1), lambda co, n: mix(carpet(co, n), (0.1, 0.1, 0.11), 0.25))
        add(rounded_box((0.05, 0.02, 0.01), at=(lx, ly - ll / 2 + 0.04, z + 0.014), bevel=0.003, segs=1), chrome)
    for (cx, cy) in ((-0.92, 1.9), (0.92, 1.9), (-0.98, -2.3), (0.98, -2.3)):
        z = boat_sheer(cy) + 0.035
        add(rounded_box((0.025, 0.18, 0.02), at=(cx, cy, z + 0.02), bevel=0.008, segs=2), chrome)
        add(rounded_box((0.02, 0.05, 0.03), at=(cx, cy, z + 0.005), bevel=0.006, segs=1), chrome)

    cons_x = 0.55
    console = sweep([(cons_x, -0.35, 0.36), (cons_x, -0.35, 0.7), (cons_x, -0.32, 0.86), (cons_x, -0.2, 0.94), (cons_x, -0.02, 0.92)], [(0.27, 0.22, 0.2, 0.3), (0.27, 0.24, 0.22, 0.3), (0.26, 0.22, 0.18, 0.3), (0.25, 0.14, 0.1, 0.3), (0.24, 0.05, 0.05, 0.3)], 20)
    add(subsurf(console, 1), glass)
    add(rounded_box((0.44, 0.03, 0.2), at=(cons_x, -0.42, 0.82), bevel=0.01, rot=Matrix.Rotation(0.55, 4, 'X')), black)
    for gx in (cons_x - 0.1, cons_x + 0.1):
        g = cyl_y(0.045, 0.02, (0, 0, 0), seg=24)
        xform(g, Matrix.Translation((gx, -0.44, 0.84)) @ Matrix.Rotation(0.55, 4, 'X'))
        add(g, lambda co, n: (0.9, 0.9, 0.88) if n[1] < -0.4 else (0.6, 0.6, 0.62))
    add(rounded_box((0.26, 0.05, 0.17), at=(cons_x, -0.2, 1.04), bevel=0.01, rot=Matrix.Rotation(0.25, 4, 'X')), lambda co, n: (0.06, 0.1, 0.16) if n[1] < -0.7 and abs(co[0] - cons_x) < 0.11 else (0.04, 0.04, 0.045))

    def windshield(cx, dy, dz):
        ws = new_bm()
        wr = []
        for k in range(13):
            a = (k / 12 - 0.5) * 2.4
            x = cx + math.sin(a) * 0.3
            y = -0.08 + (math.cos(a) - 1) * 0.16 + dy
            wr.append((ws.verts.new((x, y, 0.93 + dz)), ws.verts.new((x, y + 0.06, 1.17 + dz))))
        for k in range(12):
            ws.faces.new((wr[k][0], wr[k + 1][0], wr[k + 1][1], wr[k][1]))
        bmesh.ops.solidify(ws, geom=ws.faces[:], thickness=0.008)
        return ws
    add(windshield(cons_x, 0.0, 0.0), tint)
    add(windshield(-cons_x, 0.02, -0.06), tint)
    wc = Vector((cons_x - 0.06, -0.5, 0.92))
    tilt = Matrix.Translation(wc) @ Matrix.Rotation(-1.0, 4, 'X')
    add(xform(torus(0.15, 0.015, seg=36, rseg=8), tilt), chrome)
    for k in range(3):
        a = k / 3 * math.tau + math.pi / 2
        add(xform(rounded_box((0.13, 0.022, 0.01), at=(math.cos(a) * 0.075, math.sin(a) * 0.075, 0), bevel=0.004, segs=1, rot=Matrix.Rotation(a, 4, 'Z')), tilt), chrome)
    add(xform(cone(0.04, 0.035, 0.03, 18), tilt), black)
    add(tube([(cons_x + 0.3, -0.38, 0.8), (cons_x + 0.3, -0.42, 0.9), (cons_x + 0.3, -0.48, 1.0)], [0.012, 0.011, 0.01], 8), chrome)
    add(sphere(0.03, 14, 10, at=(cons_x + 0.3, -0.49, 1.02)), black)
    add(rounded_box((0.06, 0.16, 0.12), at=(cons_x + 0.3, -0.36, 0.78), bevel=0.02), black)
    pc = sweep([(-cons_x, -0.35, 0.36), (-cons_x, -0.35, 0.72), (-cons_x, -0.3, 0.84), (-cons_x, -0.1, 0.86)], [(0.25, 0.2, 0.2, 0.3), (0.25, 0.22, 0.2, 0.3), (0.24, 0.18, 0.15, 0.3), (0.23, 0.06, 0.06, 0.3)], 20)
    add(subsurf(pc, 1), glass)
    for sx in (cons_x, -cons_x):
        add(rounded_box((0.5, 0.48, 0.2), at=(sx, -0.95, 0.46), bevel=0.02), glass)
        stripe = lambda co, n, sx=sx: accent if abs(co[0] - sx) > 0.16 else vinyl(co, n)
        add(subsurf(rounded_box((0.48, 0.46, 0.1), at=(sx, -0.92, 0.6), bevel=0.04), 1), stripe)
        add(subsurf(rounded_box((0.48, 0.12, 0.42), at=(sx, -1.17, 0.85), bevel=0.04, rot=Matrix.Rotation(0.18, 4, 'X')), 1), stripe)
    for (py, pz) in ((1.7, 0.72), (-2.25, 0.67)):
        add(cone(0.04, 0.035, 0.26, 16, at=(0, py, pz)), chrome)
        add(cone(0.12, 0.12, 0.02, 24, at=(0, py, pz)), black)
        add(subsurf(rounded_box((0.4, 0.38, 0.07), at=(0, py, pz + 0.3), bevel=0.03), 1), vinyl)
        add(subsurf(rounded_box((0.38, 0.07, 0.18), at=(0, py - 0.17, pz + 0.42), bevel=0.03, rot=Matrix.Rotation(0.15, 4, 'X')), 1), vinyl)
    tm_z = front_z(2.6) + 0.02
    add(rounded_box((0.24, 0.32, 0.06), at=(-0.18, 2.62, tm_z + 0.03), bevel=0.01), black)
    add(tube([(-0.18, 2.86, tm_z + 0.07), (-0.18, 1.45, tm_z + 0.08)], [0.016, 0.016], 10), black)
    add(subsurf(rounded_box((0.16, 0.26, 0.13), at=(-0.18, 1.36, tm_z + 0.1), bevel=0.04), 1), black)
    add(subsurf(sweep([(-0.18, 2.74, tm_z + 0.07), (-0.18, 2.86, tm_z + 0.07), (-0.18, 3.04, tm_z + 0.07)], [(0.045, 0.045, 0.045), (0.05, 0.05, 0.05), (0.035, 0.035, 0.035)], 14, front=(0, 0, 1)), 1), black)
    add(rounded_box((0.2, 0.3, 0.05), at=(0.15, 2.0, front_z(2.0) + 0.025), bevel=0.012), black)
    add(rounded_box((0.22, 0.06, 0.16), at=(0.0, 2.62, front_z(2.62) + 0.1), bevel=0.01, rot=Matrix.Rotation(-0.3, 4, 'X')), lambda co, n: (0.06, 0.1, 0.16) if n[1] > 0.7 else (0.04, 0.04, 0.045))
    add(rounded_box((0.06, 0.04, 0.03), at=(0, 2.9, boat_sheer(2.9) + 0.03), bevel=0.01), lambda co, n: (0.9, 0.08, 0.05) if co[0] < 0 else (0.1, 0.85, 0.2))
    for s in (-1, 1):
        x = s * 0.6
        add(rounded_box((0.07, 0.1, 0.32), at=(x, BOAT_Y0 - 0.06, 0.6), bevel=0.02), black)
        add(tube([(x, BOAT_Y0 - 0.12, 0.25), (x, BOAT_Y0 - 0.12, 2.0)], [0.022, 0.022], 12), black)
        add(rounded_box((0.06, 0.06, 0.08), at=(x, BOAT_Y0 - 0.12, 2.03), bevel=0.015), black)
        add(rounded_box((0.03, 0.01, 0.12), at=(x, BOAT_Y0 - 0.11, 0.85), bevel=0.004), lambda co, n: (0.85, 0.85, 0.85))
    add(rounded_box((0.3, 0.06, 0.34), at=(0, BOAT_Y0 - 0.03, 0.55), bevel=0.01), silver)

    P = (0.0, BOAT_Y0 - 0.15, 0.62)

    def madd(bm, col, smooth=True):
        m.add('motor', piece_from_bm(bm, col, smooth=smooth), pivot=P)

    def cowl_col(co, n):
        k = 1 + 0.03 * n3(Vector((co[0] * 300, co[1] * 300, co[2] * 300)), 1)
        c = (0.75, 0.76, 0.78) if 1.06 < co[2] < 1.08 else (0.04, 0.04, 0.045)
        return (c[0] * k, c[1] * k, c[2] * k)
    cowl = sweep([(0, -3.05, 0.86), (0, -3.05, 0.98), (0, -3.05, 1.18), (0, -3.07, 1.33), (0, -3.08, 1.39)], [(0.24, 0.34, 0.3, 0.55), (0.26, 0.38, 0.33, 0.55), (0.26, 0.38, 0.34, 0.55), (0.23, 0.33, 0.3, 0.6), (0.14, 0.2, 0.18, 0.7)], 32)
    madd(subsurf(cowl, 1), cowl_col)
    for k in range(5):
        for sx in (0.255, -0.255):
            madd(box((0.006, 0.14, 0.012), at=(sx, -3.17, 1.22 - k * 0.022)), lambda co, n: (0.01, 0.01, 0.01), smooth=False)
    mgray = lambda co, n: (0.05, 0.05, 0.055)
    madd(subsurf(sweep([(0, -3.03, 0.62), (0, -3.03, 0.72), (0, -3.04, 0.86)], [(0.16, 0.24, 0.22, 0.6), (0.2, 0.3, 0.27, 0.6), (0.23, 0.33, 0.29, 0.6)], 28), 1), mgray)
    madd(subsurf(sweep([(0, -3.0, 0.08), (0, -3.0, 0.3), (0, -3.01, 0.5), (0, -3.02, 0.64)], [(0.055, 0.16, 0.12, 0.8), (0.06, 0.15, 0.12, 0.8), (0.08, 0.18, 0.15, 0.8), (0.12, 0.22, 0.2, 0.8)], 24), 1), mgray)
    madd(subsurf(rounded_box((0.34, 0.5, 0.016), at=(0, -3.05, 0.1), bevel=0.006), 1), mgray)
    madd(subsurf(sweep([(0, -2.82, -0.12), (0, -2.9, -0.12), (0, -3.05, -0.11), (0, -3.18, -0.1), (0, -3.24, -0.1)], [(0.03, 0.04, 0.04), (0.055, 0.06, 0.06), (0.065, 0.07, 0.07), (0.06, 0.065, 0.065), (0.04, 0.04, 0.04)], 20, front=(0, 0, 1)), 1), mgray)
    madd(rounded_box((0.03, 0.26, 0.24), at=(0, -2.98, -0.04), bevel=0.012), mgray)
    madd(rounded_box((0.02, 0.18, 0.12), at=(0, -3.02, -0.24), bevel=0.008), mgray)
    madd(cyl_y(0.03, 0.08, (0, -3.28, -0.11), seg=16), chrome)
    for k in range(3):
        a = k / 3 * math.tau
        blade = new_bm()
        rows = []
        for i in range(6):
            r = 0.03 + 0.14 * i / 5
            w = 0.05 * math.sin(math.pi * (0.15 + 0.85 * i / 5)) + 0.01
            row = []
            for j in range(4):
                u = (j / 3 - 0.5) * w
                row.append(blade.verts.new((math.cos(a) * r - math.sin(a) * u * 0.6, -3.28 + u * 0.8, -0.11 + math.sin(a) * r + math.cos(a) * u * 0.6)))
            rows.append(row)
        for i in range(5):
            for j in range(3):
                blade.faces.new((rows[i][j], rows[i][j + 1], rows[i + 1][j + 1], rows[i + 1][j]))
        bmesh.ops.solidify(blade, geom=blade.faces[:], thickness=0.006)
        madd(blade, chrome)
    madd(rounded_box((0.2, 0.12, 0.3), at=(0, -2.86, 0.62), bevel=0.02), lambda co, n: (0.08, 0.08, 0.085))
    madd(tube([(0, -2.75, 0.85), (0, -2.55, 0.8)], [0.02, 0.02], 8), chrome)
    write_model(m)
