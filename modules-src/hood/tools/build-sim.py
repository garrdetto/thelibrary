"""The Hood resident body, built in Blender.

Run headless from the repo root:

    blender -b -P modules-src/hood/tools/build-sim.py
    pnpm assets

Writes assets-src/models/hood/sim.glb: one skinned, anatomically proportioned adult (about 7.6 heads,
1.78 m before the Sim's height scale) with a sculpted face (brow, sockets, cheekbones, nose, lips,
ears, lidded eyes with iris and pupil), hands with thumbs, a crew-neck tee, belted trousers and
sneakers, plus four hair meshes (Hair_short, Hair_long, Hair_bun, Hair_curly) skinned to the head.

Shape keys (glTF morph targets) on the body: Feminine, Slim, Broad. The game blends them from the
Sim's Look (body and build). Material slots are named for what the game recolours: Skin, Lips, Top,
Bottom, Belt, Buckle, Shoes, Sole, Eye, Iris, Pupil, Brows, Hair.

Axes (Blender): +Z up, the figure faces -Y, its right side is -X. The glTF exporter turns this into
three.js +Y up facing +Z. Bones are named hips, spine, chest, neck, head, thigh_L/R, shin_L/R,
foot_L/R, upperarm_L/R, forearm_L/R, hand_L/R. Joint heights match the old procedural figure (hips
pivot at 0.90 m, knees 0.44 m below), so the game's poses carry over.

Set HOOD_PREVIEW=/path/prefix to also render front/side/three-quarter previews with Cycles.
"""
import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

PI = math.pi
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.environ.get("HOOD_REPO") or os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT = os.path.join(REPO, "assets-src", "models", "hood", "sim.glb")


# ---------------------------------------------------------------- helpers

def clamp(v, a, b):
    return max(a, min(b, v))


def lerp(a, b, t):
    return a + (b - a) * t


