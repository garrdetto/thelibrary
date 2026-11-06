"""Sandlot Sluggers 3D athlete body, built in Blender.

Run inside Blender (Scripting tab, or `blender -b -P modules-src/sandlot3d/tools/build-athlete.py`).
Writes assets-src/models/sandlot3d/athlete.glb: one skinned body (pelvis, belt, abdomen, chest, neck,
arms and legs) in rig units, with the same UVs and material slots the game's uniform textures expect,
then `pnpm assets` optimizes it into public/models/sandlot3d/athlete.glb.

The shapes follow the procedural Rig in main.js (chestGeo, pelvisGeo, armProfile, legProfile) at a
higher resolution, plus placket, buttons, belt loops, back pockets, a bloused jersey and fabric folds.
Bones are flat (no parenting). Each bone carries its rest frame in `frame` (origin, along, front, in
rig space: +x the player's left, +y up, +z forward) so the game can pose it from the same joints and
directions it uses for the IK, whatever Blender's bone roll convention.
"""
import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

PI = math.pi
REPO = os.environ.get("SANDLOT_REPO") or os.path.abspath(os.path.join(os.path.dirname(bpy.data.filepath or __file__), "..", "..", ".."))
OUT = os.path.join(REPO, "assets-src", "models", "sandlot3d", "athlete.glb")

LA = (.74, .68)
LL = (.92, .9)
HIP_Y = 1.9
CHEST_Y = HIP_Y + .1
NECK_Y = CHEST_Y + 1.34


def lerp(a, b, t):
    return a + (b - a) * t


def cl(v, a, b):
    return max(a, min(b, v))


def ease(t):
    return t * t * (3 - 2 * t)


def bump(x, c, w):
    d = (x - c) / w
    return math.exp(-d * d)


