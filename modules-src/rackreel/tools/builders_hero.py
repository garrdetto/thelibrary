def subsurf(bm, levels=1):
    me = bpy.data.meshes.new('ss')
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new('ss', me)
    bpy.context.scene.collection.objects.link(ob)
    mod = ob.modifiers.new('ss', 'SUBSURF')
    mod.levels = levels
    mod.render_levels = levels
    dg = bpy.context.evaluated_depsgraph_get()
    dg.update()
    me2 = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob)
    out = new_bm()
    out.from_mesh(me2)
    out.normal_update()
    return out


def sweep(path, prof, ring=24, cap0=True, cap1=True, front=(0, 1, 0)):
    bm = new_bm()
    P = [Vector(p) for p in path]
    F = Vector(front)
    n = len(P)
    rows = []
    for i, c in enumerate(P):
        t = P[min(i + 1, n - 1)] - P[max(i - 1, 0)]
        t = t.normalized() if t.length > 1e-9 else Vector((0, 0, 1))
        ex = F.cross(t)
        if ex.length < 1e-6:
            ex = Vector((1, 0, 0))
        ex.normalize()
        ey = t.cross(ex).normalized()
        pr = prof[i]
        rx, ryf, ryb = pr[0], pr[1], pr[2]
        pw = pr[3] if len(pr) > 3 else 1.0
        row = []
        for k in range(ring):
            a = k / ring * math.tau
            ca, sa = math.cos(a), math.sin(a)
            u = math.copysign(abs(ca) ** pw, ca)
            v = math.copysign(abs(sa) ** pw, sa)
            ry = ryf if v > 0 else ryb
            row.append(bm.verts.new(c + ex * (u * rx) + ey * (v * ry)))
        rows.append(row)
    for i in range(n - 1):
        for k in range(ring):
            k2 = (k + 1) % ring
            bm.faces.new((rows[i][k], rows[i][k2], rows[i + 1][k2], rows[i + 1][k]))
    if cap0:
        cv = bm.verts.new(P[0])
        for k in range(ring):
            bm.faces.new((rows[0][(k + 1) % ring], rows[0][k], cv))
    if cap1:
        cv = bm.verts.new(P[-1])
        for k in range(ring):
            bm.faces.new((rows[-1][k], rows[-1][(k + 1) % ring], cv))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return bm


def knots_path(knots, n):
    knots = [k[:4] + tuple(max(0.012, r) for r in k[4:]) for k in knots]
    pts = resample(knots, n)
    return [p[1:4] for p in pts], [p[4:] for p in pts]


def merge_bm(*bms):
    out = new_bm()
    for b in bms:
        me = bpy.data.meshes.new('mg')
        b.to_mesh(me)
        out.from_mesh(me)
        b.free()
    return out


def xform(bm, mat):
    bmesh.ops.transform(bm, matrix=mat, verts=bm.verts[:])
    return bm


def rounded_box(size, at=(0, 0, 0), bevel=0.02, segs=3, rot=None):
    b = box(size, at, rot)
    bmesh.ops.bevel(b, geom=b.edges[:], offset=min(bevel, min(size) * 0.49), segments=segs, affect='EDGES', profile=0.5)
    return b


def torus(R, r, at=(0, 0, 0), seg=32, rseg=10, rot=None):
    bm = new_bm()
    rows = []
    for i in range(seg):
        a = i / seg * math.tau
        row = []
        for j in range(rseg):
            b = j / rseg * math.tau
            row.append(bm.verts.new(((R + r * math.cos(b)) * math.cos(a), (R + r * math.cos(b)) * math.sin(a), r * math.sin(b))))
        rows.append(row)
    for i in range(seg):
        for j in range(rseg):
            bm.faces.new((rows[i][j], rows[(i + 1) % seg][j], rows[(i + 1) % seg][(j + 1) % rseg], rows[i][(j + 1) % rseg]))
    m = Matrix.Translation(Vector(at))
    if rot is not None:
        m = m @ rot
    xform(bm, m)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return bm


