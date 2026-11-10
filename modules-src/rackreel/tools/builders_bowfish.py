BOWBOAT_LENGTH = 5.6
BOWBOAT_DRAFT = 0.18
BOWBOAT_TRIS = 70000
BOWBOAT_TUB = {'y': 0.62, 'x': 0.0, 'radius': 0.42, 'height': 0.5}
BOWBOAT_SEAT = {'x': -0.36, 'y': -0.92, 'w': 0.5, 'd': 0.42, 'h': 0.56}
BOWBOAT_GENERATOR = {'x': 0.44, 'y': -1.42, 'w': 0.5, 'd': 0.36, 'h': 0.4}
BOWBOAT_LIGHT_AIM = math.radians(35)
BOWBOAT_STRETCH = 2.0
# The hull is also stretched up by this much about the waterline, so more of it stands out of the water.
BOWBOAT_RISE = 1.2
# A sidewall coaming on top of the gunwale, all the way round: standing on the front deck it comes up to just below the knee.
BOWBOAT_RAIL = 0.4
BOWBOAT_RAIL_THICK = 0.05
BOWBOAT_INFO = {}
WILDMAN_TEXTURE = 2048
WILDMAN_HIP = 0.98
BOW_NOCK = (0.0, -0.17, 0.03)
BOW_CAM = (0.0, -0.085, 0.36)
FISH['carp'] = {'len_depth': 0.14, 'width': 0.55, 'shape': 'perch', 'gill': 0.72, 'jaw': 0.05, 'dorsal': (0.2, 0.6), 'anal': (0.14, 0.24), 'spiny': (0.46, 0.68), 'fork': 0.6, 'base': (0.7, 0.52, 0.22), 'back': (0.36, 0.28, 0.13), 'belly': (0.92, 0.86, 0.68), 'pattern': 'mottle', 'fins': (0.66, 0.3, 0.16), 'eye': (0.78, 0.62, 0.3)}


def decimate_bm(bm, target):
    me = bpy.data.meshes.new('decimate')
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new('decimate', me)
    bpy.context.scene.collection.objects.link(ob)
    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    out = bmesh.new()
    if tris > target:
        mod = ob.modifiers.new('decimate', 'DECIMATE')
        mod.ratio = target / tris
        mod.use_collapse_triangulate = True
        dg = bpy.context.evaluated_depsgraph_get()
        ev = ob.evaluated_get(dg)
        tmp = ev.to_mesh()
        out.from_mesh(tmp)
        ev.to_mesh_clear()
    else:
        out.from_mesh(me)
    bpy.data.objects.remove(ob, do_unlink=True)
    bpy.data.meshes.remove(me)
    return out


def split_sharp(bm, degrees=40):
    limit = math.radians(degrees)
    sharp = [e for e in bm.edges if len(e.link_faces) == 2 and e.calc_face_angle(0) > limit]
    bmesh.ops.split_edges(bm, edges=sharp)


def upward_level(bm, select):
    hist = {}
    for f in bm.faces:
        if f.normal.z < 0.9:
            continue
        c = f.calc_center_median()
        if select(c):
            k = round(c.z, 2)
            hist[k] = hist.get(k, 0.0) + f.calc_area()
    return max(hist, key=hist.get) if hist else 0.0


