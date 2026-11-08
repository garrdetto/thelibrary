WARDROBE_DEFAULT = {'jacket': 'jacket-camo', 'vest': 'vest-blaze', 'cap': 'cap-blaze', 'pants': 'pants-camo', 'pack': None}


def bake_ao_variants(model):
    groups = {}
    for name in model.parts:
        own = model.variants.get(name)
        key = []
        for slot, default in WARDROBE_DEFAULT.items():
            key.append(own[1] if own and own[0] == slot else default)
        groups.setdefault(tuple(key), []).append(name)
    for key, names in groups.items():
        chosen = dict(zip(WARDROBE_DEFAULT.keys(), key))
        verts = []
        polys = []
        for pname, pieces in model.parts.items():
            v = model.variants.get(pname)
            if v and chosen.get(v[0]) != v[1]:
                continue
            for p in pieces:
                base = len(verts)
                verts.extend(Vector(q) for q in p.pos)
                polys.extend((a + base, b + base, c + base) for a, b, c in p.tris)
        s = 50
        base = len(verts)
        verts.extend([Vector((-s, -s, -0.002)), Vector((s, -s, -0.002)), Vector((s, s, -0.002)), Vector((-s, s, -0.002))])
        polys.extend([(base, base + 1, base + 2), (base, base + 2, base + 3)])
        tree = BVHTree.FromPolygons(verts, polys, epsilon=0.0)
        r = random.Random(3)
        dirs = []
        for i in range(16):
            u = (i + r.random()) / 16
            phi = r.random() * math.tau
            st = math.sqrt(u)
            dirs.append((st * math.cos(phi), st * math.sin(phi), math.sqrt(1 - u)))
        for pname in names:
            for p in model.parts[pname]:
                for i, (co, n) in enumerate(zip(p.pos, p.nor)):
                    nv = Vector(n)
                    if nv.length < 1e-6:
                        continue
                    nv.normalize()
                    t1 = nv.cross(Vector((0, 0, 1)) if abs(nv.z) < 0.9 else Vector((1, 0, 0))).normalized()
                    t2 = nv.cross(t1)
                    origin = Vector(co) + nv * 0.004
                    hit = 0
                    for dx, dy, dz in dirs:
                        d = t1 * dx + t2 * dy + nv * dz
                        loc, _, _, dist = tree.ray_cast(origin, d, model.ao_dist)
                        if loc is not None:
                            hit += 1.0 - (dist / model.ao_dist) * 0.5
                    ao = 1.0 - model.ao_strength * hit / len(dirs)
                    c = p.col[i]
                    p.col[i] = (c[0] * ao, c[1] * ao, c[2] * ao)


def plaid(co, n):
    a = math.sin(co[0] * 52 + co[1] * 52) > 0.45
    b = math.sin(co[2] * 52) > 0.45
    c = (0.62, 0.07, 0.05)
    if a and b:
        c = (0.07, 0.04, 0.04)
    elif a or b:
        c = (0.24, 0.04, 0.04)
    if abs(math.sin(co[2] * 26 + 1.2)) < 0.05:
        c = mix(c, (0.85, 0.7, 0.2), 0.5)
    return fabric(c, co, 1.2)


def canvas(co, n):
    return fabric(mix((0.58, 0.46, 0.29), (0.5, 0.39, 0.24), n3(Vector((co[0] * 30, co[1] * 30, co[2] * 30)), 1) * 0.5 + 0.5), co, 1.4)


def denim(co, n):
    fade = 0.35 * g2(abs(co[0]) - 0.1, co[2] - 0.62, 0.05, 0.12) + 0.25 * g2(abs(co[0]) - 0.1, co[2] - 0.5, 0.04, 0.04)
    c = mix((0.16, 0.22, 0.36), (0.42, 0.5, 0.62), fade)
    tw = 0.06 * math.sin((co[0] + co[2]) * 900)
    return (c[0] * (1 + tw), c[1] * (1 + tw), c[2] * (1 + tw))


def rubber(co, n):
    c = mix((0.2, 0.23, 0.16), (0.3, 0.33, 0.24), max(0.0, n[2]) * 0.5 + n3(Vector((co[0] * 40, co[1] * 40, co[2] * 40)), 1) * 0.15 + 0.3)
    return c


CAMO_JACKET = ((0.5, 0.46, 0.34), (0.38, 0.35, 0.25), (0.27, 0.26, 0.18), (0.19, 0.17, 0.12))
CAMO_PANTS = ((0.44, 0.39, 0.29), (0.33, 0.29, 0.21), (0.24, 0.21, 0.15), (0.14, 0.12, 0.09))
KHAKI = (0.66, 0.6, 0.45)