def bent_tube(corners, radius, bend=0.08, seg=10, steps=5):
    pts = [Vector(corners[0])]
    for i in range(1, len(corners) - 1):
        a, b, c = Vector(corners[i - 1]), Vector(corners[i]), Vector(corners[i + 1])
        d1 = (b - a)
        d2 = (c - b)
        r1 = min(bend, d1.length * 0.45)
        r2 = min(bend, d2.length * 0.45)
        p0 = b - d1.normalized() * r1
        p2 = b + d2.normalized() * r2
        for s in range(steps + 1):
            t = s / steps
            pts.append(p0 * (1 - t) ** 2 + b * 2 * (1 - t) * t + p2 * t * t)
    pts.append(Vector(corners[-1]))
    clean = [pts[0]]
    for p in pts[1:]:
        if (p - clean[-1]).length > 1e-4:
            clean.append(p)
    return tube([tuple(p) for p in clean], [radius] * len(clean), seg, cap=True)


def helix(center, radius, wire, z0, z1, turns, seg=6, axis_rot=None):
    pts = []
    count = int(turns * 14)
    for k in range(count + 1):
        a = k / 14 * math.tau
        pts.append((center[0] + math.cos(a) * radius, center[1] + math.sin(a) * radius, z0 + (z1 - z0) * k / count))
    return tube(pts, [wire] * len(pts), seg, cap=False)


def g2(x, y, sx, sy):
    return math.exp(-(x * x) / (sx * sx) - (y * y) / (sy * sy))


def camo(co, base=((0.42, 0.38, 0.28), (0.3, 0.27, 0.19), (0.2, 0.19, 0.13), (0.11, 0.1, 0.08)), scale=1.0, seed=0.0):
    p = Vector((co[0] * scale + seed, co[1] * scale - seed * 0.6, co[2] * scale * 0.8))
    v = noise.noise(p * 6.0) + 0.5 * noise.noise(p * 13.0 + Vector((3.1, 0.4, 7.7))) + 0.25 * noise.noise(p * 29.0)
    if v > 0.42:
        c = base[3]
    elif v > 0.12:
        c = base[2]
    elif v > -0.3:
        c = base[1]
    else:
        c = base[0]
    twig = abs(noise.noise(p * 9.0 + Vector((11.0, 5.0, 2.0))))
    if twig < 0.035:
        c = mix(c, base[3], 0.75)
    leaf = noise.noise(p * 21.0 + Vector((-4.0, 9.0, 1.0)))
    if leaf > 0.48:
        c = mix(c, (0.36, 0.33, 0.22), 0.6)
    return c


def fabric(c, co, k=1.0):
    w = n3(Vector((co[0] * 160, co[1] * 160, co[2] * 160)), 1.0) * 0.035 * k
    return (c[0] * (1 + w), c[1] * (1 + w), c[2] * (1 + w))


SKIN = (0.8, 0.6, 0.47)
SKIN_SHADE = (0.66, 0.46, 0.36)
BEARD = (0.25, 0.17, 0.11)
HAIR = (0.2, 0.14, 0.09)
ORANGE = (1.0, 0.4, 0.04)
ORANGE_DK = (0.78, 0.26, 0.03)


