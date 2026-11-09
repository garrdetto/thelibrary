def build_quad():
    m = Model('quad', ao_dist=0.5, ao_strength=0.6)
    shell = lambda co, n: fabric(camo(co, ((0.46, 0.43, 0.32), (0.34, 0.33, 0.23), (0.24, 0.24, 0.16), (0.14, 0.13, 0.1)), 1.6, 4.2), co, 0.5)
    plastic = grain((0.06, 0.06, 0.065))
    steel = lambda co, n: mix((0.25, 0.26, 0.28), (0.6, 0.61, 0.63), max(0.0, n[2]))
    seat_c = lambda co, n: mix((0.07, 0.07, 0.075), (0.16, 0.16, 0.17), max(0.0, n[2]))

    def add(bm, col, smooth=True):
        m.add('body', piece_from_bm(bm, col, smooth=smooth))

    for x in (-0.25, 0.25):
        add(tube([(x, -1.15, 0.42), (x, 0.0, 0.36), (x, 1.15, 0.42)], [0.03] * 3, 10), plastic)
    add(rounded_box((0.62, 2.0, 0.04), at=(0, 0.0, 0.33), bevel=0.01), grain((0.18, 0.18, 0.19), 0.05))
    eng = rounded_box((0.42, 0.55, 0.35), at=(0, 0.05, 0.55), bevel=0.04)
    add(eng, lambda co, n: mix((0.2, 0.2, 0.22), (0.4, 0.41, 0.43), max(0.0, n[2])) if int(co[2] * 60) % 3 else (0.12, 0.12, 0.13))
    for s in (-1, 1):
        for yc in (1.0, -0.95):
            arc = arc_path((s * 0.62, yc, 0.35), 0.42, 0.2, math.pi - 0.2, 16)
            add(subsurf(sweep(arc, [(0.012, 0.18, 0.18, 0.25)] * len(arc), 8, front=(1, 0, 0)), 1), shell)
        add(rounded_box((0.3, 0.75, 0.05), at=(s * 0.5, 0.02, 0.48), bevel=0.02), plastic)
    nose = sweep([(0, 1.0, 0.82), (0, 1.25, 0.8), (0, 1.45, 0.72), (0, 1.55, 0.62)], [(0.46, 0.12, 0.08, 0.35), (0.48, 0.11, 0.09, 0.35), (0.44, 0.09, 0.09, 0.35), (0.36, 0.06, 0.07, 0.35)], 24, front=(0, 0, 1))
    add(subsurf(nose, 2), shell)
    tail = sweep([(0, -0.55, 0.86), (0, -0.85, 0.85), (0, -1.15, 0.8), (0, -1.38, 0.72)], [(0.46, 0.08, 0.08, 0.35), (0.5, 0.09, 0.08, 0.35), (0.48, 0.08, 0.08, 0.35), (0.38, 0.06, 0.06, 0.35)], 24, front=(0, 0, 1))
    add(subsurf(tail, 2), shell)
    tank = subsurf(rounded_box((0.42, 0.5, 0.24), at=(0, 0.45, 0.9), bevel=0.09), 1)
    add(tank, shell)
    add(cone(0.05, 0.05, 0.03, 16, at=(0, 0.48, 1.02)), plastic)
    saddle = subsurf(sweep([(0, 0.25, 0.93), (0, 0.0, 0.98), (0, -0.35, 0.99), (0, -0.6, 0.96)], [(0.15, 0.06, 0.06, 0.55), (0.17, 0.08, 0.06, 0.5), (0.17, 0.08, 0.06, 0.5), (0.15, 0.05, 0.05, 0.6)], 20, front=(0, 0, 1)), 1)
    add(saddle, seat_c)
    add(tube([(0, 0.62, 0.95), (0, 0.72, 1.12)], [0.03, 0.03], 10), steel)
    add(tube([(-0.36, 0.66, 1.15), (-0.2, 0.72, 1.16), (0.2, 0.72, 1.16), (0.36, 0.66, 1.15)], [0.016] * 4, 10), steel)
    for s in (-1, 1):
        add(tube([(s * 0.3, 0.68, 1.15), (s * 0.42, 0.65, 1.14)], [0.022, 0.022], 10), plastic)
        add(rounded_box((0.12, 0.06, 0.06), at=(s * 0.27, 0.74, 1.14), bevel=0.015), plastic)
    add(rounded_box((0.26, 0.12, 0.1), at=(0, 0.78, 1.14), bevel=0.03), plastic)
    for s in (-1, 1):
        lamp = cone(0.06, 0.055, 0.04, 16, at=(s * 0.17, 1.55, 0.7), rot=Matrix.Rotation(-math.pi / 2, 4, 'X'))
        add(lamp, lambda co, n: (1.0, 0.98, 0.9) if n[1] > 0.7 else (0.08, 0.08, 0.08))
        add(rounded_box((0.06, 0.02, 0.04), at=(s * 0.3, -1.4, 0.72), bevel=0.01), lambda co, n: (0.85, 0.06, 0.04))
    for (y0, y1, z) in ((0.98, 1.45, 0.94), (-0.62, -1.3, 0.95)):
        rack = [(-0.42, y0, z), (-0.42, y1, z), (0.42, y1, z), (0.42, y0, z)]
        add(bent_tube(rack, 0.014, bend=0.05, seg=8), plastic)
        for k in range(5):
            y = y0 + (y1 - y0) * (k + 0.5) / 5
            add(tube([(-0.42, y, z), (0.42, y, z)], [0.01, 0.01], 6), plastic)
    add(tube([(-0.32, 1.5, 0.55), (0.32, 1.5, 0.55)], [0.025, 0.025], 10), plastic)
    gun = rounded_box((0.16, 0.95, 0.12), at=(0.38, -0.95, 1.07), bevel=0.04)
    add(gun, lambda co, n: (0.12, 0.13, 0.1))
    add(cyl_y(0.03, 0.4, (0.22, -0.7, 0.55), seg=12), lambda co, n: (0.3, 0.3, 0.32))
    add(cyl_y(0.025, 0.12, (0.22, -0.95, 0.55), seg=10), lambda co, n: (0.12, 0.1, 0.09))
    for name, (x, y) in {'wheelFL': (0.66, 1.0), 'wheelFR': (-0.66, 1.0), 'wheelBL': (0.66, -0.95), 'wheelBR': (-0.66, -0.95)}.items():
        build_tire_wheel(m, name, x, y, 0.35, 1 if x > 0 else -1)
    write_model(m)