def build_hunter():
    m = Model('hunter', ao_dist=0.22, ao_strength=0.45)
    m.variants = {}
    m.bake = bake_ao_variants
    HIP = (0, 0, 0.98)
    WAIST = (0, 0, 1.04)
    NECK = (0, -0.005, 1.535)
    pivots = {'hips': HIP, 'torso': WAIST, 'head': NECK}

    def garment(joint, slot, variant, piece):
        name = joint + ':' + variant
        m.add(name, piece, pivot=pivots[joint], parent=joint)
        m.variants[name] = (slot, variant)

    camo_j = lambda co, n: fabric(camo(co, CAMO_JACKET, seed=1.7), co)
    camo_p = lambda co, n: fabric(camo(co, CAMO_PANTS, 0.9, 5.3), co)
    jackets = {'jacket-camo': camo_j, 'jacket-flannel': plaid, 'jacket-canvas': canvas}
    jacket_trim = {'jacket-camo': (0.13, 0.12, 0.1), 'jacket-flannel': (0.1, 0.05, 0.04), 'jacket-canvas': (0.3, 0.2, 0.12)}
    pants_cols = {'pants-camo': camo_p, 'pants-jeans': denim, 'pants-waders': rubber}

    tor_knots = [
        (0.0, 0, 0.0, 0.9, 0.0, 0.0, 0.0),
        (0.02, 0, 0.0, 0.905, 0.16, 0.11, 0.115),
        (0.12, 0, 0.002, 0.96, 0.168, 0.112, 0.12),
        (0.3, 0, 0.004, 1.08, 0.165, 0.11, 0.12),
        (0.5, 0, 0.008, 1.2, 0.178, 0.13, 0.122),
        (0.68, 0, 0.006, 1.32, 0.19, 0.135, 0.122),
        (0.82, 0, 0.0, 1.42, 0.198, 0.112, 0.112),
        (0.9, 0, -0.004, 1.48, 0.17, 0.092, 0.098),
        (0.96, 0, -0.006, 1.525, 0.095, 0.07, 0.072),
        (1.0, 0, -0.006, 1.55, 0.0, 0.0, 0.0),
    ]
    path, prof = knots_path(tor_knots, 22)
    prof = [(p[0], p[1], p[2], 0.92) for p in prof]
    path[0] = (0, 0, 0.9)
    zs = [q[2] for q in path]
    m.add('torso', piece_from_bm(subsurf(sweep([(0, -0.004, 1.44), (0, -0.006, 1.53)], [(0.07, 0.065, 0.07), (0.062, 0.058, 0.064)], 20), 1), lambda co, n: (0.16, 0.15, 0.14)), pivot=WAIST, parent='hips')
    for v, col in jackets.items():
        garment('torso', 'jacket', v, piece_from_bm(subsurf(sweep(path, prof, 28), 1), col))
        garment('torso', 'jacket', v, piece_from_bm(subsurf(sweep([(0, -0.004, 1.48), (0, -0.006, 1.55)], [(0.088, 0.085, 0.09), (0.078, 0.072, 0.08)], 28, cap0=False, cap1=False), 1), (lambda c: lambda co, n: c)(jacket_trim[v]) if v != 'jacket-camo' else col))
        if v == 'jacket-flannel':
            for k in range(5):
                garment('torso', 'jacket', v, piece_from_bm(sphere(0.006, 8, 6, at=(0, 0.136 + 0.01 * math.sin(k), 0.98 + k * 0.1), scale=(1, 0.5, 1)), lambda co, n: (0.85, 0.82, 0.7)))
            for sx in (-1, 1):
                garment('torso', 'jacket', v, piece_from_bm(rounded_box((0.07, 0.012, 0.075), at=(sx * 0.08, 0.142, 1.3), bevel=0.006), plaid))
        else:
            garment('torso', 'jacket', v, piece_from_bm(tube([(0, 0.128, 0.92), (0, 0.142, 1.1), (0, 0.15, 1.3), (0, 0.13, 1.42), (0, 0.085, 1.52)], [0.0045] * 5, 6, cap=False), lambda co, n: (0.09, 0.09, 0.08)))
        if v == 'jacket-canvas':
            for sx in (-1, 1):
                garment('torso', 'jacket', v, piece_from_bm(rounded_box((0.085, 0.03, 0.1), at=(sx * 0.09, 0.135, 1.03), bevel=0.01), canvas))

    def torso_at(a, z, off):
        z = max(zs[0], min(zs[-1], z))
        i = 0
        while i < len(zs) - 2 and zs[i + 1] < z:
            i += 1
        f = (z - zs[i]) / max(1e-6, zs[i + 1] - zs[i])
        rx = lerp(prof[i][0], prof[i + 1][0], f) + off
        ryf = lerp(prof[i][1], prof[i + 1][1], f) + off
        ryb = lerp(prof[i][2], prof[i + 1][2], f) + off
        cy = lerp(path[i][1], path[i + 1][1], f)
        ca, sa = math.cos(a), math.sin(a)
        u = math.copysign(abs(ca) ** 0.92, ca)
        v = math.copysign(abs(sa) ** 0.92, sa)
        return Vector((u * rx, cy + v * (ryf if v > 0 else ryb), z))

    def vest_top(a):
        c, sn = abs(math.cos(a)), math.sin(a)
        side = smooth01(0.93, 0.8, c)
        strap = 1.27 + (1.49 - 1.27) * side
        if sn > 0:
            vneck = 1.31 + (1.49 - 1.31) * smooth01(0.0, 0.42, c)
            strap = min(strap, vneck)
        return strap

    def vest_shell(bottom):
        vest = new_bm()
        NA, NF = 96, 14
        grid = []
        for i in range(NA):
            a = (i + 0.5) / NA * math.tau
            top = vest_top(a)
            grid.append([vest.verts.new(torso_at(a, bottom + (top - bottom) * j / NF, 0.013 + 0.004 * smooth01(1.2, 1.4, bottom + (top - bottom) * j / NF))) for j in range(NF + 1)])
        for i in range(NA):
            i2 = (i + 1) % NA
            if abs((i + 1) / NA * math.tau - math.pi / 2) < 1e-6:
                continue
            for j in range(NF):
                vest.faces.new((grid[i][j], grid[i2][j], grid[i2][j + 1], grid[i][j + 1]))
        vest.normal_update()
        for f in vest.faces:
            c = f.calc_center_median()
            if Vector((c.x, c.y, 0)).dot(f.normal) < 0:
                f.normal_flip()
        bmesh.ops.solidify(vest, geom=vest.faces[:], thickness=0.005)
        bmesh.ops.recalc_face_normals(vest, faces=vest.faces[:])
        return vest

    def blaze(co, n):
        mesh = n3(Vector((co[0] * 260, co[1] * 260, co[2] * 260)), 1.0) > 0.25
        c = ORANGE if not mesh else mix(ORANGE, ORANGE_DK, 0.18)
        if co[2] > vest_top(math.atan2(co[1], co[0])) - 0.012 or co[2] < 0.977 or (abs(co[0]) < 0.012 and co[1] > 0):
            return (0.1, 0.09, 0.08)
        return c
    garment('torso', 'vest', 'vest-blaze', piece_from_bm(vest_shell(0.965), blaze))
    for sx in (-1, 1):
        garment('torso', 'vest', 'vest-blaze', piece_from_bm(rounded_box((0.075, 0.03, 0.06), at=(sx * 0.085, 0.142, 1.16), bevel=0.01), lambda co, n: mix(ORANGE, ORANGE_DK, 0.25) if co[2] < 1.17 else ORANGE_DK))
        garment('torso', 'vest', 'vest-blaze', piece_from_bm(rounded_box((0.06, 0.02, 0.07), at=(sx * 0.075, 0.15, 1.32), bevel=0.008), lambda co, n: mix(ORANGE, ORANGE_DK, 0.2)))

    def khaki(co, n):
        if co[2] > vest_top(math.atan2(co[1], co[0])) - 0.01 or co[2] < 1.065 or (abs(co[0]) < 0.012 and co[1] > 0):
            return (0.38, 0.33, 0.22)
        if co[1] < -0.05 and 1.15 < co[2] < 1.4:
            return (0.3, 0.28, 0.2) if int(co[0] * 200 + co[2] * 200) % 2 else (0.45, 0.41, 0.3)
        return fabric(KHAKI, co, 1.2)
    garment('torso', 'vest', 'vest-fishing', piece_from_bm(vest_shell(1.055), khaki))
    for sx in (-1, 1):
        for (px, pz, w, h) in ((0.06, 1.12, 0.06, 0.075), (0.12, 1.12, 0.045, 0.07), (0.085, 1.36, 0.05, 0.05)):
            y = torso_at(math.atan2(0.9, sx * px / 0.17), pz, 0.022).y
            garment('torso', 'vest', 'vest-fishing', piece_from_bm(rounded_box((w, 0.025, h), at=(sx * px, max(0.135, y), pz), bevel=0.008), lambda co, n: mix(KHAKI, (0.4, 0.35, 0.24), 0.35 if n[1] > 0.6 else 0.0)))
    garment('torso', 'vest', 'vest-fishing', piece_from_bm(torus(0.012, 0.0025, at=(0.07, 0.15, 1.44), seg=12, rseg=5, rot=Matrix.Rotation(math.pi / 2, 4, 'X')), lambda co, n: (0.7, 0.7, 0.72)))

    pack_c = lambda co, n: fabric(camo(co, CAMO_JACKET, 1.2, 8.8), co)
    garment('torso', 'pack', 'pack-hunting', piece_from_bm(subsurf(rounded_box((0.3, 0.17, 0.4), at=(0, -0.22, 1.22), bevel=0.05), 1), pack_c))
    garment('torso', 'pack', 'pack-hunting', piece_from_bm(subsurf(rounded_box((0.24, 0.07, 0.17), at=(0, -0.32, 1.12), bevel=0.03), 1), pack_c))
    for sx in (-1, 1):
        strap = [(sx * 0.1, -0.15, 1.4), (sx * 0.11, -0.04, 1.5), (sx * 0.12, 0.08, 1.44), (sx * 0.12, 0.14, 1.3), (sx * 0.12, 0.148, 1.15)]
        garment('torso', 'pack', 'pack-hunting', piece_from_bm(sweep(strap, [(0.025, 0.006, 0.006, 0.4)] * len(strap), 10, front=(1, 0, 0)), lambda co, n: (0.1, 0.1, 0.09)))
    garment('torso', 'pack', 'pack-hunting', piece_from_bm(tube([(-0.13, -0.31, 1.42), (0.13, -0.31, 1.42)], [0.035, 0.035], 14), lambda co, n: (0.25, 0.3, 0.22)))

    neck = sweep([(0, -0.01, 1.47), (0, -0.002, 1.56), (0, 0.004, 1.63)], [(0.052, 0.05, 0.052), (0.05, 0.048, 0.05), (0.052, 0.05, 0.052)], 24, cap0=True, cap1=False)
    m.add('head', piece_from_bm(subsurf(neck, 1), lambda co, n: mix(SKIN, SKIN_SHADE, 0.3 if co[1] > 0 else 0.0)), pivot=NECK, parent='torso')
    HC = Vector((0, 0.012, 1.685))
    head = sphere(1.0, 40, 30)
    for v in head.verts:
        x, y, z = v.co
        X, Y, Z = x * 0.077, y * 0.097, z * 0.118
        if Y < 0:
            Y *= 1.04
            X *= 1.02
        jaw = smooth01(-0.02, -0.11, Z)
        X *= 1 - 0.32 * jaw
        if Y > 0:
            Y *= 1 - 0.1 * jaw
        X *= 1 - 0.1 * smooth01(0.05, 0.118, Z)
        if Y > 0:
            Y += 0.03 * g2(X, Z + 0.014, 0.012, 0.032) * smooth01(0.014, -0.034, Z) + 0.007 * g2(X, Z - 0.008, 0.009, 0.02)
            Y += 0.014 * g2(X, Z + 0.04, 0.011, 0.007)
            for s in (-1, 1):
                Y -= 0.009 * g2(X - s * 0.033, Z - 0.008, 0.016, 0.012)
                X += s * 0.004 * g2(X - s * 0.05, Z + 0.02, 0.02, 0.02)
            Y += 0.007 * g2(X, Z - 0.03, 0.05, 0.008)
            Y += 0.005 * g2(X, Z + 0.062, 0.024, 0.008)
            Y += 0.009 * g2(X, Z + 0.1, 0.022, 0.018)
        v.co = HC + Vector((X, Y, Z))
    bmesh.ops.recalc_face_normals(head, faces=head.faces[:])

    def face_col(co, n):
        L = Vector(co) - HC
        X, Y, Z = L.x, L.y, L.z
        c = mix(SKIN, SKIN_SHADE, smooth01(0.4, -0.6, n[1]) * 0.4)
        c = mix(c, (0.84, 0.52, 0.42), 0.35 * g2(abs(X) - 0.045, Z + 0.02, 0.02, 0.02) * (1 if Y > 0 else 0))
        c = mix(c, (0.85, 0.5, 0.42), 0.3 * g2(X, Z + 0.03, 0.012, 0.012))
        if Y > 0.04 and abs(Z + 0.062) < 0.006 and abs(X) < 0.024:
            c = mix(c, (0.55, 0.3, 0.26), 0.8)
        line = -0.04 + 0.018 * smooth01(0.045, 0.075, abs(X)) + 0.006 * n3(Vector((X * 90, Y * 90, Z * 90)), 1)
        w = smooth01(line + 0.006, line - 0.008, Z) * smooth01(-0.05, -0.025, Y + (0.04 if Z < -0.075 else 0))
        w = max(w, g2(X, Z + 0.047, 0.03, 0.006) * smooth01(0.05, 0.07, Y))
        w *= 1 - g2(X, Z + 0.062, 0.02, 0.0035)
        if w > 0.01:
            c = mix(c, mix(BEARD, (0.36, 0.25, 0.16), n3(Vector((X * 300, Y * 300, Z * 300)), 1) * 0.5 + 0.5), 0.9 * w)
        if Z > 0.03 and (Y < 0.02 or abs(X) > 0.06):
            c = mix(c, HAIR, 0.9)
        if Y > 0:
            bw = g2(abs(X) - 0.033, Z - 0.026 + 0.004 * (abs(X) - 0.033) / 0.02, 0.019, 0.0045)
            c = mix(c, HAIR, min(1.0, bw * 1.3))
        return c
    m.add('head', piece_from_bm(subsurf(head, 1), face_col), pivot=NECK)
    for s in (-1, 1):
        eye = sphere(0.0115, 16, 12, at=(s * 0.032, 0.0705 + HC.y, HC.z + 0.008))
        m.add('head', piece_from_bm(eye, lambda co, n: (0.03, 0.03, 0.03) if n[1] > 0.993 else (0.28, 0.22, 0.12) if n[1] > 0.972 else (0.9, 0.88, 0.84)), pivot=NECK)
        lid = sweep([(s * 0.032, 0.0715 + HC.y, HC.z + 0.0178), (s * 0.032, 0.073 + HC.y, HC.z + 0.0188)], [(0.0135, 0.007, 0.002), (0.0115, 0.006, 0.002)], 12)
        ear = sweep([(s * 0.077, HC.y - 0.006, HC.z - 0.02), (s * 0.08, HC.y - 0.01, HC.z + 0.004), (s * 0.079, HC.y - 0.012, HC.z + 0.026)], [(0.008, 0.016, 0.014), (0.011, 0.019, 0.017), (0.007, 0.012, 0.012)], 16)
        m.add('head', piece_from_bm(ear, lambda co, n: mix(SKIN, (0.72, 0.45, 0.38), 0.4)), pivot=NECK)
        m.add('head', piece_from_bm(lid, lambda co, n: SKIN_SHADE), pivot=NECK)

    def ball_cap(variant, crown_col, brim_col):
        cap = sphere(1.0, 32, 20)
        bmesh.ops.delete(cap, geom=[v for v in cap.verts if v.co.z < -0.05], context='VERTS')
        for v in cap.verts:
            x, y, z = v.co
            v.co = HC + Vector((x * 0.0835, y * 0.106 - 0.003, max(z, 0.0) * 0.1 + 0.03 + min(z, 0) * 0.1))
        bmesh.ops.solidify(cap, geom=cap.faces[:], thickness=-0.004)
        bmesh.ops.recalc_face_normals(cap, faces=cap.faces[:])
        garment('head', 'cap', variant, piece_from_bm(subsurf(cap, 1), crown_col))
        garment('head', 'cap', variant, piece_from_bm(sphere(0.008, 10, 6, at=(HC.x, HC.y - 0.003, HC.z + 0.13), scale=(1, 1, 0.5)), brim_col))
        brim = new_bm()
        rows = []
        for i in range(17):
            u = i / 16 * 2 - 1
            row = []
            for j in range(7):
                t = j / 6
                ang = u * 1.15
                rr = 0.084 + t * 0.075 * (1 - 0.55 * u * u)
                row.append(brim.verts.new((math.sin(ang) * rr * 0.98, math.cos(ang) * rr * 1.1 + HC.y, HC.z + 0.032 - t * 0.012 - abs(u) ** 2 * 0.014 * t)))
            rows.append(row)
        for i in range(16):
            for j in range(6):
                brim.faces.new((rows[i][j], rows[i + 1][j], rows[i + 1][j + 1], rows[i][j + 1]))
        bmesh.ops.solidify(brim, geom=brim.faces[:], thickness=0.006)
        bmesh.ops.recalc_face_normals(brim, faces=brim.faces[:])
        garment('head', 'cap', variant, piece_from_bm(subsurf(brim, 1), brim_col))

    def blaze_cap(co, n):
        L = Vector(co) - HC
        seam = abs(((math.atan2(L.x, L.y) / (math.tau / 6)) % 1) - 0.5) > 0.47
        c = fabric(ORANGE, co, 1.5)
        if seam and L.z > 0.05:
            c = mix(c, ORANGE_DK, 0.7)
        if L.z < 0.036:
            c = mix(c, ORANGE_DK, 0.35)
        return c
    ball_cap('cap-blaze', blaze_cap, lambda co, n: fabric(mix(ORANGE, ORANGE_DK, 0.15), co))
    camo_cap = lambda co, n: fabric(camo(co, CAMO_JACKET, 2.0, 3.1), co)
    ball_cap('cap-camo', camo_cap, camo_cap)
    bucket = sweep([HC + Vector((0, -0.003, 0.018)), HC + Vector((0, -0.003, 0.07)), HC + Vector((0, -0.003, 0.118)), HC + Vector((0, -0.003, 0.128))], [(0.088, 0.108, 0.108), (0.086, 0.104, 0.104), (0.075, 0.09, 0.09), (0.05, 0.06, 0.06)], 32, cap0=False, cap1=True)
    bmesh.ops.solidify(bucket, geom=bucket.faces[:], thickness=-0.004)
    bmesh.ops.recalc_face_normals(bucket, faces=bucket.faces[:])
    hat_c = lambda co, n: fabric(mix(KHAKI, (0.55, 0.5, 0.37), 0.3 if (Vector(co) - HC).z < 0.04 else 0.0), co, 1.3)
    garment('head', 'cap', 'cap-bucket', piece_from_bm(subsurf(bucket, 1), hat_c))
    brim = new_bm()
    rows = []
    for i in range(40):
        a = i / 40 * math.tau
        rows.append([brim.verts.new(HC + Vector((math.sin(a) * (0.088 + t * 0.07), math.cos(a) * (0.108 + t * 0.07) - 0.003, 0.02 - t * 0.035))) for t in (0.0, 0.5, 1.0)])
    for i in range(40):
        for j in range(2):
            brim.faces.new((rows[i][j], rows[(i + 1) % 40][j], rows[(i + 1) % 40][j + 1], rows[i][j + 1]))
    bmesh.ops.solidify(brim, geom=brim.faces[:], thickness=0.005)
    bmesh.ops.recalc_face_normals(brim, faces=brim.faces[:])
    garment('head', 'cap', 'cap-bucket', piece_from_bm(subsurf(brim, 1), hat_c))
    garment('head', 'cap', 'cap-bucket', piece_from_bm(sweep([HC + Vector((0, -0.003, 0.045)), HC + Vector((0, -0.003, 0.06))], [(0.0885, 0.1085, 0.1085), (0.087, 0.106, 0.106)], 32, cap0=False, cap1=False), lambda co, n: (0.32, 0.26, 0.17)))

    m.add('hips', piece_from_bm(sweep([(0, 0.0, 0.955), (0, 0.0, 0.995)], [(0.168, 0.118, 0.122, 0.9), (0.168, 0.118, 0.122, 0.9)], 32, cap0=False, cap1=False), lambda co, n: (0.2, 0.13, 0.08)), pivot=HIP)
    m.add('hips', piece_from_bm(rounded_box((0.05, 0.012, 0.042), at=(0, 0.122, 0.975), bevel=0.004), lambda co, n: (0.55, 0.52, 0.45) if n[1] > 0.5 else (0.3, 0.29, 0.26)), pivot=HIP)
    pel = [(0, 0, 0.78), (0, 0, 0.82), (0, 0, 0.88), (0, 0, 0.95), (0, 0, 1.0)]
    for v, col in pants_cols.items():
        grow = 0.012 if v == 'pants-waders' else 0.0
        pelp = [(0.07 + grow, 0.07 + grow, 0.08 + grow, 0.9), (0.135 + grow, 0.095 + grow, 0.11 + grow, 0.9), (0.16 + grow, 0.108 + grow, 0.122 + grow, 0.9), (0.163 + grow, 0.112 + grow, 0.12 + grow, 0.9), (0.16 + grow * 0.4, 0.11 + grow * 0.4, 0.117 + grow * 0.4, 0.9)]
        garment('hips', 'pants', v, piece_from_bm(subsurf(sweep(pel, pelp, 32, cap0=True, cap1=False), 1), col))
    garment('hips', 'pants', 'pants-waders', piece_from_bm(subsurf(sweep([(0, 0.0, 0.94), (0, 0.004, 1.05), (0, 0.008, 1.16)], [(0.172, 0.124, 0.128, 0.9), (0.17, 0.12, 0.13, 0.9), (0.17, 0.13, 0.13, 0.9)], 32, cap0=False, cap1=False), 1), rubber))

    glove = lambda co, n: mix((0.3, 0.2, 0.12), (0.2, 0.13, 0.08), n3(Vector((co[0] * 90, co[1] * 90, co[2] * 90)), 1) * 0.5 + 0.5)
    boot_leather = lambda co, n: mix((0.36, 0.24, 0.13), (0.24, 0.15, 0.08), n3(Vector((co[0] * 70, co[1] * 70, co[2] * 70)), 1) * 0.5 + 0.5 + smooth01(0.1, 0.05, co[2]) * 0.3)
    for side, s in (('L', 1), ('R', -1)):
        SH = (s * 0.192, -0.004, 1.44)
        EL = (s * 0.235, -0.012, 1.155)
        WR = (s * 0.255, 0.012, 0.9)
        HJ = (s * 0.092, 0.0, 0.93)
        KN = (s * 0.1, 0.01, 0.51)
        pivots['upperArm' + side] = SH
        pivots['foreArm' + side] = EL
        pivots['thigh' + side] = HJ
        pivots['shin' + side] = KN
        m.add('upperArm' + side, piece_from_bm(sphere(0.05, 12, 8, at=(s * 0.2, -0.004, 1.42)), lambda co, n: (0.16, 0.15, 0.14)), pivot=SH, parent='torso')
        up_knots = [(0.0, s * 0.16, -0.004, 1.47, 0.03, 0.03, 0.03), (0.08, s * 0.175, -0.004, 1.475, 0.06, 0.06, 0.062), (0.2, s * 0.198, -0.004, 1.44, 0.068, 0.066, 0.068), (0.55, s * 0.218, -0.008, 1.3, 0.06, 0.058, 0.058), (0.88, s * 0.233, -0.012, 1.17, 0.054, 0.052, 0.054), (0.96, s * 0.236, -0.012, 1.135, 0.045, 0.045, 0.045), (1.0, s * 0.237, -0.012, 1.115, 0.0, 0.0, 0.0)]
        fo_knots = [(0.0, s * 0.235, -0.01, 1.2, 0.0, 0.0, 0.0), (0.06, s * 0.235, -0.01, 1.185, 0.042, 0.042, 0.042), (0.2, s * 0.237, -0.008, 1.14, 0.052, 0.054, 0.05), (0.5, s * 0.244, 0.0, 1.04, 0.048, 0.05, 0.046), (0.85, s * 0.252, 0.01, 0.935, 0.043, 0.042, 0.04), (1.0, s * 0.255, 0.012, 0.9, 0.042, 0.042, 0.04)]
        up_p, up_pr = knots_path(up_knots, 14)
        fo_p, fo_pr = knots_path(fo_knots, 12)
        for v, col in jackets.items():
            garment('upperArm' + side, 'jacket', v, piece_from_bm(subsurf(sweep(up_p, up_pr, 18), 1), col))
            garment('foreArm' + side, 'jacket', v, piece_from_bm(subsurf(sweep(fo_p, fo_pr, 18), 1), col))
            trim = jacket_trim[v]
            garment('foreArm' + side, 'jacket', v, piece_from_bm(subsurf(sweep([(s * 0.253, 0.01, 0.925), (s * 0.256, 0.013, 0.895)], [(0.046, 0.046, 0.044), (0.044, 0.044, 0.042)], 24, cap0=False, cap1=False), 1), (lambda c: lambda co, n: c)(trim)))
        wr = Vector(WR)
        palm = sweep([wr + Vector((0, 0.002, 0.005)), wr + Vector((0, 0.008, -0.03)), wr + Vector((0, 0.012, -0.075)), wr + Vector((s * -0.004, 0.012, -0.098))], [(0.026, 0.034, 0.034, 0.75), (0.024, 0.044, 0.044, 0.7), (0.022, 0.047, 0.047, 0.7), (0.016, 0.04, 0.04, 0.8)], 16)
        m.add('foreArm' + side, piece_from_bm(subsurf(palm, 1), glove), pivot=EL, parent='upperArm' + side)
        for f in range(4):
            fy = 0.012 + (f - 1.5) * 0.021
            base = wr + Vector((0, fy, -0.1))
            pts = [base, base + Vector((s * -0.012, 0.0, -0.028)), base + Vector((s * -0.032, 0.0, -0.035)), base + Vector((s * -0.045, 0.0, -0.022))]
            fl = 1.0 - abs(f - 1.3) * 0.08
            m.add('foreArm' + side, piece_from_bm(tube([tuple(q) for q in pts], [0.0105 * fl, 0.0098 * fl, 0.009 * fl, 0.0085 * fl], 8), glove), pivot=EL)
        th = [wr + Vector((s * -0.012, 0.035, -0.04)), wr + Vector((s * -0.03, 0.045, -0.065)), wr + Vector((s * -0.045, 0.04, -0.085))]
        m.add('foreArm' + side, piece_from_bm(tube([tuple(q) for q in th], [0.012, 0.011, 0.0095], 8), glove), pivot=EL)

        m.add('thigh' + side, piece_from_bm(sphere(0.05, 12, 8, at=(s * 0.095, 0.0, 0.88)), lambda co, n: (0.16, 0.15, 0.14)), pivot=HJ, parent='hips')
        th_knots = [(0.0, s * 0.088, 0.0, 1.0, 0.07, 0.07, 0.07), (0.12, s * 0.09, 0.002, 0.95, 0.088, 0.094, 0.098), (0.4, s * 0.095, 0.008, 0.8, 0.084, 0.09, 0.088), (0.75, s * 0.1, 0.012, 0.6, 0.068, 0.07, 0.066), (0.92, s * 0.1, 0.012, 0.52, 0.06, 0.064, 0.06), (1.0, s * 0.1, 0.01, 0.48, 0.0, 0.0, 0.0)]
        sh_knots = [(0.0, s * 0.1, 0.012, 0.56, 0.0, 0.0, 0.0), (0.06, s * 0.1, 0.012, 0.545, 0.058, 0.064, 0.058), (0.25, s * 0.1, 0.01, 0.48, 0.06, 0.064, 0.064), (0.6, s * 0.1, 0.0, 0.36, 0.054, 0.056, 0.058), (1.0, s * 0.1, -0.004, 0.26, 0.052, 0.054, 0.054)]
        for v, col in pants_cols.items():
            grow = 0.01 if v == 'pants-waders' else (-0.006 if v == 'pants-jeans' else 0.0)
            tk = [k[:4] + tuple(r + grow if r > 0 else r for r in k[4:]) for k in th_knots]
            p, pr = knots_path(tk, 14)
            garment('thigh' + side, 'pants', v, piece_from_bm(subsurf(sweep(p, pr, 20), 1), col))
            if v == 'pants-camo':
                garment('thigh' + side, 'pants', v, piece_from_bm(subsurf(rounded_box((0.025, 0.11, 0.13), at=(s * 0.18, 0.012, 0.73), bevel=0.01), 1), col))
                garment('thigh' + side, 'pants', v, piece_from_bm(rounded_box((0.03, 0.115, 0.04), at=(s * 0.183, 0.012, 0.795), bevel=0.008), lambda co, n: mix(camo_p(co, n), (0.1, 0.09, 0.07), 0.25)))
            sk = list(sh_knots)
            if v == 'pants-waders':
                sk = [(0.0, s * 0.1, 0.012, 0.56, 0.0, 0.0, 0.0), (0.06, s * 0.1, 0.012, 0.545, 0.07, 0.076, 0.07), (0.3, s * 0.1, 0.008, 0.45, 0.07, 0.074, 0.074), (0.65, s * 0.1, 0.0, 0.3, 0.066, 0.068, 0.07), (0.9, s * 0.1, 0.004, 0.16, 0.064, 0.08, 0.07), (1.0, s * 0.1, 0.012, 0.1, 0.064, 0.09, 0.07)]
            elif v == 'pants-jeans':
                sk = [k[:4] + tuple(r + 0.004 if r > 0 else r for r in k[4:]) for k in sh_knots[:-1]] + [(1.0, s * 0.1, -0.004, 0.2, 0.06, 0.064, 0.064)]
            p, pr = knots_path(sk, 11)
            garment('shin' + side, 'pants', v, piece_from_bm(subsurf(sweep(p, pr, 18), 1), col))
        shaft = sweep([(s * 0.1, -0.006, 0.3), (s * 0.1, -0.006, 0.2), (s * 0.1, 0.0, 0.11), (s * 0.1, 0.01, 0.06)], [(0.058, 0.058, 0.06), (0.054, 0.056, 0.058), (0.05, 0.06, 0.056), (0.052, 0.07, 0.062)], 24, cap0=False, cap1=False)
        m.add('shin' + side, piece_from_bm(subsurf(shaft, 1), boot_leather), pivot=KN, parent='thigh' + side)
        m.add('shin' + side, piece_from_bm(torus(0.058, 0.009, at=(s * 0.1, -0.006, 0.3), seg=24, rseg=8), lambda co, n: (0.16, 0.1, 0.06)), pivot=KN)
        foot = sweep([(s * 0.1, -0.075, 0.07), (s * 0.1, -0.05, 0.075), (s * 0.1, 0.03, 0.07), (s * 0.1, 0.12, 0.055), (s * 0.1, 0.175, 0.045), (s * 0.1, 0.2, 0.035)], [(0.044, 0.04, 0.04, 0.8), (0.048, 0.05, 0.045, 0.8), (0.05, 0.05, 0.038, 0.8), (0.052, 0.038, 0.032, 0.8), (0.046, 0.03, 0.028, 0.8), (0.026, 0.02, 0.02, 0.8)], 24, front=(0, 0, 1))
        m.add('shin' + side, piece_from_bm(subsurf(foot, 1), lambda co, n: mix(boot_leather(co, n), (0.13, 0.08, 0.04), 0.5 if co[1] > 0.13 else 0.0)), pivot=KN)
        sole = sweep([(s * 0.1, -0.085, 0.017), (s * 0.1, -0.07, 0.017), (s * 0.1, 0.04, 0.017), (s * 0.1, 0.15, 0.019), (s * 0.1, 0.205, 0.024), (s * 0.1, 0.218, 0.026)], [(0.04, 0.017, 0.017, 0.5), (0.05, 0.017, 0.017, 0.5), (0.054, 0.017, 0.017, 0.5), (0.057, 0.017, 0.017, 0.5), (0.04, 0.015, 0.015, 0.5), (0.02, 0.012, 0.012, 0.5)], 20, front=(0, 0, 1))
        m.add('shin' + side, piece_from_bm(sole, lambda co, n: (0.07, 0.06, 0.05)), pivot=KN)
        for k in range(7):
            for lx in (-0.03, 0.03):
                m.add('shin' + side, piece_from_bm(box((0.022, 0.018, 0.008), at=(s * 0.1 + lx * 0.95, -0.07 + k * 0.042, 0.0)), lambda co, n: (0.05, 0.045, 0.04), smooth=False), pivot=KN)
        for k in range(6):
            z = 0.09 + k * 0.035
            yb = 0.058 + (0.012 if z < 0.13 else 0.0)
            for a, b in (((s * 0.1 - 0.025, yb, z), (s * 0.1 + 0.025, yb + 0.002, z + 0.018)), ((s * 0.1 + 0.025, yb, z), (s * 0.1 - 0.025, yb + 0.002, z + 0.018))):
                m.add('shin' + side, piece_from_bm(tube([a, b], [0.0028, 0.0028], 5, cap=False), lambda co, n: (0.55, 0.42, 0.25)), pivot=KN)
    write_model(m)