def build_hunter():
    m = Model('hunter', ao_dist=0.22, ao_strength=0.45)
    HIP = (0, 0, 0.98)
    WAIST = (0, 0, 1.04)
    NECK = (0, -0.005, 1.535)
    jacket = lambda co, n: fabric(camo(co, ((0.5, 0.46, 0.34), (0.38, 0.35, 0.25), (0.27, 0.26, 0.18), (0.19, 0.17, 0.12)), seed=1.7), co)
    pants = lambda co, n: fabric(camo(co, ((0.44, 0.39, 0.29), (0.33, 0.29, 0.21), (0.24, 0.21, 0.15), (0.14, 0.12, 0.09)), 0.9, 5.3), co)

    def vest_col(co, n):
        mesh = (n3(Vector((co[0] * 260, co[1] * 260, co[2] * 260)), 1.0) > 0.25)
        c = ORANGE if not mesh else mix(ORANGE, ORANGE_DK, 0.18)
        if abs(co[0]) < 0.008 and n[1] > 0.4:
            return (0.12, 0.11, 0.1)
        if abs(abs(co[0]) - 0.012) < 0.004 and n[1] > 0.4:
            return mix(c, (0.5, 0.2, 0.03), 0.6)
        if co[2] < 1.0:
            return mix(c, ORANGE_DK, 0.5)
        return c

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
    torso = subsurf(sweep(path, prof, 28, cap0=True, cap1=True), 1)
    m.add('torso', piece_from_bm(torso, jacket), pivot=WAIST, parent='hips')
    zs = [q[2] for q in path]

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

    vest = new_bm()
    NA, NF = 96, 16
    grid = []
    for i in range(NA):
        a = (i + 0.5) / NA * math.tau
        if abs(math.cos(a)) < 0.03 and math.sin(a) > 0:
            a += 0.0
        col = []
        top = vest_top(a)
        for j in range(NF + 1):
            f = j / NF
            z = 0.965 + (top - 0.965) * f
            col.append(vest.verts.new(torso_at(a, z, 0.013 + 0.004 * smooth01(1.2, 1.4, z))))
        grid.append(col)
    for i in range(NA):
        i2 = (i + 1) % NA
        a_mid = (i + 1) / NA * math.tau
        if abs(a_mid - math.pi / 2) < 1e-6:
            continue
        for j in range(NF):
            vest.faces.new((grid[i][j], grid[i2][j], grid[i2][j + 1], grid[i][j + 1]))
    bmesh.ops.recalc_face_normals(vest, faces=vest.faces[:])
    for f in vest.faces:
        c = f.calc_center_median()
        if Vector((c.x, c.y, 0)).dot(f.normal) < 0:
            f.normal_flip()
    bmesh.ops.solidify(vest, geom=vest.faces[:], thickness=0.005)
    bmesh.ops.recalc_face_normals(vest, faces=vest.faces[:])
    edge_z = {}

    def vest_col2(co, n):
        a = math.atan2(co[1], co[0])
        top = vest_top(a)
        c = vest_col(co, n)
        if co[2] > top - 0.012 or co[2] < 0.977 or (abs(co[0]) < 0.012 and co[1] > 0):
            return (0.1, 0.09, 0.08)
        return c
    m.add('torso', piece_from_bm(vest, vest_col2), pivot=WAIST)
    for side in (-1, 1):
        flap = rounded_box((0.075, 0.03, 0.06), at=(side * 0.085, 0.142, 1.16), bevel=0.01)
        m.add('torso', piece_from_bm(flap, lambda co, n: mix(ORANGE, ORANGE_DK, 0.25) if co[2] < 1.17 else ORANGE_DK), pivot=WAIST)
        chest = rounded_box((0.06, 0.02, 0.07), at=(side * 0.075, 0.15, 1.32), bevel=0.008)
        m.add('torso', piece_from_bm(chest, lambda co, n: mix(ORANGE, ORANGE_DK, 0.2)), pivot=WAIST)
    collar = sweep([(0, -0.004, 1.48), (0, -0.006, 1.55)], [(0.088, 0.085, 0.09), (0.078, 0.072, 0.08)], 28, cap0=False, cap1=False)
    m.add('torso', piece_from_bm(subsurf(collar, 1), jacket), pivot=WAIST)
    zip_ = tube([(0, 0.128, 0.92), (0, 0.142, 1.1), (0, 0.15, 1.3), (0, 0.13, 1.42), (0, 0.085, 1.52)], [0.0045] * 5, 6, cap=False)
    m.add('torso', piece_from_bm(zip_, lambda co, n: (0.09, 0.09, 0.08)), pivot=WAIST)

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
        top = smooth01(0.05, 0.118, Z)
        X *= 1 - 0.1 * top
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
        stache = g2(X, Z + 0.047, 0.03, 0.006) * smooth01(0.05, 0.07, Y)
        w = max(w, stache)
        w *= 1 - g2(X, Z + 0.062, 0.02, 0.0035)
        if w > 0.01:
            b = mix(BEARD, (0.36, 0.25, 0.16), n3(Vector((X * 300, Y * 300, Z * 300)), 1) * 0.5 + 0.5)
            c = mix(c, b, 0.9 * w)
        if Z > 0.03 and (Y < 0.02 or abs(X) > 0.06):
            c = mix(c, HAIR, 0.9)
        if Y > 0:
            bw = g2(abs(X) - 0.033, Z - 0.026 + 0.004 * (abs(X) - 0.033) / 0.02, 0.019, 0.0045)
            c = mix(c, HAIR, min(1.0, bw * 1.3))
        return c
    hb = subsurf(head, 1)
    m.add('head', piece_from_bm(hb, face_col), pivot=NECK)
    for s in (-1, 1):
        eye = sphere(0.0115, 16, 12, at=(s * 0.032, 0.0705 + HC.y, HC.z + 0.008))
        def eye_col(co, n, s=s):
            if n[1] > 0.993:
                return (0.03, 0.03, 0.03)
            if n[1] > 0.972:
                return (0.28, 0.22, 0.12)
            return (0.9, 0.88, 0.84)
        m.add('head', piece_from_bm(eye, eye_col), pivot=NECK)
        lid = sweep([(s * 0.032, 0.0715 + HC.y, HC.z + 0.0178), (s * 0.032, 0.073 + HC.y, HC.z + 0.0188)], [(0.0135, 0.007, 0.002), (0.0115, 0.006, 0.002)], 12)
        ear = sweep([(s * 0.077, HC.y - 0.006, HC.z - 0.02), (s * 0.08, HC.y - 0.01, HC.z + 0.004), (s * 0.079, HC.y - 0.012, HC.z + 0.026)], [(0.008, 0.016, 0.014), (0.011, 0.019, 0.017), (0.007, 0.012, 0.012)], 16)
        m.add('head', piece_from_bm(ear, lambda co, n: mix(SKIN, (0.72, 0.45, 0.38), 0.4)), pivot=NECK)
        m.add('head', piece_from_bm(lid, lambda co, n: SKIN_SHADE), pivot=NECK)
    cap = sphere(1.0, 32, 20)
    bmesh.ops.delete(cap, geom=[v for v in cap.verts if v.co.z < -0.05], context='VERTS')
    for v in cap.verts:
        x, y, z = v.co
        v.co = HC + Vector((x * 0.0835, y * 0.106 - 0.003, max(z, 0.0) * 0.1 + 0.03 + min(z, 0) * 0.1))
    capb = new_bm()
    me = bpy.data.meshes.new('cap')
    cap.to_mesh(me)
    capb.from_mesh(me)
    bmesh.ops.solidify(capb, geom=capb.faces[:], thickness=-0.004)
    bmesh.ops.recalc_face_normals(capb, faces=capb.faces[:])
    cap.free()

    def cap_col(co, n):
        L = Vector(co) - HC
        a = math.atan2(L.x, L.y)
        seam = min(abs(((a / (math.tau / 6)) % 1) - 0.5) for _ in (0,)) > 0.47
        c = fabric(ORANGE, co, 1.5)
        if seam and L.z > 0.05:
            c = mix(c, ORANGE_DK, 0.7)
        if L.z < 0.036:
            c = mix(c, ORANGE_DK, 0.35)
        return c
    m.add('head', piece_from_bm(subsurf(capb, 1), cap_col), pivot=NECK)
    m.add('head', piece_from_bm(sphere(0.008, 10, 6, at=(HC.x, HC.y - 0.003, HC.z + 0.13), scale=(1, 1, 0.5)), lambda co, n: ORANGE_DK), pivot=NECK)
    brim = new_bm()
    rows = []
    for i in range(17):
        u = i / 16 * 2 - 1
        row = []
        for j in range(7):
            t = j / 6
            ang = u * 1.15
            rr = 0.084 + t * 0.075 * (1 - 0.55 * u * u)
            x = math.sin(ang) * rr * 0.98
            y = math.cos(ang) * rr * 1.1 + HC.y
            z = HC.z + 0.032 - t * 0.012 - abs(u) ** 2 * 0.014 * t
            row.append(brim.verts.new((x, y, z)))
        rows.append(row)
    for i in range(16):
        for j in range(6):
            brim.faces.new((rows[i][j], rows[i + 1][j], rows[i + 1][j + 1], rows[i][j + 1]))
    bmesh.ops.solidify(brim, geom=brim.faces[:], thickness=0.006)
    bmesh.ops.recalc_face_normals(brim, faces=brim.faces[:])
    m.add('head', piece_from_bm(subsurf(brim, 1), lambda co, n: fabric(mix(ORANGE, ORANGE_DK, 0.15), co)), pivot=NECK)

    belt = sweep([(0, 0.0, 0.955), (0, 0.0, 0.995)], [(0.168, 0.118, 0.122, 0.9), (0.168, 0.118, 0.122, 0.9)], 32, cap0=False, cap1=False)
    m.add('hips', piece_from_bm(belt, lambda co, n: (0.2, 0.13, 0.08)), pivot=HIP)
    m.add('hips', piece_from_bm(rounded_box((0.05, 0.012, 0.042), at=(0, 0.122, 0.975), bevel=0.004), lambda co, n: (0.55, 0.52, 0.45) if n[1] > 0.5 else (0.3, 0.29, 0.26)), pivot=HIP)
    pel = [(0, 0, 0.78), (0, 0, 0.82), (0, 0, 0.88), (0, 0, 0.95), (0, 0, 1.0)]
    pelp = [(0.07, 0.07, 0.08, 0.9), (0.135, 0.095, 0.11, 0.9), (0.16, 0.108, 0.122, 0.9), (0.163, 0.112, 0.12, 0.9), (0.16, 0.11, 0.117, 0.9)]
    m.add('hips', piece_from_bm(subsurf(sweep(pel, pelp, 32, cap0=True, cap1=False), 1), pants), pivot=HIP)

    for side, s in (('L', 1), ('R', -1)):
        SH = (s * 0.192, -0.004, 1.44)
        EL = (s * 0.235, -0.012, 1.155)
        WR = (s * 0.255, 0.012, 0.9)
        up_knots = [(0.0, s * 0.16, -0.004, 1.47, 0.03, 0.03, 0.03), (0.08, s * 0.175, -0.004, 1.475, 0.06, 0.06, 0.062), (0.2, s * 0.198, -0.004, 1.44, 0.068, 0.066, 0.068), (0.55, s * 0.218, -0.008, 1.3, 0.06, 0.058, 0.058), (0.88, s * 0.233, -0.012, 1.17, 0.054, 0.052, 0.054), (0.96, s * 0.236, -0.012, 1.135, 0.045, 0.045, 0.045), (1.0, s * 0.237, -0.012, 1.115, 0.0, 0.0, 0.0)]
        p, pr = knots_path(up_knots, 14)
        m.add('upperArm' + side, piece_from_bm(subsurf(sweep(p, pr, 18), 1), jacket), pivot=SH, parent='torso')
        fo_knots = [(0.0, s * 0.235, -0.01, 1.2, 0.0, 0.0, 0.0), (0.06, s * 0.235, -0.01, 1.185, 0.042, 0.042, 0.042), (0.2, s * 0.237, -0.008, 1.14, 0.052, 0.054, 0.05), (0.5, s * 0.244, 0.0, 1.04, 0.048, 0.05, 0.046), (0.85, s * 0.252, 0.01, 0.935, 0.043, 0.042, 0.04), (1.0, s * 0.255, 0.012, 0.9, 0.042, 0.042, 0.04)]
        p, pr = knots_path(fo_knots, 12)
        m.add('foreArm' + side, piece_from_bm(subsurf(sweep(p, pr, 18), 1), jacket), pivot=EL, parent='upperArm' + side)
        cuff = sweep([(s * 0.253, 0.01, 0.925), (s * 0.256, 0.013, 0.895)], [(0.046, 0.046, 0.044), (0.044, 0.044, 0.042)], 24, cap0=False, cap1=False)
        m.add('foreArm' + side, piece_from_bm(subsurf(cuff, 1), lambda co, n: (0.13, 0.12, 0.1)), pivot=EL)
        glove = lambda co, n: mix((0.3, 0.2, 0.12), (0.2, 0.13, 0.08), n3(Vector((co[0] * 90, co[1] * 90, co[2] * 90)), 1) * 0.5 + 0.5)
        wr = Vector(WR)
        palm = sweep([wr + Vector((0, 0.002, 0.005)), wr + Vector((0, 0.008, -0.03)), wr + Vector((0, 0.012, -0.075)), wr + Vector((s * -0.004, 0.012, -0.098))], [(0.026, 0.034, 0.034, 0.75), (0.024, 0.044, 0.044, 0.7), (0.022, 0.047, 0.047, 0.7), (0.016, 0.04, 0.04, 0.8)], 16)
        m.add('foreArm' + side, piece_from_bm(subsurf(palm, 1), glove), pivot=EL)
        for f in range(4):
            fy = 0.012 + (f - 1.5) * 0.021
            base = wr + Vector((0, fy, -0.1))
            pts = [base, base + Vector((s * -0.012, 0.0, -0.028)), base + Vector((s * -0.032, 0.0, -0.035)), base + Vector((s * -0.045, 0.0, -0.022))]
            fl = 1.0 - abs(f - 1.3) * 0.08
            m.add('foreArm' + side, piece_from_bm(tube([tuple(q) for q in pts], [0.0105 * fl, 0.0098 * fl, 0.009 * fl, 0.0085 * fl], 8), glove), pivot=EL)
        th = [wr + Vector((s * -0.012, 0.035, -0.04)), wr + Vector((s * -0.03, 0.045, -0.065)), wr + Vector((s * -0.045, 0.04, -0.085))]
        m.add('foreArm' + side, piece_from_bm(tube([tuple(q) for q in th], [0.012, 0.011, 0.0095], 8), glove), pivot=EL)

        HJ = (s * 0.092, 0.0, 0.93)
        KN = (s * 0.1, 0.01, 0.51)
        th_knots = [(0.0, s * 0.088, 0.0, 1.0, 0.07, 0.07, 0.07), (0.12, s * 0.09, 0.002, 0.95, 0.088, 0.094, 0.098), (0.4, s * 0.095, 0.008, 0.8, 0.084, 0.09, 0.088), (0.75, s * 0.1, 0.012, 0.6, 0.068, 0.07, 0.066), (0.92, s * 0.1, 0.012, 0.52, 0.06, 0.064, 0.06), (1.0, s * 0.1, 0.01, 0.48, 0.0, 0.0, 0.0)]
        p, pr = knots_path(th_knots, 14)
        m.add('thigh' + side, piece_from_bm(subsurf(sweep(p, pr, 20), 1), pants), pivot=HJ, parent='hips')
        pocket = rounded_box((0.025, 0.11, 0.13), at=(s * 0.18, 0.012, 0.73), bevel=0.01)
        m.add('thigh' + side, piece_from_bm(subsurf(pocket, 1), pants), pivot=HJ)
        pflap = rounded_box((0.03, 0.115, 0.04), at=(s * 0.183, 0.012, 0.795), bevel=0.008)
        m.add('thigh' + side, piece_from_bm(pflap, lambda co, n: mix(pants(co, n), (0.1, 0.09, 0.07), 0.25)), pivot=HJ)
        sh_knots = [(0.0, s * 0.1, 0.012, 0.56, 0.0, 0.0, 0.0), (0.06, s * 0.1, 0.012, 0.545, 0.058, 0.064, 0.058), (0.25, s * 0.1, 0.01, 0.48, 0.06, 0.064, 0.064), (0.6, s * 0.1, 0.0, 0.36, 0.054, 0.056, 0.058), (1.0, s * 0.1, -0.004, 0.26, 0.052, 0.054, 0.054)]
        p, pr = knots_path(sh_knots, 11)
        m.add('shin' + side, piece_from_bm(subsurf(sweep(p, pr, 18), 1), pants), pivot=KN, parent='thigh' + side)
        boot_leather = lambda co, n: mix((0.36, 0.24, 0.13), (0.24, 0.15, 0.08), n3(Vector((co[0] * 70, co[1] * 70, co[2] * 70)), 1) * 0.5 + 0.5 + smooth01(0.1, 0.05, co[2]) * 0.3)
        shaft = sweep([(s * 0.1, -0.006, 0.3), (s * 0.1, -0.006, 0.2), (s * 0.1, 0.0, 0.11), (s * 0.1, 0.01, 0.06)], [(0.058, 0.058, 0.06), (0.054, 0.056, 0.058), (0.05, 0.06, 0.056), (0.052, 0.07, 0.062)], 24, cap0=False, cap1=False)
        m.add('shin' + side, piece_from_bm(subsurf(shaft, 1), boot_leather), pivot=KN)
        collar_b = torus(0.058, 0.009, at=(s * 0.1, -0.006, 0.3), seg=24, rseg=8)
        m.add('shin' + side, piece_from_bm(collar_b, lambda co, n: (0.16, 0.1, 0.06)), pivot=KN)
        foot = sweep([(s * 0.1, -0.075, 0.07), (s * 0.1, -0.05, 0.075), (s * 0.1, 0.03, 0.07), (s * 0.1, 0.12, 0.055), (s * 0.1, 0.175, 0.045), (s * 0.1, 0.2, 0.035)], [(0.044, 0.04, 0.04, 0.8), (0.048, 0.05, 0.045, 0.8), (0.05, 0.05, 0.038, 0.8), (0.052, 0.038, 0.032, 0.8), (0.046, 0.03, 0.028, 0.8), (0.026, 0.02, 0.02, 0.8)], 24, front=(0, 0, 1))
        m.add('shin' + side, piece_from_bm(subsurf(foot, 1), lambda co, n: mix(boot_leather(co, n), (0.13, 0.08, 0.04), 0.5 if co[1] > 0.13 else 0.0)), pivot=KN)
        sole = sweep([(s * 0.1, -0.085, 0.017), (s * 0.1, -0.07, 0.017), (s * 0.1, 0.04, 0.017), (s * 0.1, 0.15, 0.019), (s * 0.1, 0.205, 0.024), (s * 0.1, 0.218, 0.026)], [(0.04, 0.017, 0.017, 0.5), (0.05, 0.017, 0.017, 0.5), (0.054, 0.017, 0.017, 0.5), (0.057, 0.017, 0.017, 0.5), (0.04, 0.015, 0.015, 0.5), (0.02, 0.012, 0.012, 0.5)], 20, front=(0, 0, 1))
        m.add('shin' + side, piece_from_bm(sole, lambda co, n: (0.07, 0.06, 0.05)), pivot=KN)
        for k in range(7):
            ly = -0.07 + k * 0.042
            for lx in (-0.03, 0.03):
                lug = box((0.022, 0.018, 0.008), at=(s * 0.1 + lx * 0.95, ly, 0.0))
                m.add('shin' + side, piece_from_bm(lug, lambda co, n: (0.05, 0.045, 0.04), smooth=False), pivot=KN)
        for k in range(6):
            z = 0.09 + k * 0.035
            yb = 0.058 + (0.012 if z < 0.13 else 0.0)
            lace = tube([(s * 0.1 - 0.025, yb, z), (s * 0.1 + 0.025, yb + 0.002, z + 0.018)], [0.0028, 0.0028], 5, cap=False)
            m.add('shin' + side, piece_from_bm(lace, lambda co, n: (0.55, 0.42, 0.25)), pivot=KN)
            lace2 = tube([(s * 0.1 + 0.025, yb, z), (s * 0.1 - 0.025, yb + 0.002, z + 0.018)], [0.0028, 0.0028], 5, cap=False)
            m.add('shin' + side, piece_from_bm(lace2, lambda co, n: (0.55, 0.42, 0.25)), pivot=KN)
    m.pivots['hips'] = HIP
    write_model(m)