def sstep(a, b, x):
    t = cl((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def curve(pts, x):
    if x <= pts[0][0]:
        return pts[0][1]
    for k in range(1, len(pts)):
        if x <= pts[k][0]:
            a, b = pts[k - 1]
            c, d = pts[k]
            return b + (d - b) * ease((x - a) / (c - a))
    return pts[-1][1]


def dome(s, length, r):
    return r * math.sqrt(max(0, 1 - (s / length) ** 2))


def sec_th(u):
    return u * 2 * PI - PI / 2


def section(W, D, seg, pw, shape=None):
    pts = []
    for j in range(seg + 1):
        th = sec_th(j / seg)
        s, c = math.sin(th), math.cos(th)
        x = W * math.copysign(abs(s) ** (2 / pw), s) if s else 0.0
        z = D * math.copysign(abs(c) ** (2 / pw), c) if c else 0.0
        if shape:
            x, z = shape(x, z, th)
        pts.append((x, z))
    return pts


def torso_v(yc):
    return (yc + .1) / 1.54


class Builder:
    """Collects one mesh: vertices, faces, per-face material, per-corner UVs and per-vertex weights."""

    def __init__(self):
        self.verts = []
        self.weights = []
        self.faces = []
        self.mats = []
        self.uvs = []
        self.slots = []

    def slot(self, name):
        if name not in self.slots:
            self.slots.append(name)
        return self.slots.index(name)

    def vert(self, p, w):
        self.verts.append(p)
        self.weights.append(w)
        return len(self.verts) - 1

    def grid(self, rows, uv_of, mat_of, weight_of, flip=False):
        """rows[k][j] = rig-space point; a closed strip of quads between consecutive rows."""
        K, J = len(rows), len(rows[0])
        idx = [[self.vert(rows[k][j], weight_of(k, j)) for j in range(J)] for k in range(K)]
        for k in range(K - 1):
            for j in range(J - 1):
                a, b, c, d = idx[k][j], idx[k][j + 1], idx[k + 1][j + 1], idx[k + 1][j]
                quad = (a, d, c, b) if flip else (a, b, c, d)
                cuv = {a: uv_of(k, j), b: uv_of(k, j + 1), c: uv_of(k + 1, j + 1), d: uv_of(k + 1, j)}
                self.faces.append(quad)
                self.uvs.append([cuv[v] for v in quad])
                self.mats.append(self.slot(mat_of(k, j)))
        return idx


def ring_body(B, ys, seg, sec_of, y_world, weight_of, mat, uv_v, flip=False):
    rows = []
    for y in ys:
        rows.append([(x, y_world(y), z) for x, z in sec_of(y)])
    B.grid(rows, lambda k, j: (j / seg, uv_v(ys[k])), lambda k, j: mat, lambda k, j: weight_of(ys[k]), flip)


# ---------- trunk ----------
CHEST_P = [[.2, .355, .262], [.4, .37, .27], [.6, .41, .282], [.8, .455, .3], [.95, .48, .31], [1.07, .495, .3], [1.16, .48, .272], [1.24, .42, .24], [1.31, .31, .205], [1.37, .21, .172], [1.44, .155, .142]]
PELVIS_P = [[-.44, .18, .15], [-.38, .34, .24], [-.26, .425, .285], [-.12, .445, .3], [0, .42, .292], [.08, .4, .285], [.15, .388, .28]]
ABS_P = [[-.02, .372, .282], [.15, .352, .266], [.32, .338, .252], [.45, .336, .25], [.6, .338, .252]]


def chest_dims(y):
    return curve([(q[0], q[1]) for q in CHEST_P], y), curve([(q[0], q[2]) for q in CHEST_P], y)


def chest_shape(y, W):
    def f(x, z, th):
        ax = abs(x) / W
        if z > 0:
            z += .03 * bump(y, .98, .11) * bump(ax, .46, .3) - .012 * bump(y, .6, .2) * bump(ax, 0, .18)
            z -= .004 * bump(ax, .62, .05) * bump(y, 1.05, .12)
        else:
            z -= .016 * bump(y, 1.0, .13) * bump(ax, .45, .28)
            z += .012 * bump(x, 0, .05) * sstep(.35, .6, y)
        return x, z
    return f


def pelvis_dims(y):
    return curve([(q[0], q[1]) for q in PELVIS_P], y), curve([(q[0], q[2]) for q in PELVIS_P], y)


def pelvis_shape(y, W):
    def f(x, z, th):
        if z < 0:
            ax = abs(x)
            z -= .045 * bump(y, -.2, .13) * bump(ax / W, .45, .4)
            pocket = sstep(.07, .09, ax) * (1 - sstep(.23, .25, ax)) * sstep(-.23, -.21, y) * (1 - sstep(-.05, -.03, y))
            z -= .007 * pocket
        else:
            z += .003 * bump(x, .03, .02) * sstep(-.3, -.1, y) * (1 - sstep(.0, .08, y))
        return x, z
    return f


def abs_dims(y):
    return curve([(q[0], q[1]) for q in ABS_P], y), curve([(q[0], q[2]) for q in ABS_P], y)


def build_trunk(B):
    seg = 64
    ys = [lerp(.2, 1.44, k / 36) for k in range(37)]

    def chest_sec(y):
        W, D = chest_dims(y)
        return section(W, D, seg, 2.35, chest_shape(y, W))
    ring_body(B, ys, seg, chest_sec, lambda y: CHEST_Y + y, lambda y: {"chest": 1}, "jersey", lambda y: 1 - torso_v(y))

    ys = [lerp(-.44, .15, k / 20) for k in range(21)]

    def pelvis_sec(y):
        W, D = pelvis_dims(y)
        return section(W, D, seg, 2.2, pelvis_shape(y, W))
    ring_body(B, ys, seg, pelvis_sec, lambda y: HIP_Y + y, lambda y: {"hips": 1}, "pantsPlain", lambda y: 1 - y)

    ys = [lerp(-.02, .6, k / 20) for k in range(21)]

    def abs_sec(y):
        W, D = abs_dims(y)
        blouse = 1 + .045 * bump(y, .24, .07)
        ripple = .004 * math.sin(y * 70) * bump(y, .26, .06)

        def f(x, z, th):
            side = abs(math.sin(th))
            return x * (blouse + ripple * side), z * blouse
        return section(W, D, seg, 2.25, f)

    def abs_w(y):
        w = sstep(.08, .5, y)
        return {"hips": 1 - w, "chest": w}
    ring_body(B, ys, seg, abs_sec, lambda y: HIP_Y + y, abs_w, "jersey", lambda y: 1 - torso_v(y - .1))

    belt = [(.074, .992), (.08, 1.0), (.17, 1.0), (.176, .992)]
    rows = []
    for y, sc in belt:
        rows.append([(x, HIP_Y + y, z) for x, z in section(.412 * sc, .298 * sc, seg, 2.2)])
    B.grid(rows, lambda k, j: (j / seg, 1 - belt[k][0]), lambda k, j: "belt", lambda k, j: {"hips": 1})

    for a in (-2.35, -1.25, -.45, .45, 1.25, 2.35, PI):
        add_box(B, a, .412 + .006, .298 + .006, HIP_Y + .125, (.018, .11, .008), "pantsPlain", {"hips": 1})
    add_box(B, 0, .412 + .012, .298 + .012, HIP_Y + .125, (.07, .06, .014), "buckle", {"hips": 1})

    build_placket(B)


def add_box(B, theta, W, D, y, size, mat, w):
    """A small box sitting on a superellipse ring at angle theta (0 = front), facing outward."""
    s, c = math.sin(theta), math.cos(theta)
    px = W * math.copysign(abs(s) ** (2 / 2.2), s) if s else 0.0
    pz = D * math.copysign(abs(c) ** (2 / 2.2), c) if c else 0.0
    out = Vector((px / W ** 2, 0, pz / D ** 2)).normalized()
    side = Vector((0, 1, 0)).cross(out).normalized()
    hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
    center = Vector((px, y, pz)) + out * hz
    corners = []
    for dz in (-hz, hz):
        for dy in (-hy, hy):
            for dx in (-hx, hx):
                corners.append(center + side * dx + Vector((0, dy, 0)) + out * dz)
    ids = [B.vert(tuple(p), w) for p in corners]
    quads = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    for q in quads:
        f = tuple(ids[i] for i in q)
        B.faces.append(f)
        B.uvs.append([(0, 0), (1, 0), (1, 1), (0, 1)])
        B.mats.append(B.slot(mat))


def front_z(W, D, pw, shape, x):
    s = cl(x / W, -1, 1)
    s = math.copysign(abs(s) ** (pw / 2), s)
    th = math.asin(s)
    c = math.cos(th)
    z = D * abs(c) ** (2 / pw)
    if shape:
        x, z = shape(x, z, th)
    return z


def build_placket(B):
    """A raised button placket down the jersey front, under the painted piping, with stitched buttons."""
    xs = [-.04, -.036, .036, .04]
    rows = []
    ys_c = [lerp(.18, 1.36, k / 40) for k in range(41)]
    for y in ys_c:
        W, D = chest_dims(y)
        sh = chest_shape(y, W)
        lift = [.0, .0045, .0045, .0]
        rows.append([(x, CHEST_Y + y, front_z(W, D, 2.35, sh, x) + .0015 + lift[i]) for i, x in enumerate(xs)])
    B.grid(rows, lambda k, j: (.25 + xs[j] / 2.6, 1 - torso_v(ys_c[k])), lambda k, j: "jersey", lambda k, j: {"chest": 1})
    rows = []
    ys_a = [lerp(.18, .62, k / 14) for k in range(15)]
    for y in ys_a:
        W, D = abs_dims(y)
        blouse = 1 + .045 * bump(y, .24, .07)
        lift = [.0, .0045, .0045, .0]
        rows.append([(x, HIP_Y + y, front_z(W, D, 2.25, None, x / blouse) * blouse + .0015 + lift[i]) for i, x in enumerate(xs)])
    B.grid(rows, lambda k, j: (.25 + xs[j] / 2.6, 1 - torso_v(ys_a[k] - .1)), lambda k, j: "jersey",
           lambda k, j: {"hips": 1 - sstep(.08, .5, ys_a[k]), "chest": sstep(.08, .5, ys_a[k])})
    v = .9
    while v > .1:
        yc = v * 1.54 - .1
        if yc >= .2:
            W, D = chest_dims(yc)
            z = front_z(W, D, 2.35, chest_shape(yc, W), .013) + .006
            add_button(B, (.013, CHEST_Y + yc, z), {"chest": 1})
        else:
            yh = yc + .1
            W, D = abs_dims(yh)
            blouse = 1 + .045 * bump(yh, .24, .07)
            z = front_z(W, D, 2.25, None, .013 / blouse) * blouse + .006
            w = sstep(.08, .5, yh)
            add_button(B, (.013, HIP_Y + yh, z), {"hips": 1 - w, "chest": w})
        v -= .105


def add_button(B, c, w):
    r, n = .0105, 10
    rim = [B.vert((c[0] + r * math.cos(a), c[1] + r * math.sin(a), c[2]), w) for a in (k / n * 2 * PI for k in range(n))]
    top = B.vert((c[0], c[1], c[2] + .0035), w)
    for k in range(n):
        f = (rim[k], rim[(k + 1) % n], top)
        B.faces.append(f)
        B.uvs.append([(0, 0), (1, 0), (.5, 1)])
        B.mats.append(B.slot("button"))


# ---------- neck ----------
def build_neck(B):
    prof = [(0, -.12), (.172, -.12), (.158, 0), (.142, .14), (.135, .28), (.13, .38), (0, .4)]
    n = 32
    rows = []
    for r, y in prof[1:-1]:
        ring = []
        for j in range(n + 1):
            a = j / n * 2 * PI
            x, z = math.sin(a) * r, math.cos(a) * r
            cy, sy = math.cos(-.08), math.sin(-.08)
            yy, zz = y * cy - z * sy, y * sy + z * cy
            ring.append((x, NECK_Y + yy, zz))
        rows.append(ring)
    ys = [y for _, y in prof[1:-1]]
    B.grid(rows, lambda k, j: (j / n, 1 - (k / (len(rows) - 1))), lambda k, j: "neck",
           lambda k, j: {"neck": sstep(-.12, .08, ys[k]), "chest": 1 - sstep(-.12, .08, ys[k])}, flip=True)


# ---------- limbs ----------
def arm_profile(lb, sleeve):
    L1, L2, SE = LA[0], LA[1], .3

    def R(s, th):
        c, sn = math.cos(th), math.sin(th)
        F, Bk, Lt, Md = max(0, c) ** 2, max(0, -c) ** 2, max(0, sn) ** 2, max(0, -sn) ** 2
        if s < 0:
            r = dome(s, .11, .142 * lb + (.02 if sleeve else 0))
        elif s <= L1:
            u = s / L1
            r = curve([(0, .142), (.18, .142), (.45, .122), (.78, .1), (1, .088)], u) * lb
            r += (.024 * bump(u, .06, .2) * Lt + .03 * bump(u, .52, .2) * F + .024 * bump(u, .4, .22) * Bk) * lb
            if s < SE:
                r += .028 + .006 * bump(s, SE, .03) + .004 * math.sin(s * 55) * Md * bump(s, .1, .09)
            elif s < SE + .045:
                r += .033
            else:
                r += .005
        elif s <= L1 + L2:
            v = (s - L1) / L2
            r = curve([(0, .088), (.14, .098), (.32, .095), (.62, .078), (.9, .064), (1, .062)], v) * lb
            r += (.016 * bump(v, .22, .18) * F + .012 * bump(v, .2, .2) * Lt) * lb - .012 * sstep(.7, 1, v) * (Lt + Md) + .004
        else:
            r = dome(s - L1 - L2, .035, .062 * lb + .004)
        return max(0, r)
    return R


def leg_profile(lb):
    L1, L2 = LL
    KN = L1 + .36

    def R(s, th):
        c, sn = math.cos(th), math.sin(th)
        F, Bk, Lt, Md = max(0, c) ** 2, max(0, -c) ** 2, max(0, sn) ** 2, max(0, -sn) ** 2
        if s < 0:
            r = dome(s, .17, .235 * lb)
        elif s <= L1:
            u = s / L1
            r = curve([(0, .215), (.2, .205), (.5, .185), (.8, .152), (1, .13)], u) * lb
            r += (.03 * bump(u, .45, .25) * F + .022 * bump(u, .55, .25) * Lt + .025 * bump(u, .35, .25) * Bk + .016 * bump(u, .2, .2) * Md + .016 * bump(u, 1, .05) * F) * lb
        elif s <= L1 + L2:
            v = (s - L1) / L2
            r = curve([(0, .13), (.15, .128), (.35, .13), (.6, .105), (.85, .078), (1, .072)], v) * lb
            r += (.045 * bump(v, .28, .17) * Bk + .014 * bump(v, .25, .18) * Md + .012 * bump(v, 0, .06) * F) * lb - .01 * bump(v, .5, .3) * F
        else:
            r = dome(s - L1 - L2, .035, .072 * lb + .006)
        if s < KN:
            r += .028 + .03 * bump(s, KN - .03, .05)
            r += .006 * math.sin(s * 62) * Bk * bump(s, L1, .12)
            r += .004 * math.sin(s * 48 + 1) * Md * bump(s, .2, .14)
            r += .003 * math.sin(s * 40) * F * bump(s, L1 - .05, .1)
        elif s < L1 + L2 + .04:
            r += .006
        return max(0, r)
    return R


def ring_s(a, b, step, extra):
    s = set()
    x = a
    while x < b - 1e-6:
        s.add(round(x, 4))
        x += step
    s.add(b)
    for e in extra:
        s.add(e)
    return sorted(s)


def limb_frame(origin, along, front):
    t = along.normalized()
    N = (front - t * front.dot(t)).normalized()
    return origin, t, N


def build_limb(B, name_a, name_b, A, t, N, q, L1, L2, join, S, R, groups, seg):
    """Rest pose: a straight limb from A along t. Theta 0 faces N, 90 deg faces q * (t x N) (the outer side)."""
    Bn = t.cross(N) * q
    rows, ws, mats = [], [], []

    def mat_at(s):
        for e, m in groups:
            if s < e - 1e-6:
                return m
        return groups[-1][1]
    for s in S:
        c = A + t * s
        ring = []
        for j in range(seg + 1):
            th = j / seg * 2 * PI
            d = N * math.cos(th) + Bn * math.sin(th)
            ring.append(tuple(c + d * R(s, th)))
        rows.append(ring)
        wb = sstep(L1 - join, L1 + join, s)
        ws.append({name_a: 1 - wb, name_b: wb})
    K = len(S)
    B.grid(rows, lambda k, j: (j / seg, 1 - k / (K - 1)), lambda k, j: mat_at((S[min(k + 1, K - 1)] + S[k]) / 2),
           lambda k, j: ws[k], flip=q < 0)


FRAMES = {}


def build_limbs(B):
    for side, sg in (("L", 1), ("R", -1)):
        S0 = Vector((sg * .45, CHEST_Y + 1.15, 0))
        along = Vector((sg * .2, -1, .05))
        front = -Vector((sg * .7, -1, -.7)).normalized()
        A, t, N = limb_frame(S0, along, front)
        E = A + t * LA[0]
        FRAMES["upperarm_" + side] = (A, t, N, LA[0])
        FRAMES["forearm_" + side] = (E, t, N, LA[1])
        tot = LA[0] + LA[1]
        S = ring_s(0, tot, .035, [-.12, -.105, -.09, -.075, -.06, -.045, -.03, -.015, .3, .345, tot + .018, tot + .03, tot + .035])
        build_limb(B, "upperarm_" + side, "forearm_" + side, A, t, N, -sg, LA[0], LA[1], .12, S, arm_profile(1, True),
                   [(.3, "sleeve"), (.345, "trim"), (9, "forearm")], 32)

        H0 = Vector((sg * .25, HIP_Y - .12, 0))
        along = Vector((sg * .03, -1, 0))
        front = Vector((0, .2, 1)).normalized()
        A, t, N = limb_frame(H0, along, front)
        Kn = A + t * LL[0]
        FRAMES["thigh_" + side] = (A, t, N, LL[0])
        FRAMES["shin_" + side] = (Kn, t, N, LL[1])
        KN = LL[0] + .36
        tot = LL[0] + LL[1]
        S = ring_s(0, tot, .04, [-.17, -.15, -.13, -.11, -.09, -.07, -.05, -.03, -.02, KN, KN + .35, tot + .02, tot + .032, tot + .035])
        build_limb(B, "thigh_" + side, "shin_" + side, A, t, N, -sg, LL[0], LL[1], .15, S, leg_profile(1),
                   [(KN, "pants"), (KN + .35, "stirrups"), (9, "socks")], 36)
    up, fwd = Vector((0, 1, 0)), Vector((0, 0, 1))
    FRAMES["hips"] = (Vector((0, HIP_Y, 0)), up, fwd, .3)
    FRAMES["chest"] = (Vector((0, CHEST_Y, 0)), up, fwd, .5)
    FRAMES["neck"] = (Vector((0, NECK_Y, 0)), up, fwd, .3)


# ---------- Blender scene ----------
def to_bl(p):
    return Vector((p[0], -p[2], p[1]))


def make_scene():
    scn = bpy.data.scenes.get("SandlotAthlete") or bpy.data.scenes.new("SandlotAthlete")
    for o in list(scn.collection.all_objects):
        bpy.data.objects.remove(o, do_unlink=True)
    return scn


SLOT_COLORS = {"jersey": "#f4f2ec", "pantsPlain": "#e8e6e0", "belt": "#a5281f", "buckle": "#c9ccd0", "button": "#f6f4ee", "neck": "#c8906e",
               "sleeve": "#f0eee8", "trim": "#c8342a", "forearm": "#b82e26", "pants": "#ecead4", "stirrups": "#c03028", "socks": "#faf8f2"}


def material(name):
    """Preview colors only (the game recolors every slot); distinct values keep the asset pipeline from merging slots."""
    m = bpy.data.materials.get("athlete_" + name) or bpy.data.materials.new("athlete_" + name)
    m.use_nodes = True
    h = SLOT_COLORS[name].lstrip("#")
    rgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    rgb = [c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4 for c in rgb]
    bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*rgb, 1)
    bsdf.inputs["Roughness"].default_value = .4 if name in ("buckle", "button") else .85
    m.diffuse_color = (*rgb, 1)
    return m


def build():
    B = Builder()
    build_trunk(B)
    build_neck(B)
    build_limbs(B)

    scn = make_scene()
    me = bpy.data.meshes.new("athlete_body")
    me.from_pydata([tuple(to_bl(v)) for v in B.verts], [], B.faces)
    for name in B.slots:
        me.materials.append(material(name))
    for poly, m in zip(me.polygons, B.mats):
        poly.material_index = m
        poly.use_smooth = True
    uv = me.uv_layers.new(name="UVMap")
    for poly, cuv in zip(me.polygons, B.uvs):
        for li, (u, v) in zip(poly.loop_indices, cuv):
            uv.data[li].uv = (u, v)
    me.validate()
    body = bpy.data.objects.new("AthleteBody", me)
    scn.collection.objects.link(body)

    arm =bpy.data.armatures.new("AthleteRig")
    rig = bpy.data.objects.new("AthleteRig", arm)
    scn.collection.objects.link(rig)
    bpy.context.window.scene = scn
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    for name, (o, t, N, length) in FRAMES.items():
        eb = arm.edit_bones.new(name)
        eb.head = to_bl(o)
        eb.tail = to_bl(o + t * length)
        eb.align_roll(to_bl(N))
        eb.use_deform = True
    bpy.ops.object.mode_set(mode="OBJECT")
    for name, (o, t, N, length) in FRAMES.items():
        pb = rig.pose.bones[name]
        pb["frame"] = [round(c, 6) for c in (*o, *t, *N)]

    groups = {n: body.vertex_groups.new(name=n) for n in FRAMES}
    for vi, w in enumerate(B.weights):
        for n, val in w.items():
            if val > 1e-4:
                groups[n].add([vi], val, "REPLACE")
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(me)
    bm.free()
    body.parent = rig
    mod = body.modifiers.new("Armature", "ARMATURE")
    mod.object = rig

    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    body.select_set(True)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=OUT, use_selection=True, export_format="GLB", export_skins=True, use_active_scene=True,
                              export_extras=True, export_animations=False, export_yup=True, export_apply=False,
                              export_texcoords=True, export_normals=True, export_materials="EXPORT")
    print("athlete", len(me.vertices), "verts", sum(len(p.vertices) - 2 for p in me.polygons), "tris", B.slots, OUT)


build()