def sstep(a, b, x):
    t = clamp((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def bump(x, c, w):
    d = (x - c) / w
    return math.exp(-d * d)


def spow(v, p):
    return math.copysign(abs(v) ** p, v) if v else 0.0


def curve(pts, x):
    """Smooth piecewise interpolation through (x, y) points."""
    if x <= pts[0][0]:
        return pts[0][1]
    for k in range(1, len(pts)):
        if x <= pts[k][0]:
            a, b = pts[k - 1]
            c, d = pts[k]
            t = (x - a) / (c - a)
            t = t * t * (3 - 2 * t)
            return b + (d - b) * t
    return pts[-1][1]


def norm_weights(w):
    w = {k: v for k, v in w.items() if v > 1e-4}
    s = sum(w.values()) or 1.0
    return {k: v / s for k, v in w.items()}


# ---------------------------------------------------------------- parameters

BASE = dict(
    torso_w=[(0.755, 0.045), (0.785, 0.085), (0.82, 0.13), (0.86, 0.163), (0.93, 0.172), (1.00, 0.158), (1.06, 0.147), (1.15, 0.152), (1.25, 0.165), (1.33, 0.170), (1.40, 0.167), (1.44, 0.156), (1.47, 0.130), (1.49, 0.097), (1.51, 0.074), (1.525, 0.066)],
    torso_df=[(0.755, 0.04), (0.80, 0.07), (0.90, 0.097), (1.00, 0.095), (1.06, 0.094), (1.15, 0.098), (1.27, 0.112), (1.35, 0.106), (1.42, 0.084), (1.47, 0.070), (1.50, 0.058), (1.525, 0.054)],
    torso_db=[(0.755, 0.045), (0.80, 0.08), (0.88, 0.112), (0.93, 0.113), (1.00, 0.096), (1.06, 0.088), (1.15, 0.092), (1.27, 0.104), (1.36, 0.106), (1.42, 0.090), (1.47, 0.074), (1.50, 0.062), (1.525, 0.058)],
    scale_w=1.0, scale_d=1.0, belly=0.0, bust=0.0, pecs=1.0, shoulder_in=0.0,
    arm=1.0, leg=1.0, thigh_top=1.0, neck=1.0,
    jaw=0.93, brow=1.0, chin=1.0, lips=1.0, nose=1.0, head_w=1.0, cheek=1.0,
)

FEM = dict(BASE)
FEM.update(
    torso_w=[(0.755, 0.047), (0.785, 0.09), (0.82, 0.14), (0.86, 0.176), (0.93, 0.194), (1.00, 0.17), (1.06, 0.13), (1.15, 0.133), (1.25, 0.142), (1.33, 0.146), (1.40, 0.143), (1.44, 0.133), (1.47, 0.119), (1.49, 0.089), (1.51, 0.068), (1.525, 0.060)],
    torso_df=[(0.755, 0.04), (0.80, 0.07), (0.90, 0.095), (1.00, 0.090), (1.06, 0.086), (1.15, 0.090), (1.27, 0.100), (1.35, 0.098), (1.42, 0.080), (1.47, 0.066), (1.50, 0.054), (1.525, 0.050)],
    torso_db=[(0.755, 0.047), (0.80, 0.085), (0.88, 0.125), (0.93, 0.121), (1.00, 0.098), (1.06, 0.084), (1.15, 0.088), (1.27, 0.098), (1.36, 0.100), (1.42, 0.086), (1.47, 0.070), (1.50, 0.058), (1.525, 0.054)],
    bust=1.3, pecs=0.0, arm=0.86, shoulder_in=0.016, leg=0.98, thigh_top=1.07, neck=0.88,
    jaw=0.86, brow=0.35, chin=0.6, lips=1.35, nose=0.84, head_w=0.96, cheek=1.2,
)

SLIM = dict(BASE)
SLIM.update(shoulder_in=0.008, scale_w=0.89, scale_d=0.88, arm=0.86, leg=0.88, thigh_top=0.9, neck=0.94, jaw=0.89, pecs=0.6)

BROAD = dict(BASE)
BROAD.update(shoulder_in=-0.012, scale_w=1.13, scale_d=1.14, belly=1.0, arm=1.17, leg=1.13, thigh_top=1.1, neck=1.12, jaw=0.97, pecs=1.3, cheek=1.1)

# skeleton (Blender coordinates)
ARM_A = 0.10
SHOULDER = Vector((0.181, 0.004, 1.388))
UPPER = 0.29
FORE = 0.25
HAND = 0.175
HIP = Vector((0.093, 0.0, 0.90))
KNEE_Z = 0.46
ANKLE_Z = 0.085
HEAD_C = Vector((0.0, -0.012, 1.668))
HX, HYF, HYB, HZ = 0.0795, 0.096, 0.105, 0.119


def arm_dir(side):
    return Vector((side * math.sin(ARM_A), 0.0, -math.cos(ARM_A)))


def arm_out(side):
    return Vector((side * math.cos(ARM_A), 0.0, math.sin(ARM_A)))


FRONT = Vector((0.0, -1.0, 0.0))


# ---------------------------------------------------------------- geometry collector

class Geo:
    def __init__(self):
        self.verts = []
        self.weights = []
        self.faces = []
        self.mats = []
        self.uvs = []

    def vert(self, p, w):
        self.verts.append(Vector(p))
        self.weights.append(w)
        return len(self.verts) - 1

    def loft(self, rings, mat_of, weight_of, cap0=True, cap1=True, uv_scale=1.0, closed=True):
        """rings[k][j]: points; quads between consecutive rings, fan caps at both ends."""
        K, N = len(rings), len(rings[0])
        idx = [[self.vert(rings[k][j], weight_of(rings[k][j], k, j)) for j in range(N)] for k in range(K)]
        vcum = [0.0]
        for k in range(1, K):
            ca = sum(rings[k - 1], Vector()) / N
            cb = sum(rings[k], Vector()) / N
            vcum.append(vcum[-1] + (cb - ca).length)
        perim = []
        for k in range(K):
            perim.append(sum((rings[k][(j + 1) % N] - rings[k][j]).length for j in range(N)))
        J = N if closed else N - 1
        for k in range(K - 1):
            for j in range(J):
                j2 = (j + 1) % N
                quad = (idx[k][j], idx[k][j2], idx[k + 1][j2], idx[k + 1][j])
                pk = (perim[k] + perim[k + 1]) * 0.5
                u0, u1 = j / N * pk, (j + 1) / N * pk
                self.faces.append(quad)
                self.uvs.append([(u0 / uv_scale, vcum[k] / uv_scale), (u1 / uv_scale, vcum[k] / uv_scale), (u1 / uv_scale, vcum[k + 1] / uv_scale), (u0 / uv_scale, vcum[k + 1] / uv_scale)])
                c = (rings[k][j] + rings[k][j2] + rings[k + 1][j2] + rings[k + 1][j]) / 4
                self.mats.append(mat_of(c, k, j))
        for end, k in ((cap0, 0), (cap1, K - 1)):
            if not end or not closed:
                continue
            c = sum(rings[k], Vector()) / N
            ci = self.vert(c, weight_of(c, k, -1))
            for j in range(N):
                j2 = (j + 1) % N
                tri = (ci, idx[k][j2], idx[k][j]) if k == 0 else (ci, idx[k][j], idx[k][j2])
                self.faces.append(tri)
                self.uvs.append([(0.5, 0.5)] * 3)
                self.mats.append(mat_of(c, k, j))
        return idx


# ---------------------------------------------------------------- body parts

def torso_dims(P, z):
    fade = sstep(1.43, 1.50, z)
    sw = lerp(P["scale_w"], 1.0, fade)
    sd = lerp(P["scale_d"], 1.0, fade)
    W = curve(P["torso_w"], z) * sw
    Df = curve(P["torso_df"], z) * sd
    Db = curve(P["torso_db"], z) * sd
    return W, Df, Db


def neckline(th):
    front = max(0.0, -math.sin(th))
    return 1.488 - 0.036 * front ** 1.6


CLOTH = {"Bottom": 0.005, "Belt": 0.0085, "Top": 0.0062, "Collar": 0.0078, "Skin": 0.0}


def station_z(st, th):
    kind, val = st[0], st[1]
    if kind == "z":
        return val
    n = neckline(th)
    if kind == "n":
        return 1.40 + (n - 1.40) * val
    return n + (1.525 - n) * val


def torso_stations():
    st = [("z", 0.755 + i * 0.0183, "Bottom") for i in range(12)]
    st += [("z", 0.975, "Bottom"), ("z", 0.975, "Belt"), ("z", 0.9905, "Belt"), ("z", 1.006, "Belt"), ("z", 1.006, "Top")]
    st += [("z", 1.006 + i * 0.0175, "Top") for i in range(1, 23) if 1.006 + i * 0.0175 < 1.395]
    st += [("n", i / 6, "Top") for i in range(0, 6)]
    st += [("n", 1.0, "Collar"), ("m", 0.0, "Skin")]
    st += [("m", i / 4, "Skin") for i in range(1, 5)]
    return st


def torso_point(P, z, th, region):
    W, Df, Db = torso_dims(P, z)
    p = 2.35
    c, s = math.cos(th), math.sin(th)
    x = W * spow(c, 2 / p)
    D = Df if s < 0 else Db
    y = D * spow(s, 2 / p)
    ax = abs(x)
    if s < 0:  # front
        y -= P["bust"] * 0.034 * bump(z, 1.265, 0.045) * bump(ax, 0.075, 0.048)
        y -= P["pecs"] * 0.008 * bump(z, 1.31, 0.05) * bump(ax, 0.08, 0.06)
        y -= P["belly"] * 0.03 * bump(z, 1.08, 0.08) * bump(ax, 0.0, 0.11)
        y += 0.004 * bump(z, 1.44, 0.03) * bump(ax, 0.0, 0.03)  # suprasternal notch
    else:  # back: glutes and shoulder blades
        y += 0.010 * bump(z, 0.90, 0.05) * bump(ax, 0.07, 0.05)
        y += 0.006 * bump(z, 1.33, 0.06) * bump(ax, 0.08, 0.05)
    off = CLOTH[region]
    if region == "Top":
        off += 0.004 * bump(z, 1.016, 0.01) + 0.0012 * math.sin(z * 95 + th * 3.0) * sstep(1.02, 1.1, z) * (1 - sstep(1.3, 1.4, z))
    n = Vector((x / max(W, 1e-4) ** 2, y / max(D, 1e-4) ** 2, 0.0))
    n = n.normalized() if n.length > 1e-6 else Vector((1, 0, 0))
    return Vector((x, y, z)) + n * off


def band_material(a, b):
    """Material of the faces between two stations: a step (same height) belongs to the side that stands out."""
    if a[:2] == b[:2] or (a[0] == "n" and a[1] == 1.0 and b[0] == "m" and b[1] == 0.0):
        r = a[2] if CLOTH[a[2]] >= CLOTH[b[2]] else b[2]
    else:
        r = a[2]
    return "Top" if r == "Collar" else r


def build_torso(G, P):
    N = 40
    st = torso_stations()
    rings = []
    for k, sta in enumerate(st):
        ring = []
        for j in range(N):
            th = j / N * 2 * PI
            ring.append(torso_point(P, station_z(sta, th), th, sta[2]))
        rings.append(ring)

    def mat_of(c, k, j):
        if k >= len(st) - 1:
            return st[-1][2] if k > 0 else st[0][2]
        return band_material(st[k], st[k + 1])

    def weight_of(p, k, j):
        z, ax = p.z, abs(p.x)
        side = "L" if p.x > 0 else "R"
        w = {}
        t1 = sstep(0.98, 1.10, z)
        t2 = sstep(1.18, 1.30, z)
        t3 = sstep(1.47, 1.52, z)
        w["hips"] = 1 - t1
        w["spine"] = t1 * (1 - t2)
        w["chest"] = t2 * (1 - t3)
        w["neck"] = t3
        arm = sstep(0.13, 0.19, ax) * sstep(1.30, 1.40, z) * 0.55
        if arm:
            for key in list(w):
                w[key] *= 1 - arm
            w["upperarm_" + side] = arm
        leg = sstep(0.95, 0.84, z) * sstep(0.02, 0.09, ax) * 0.6
        if leg:
            for key in list(w):
                w[key] *= 1 - leg
            w["thigh_" + side] = w.get("thigh_" + side, 0) + leg
        return norm_weights(w)

    G.loft(rings, mat_of, weight_of)

    # belt buckle
    W, Df, _ = torso_dims(P, 0.99)
    y0 = -(Df + 0.0085)
    bw, bh, bd = 0.024, 0.02, 0.004
    corners = []
    for dz in (-bh / 2, bh / 2):
        ring = [Vector((x, y0 - bd if f else y0 + 0.002, 0.9905 + dz)) for x, f in ((-bw / 2, 1), (bw / 2, 1), (bw / 2, 0), (-bw / 2, 0))]
        corners.append(ring)
    G.loft(corners, lambda c, k, j: "Buckle", lambda p, k, j: {"hips": 1.0})


def build_neck(G, P):
    N = 20
    rings = []
    zs = [1.43 + i * 0.016 for i in range(13)]
    for z in zs:
        t = (z - 1.43) / 0.19
        rx = lerp(0.064, 0.056, sstep(0, 0.45, t)) * P["neck"]
        ry = lerp(0.066, 0.059, sstep(0, 0.45, t)) * P["neck"]
        cy = lerp(0.004, -0.014, t)
        ring = []
        for j in range(N):
            th = j / N * 2 * PI
            x = rx * math.cos(th)
            y = cy + ry * math.sin(th)
            # Adam's apple / throat and the neck muscles at the back
            if math.sin(th) < 0:
                y -= 0.004 * bump(z, 1.53, 0.02) * bump(x, 0, 0.015) * P["brow"]
            ring.append(Vector((x, y, z)))
        rings.append(ring)

    def weight_of(p, k, j):
        t1 = sstep(1.46, 1.52, p.z)
        t2 = sstep(1.56, 1.61, p.z)
        return norm_weights({"chest": 1 - t1, "neck": t1 * (1 - t2), "head": t2})

    G.loft(rings, lambda c, k, j: "Skin", weight_of)


ARM_PROFILE = [(-0.03, 0.012), (-0.02, 0.028), (-0.004, 0.038), (0.02, 0.0435), (0.06, 0.0445), (0.11, 0.042), (0.17, 0.042), (0.23, 0.037), (0.285, 0.034), (0.33, 0.039), (0.38, 0.036), (0.46, 0.030), (0.52, 0.026), (0.545, 0.025)]


def sleeve(s):
    if s < 0.15:
        return 0.0065, "Top"
    return 0.0, "Skin"


def arm_stations():
    st = [(-0.03 + i * 0.0138, "Top") for i in range(13)]
    st += [(0.15, "Top"), (0.15, "Skin")]
    st += [(0.15 + i * 0.4 / 22, "Skin") for i in range(1, 23)]
    return st


def build_arm(G, P, side):
    N = 20
    d, o = arm_dir(side), arm_out(side)
    S = Vector((side * SHOULDER.x, SHOULDER.y, SHOULDER.z))
    S_bone = S.copy()
    S = S - Vector((side * P["shoulder_in"], 0, P["shoulder_in"] * 0.4))
    st = arm_stations()
    rings = []
    for s, region in st:
        r = curve(ARM_PROFILE, s) * P["arm"]
        off = CLOTH[region] and 0.0065
        c = S + d * s
        ring = []
        for j in range(N):
            th = j / N * 2 * PI
            ro = r * (1.0 + 0.06 * bump(s, 0.03, 0.05) * max(0, math.cos(th)))  # deltoid
            rf = r * 0.92 * (1 + 0.06 * bump(s, 0.12, 0.06) * max(0, -math.sin(th)))  # biceps
            if s > 0.30:
                rf *= 0.93
            x = math.cos(th) * (ro + off)
            y = math.sin(th) * (rf + off)
            ring.append(c + o * x + Vector((0, 1, 0)) * y)
        if side < 0:
            ring.reverse()
        rings.append(ring)

    def mat_of(c, k, j):
        if k >= len(st) - 1:
            return st[-1][1]
        a, b = st[k], st[k + 1]
        if a[0] == b[0]:
            return "Top"
        return a[1]

    def weight_of(p, k, j):
        s = (p - S).dot(d)
        sd = "_L" if side > 0 else "_R"
        _ = S_bone
        top = sstep(-0.05, 0.04, s)
        elbow = sstep(UPPER - 0.035, UPPER + 0.035, s)
        wrist = sstep(UPPER + FORE - 0.02, UPPER + FORE + 0.03, s)
        return norm_weights({"chest": 1 - top, "upperarm" + sd: top * (1 - elbow), "forearm" + sd: elbow * (1 - wrist), "hand" + sd: wrist})

    G.loft(rings, mat_of, weight_of)

    # hand: palm faces the body, fingers slightly curled, a separate thumb
    W = S + d * (UPPER + FORE)
    inward = -o
    hand = [(-0.01, 0.024, 0.018), (0.012, 0.031, 0.017), (0.04, 0.039, 0.016), (0.075, 0.043, 0.015), (0.098, 0.042, 0.0135), (0.13, 0.039, 0.012), (0.158, 0.034, 0.0105), (0.172, 0.026, 0.009), (0.18, 0.012, 0.006)]
    rings = []
    N = 16
    for s, hw, ht in hand:
        curl = 0.35 * max(0.0, s - 0.095) ** 1.4
        c = W + d * s + inward * curl * 0.9
        ring = []
        for j in range(N):
            th = j / N * 2 * PI
            x = math.cos(th) * ht * (1.15 if math.cos(th) > 0 else 1.0)
            y = math.sin(th) * hw
            ring.append(c + o * x + Vector((0, 1, 0)) * y)
        if side < 0:
            ring.reverse()
        rings.append(ring)
    sd = "_L" if side > 0 else "_R"

    def hw_of(p, k, j):
        s = (p - W).dot(d)
        t = sstep(-0.01, 0.02, s)
        return norm_weights({"forearm" + sd: 1 - t, "hand" + sd: t})

    G.loft(rings, lambda c, k, j: "Skin", hw_of)
    # thumb
    base = W + d * 0.028 + Vector((0, -1, 0)) * 0.022 + inward * 0.006
    td = (d * 0.75 + Vector((0, -1, 0)) * 0.45 + inward * 0.25).normalized()
    tside = td.cross(Vector((0, 0, 1))).normalized()
    tup = tside.cross(td).normalized()
    rings = []
    for s, r in ((0.0, 0.0125), (0.02, 0.0125), (0.04, 0.0105), (0.058, 0.0092), (0.068, 0.006)):
        c = base + td * s
        ring = [c + tside * math.cos(j / 12 * 2 * PI) * r + tup * math.sin(j / 12 * 2 * PI) * r * 0.85 for j in range(12)]
        rings.append(ring)
    G.loft(rings, lambda c, k, j: "Skin", lambda p, k, j: {"hand" + sd: 1.0})


LEG_PROFILE = [(0.075, 0.041), (0.10, 0.045), (0.115, 0.047), (0.16, 0.046), (0.26, 0.051), (0.34, 0.056), (0.40, 0.056), (0.46, 0.054), (0.52, 0.058), (0.60, 0.066), (0.72, 0.076), (0.84, 0.084), (0.92, 0.088), (0.985, 0.080)]


def build_leg(G, P, side):
    N = 22
    zs = [0.075 + i * (0.985 - 0.075) / 46 for i in range(47)]
    rings = []
    for z in zs:
        r = curve(LEG_PROFILE, z) * P["leg"]
        r *= lerp(1.0, P["thigh_top"], sstep(0.55, 0.85, z))
        cx = side * curve([(0.075, 0.084), (0.46, 0.089), (0.90, HIP.x), (0.985, HIP.x - 0.004)], z)
        if P is FEM:
            cx = side * curve([(0.075, 0.082), (0.46, 0.086), (0.90, HIP.x + 0.006), (0.985, HIP.x + 0.002)], z)
        cy = curve([(0.075, 0.012), (0.30, 0.008), (0.46, -0.004), (0.7, -0.006), (0.985, 0.0)], z)
        ring = []
        for j in range(N):
            th = j / N * 2 * PI
            back = max(0.0, math.sin(th))
            ry = r * (1.02 + 0.06 * back * bump(z, 0.33, 0.08))  # calf under the trousers
            wr = 0.0012 * math.sin(z * 70 + th * 2) * bump(z, 0.46, 0.06)  # knee creases
            x = math.cos(th) * (r + wr)
            y = math.sin(th) * (ry + wr)
            ring.append(Vector((cx + x, cy + y, z)))
        rings.append(ring)
    sd = "_L" if side > 0 else "_R"

    def weight_of(p, k, j):
        z = p.z
        top = sstep(0.85, 0.96, z)
        knee = sstep(KNEE_Z - 0.05, KNEE_Z + 0.05, z)
        ank = sstep(ANKLE_Z - 0.02, ANKLE_Z + 0.04, z)
        thigh = knee * (1 - top)
        return norm_weights({"hips": top, "thigh" + sd: thigh, "shin" + sd: (1 - knee) * ank, "foot" + sd: 1 - ank})

    G.loft(rings, lambda c, k, j: "Bottom", weight_of)

    # sneaker
    shoe = [(0.060, 0.014, 0.050), (0.054, 0.034, 0.092), (0.038, 0.041, 0.108), (0.0, 0.045, 0.104), (-0.05, 0.047, 0.088), (-0.10, 0.050, 0.070), (-0.14, 0.049, 0.058), (-0.172, 0.044, 0.05), (-0.19, 0.033, 0.042), (-0.199, 0.014, 0.03)]
    toe = math.radians(5) * side
    cx = side * 0.084
    rot = Matrix.Rotation(toe, 3, "Z")
    rings = []
    N = 22
    for y, hw, top in shoe:
        ring = []
        for j in range(N):
            th = j / N * 2 * PI
            c, s = math.cos(th), math.sin(th)
            x = hw * spow(c, 2 / 2.6)
            zc = top * 0.5
            z = zc + top * 0.5 * spow(s, 2 / 2.4)
            z = max(z, 0.0)
            p = rot @ Vector((x, y, 0)) + Vector((cx, 0.012, z))
            ring.append(p)
        rings.append(ring)

    def shoe_mat(c, k, j):
        if c.z < 0.013:
            return "Sole"
        return "Shoes"

    def shoe_w(p, k, j):
        up = sstep(0.06, 0.10, p.z) * sstep(-0.04, 0.02, p.y) * 0.5
        return norm_weights({"foot" + sd: 1 - up, "shin" + sd: up})

    G.loft(rings, shoe_mat, shoe_w)


# ---------------------------------------------------------------- head and face

JAW = [(-1.0, 0.42), (-0.88, 0.63), (-0.62, 0.93), (-0.35, 0.97), (0.0, 1.0), (1.0, 1.0)]


def head_point(P, th, ph, off=0.0):
    """th: 0 = front, +pi/2 = the figure's left; ph: -pi/2 chin .. +pi/2 crown."""
    cu = math.cos(ph)
    u = cu * math.sin(th)
    w = cu * math.cos(th)
    v = math.sin(ph)
    jaw_pts = [(a, b if a != -0.62 else P["jaw"]) for a, b in JAW]
    fx = curve(jaw_pts, v)
    x = HX * spow(u, 0.88) * fx * P["head_w"]
    ry = HYF if w > 0 else HYB
    fy = curve([(-1.0, 0.86), (-0.7, 0.92), (-0.3, 0.97), (0.2, 1.0), (1.0, 1.0)], v) if w > 0 else curve([(-1.0, 0.7), (-0.4, 0.92), (0.0, 1.0), (1.0, 1.0)], v)
    y = -ry * spow(w, 0.82 if w > 0 else 0.95) * fy
    z = HZ * v
    front = sstep(0.35, 0.85, w)
    dx = dy = dz = 0.0
    dy -= P["chin"] * 0.011 * bump(v, -0.86, 0.12) * front * bump(u, 0, 0.32)
    dz -= 0.004 * bump(v, -0.9, 0.1) * front
    for sg in (-1, 1):
        dy += 0.0105 * bump(u, sg * 0.36, 0.17) * bump(v, 0.07, 0.11) * front
        dy -= P["cheek"] * 0.0045 * bump(u, sg * 0.56, 0.15) * bump(v, -0.12, 0.15) * front
        dx -= sg * 0.004 * bump(u, sg * 0.9, 0.12) * bump(v, 0.3, 0.2) * sstep(-0.2, 0.4, w)
        dx += sg * 0.003 * P["jaw"] * bump(v, -0.62, 0.1) * bump(abs(u), 0.8, 0.15)
    dy -= P["brow"] * 0.006 * bump(v, 0.27, 0.07) * front * (1 - min(1.0, u * u * 1.6))
    lw = bump(u, 0, 0.21)
    dy -= P["lips"] * (0.0050 * bump(v, -0.535, 0.032) + 0.0060 * bump(v, -0.612, 0.036)) * lw * front
    dy += 0.0022 * bump(v, -0.574, 0.011) * lw * front
    dy += 0.0022 * bump(v, -0.69, 0.035) * bump(u, 0, 0.25) * front
    p = Vector((HEAD_C.x + x + dx, HEAD_C.y + y + dy, HEAD_C.z + z + dz))
    if off:
        n = Vector((x / HX ** 2, y / ry ** 2, z / HZ ** 2))
        p += n.normalized() * off
    return p


def is_lips(th, ph):
    u = math.cos(ph) * math.sin(th)
    v = math.sin(ph)
    w = math.cos(ph) * math.cos(th)
    return w > 0.75 and -0.655 < v < -0.505 and abs(u) < 0.2 * (1 - 0.6 * abs(v + 0.575) / 0.08)


def build_head(G, P):
    N, R = 72, 60
    phs = [-PI / 2 + (i + 1) / (R + 1) * PI for i in range(R)]
    rings = []
    for ph in phs:
        rings.append([head_point(P, -PI + j / N * 2 * PI, ph) for j in range(N)])

    def mat_of(c, k, j):
        th = -PI + (j + 0.5) / N * 2 * PI
        ph = phs[min(k, R - 1)] + (PI / (R + 1)) * 0.5
        return "Skin"

    G.loft(rings, mat_of, lambda p, k, j: {"head": 1.0})

    # lips: an upper and a lower lip following the mouth's curve
    for vc, hgt, pro, bow in ((-0.538, 0.0050, 0.0030, 1.0), (-0.606, 0.0062, 0.0036, 0.0)):
        pts = []
        for i in range(13):
            t = i / 12
            u = lerp(-0.205, 0.205, t)
            v = vc + 0.012 * (u / 0.205) ** 2 * (1 if bow else -0.6) - bow * 0.006 * bump(u, 0, 0.035)
            ph = math.asin(v)
            th = math.asin(clamp(u / math.cos(ph), -0.99, 0.99))
            taper = math.sin(PI * t) ** 0.55
            pts.append((head_point(P, th, ph, -0.0008), taper))
        rings = []
        for i, (p, taper) in enumerate(pts):
            a = pts[max(0, i - 1)][0]
            b = pts[min(len(pts) - 1, i + 1)][0]
            T = (b - a).normalized()
            Nn = Vector((p.x * 0.35, p.y - HEAD_C.y, 0)).normalized()
            B = T.cross(Nn).normalized()
            hh = hgt * P["lips"] ** 0.5 * max(0.25, taper)
            pr = pro * P["lips"] * max(0.15, taper)
            rings.append([p + B * hh * math.cos(j / 10 * 2 * PI) + Nn * pr * max(0.0, math.sin(j / 10 * 2 * PI)) - Nn * 0.0015 * max(0.0, -math.sin(j / 10 * 2 * PI)) for j in range(10)])
        G.loft(rings, lambda c, k, j: "Lips", lambda p, k, j: {"head": 1.0})

    # nose
    nose = [(0.15, 0.0066, 0.001), (0.08, 0.0071, 0.0038), (0.0, 0.0078, 0.0072), (-0.10, 0.0088, 0.011), (-0.18, 0.0105, 0.0145), (-0.235, 0.0128, 0.0170), (-0.27, 0.0158, 0.0160), (-0.30, 0.0142, 0.0105), (-0.32, 0.0092, 0.004)]
    rings = []
    for v, hw, pr in nose:
        hw *= P["nose"]
        pr *= P["nose"]
        p0 = head_point(P, 0.0, math.asin(v))
        back = p0.y + 0.006
        ring = []
        for j in range(16):
            t = j / 16 * 2 * PI
            s = math.sin(t)
            x = hw * math.cos(t) * lerp(1.0, 0.78, max(0.0, -s))
            y = back - (pr + 0.006) / 2 + (pr + 0.006) / 2 * s
            ring.append(Vector((x, y, p0.z)))
        rings.append(ring)
    G.loft(rings, lambda c, k, j: "Skin", lambda p, k, j: {"head": 1.0})

    # ears
    for sg in (-1, 1):
        th = sg * (PI / 2 + 0.16)
        base = head_point(P, th, math.asin(-0.03))
        rot = Matrix.Rotation(-0.25 * sg, 3, "Z") @ Matrix.Rotation(-0.22, 3, "X")
        rings = []
        for i in range(10):
            a = -PI / 2 + (i + 1) / 11 * PI
            ring = []
            for j in range(14):
                b = j / 14 * 2 * PI
                ex = 0.0065 * math.cos(a) * math.cos(b)
                ey = 0.019 * math.cos(a) * math.sin(b) * (1.0 + 0.15 * math.sin(a))
                ez = 0.031 * math.sin(a)
                cup = -0.003 * math.cos(a) * max(0, math.cos(b))
                q = rot @ Vector((ex * sg + cup * sg, ey, ez))
                ring.append(base + Vector((sg * 0.006, 0.006, 0)) + q)
            if sg < 0:
                ring.reverse()
            rings.append(ring)
        G.loft(rings, lambda c, k, j: "Skin", lambda p, k, j: {"head": 1.0})

    # eyes, lids and brows
    ev = 0.07
    for sg in (-1, 1):
        th = sg * math.asin(min(0.99, 0.355 / math.cos(math.asin(ev))))
        surf = head_point(P, th, math.asin(ev))
        r = 0.0122
        E = Vector((sg * 0.0318, surf.y + 0.0048, surf.z))
        rings = []
        alphas = [0.12 + i * (PI - 0.24) / 15 for i in range(16)]
        for a in alphas:
            ring = []
            for j in range(16):
                b = j / 16 * 2 * PI
                ring.append(E + Vector((r * math.sin(a) * math.cos(b), -r * math.cos(a), r * math.sin(a) * math.sin(b))))
            rings.append(ring)

        def eye_mat(c, k, j, E=E, r=r):
            a = math.acos(clamp(-(c.y - E.y) / r, -1, 1))
            return "Pupil" if a < 0.24 else ("Iris" if a < 0.58 else "Eye")

        G.loft(rings, eye_mat, lambda p, k, j: {"head": 1.0})
        # lids: almond-shaped opening, the lid edges meet at the corners
        def lid_pt(az, el, rr=r * 1.07, E=E):
            return E + Vector((rr * math.sin(az) * math.cos(el), -rr * math.cos(az) * math.cos(el), rr * math.sin(el)))

        for upper in (True, False):
            rows = []
            for i in range(9):
                t = i / 8
                row = []
                for jj in range(13):
                    az = lerp(-1.35, 1.35, jj / 12)
                    open_ = math.cos(clamp(az * 1.12, -PI / 2, PI / 2)) ** 0.75
                    if upper:
                        edge = lerp(0.02, 0.40, open_) - 0.06 * az * sg
                        el = lerp(edge, 1.45, t)
                    else:
                        edge = -lerp(0.02, 0.50, open_)
                        el = lerp(edge, -1.4, t)
                    row.append(lid_pt(az, el))
                rows.append(row)
            G.loft(rows, lambda c, k, j: "Skin", lambda p, k, j: {"head": 1.0}, cap0=False, cap1=False, closed=False)
        # brow
        pts = []
        for i in range(9):
            t = i / 8
            u = lerp(0.12, 0.66, t)
            v = 0.255 + 0.05 * math.sin(PI * min(1.0, t * 1.2)) - 0.03 * t
            ph = math.asin(v)
            th2 = sg * math.asin(min(0.99, u / math.cos(ph)))
            pts.append((head_point(P, th2, ph, 0.0022), lerp(0.0048, 0.0018, t ** 1.5)))
        rings = []
        for i, (p, hw) in enumerate(pts):
            a = pts[max(0, i - 1)][0]
            b = pts[min(len(pts) - 1, i + 1)][0]
            T = (b - a).normalized()
            Nn = (p - HEAD_C).normalized()
            B = T.cross(Nn).normalized()
            ring = [p + B * hw * math.cos(j / 6 * 2 * PI) + Nn * 0.0016 * math.sin(j / 6 * 2 * PI) for j in range(6)]
            rings.append(ring)
        G.loft(rings, lambda c, k, j: "Brows", lambda p, k, j: {"head": 1.0})


# ---------------------------------------------------------------- hair

HAIRLINE = [(0.0, 0.70), (0.45, 0.66), (0.85, 0.42), (1.2, 0.26), (1.65, 0.22), (2.1, -0.12), (2.6, -0.40), (PI, -0.46)]


def hairline(th, P, drop=0.0):
    a = abs(th)
    v = curve(HAIRLINE, a) - 0.25 * bump(a, 1.33, 0.07) - drop
    return math.asin(clamp(v, -0.95, 0.95))


def cap(G, P, thick, noise=1.0, top=0.006, drop=0.0):
    N, R = 80, 18
    rings = []
    for i in range(R):
        ring = []
        for j in range(N):
            th = -PI + j / N * 2 * PI
            p0 = hairline(th, P, drop)
            t = i / (R - 1)
            ph = lerp(p0, PI / 2 - 0.02, t ** 1.15)
            v = math.sin(ph)
            taper = sstep(0.0, 0.22, t)
            strands = noise * (0.0016 * math.sin(th * 38 + ph * 9) + 0.0011 * math.sin(th * 73 - ph * 15))
            off = 0.0016 + (thick + top * sstep(0.55, 1.0, v) + strands) * taper
            ring.append(head_point(P, th, ph, off))
        rings.append(ring)
    G.loft(rings, lambda c, k, j: "Hair", lambda p, k, j: {"head": 1.0}, cap0=False, cap1=True)


def hair_short(P):
    G = Geo()
    cap(G, P, 0.011, top=0.011)
    return G


def hair_long(P):
    G = Geo()
    cap(G, P, 0.009, top=0.005, drop=0.02)
    N, R = 48, 22
    th0, th1 = 1.30, 2 * PI - 1.30
    z_top = HEAD_C.z + 0.03
    z_s = HEAD_C.z - 0.085
    rows = []
    for i in range(R):
        row = []
        for j in range(N):
            th = lerp(th0, th1, j / (N - 1))
            th_w = math.atan2(math.sin(th), math.cos(th))
            side = abs(math.sin(th))
            z_end = 1.405 + 0.07 * sstep(0.55, 0.97, side) + 0.012 * math.sin(th * 7)
            z = lerp(z_top, z_end, i / (R - 1))
            wave = 0.0018 * math.sin(th * 30) + 0.0012 * math.sin(th * 55 + z * 40)
            if z >= z_s:
                v = (z - HEAD_C.z) / HZ
                p = head_point(P, th_w, math.asin(clamp(v, -0.98, 0.98)), 0.011 + wave)
            else:
                ps = head_point(P, th_w, math.asin((z_s - HEAD_C.z) / HZ), 0.011 + wave)
                dz = z_s - z
                p = Vector((ps.x + math.sin(th) * 0.5 * dz, ps.y + max(0.0, -math.cos(th)) * 0.38 * dz, z))
                p.x += math.copysign(wave, p.x)
            row.append(p)
        rows.append(row)
    G.loft(rows, lambda c, k, j: "Hair", lambda p, k, j: {"head": 1.0}, cap0=False, cap1=False, closed=False)
    return G


def hair_bun(P):
    G = Geo()
    cap(G, P, 0.0045, noise=0.5, top=0.002)
    C = HEAD_C + Vector((0, 0.088, 0.072))
    rings = []
    for i in range(12):
        a = -PI / 2 + (i + 1) / 13 * PI
        ring = []
        for j in range(20):
            b = j / 20 * 2 * PI
            r = 0.037 * (1 + 0.07 * math.sin(6 * b + 4 * a))
            ring.append(C + Vector((r * math.cos(a) * math.cos(b), r * math.cos(a) * math.sin(b) * 0.85, r * math.sin(a) * 0.9)))
        rings.append(ring)
    G.loft(rings, lambda c, k, j: "Hair", lambda p, k, j: {"head": 1.0})
    return G


def ico_template():
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0)
    verts = [v.co.copy() for v in bm.verts]
    faces = [[v.index for v in f.verts] for f in bm.faces]
    bm.free()
    return verts, faces


def hair_curly(P):
    G = Geo()
    cap(G, P, 0.013, noise=0.4, top=0.004)
    tv, tf = ico_template()
    n = 170
    golden = PI * (3 - math.sqrt(5))
    for i in range(n):
        v = 1 - (i + 0.5) / n * 1.35
        if v < -0.5:
            continue
        ph = math.asin(clamp(v, -1, 1))
        th = math.atan2(math.sin(i * golden), math.cos(i * golden))
        if ph < hairline(th, P) + 0.05:
            continue
        r = 0.016 + 0.006 * ((i * 37) % 7) / 6
        c = head_point(P, th, ph, 0.016)
        base = len(G.verts)
        for p in tv:
            q = c + Vector((p.x * r, p.y * r, p.z * r * 0.9))
            G.vert(q, {"head": 1.0})
        for f in tf:
            G.faces.append(tuple(base + k for k in f))
            G.uvs.append([(0.5, 0.5)] * len(f))
            G.mats.append("Hair")
    return G


# ---------------------------------------------------------------- assembly

def build_body(P):
    G = Geo()
    build_torso(G, P)
    build_neck(G, P)
    for side in (-1, 1):
        build_arm(G, P, side)
        build_leg(G, P, side)
    build_head(G, P)
    return G


COLORS = {
    "Skin": ((0.80, 0.56, 0.42, 1), 0.5), "Lips": ((0.62, 0.32, 0.30, 1), 0.45), "Top": ((0.13, 0.27, 0.50, 1), 0.92),
    "Bottom": ((0.06, 0.07, 0.09, 1), 0.88), "Belt": ((0.10, 0.06, 0.04, 1), 0.5), "Buckle": ((0.75, 0.72, 0.65, 1), 0.3),
    "Shoes": ((0.85, 0.85, 0.83, 1), 0.7), "Sole": ((0.95, 0.94, 0.90, 1), 0.85), "Eye": ((0.93, 0.91, 0.88, 1), 0.2),
    "Iris": ((0.22, 0.13, 0.07, 1), 0.2), "Pupil": ((0.01, 0.01, 0.01, 1), 0.1), "Brows": ((0.12, 0.07, 0.04, 1), 0.9),
    "Hair": ((0.12, 0.07, 0.04, 1), 0.6),
}


def get_material(name):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    col, rough = COLORS[name]
    bsdf.inputs["Base Color"].default_value = col
    bsdf.inputs["Roughness"].default_value = rough
    if name == "Buckle":
        bsdf.inputs["Metallic"].default_value = 1.0
    return m


def make_object(name, G, arm_obj):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in G.verts], [], [tuple(f) for f in G.faces])
    me.validate(clean_customdata=False)
    slots = []
    for m in G.mats:
        if m not in slots:
            slots.append(m)
    for s in slots:
        me.materials.append(get_material(s))
    for poly, m in zip(me.polygons, G.mats):
        poly.material_index = slots.index(m)
    uv = me.uv_layers.new(name="UVMap")
    for poly, corners in zip(me.polygons, G.uvs):
        for li, c in zip(poly.loop_indices, corners):
            uv.data[li].uv = c
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    me.shade_smooth()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    groups = {}
    for i, w in enumerate(G.weights):
        for bone, val in w.items():
            if bone not in groups:
                groups[bone] = obj.vertex_groups.new(name=bone)
            groups[bone].add([i], val, "REPLACE")
    obj.parent = arm_obj
    mod = obj.modifiers.new("Armature", "ARMATURE")
    mod.object = arm_obj
    return obj