def boat_frame(bm):
    bmesh.ops.rotate(bm, verts=bm.verts[:], cent=(0, 0, 0), matrix=Matrix.Rotation(-math.pi / 2, 3, 'Z'))
    b = bounds([v.co for v in bm.verts])
    s = BOWBOAT_LENGTH / (b[1][1] - b[1][0])
    bmesh.ops.scale(bm, vec=(s, s, s), verts=bm.verts[:])
    b = bounds([v.co for v in bm.verts])
    bmesh.ops.translate(bm, vec=(-(b[0][0] + b[0][1]) / 2, -(b[1][0] + b[1][1]) / 2, 0), verts=bm.verts[:])
    b = bounds([v.co for v in bm.verts])
    half = (b[0][1] - b[0][0]) / 2
    sides = [v.co for v in bm.verts if abs(v.co.x) > half * 0.7]
    transom = min(c.y for c in sides)
    bottom = min(v.co.z for v in bm.verts if v.co.y > transom)
    bmesh.ops.translate(bm, vec=(0, 0, -BOWBOAT_DRAFT - bottom), verts=bm.verts[:])
    bm.normal_update()
    bow0 = max(v.co.y for v in bm.verts)
    floor0 = upward_level(bm, lambda c: abs(c.x) < 0.6 and transom + 0.4 < c.y < bow0 - 1.5)
    k = BOWBOAT_STRETCH
    console = [v.co.copy() for v in bm.verts if abs(v.co.x) < 0.72 and -0.72 < v.co.y < 0.25 and v.co.z > floor0 + 0.04]
    ccx = sum(c.x for c in console) / max(1, len(console))
    ccy = sum(c.y for c in console) / max(1, len(console))
    for v in bm.verts:
        c = v.co
        motor = (c.y < transom - 0.03 and abs(c.x) < 0.5) or (c.y < transom + 0.42 and abs(c.x) < 0.36 and c.z > floor0 + 0.05)
        if motor:
            c.y += transom * (k - 1)
        elif abs(c.x) < 0.72 and -0.72 < c.y < 0.25 and c.z > floor0 + 0.04:
            c.x += ccx * (k - 1)
            c.y += ccy * (k - 1)
        else:
            c.x *= k
            c.y *= k
    gun0 = max(v.co.z for v in bm.verts if abs(v.co.x) > (b[0][1] - b[0][0]) * 0.42 and v.co.y > transom + 0.3)
    for v in bm.verts:
        c = v.co
        motor = (c.y < transom * k - 0.03 and abs(c.x) < 0.5) or (c.y < transom * k + 0.42 and abs(c.x) < 0.36 and c.z > floor0 + 0.05)
        if motor:
            c.z += gun0 * (BOWBOAT_RISE - 1)
        elif abs(c.x - ccx * k) < 0.75 and -0.75 < c.y - ccy * k < 0.5 and c.z > floor0 + 0.04:
            c.z += floor0 * (BOWBOAT_RISE - 1)
        else:
            c.z *= BOWBOAT_RISE
    bm.normal_update()
    b = bounds([v.co for v in bm.verts])
    half = (b[0][1] - b[0][0]) / 2
    transom *= k
    bow = max(v.co.y for v in bm.verts)
    floor = upward_level(bm, lambda c: abs(c.x) < 1.2 and transom + 0.8 < c.y < bow - 2.8)
    deck = upward_level(bm, lambda c: abs(c.x) < 1.6 and c.y > bow - 1.4)
    gunwale = max(v.co.z for v in bm.verts if abs(v.co.x) > half * 0.85 and transom + 0.6 < v.co.y < bow - 2.8)
    inner = max(abs(v.co.x) for v in bm.verts if v.co.z < floor + 0.02 and v.co.z > floor - 0.02 and transom + 0.8 < v.co.y < bow - 2.8)
    cx, cy = ccx * k, ccy * k
    BOWBOAT_SEAT['x'] = cx + (-0.36 - ccx)
    BOWBOAT_SEAT['y'] = cy + (-0.92 - ccy)
    BOWBOAT_TUB['x'] = 0.0
    BOWBOAT_TUB['y'] = cy + 1.7
    BOWBOAT_GENERATOR['x'] = 0.9
    BOWBOAT_GENERATOR['y'] = transom + 1.3
    return {'half': half, 'transom': transom, 'bow': bow, 'floor': floor, 'deck': deck, 'gunwale': gunwale, 'inner': inner, 'stern': b[1][0], 'console': (cx, cy), 'rail': gunwale + BOWBOAT_RAIL}


def sheer_line(bm, info, step=0.25):
    """The hull's outline at the gunwale, sampled from the transom to the bow: (y, half-width, sheer height) per station."""
    verts = [v.co for v in bm.verts if v.co.z > info['gunwale'] - 0.14 and v.co.y > info['transom'] - 0.05 and not (v.co.y < info['transom'] + 0.45 and abs(v.co.x) < 0.4)]
    out = []
    y = info['transom']
    while y < info['bow'] - 0.08:
        near = [c for c in verts if abs(c.y - y) < 0.22]
        if near:
            w = max(abs(c.x) for c in near)
            z = max(c.z for c in near)
            out.append((y, w, z))
        y += step
    out.append((info['bow'] - 0.04, 0.12, max(c.z for c in verts if c.y > info['bow'] - 0.5)))
    for _ in range(4):
        for i in range(1, len(out) - 1):
            out[i] = (out[i][0], (out[i - 1][1] + out[i][1] * 2 + out[i + 1][1]) / 4, (out[i - 1][2] + out[i][2] * 2 + out[i + 1][2]) / 4)
    return out


def rail_pieces(bm, info):
    """The sidewall coaming: a sheet-aluminum wall `BOWBOAT_RAIL` tall on the gunwale down both sides and round the bow, a lower transom wall either side of the motor, and a round cap rail on top."""
    h = BOWBOAT_RAIL
    t = BOWBOAT_RAIL_THICK
    line = sheer_line(bm, info)
    top = info['rail']
    pieces = []
    wall_col = lambda co, n: aluminum(co, n, 0.96)
    rail_top = []
    for sx in (-1, 1):
        wb = new_bm()
        rings = []
        for y, w, z in line:
            xo = sx * max(0.08, w - 0.01)
            xi = sx * max(0.03, w - 0.01 - t)
            ring = [wb.verts.new((xo, y, z - 0.06)), wb.verts.new((xo, y, top)), wb.verts.new((xi, y, top)), wb.verts.new((xi, y, z - 0.06))]
            rings.append(ring)
        for a, b2 in zip(rings, rings[1:]):
            for i in range(3):
                quad = [a[i], a[i + 1], b2[i + 1], b2[i]]
                wb.faces.new(quad if sx < 0 else quad[::-1])
        pieces.append(piece_from_bm(wb, wall_col, smooth=False))
        pts = [(sx * (w - 0.01 - t / 2), y, top) for y, w, z in line]
        if sx < 0:
            rail_top = pts[::-1]
        else:
            rail_top = rail_top + pts
    cap = tube(rail_top, [0.028] * len(rail_top), 10, cap=True)
    pieces.append(piece_from_bm(cap, lambda co, n: aluminum(co, n, 1.0)))
    y0, w0, z0 = line[0]
    for sx in (-1, 1):
        wb = new_bm()
        x_in, x_out = sx * 0.5, sx * (w0 - 0.01)
        zt = z0 + (top - z0) * 0.6
        for yy in (y0 + t, y0):
            pass
        v = [wb.verts.new((x_in, y0, z0 - 0.04)), wb.verts.new((x_in, y0, zt)), wb.verts.new((x_out, y0, zt)), wb.verts.new((x_out, y0, z0 - 0.04)),
             wb.verts.new((x_in, y0 + t, z0 - 0.04)), wb.verts.new((x_in, y0 + t, zt)), wb.verts.new((x_out, y0 + t, zt)), wb.verts.new((x_out, y0 + t, z0 - 0.04))]
        for quad in ([0, 1, 2, 3], [7, 6, 5, 4], [1, 5, 6, 2], [0, 4, 5, 1], [3, 2, 6, 7]):
            wb.faces.new([v[i] for i in quad])
        pieces.append(piece_from_bm(wb, wall_col, smooth=False))
    return pieces


def boat_labels(bm, info):
    t = info['transom']
    labels = {}
    for f in bm.faces:
        c = f.calc_center_median()
        motor = (c.y < t - 0.03 and abs(c.x) < 0.5) or (c.y < t + 0.42 and abs(c.x) < 0.36 and c.z > info['floor'] + 0.05)
        labels[f.index] = 'motor' if motor else 'hull'
    motor_min = min(f.calc_center_median().y for f in bm.faces if labels[f.index] == 'motor')
    prop_cut = motor_min + 0.36
    for f in bm.faces:
        if labels[f.index] == 'motor' and f.calc_center_median().y < prop_cut:
            labels[f.index] = 'prop'
    return labels


def camo(co):
    a = n3(co, 1.7)
    b = n3(Vector((co[0] + 7.1, co[1] - 3.3, co[2] * 2.0)), 3.1)
    if a > 0.22:
        return (0.33, 0.27, 0.17)
    if b > 0.3:
        return (0.11, 0.13, 0.09)
    if a < -0.25:
        return (0.47, 0.44, 0.31)
    return (0.25, 0.29, 0.16)


def aluminum(co, n, shade=1.0):
    brushed = 0.9 + 0.06 * n3(Vector((co[0] * 40.0, co[1] * 1.5, co[2] * 40.0)), 1.0) + 0.04 * n3(co, 6.0)
    lift = 0.06 * max(0.0, n[2])
    k = brushed * shade + lift
    return (0.66 * k, 0.68 * k, 0.7 * k)


def boat_color_fn(info):
    def col(co, n):
        x, y, z = co[0], co[1], co[2]
        if z < info['floor'] - 0.05 or y > info['bow'] - 0.04 or abs(x) > info['inner'] + 0.1:
            return aluminum(co, n, 0.82 if n[2] < -0.55 else 1.0)
        if n[2] > 0.75 and z < info['deck'] + 0.08:
            grit = 0.85 + 0.15 * (n3(co, 60.0) * 0.5 + 0.5)
            return (0.1 * grit, 0.102 * grit, 0.108 * grit)
        return aluminum(co, n, 0.9)
    return col


def motor_color_fn(info):
    def col(co, n):
        if co[2] > info['floor'] + 0.3:
            return mix((0.05, 0.05, 0.055), (0.2, 0.2, 0.21), max(0.0, n[2]) * 0.4)
        return (0.2, 0.21, 0.22)
    return col