def build_armature():
    arm = bpy.data.armatures.new("SimRig")
    obj = bpy.data.objects.new("SimRig", arm)
    bpy.context.scene.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.edit_bones

    def bone(name, head, tail, parent=None):
        b = eb.new(name)
        b.head = head
        b.tail = tail
        b.roll = 0
        if parent:
            b.parent = eb[parent]
            b.use_connect = False
        return b

    bone("hips", (0, 0, HIP.z), (0, 0, 1.04))
    bone("spine", (0, 0, 1.04), (0, 0, 1.22), "hips")
    bone("chest", (0, 0, 1.22), (0, 0, 1.44), "spine")
    bone("neck", (0, 0.002, 1.46), (0, -0.01, 1.57), "chest")
    bone("head", (0, -0.01, 1.57), (0, -0.01, 1.78), "neck")
    for side, sd in ((1, "_L"), (-1, "_R")):
        hip = Vector((side * HIP.x, 0, HIP.z))
        knee = Vector((side * 0.089, -0.004, KNEE_Z))
        ankle = Vector((side * 0.084, 0.01, ANKLE_Z))
        toe = Vector((side * 0.09, -0.13, 0.03))
        bone("thigh" + sd, hip, knee, "hips")
        bone("shin" + sd, knee, ankle, "thigh" + sd)
        bone("foot" + sd, ankle, toe, "shin" + sd)
        S = Vector((side * SHOULDER.x, SHOULDER.y, SHOULDER.z))
        d = arm_dir(side)
        E = S + d * UPPER
        W = E + d * FORE
        bone("upperarm" + sd, S, E, "chest")
        bone("forearm" + sd, E, W, "upperarm" + sd)
        bone("hand" + sd, W, W + d * HAND, "forearm" + sd)
    bpy.ops.object.mode_set(mode="OBJECT")
    return obj