def tub_pieces(info):
    t = BOWBOAT_TUB
    base = Vector((t['x'], t['y'], info['floor']))
    r, h = t['radius'], t['height']
    zinc = lambda co, n: mix((0.52, 0.54, 0.54), (0.74, 0.76, 0.75), n3(co, 14.0) * 0.5 + 0.5)
    inside = lambda co, n: mix((0.36, 0.38, 0.38), (0.5, 0.52, 0.52), n3(co, 12.0) * 0.5 + 0.5)
    out = []
    wall = cone(r, r, h, 36, at=tuple(base), cap=False)
    out.append(piece_from_bm(wall, zinc))
    inner = cone(r - 0.02, r - 0.02, h - 0.02, 36, at=tuple(base + Vector((0, 0, 0.02))), cap=False)
    out.append(piece_from_bm(inner, inside, flip=True))
    floor = cone(r - 0.02, r - 0.02, 0.02, 36, at=tuple(base + Vector((0, 0, 0.01))), cap=True)
    out.append(piece_from_bm(floor, inside))
    ring = [(base.x + math.cos(a) * (r - 0.005), base.y + math.sin(a) * (r - 0.005), base.z + h) for a in [i / 36 * math.tau for i in range(37)]]
    out.append(piece_from_bm(tube(ring, [0.018] * len(ring), 8, cap=False), zinc))
    for k in (0.3, 0.62):
        band = [(base.x + math.cos(a) * (r + 0.004), base.y + math.sin(a) * (r + 0.004), base.z + h * k) for a in [i / 36 * math.tau for i in range(37)]]
        out.append(piece_from_bm(tube(band, [0.008] * len(band), 6, cap=False), zinc))
    return out


def seat_pieces(info):
    s = BOWBOAT_SEAT
    body = box((s['w'], s['d'], s['h'] - 0.08), at=(s['x'], s['y'], info['floor'] + (s['h'] - 0.08) / 2))
    cushion = box((s['w'] + 0.02, s['d'] + 0.02, 0.09), at=(s['x'], s['y'], info['floor'] + s['h'] - 0.045))
    bmesh.ops.bevel(cushion, geom=cushion.edges[:], offset=0.02, segments=2, affect='EDGES')
    return [piece_from_bm(body, lambda co, n: aluminum(co, n, 0.95), smooth=False), piece_from_bm(cushion, lambda co, n: (0.08, 0.08, 0.08))]


def generator_pieces(info):
    g = BOWBOAT_GENERATOR
    body = box((g['w'], g['d'], g['h']), at=(g['x'], g['y'], info['floor'] + g['h'] / 2 + 0.03))
    bmesh.ops.bevel(body, geom=body.edges[:], offset=0.04, segments=3, affect='EDGES')
    out = [piece_from_bm(body, lambda co, n: (0.72, 0.1, 0.06) if n[2] < 0.8 else (0.62, 0.08, 0.05))]
    for dx in (-1, 1):
        rail = tube([(g['x'] + dx * g['w'] * 0.5, g['y'] - g['d'] * 0.55, info['floor'] + 0.02), (g['x'] + dx * g['w'] * 0.5, g['y'] - g['d'] * 0.55, info['floor'] + g['h'] + 0.08), (g['x'] + dx * g['w'] * 0.5, g['y'] + g['d'] * 0.55, info['floor'] + g['h'] + 0.08), (g['x'] + dx * g['w'] * 0.5, g['y'] + g['d'] * 0.55, info['floor'] + 0.02)], [0.016] * 4, 8, cap=False)
        out.append(piece_from_bm(rail, lambda co, n: (0.05, 0.05, 0.05)))
    return out


def led_pod(at, aim, side, width=0.13):
    aim = Vector(aim).normalized()
    side = Vector(side).normalized()
    up = side.cross(aim).normalized()
    rot = Matrix((side, aim, up)).transposed().to_4x4()
    housing = box((width, 0.07, 0.07), at=tuple(Vector(at) - aim * 0.02), rot=rot)
    lens = box((width - 0.02, 0.012, 0.05), at=tuple(Vector(at) + aim * 0.016), rot=rot)
    return housing, lens


def light_pieces(bm, info):
    """LED flood pods bolted to the outside of the sidewall rail just under the cap, following the hull's outline down both sides and round the bow, plus a row on the transom wall either side of the motor; each aimed out and 35 degrees down."""
    black = lambda co, n: (0.05, 0.05, 0.055)
    white = lambda co, n: (1.0, 1.0, 1.0)
    frame, lenses = [], []
    line = sheer_line(bm, info)
    top = info['rail']
    z = top - 0.11
    down = math.sin(BOWBOAT_LIGHT_AIM)
    out = math.cos(BOWBOAT_LIGHT_AIM)
    port = [(-max(0.08, w - 0.01), y) for y, w, _ in line]
    ring = port + [(-x, y) for x, y in reversed(port)]
    seg_len = [math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(ring, ring[1:])]
    total = sum(seg_len)
    spacing = 1.05
    count = max(8, int(total / spacing))
    spots = []
    for i in range(count):
        d = total * (i + 0.5) / count
        if d < 0.45 or d > total - 0.45:
            continue
        j = 0
        while j < len(seg_len) - 1 and d > seg_len[j]:
            d -= seg_len[j]
            j += 1
        a, b = ring[j], ring[j + 1]
        tx, ty = b[0] - a[0], b[1] - a[1]
        tl = math.hypot(tx, ty) or 1.0
        tx, ty = tx / tl, ty / tl
        nx, ny = -ty, tx
        k = d / (seg_len[j] or 1.0)
        px, py = a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k
        spots.append(((px, py, z), (nx, ny), (nx * out, ny * out, -down), (tx, ty, 0)))
    y0, w0, z0 = line[0]
    zt = z0 + (top - z0) * 0.6
    span = max(0.2, w0 - 0.01 - 0.6)
    for x in (-(0.6 + span * 0.8), -(0.6 + span * 0.3), 0.6 + span * 0.3, 0.6 + span * 0.8):
        spots.append(((x, y0, zt - 0.1), (0.0, -1.0), (0.0, -out, -down), (-1, 0, 0)))
    for (px, py, pz), (nx, ny), aim, side in spots:
        at = (px + nx * 0.045, py + ny * 0.045, pz)
        housing, lens = led_pod(at, aim, side, 0.16)
        frame.append(piece_from_bm(housing, black, smooth=False))
        lenses.append(piece_from_bm(lens, white, smooth=False))
        brot = Matrix((Vector(side), Vector((nx, ny, 0.0)), Vector((0.0, 0.0, 1.0)))).transposed().to_4x4()
        bracket = box((0.07, 0.05, 0.05), at=(px + nx * 0.02, py + ny * 0.02, pz), rot=brot)
        frame.append(piece_from_bm(bracket, black, smooth=False))
    return frame, lenses, (0.0, info['gunwale'] + 0.9, (info['transom'] + info['bow']) / 2)


def build_bowboat():
    src = meshy_source('bowboat')
    if not src:
        print('bowboat: no source model in assets-src/rackreel/meshy')
        return
    bm, _ = import_meshy(src)
    info = boat_frame(bm)
    bm = decimate_bm(bm, BOWBOAT_TRIS)
    bm.normal_update()
    split_sharp(bm)
    bm.faces.ensure_lookup_table()
    bm.faces.index_update()
    labels = boat_labels(bm, info)
    groups = {}
    for i, lab in labels.items():
        groups.setdefault(lab, set()).add(i)
    m = Model('bowboat', ground=False, ao_dist=0.35, ao_strength=0.55)
    region = region_bm(bm, groups['hull'])
    m.add('hull', piece_from_bm(region, boat_color_fn(info)))
    for p in tub_pieces(info) + seat_pieces(info) + generator_pieces(info) + rail_pieces(bm, info):
        m.add('hull', p)
    frame, lenses, bar = light_pieces(bm, info)
    for p in frame:
        m.add('hull', p)
    motor = region_bm(bm, groups['motor'])
    mb = bounds([v.co for v in motor.verts])
    motor_pivot = (0.0, info['transom'], mb[2][1] - 0.1)
    m.add('motor', piece_from_bm(motor, motor_color_fn(info)), pivot=motor_pivot)
    prop = region_bm(bm, groups['prop'])
    pb = bounds([v.co for v in prop.verts])
    prop_pivot = ((pb[0][0] + pb[0][1]) / 2, (pb[1][0] + pb[1][1]) / 2, (pb[2][0] + pb[2][1]) / 2)
    m.add('prop', piece_from_bm(prop, lambda co, n: mix((0.48, 0.49, 0.5), (0.7, 0.71, 0.72), max(0.0, n[2]))), pivot=prop_pivot, parent='motor')
    bm.free()
    for p in lenses:
        m.add('leds', p, material='led')
    s = BOWBOAT_SEAT
    t = BOWBOAT_TUB
    game = lambda p: (round(p[0], 3), round(p[2], 3), round(p[1], 3))
    BOWBOAT_INFO.update({
        'deck': game((0.0, info['bow'] - 1.15, info['deck'])),
        'driver': game((s['x'], s['y'] - 0.02, info['floor'] + s['h'] + 0.1)),
        'tub': game((t['x'], t['y'], info['floor'] + 0.03)),
        'tubRadius': round(t['radius'] - 0.05, 3),
        'flood': game(bar),
        'leds': len(lenses),
        'bowLip': game((0.5, info['bow'] - 0.25, info['rail'] + 0.26)),
        'motor': game(motor_pivot),
        'prop': game(prop_pivot),
        'floor': round(info['floor'], 3), 'deckTop': round(info['deck'], 3), 'gunwale': round(info['gunwale'], 3), 'rail': round(info['rail'], 3),
        'transom': round(info['transom'], 3), 'bow': round(info['bow'], 3), 'stern': round(info['stern'], 3), 'half': round(info['half'], 3),
    })
    write_model(m)
    print('bowboat anchors', json.dumps(BOWBOAT_INFO))
    if PREVIEW:
        marks = Model('bowboat-anchors', ground=False)
        marks.bake = lambda model: None
        for part, pieces in m.parts.items():
            for p in pieces:
                marks.add(part, p)
        for key, color in (('deck', (0.1, 0.9, 0.2)), ('driver', (0.9, 0.2, 0.9)), ('tub', (0.2, 0.5, 1.0)), ('flood', (1.0, 1.0, 0.2)), ('bowLip', (1.0, 0.4, 0.0))):
            g = BOWBOAT_INFO[key]
            marks.add('mark', piece_from_bm(sphere(0.07, 10, 6, at=(g[0], g[2], g[1])), lambda co, n, c=color: c))
        preview(marks)