def add_shape(obj, name, G):
    key = obj.shape_key_add(name=name, from_mix=False)
    for i, v in enumerate(G.verts):
        key.data[i].co = v


def preview(prefix, objs):
    scn = bpy.context.scene
    scn.render.engine = "CYCLES"
    scn.cycles.samples = 48
    scn.cycles.device = "CPU"
    scn.render.resolution_x = 640
    scn.render.resolution_y = 900
    scn.render.film_transparent = False
    world = bpy.data.worlds.new("W")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.62, 0.72, 0.82, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.8
    scn.world = world
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(50), 0, math.radians(-30))
    scn.collection.objects.link(sun)
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    cam.data.lens = 85
    scn.collection.objects.link(cam)
    scn.camera = cam
    shots = {"front": (0, -6.2, 1.0), "side": (6.2, 0, 1.0), "three": (3.6, -4.8, 1.6), "face": (0.35, -1.25, 1.68)}
    for tag, pos in shots.items():
        cam.location = pos
        target = Vector((0, 0, 1.66 if tag == "face" else 0.9))
        cam.data.lens = 85 if tag != "face" else 70
        d = target - Vector(pos)
        cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        scn.render.filepath = f"{prefix}-{tag}.png"
        bpy.ops.render.render(write_still=True)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    arm_obj = build_armature()
    base = build_body(BASE)
    body = make_object("Body", base, arm_obj)
    body.shape_key_add(name="Basis", from_mix=False)
    for name, P in (("Feminine", FEM), ("Slim", SLIM), ("Broad", BROAD)):
        G = build_body(P)
        assert len(G.verts) == len(base.verts), name
        add_shape(body, name, G)
    hairs = []
    for name, fn in (("Hair_short", hair_short), ("Hair_long", hair_long), ("Hair_bun", hair_bun), ("Hair_curly", hair_curly)):
        hairs.append(make_object(name, fn(BASE), arm_obj))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=OUT, use_selection=True, export_format="GLB", export_skins=True, export_morph=True,
                              export_morph_normal=True, export_animations=False, export_yup=True, export_apply=False,
                              export_texcoords=True, export_normals=True, export_materials="EXPORT", export_extras=False)
    tris = sum(len(p.vertices) - 2 for p in body.data.polygons)
    print("sim body", len(body.data.vertices), "verts", tris, "tris;", [(h.name, len(h.data.vertices)) for h in hairs], OUT)
    prefix = os.environ.get("HOOD_PREVIEW")
    if prefix:
        for h in hairs[1:]:
            h.hide_render = True
        preview(prefix, [body] + hairs)
        for sk, tag in (("Feminine", "fem"),):
            body.data.shape_keys.key_blocks[sk].value = 1.0
            hairs[0].hide_render = True
            hairs[1].hide_render = False
            scn = bpy.context.scene
            for shot, pos in {"front": (0, -6.2, 1.0), "three": (3.6, -4.8, 1.6), "face": (0.35, -1.25, 1.68)}.items():
                cam = scn.camera
                cam.location = pos
                target = Vector((0, 0, 1.66 if shot == "face" else 0.9))
                cam.data.lens = 85 if shot != "face" else 70
                cam.rotation_euler = (target - Vector(pos)).to_track_quat("-Z", "Y").to_euler()
                scn.render.filepath = f"{prefix}-{tag}-{shot}.png"
                bpy.ops.render.render(write_still=True)


main()