def mullet_piece(face_verts, pivots, tree):
    top = max(c.z for c in face_verts)
    crown = [c for c in face_verts if c.z > top - 0.09]
    cx = sum(c.x for c in crown) / len(crown)
    cy = sum(c.y for c in crown) / len(crown)
    z_top = pivots['head'].z + (top - pivots['head'].z) * 0.62
    z_bottom = pivots['head'].z - 0.05
    rows, cols = 10, 20
    span = math.radians(96)
    outer, inner = [], []
    hang = {}
    for j in range(rows):
        ring_o, ring_i = [], []
        for i in range(cols):
            a = -span + 2 * span * i / (cols - 1)
            fade = abs(a) / span
            end = z_bottom + (z_top - 0.035 - z_bottom) * fade ** 2.2
            h = z_top + (end - z_top) * j / (rows - 1)
            d = Vector((math.sin(a), -math.cos(a), 0.0))
            origin = Vector((cx, cy, h))
            hit, _, _, dist = tree.ray_cast(origin + d * 0.25, -d, 0.25)
            surf = 0.25 - dist if hit is not None else 0.08
            prev = hang.get(i)
            r = surf if prev is None else min(max(surf, prev * (0.97 if j > 3 else 0.0)), prev * 1.04 + 0.002)
            hang[i] = r
            tip = 0.0
            if j == rows - 1:
                tip = 0.014 * n3(Vector((a * 3.0, 0.0, 0.0)), 1.0) - 0.01 * abs(math.sin(a * 5.0))
            low = j / (rows - 1)
            thick = 0.004 + 0.014 * low * (1.0 - fade ** 2)
            off = 0.002 + 0.012 * low * low
            p = origin + d * (r + off + thick)
            p.z += tip
            q = origin + d * (r + off * 0.4)
            q.z += tip
            ring_o.append(p)
            ring_i.append(q)
        outer.append(ring_o)
        inner.append(ring_i)
    bm = bmesh.new()
    vo = [[bm.verts.new(p) for p in row] for row in outer]
    vi = [[bm.verts.new(p) for p in row] for row in inner]
    for j in range(rows - 1):
        for i in range(cols - 1):
            bm.faces.new((vo[j][i], vo[j][i + 1], vo[j + 1][i + 1], vo[j + 1][i]))
            bm.faces.new((vi[j][i], vi[j + 1][i], vi[j + 1][i + 1], vi[j][i + 1]))
    for i in range(cols - 1):
        bm.faces.new((vo[rows - 1][i], vo[rows - 1][i + 1], vi[rows - 1][i + 1], vi[rows - 1][i]))
    for j in range(rows - 1):
        bm.faces.new((vo[j][0], vo[j + 1][0], vi[j + 1][0], vi[j][0]))
        bm.faces.new((vo[j][cols - 1], vi[j][cols - 1], vi[j + 1][cols - 1], vo[j + 1][cols - 1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])

    def col(co, n):
        a = math.atan2(co[0] - cx, -(co[1] - cy))
        strand = 0.82 + 0.18 * math.sin(a * 46.0 + n3(co, 30.0) * 2.0)
        low = smooth01(z_top, z_bottom, co[2])
        base = mix((0.66, 0.42, 0.18), (0.88, 0.66, 0.34), low)
        return (base[0] * strand, base[1] * strand, base[2] * strand)
    pivot = (cx, cy - 0.06, z_top)
    return piece_from_bm(bm, col), pivot


def build_wildman():
    rig_path = meshy_source('wildman-rig')
    base_path = meshy_source('wildman-base')
    if not rig_path or not base_path:
        print('wildman: no Meshy source')
        return
    bones, rverts, rpolys, fjoint = load_rig(rig_path)
    tree = BVHTree.FromPolygons(rverts, rpolys, epsilon=0.0)
    bm, base_image = import_meshy(base_path)
    fit_to(bm, bounds(rverts))
    bm.faces.index_update()
    bm.faces.ensure_lookup_table()
    labels = {}
    for f in bm.faces:
        _, _, idx, _ = tree.find_nearest(f.calc_center_median())
        labels[f.index] = fjoint[idx] if idx is not None else 'torso'
    neighbors = face_neighbors(bm)
    smooth_labels(labels, neighbors)
    if base_image is not None:
        pixels = image_array(base_image)
        ph, pw = pixels.shape[0], pixels.shape[1]
        uv = bm.loops.layers.uv.active
        knee = bones['LeftLeg'].z
        for f in bm.faces:
            if not labels[f.index].startswith(('foreArm', 'upperArm')):
                continue
            u, v = face_uv(f, uv)
            r, g, b = pixels[int(v * ph) % ph, int(u * pw) % pw][:3]
            if b > r * 1.15 and b > g * 0.95 and b > 0.12:
                z = f.calc_center_median().z
                side = 'L' if f.calc_center_median().x < 0 else 'R'
                labels[f.index] = 'hips' if z > (bones['Hips'].z + knee) / 2 + 0.08 * (bones['Hips'].z - knee) else 'thigh' + side
    k = WILDMAN_HIP / bones['Hips'].z
    frame = to_game_frame(k)
    bm.transform(frame)
    B = {n: frame @ p for n, p in bones.items()}
    bm.normal_update()
    n0 = bm.verts.layers.float_vector.new('n0')
    for v in bm.verts:
        v[n0] = v.normal
    pivots = {
        'hips': B['Hips'], 'torso': B['Spine02'], 'head': B['neck'],
        'upperArmL': B['RightArm'], 'upperArmR': B['LeftArm'], 'foreArmL': B['RightForeArm'], 'foreArmR': B['LeftForeArm'],
        'thighL': B['RightUpLeg'], 'thighR': B['LeftUpLeg'], 'shinL': B['RightLeg'], 'shinR': B['LeftLeg'],
    }
    arm_fix = {}
    for side, s, bone in (('L', 1, 'Right'), ('R', -1, 'Left')):
        up, fore, elbow = straighten_arm(B[bone + 'Arm'], B[bone + 'ForeArm'], B[bone + 'Hand'], s, (s * 0.15, -0.03, -1.0), (s * 0.08, 0.06, -1.0))
        arm_fix['upperArm' + side] = up
        arm_fix['foreArm' + side] = fore
        pivots['foreArm' + side] = elbow
    every = set(labels)
    joints = {}
    for i, j in labels.items():
        joints.setdefault(j, set()).add(i)
    m = Model('wildman', ao_dist=0.2, ao_strength=0.3)
    m.bake = lambda model: None
    tag = 'tex:wildman'
    order = ['hips', 'torso', 'head', 'upperArmL', 'upperArmR', 'foreArmL', 'foreArmR', 'thighL', 'thighR', 'shinL', 'shinR']
    for joint in order:
        faces = grow(joints.get(joint, set()), neighbors, every, 2)
        if not faces:
            m.add(joint, anchor_piece(pivots[joint]), pivot=tuple(pivots[joint]), material=tag, parent=JOINT_PARENT[joint])
            continue
        part = region_bm(bm, faces)
        if joint in arm_fix:
            fix = arm_fix[joint]
            layer = part.verts.layers.float_vector.get('n0')
            for v in part.verts:
                p = v.co.copy()
                v[layer] = (fix(p + Vector(v[layer])) - fix(p)).normalized()
                v.co = fix(p)
        m.add(joint, piece_from_textured(part), pivot=tuple(pivots[joint]), material=tag, parent=JOINT_PARENT[joint])
        part.free()
    head_verts = [v.co.copy() for f in bm.faces if labels[f.index] == 'head' for v in f.verts]
    body = BVHTree.FromBMesh(bm)
    mullet, mpivot = mullet_piece(head_verts, pivots, body)
    m.add('head:mullet', mullet, pivot=mpivot, parent='head')
    bm.free()
    if base_image is not None:
        save_variant_texture('wildman', base_image, WILDMAN_TEXTURE)
    write_model(m)
    print('wildman pivots', {k: tuple(round(x, 3) for x in v) for k, v in pivots.items()}, 'mullet', tuple(round(x, 3) for x in mpivot))


def build_bow():
    m = Model('bow', ground=False, ao_dist=0.03, ao_strength=0.35)
    riser = lambda co, n: mix((0.06, 0.065, 0.07), (0.16, 0.17, 0.18), max(0.0, n[2]) * 0.5)
    grip = lambda co, n: (0.04, 0.04, 0.04)
    limb = lambda co, n: mix((0.16, 0.2, 0.11), (0.3, 0.33, 0.2), n3(co, 60.0) * 0.5 + 0.5)
    steel = lambda co, n: mix((0.45, 0.46, 0.48), (0.78, 0.79, 0.8), max(0.0, n[2]))
    m.add('bow', piece_from_bm(tube([(0, 0.015, -0.23), (0, 0.04, -0.13), (0, 0.03, -0.05), (0, 0.03, 0.05), (0, 0.04, 0.13), (0, 0.015, 0.23)], [0.011, 0.014, 0.019, 0.019, 0.014, 0.011], 10), riser))
    m.add('bow', piece_from_bm(tube([(0, 0.012, -0.06), (0, 0.012, 0.02)], [0.021, 0.021], 10), grip))
    m.add('bow', piece_from_bm(box((0.012, 0.03, 0.012), at=(0.012, 0.03, BOW_NOCK[2] - 0.008)), riser, smooth=False))
    for sgn in (1, -1):
        bm = tube([(0, 0.015, 0.215 * sgn), (0, -0.015, 0.29 * sgn), (0, -0.07, 0.345 * sgn)], [0.012, 0.01, 0.008], 8)
        for v in bm.verts:
            v.co.x *= 1.9
        m.add('bow', piece_from_bm(bm, limb))
        cam = cone(0.03, 0.03, 0.012, 18, at=(-0.006, BOW_CAM[1], BOW_CAM[2] * sgn), rot=Matrix.Rotation(math.pi / 2, 4, 'Y'))
        m.add('bow', piece_from_bm(cam, steel))
        m.add('bow', piece_from_bm(tube([(-0.012, BOW_CAM[1], BOW_CAM[2] * sgn), (0.012, BOW_CAM[1], BOW_CAM[2] * sgn)], [0.004, 0.004], 6), steel))
    reel_at = (0.0, 0.005, -0.1)
    m.add('bow', piece_from_bm(box((0.014, 0.05, 0.05), at=(0.0, 0.02, -0.07)), riser, smooth=False))
    m.add('bow', piece_from_bm(cone(0.034, 0.034, 0.075, 18, at=reel_at, rot=Matrix.Rotation(-math.pi / 2, 4, 'X')), lambda co, n: (0.05, 0.05, 0.055)))
    m.add('bow', piece_from_bm(cone(0.034, 0.011, 0.045, 18, at=(reel_at[0], reel_at[1] + 0.075, reel_at[2]), rot=Matrix.Rotation(-math.pi / 2, 4, 'X')), steel))
    m.add('bow', piece_from_bm(cone(0.024, 0.024, 0.012, 14, at=(reel_at[0], reel_at[1] - 0.012, reel_at[2]), rot=Matrix.Rotation(-math.pi / 2, 4, 'X')), lambda co, n: (0.85, 0.42, 0.08)))
    nock = Vector(BOW_NOCK)
    shaft_len = 0.84
    white = lambda co, n: mix((0.82, 0.82, 0.76), (0.95, 0.95, 0.9), max(0.0, n[2]))
    orange = lambda co, n: (1.0, 0.42, 0.04)
    tip = nock + Vector((0, shaft_len - 0.06, 0))
    m.add('arrow', piece_from_bm(tube([tuple(nock), tuple(tip)], [0.0042, 0.0042], 8, cap=False), white), pivot=tuple(nock))
    m.add('arrow', piece_from_bm(cone(0.0055, 0.0004, 0.06, 10, at=tuple(tip), rot=Matrix.Rotation(-math.pi / 2, 4, 'X')), steel))
    for sx in (-1, 1):
        barb = tube([(sx * 0.003, tip.y + 0.035, tip.z), (sx * 0.011, tip.y + 0.012, tip.z)], [0.0018, 0.0006], 5)
        m.add('arrow', piece_from_bm(barb, steel))
    m.add('arrow', piece_from_bm(tube([(0, nock.y + 0.03, nock.z), (0, nock.y + 0.11, nock.z)], [0.0068, 0.0068], 10), orange))
    m.add('arrow', piece_from_bm(tube([(0, nock.y - 0.008, nock.z), (0, nock.y + 0.012, nock.z)], [0.0052, 0.0048], 8), lambda co, n: (0.05, 0.05, 0.05)))
    for name, sgn in (('stringU', 1), ('stringL', -1)):
        cam = (BOW_CAM[0], BOW_CAM[1], BOW_CAM[2] * sgn)
        m.add(name, piece_from_bm(tube([cam, tuple(nock)], [0.0017, 0.0017], 5, cap=False), lambda co, n: (0.06, 0.06, 0.06)), pivot=cam)
    write_model(m)
