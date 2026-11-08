"""Sandlot Sluggers (2D) close-up batter sprites, posed and rendered in Blender.

Run headless:  blender -b -P modules-src/sandlot/tools/build-batter.py -- [kid ids...]

Uses the kid figures from build-kids.py and poses them with the same maths as drawBatter3D in index.html (SWING3, BUNT3,
swingFrame, ik2, stances), seen through a perspective camera that reproduces projB (catcher's view, 960 x 600, focal 600 px,
eye at y 3.6 ft, 7 ft behind the plate) with the batter at x = -2.45 (right-handed) or 2.45 (left-handed), z = 0.6.
Every frame is rendered full-frame, trimmed to its pixels and shelf-packed into public/modules/sprites/kids/bat-<id>.webp;
public/modules/sprites/kids/batters.json lists, per kid and side, each frame's swing phase k (null in the stance), contact
height cy, bunt flag, layer (a = batter, h = white batting helmet for hatless hitters, tinted in the game), atlas rect,
canvas position and bat tip, so the game draws the nearest frame exactly where drawBatter3D would.
"""
import importlib.util
import json
import math
import os
import sys
import tempfile

import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("build_kids", os.path.join(HERE, "build-kids.py"))
bk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bk)

OUT_DIR = bk.OUT_DIR
W, H_PX = 960, 600
CAM_Z, CAM_Y, CAM_F, CAM_H0 = -7.0, 3.6, 600.0, 238.0
BAT_X, BAT_Z = 2.45, 0.6
ATLAS_W = 2048
DEG = math.pi / 180

SWING3 = [
    (0.00, -8, -4, (0.18, 0.78, -0.45), (-0.3, 0.7, -0.65), 0.3, 0),
    (0.20, -18, -12, (0.08, 0.8, -0.62), (-0.35, 0.82, -0.45), 0.32, 0.5),
    (0.38, 22, 50, (0.45, 0.64, -0.35), (-0.18, 0.32, -0.93), 0.28, 1),
    (0.50, 72, 88, (0.85, "C", -0.05), (0.97, 0.02, -0.1), 0.24, 1),
    (0.62, 100, 100, (0.8, "C+", 0.45), (0.35, 0.14, 0.93), 0.18, 1),
    (0.80, 122, 106, (0.3, 0.76, 0.5), (-0.55, 0.72, 0.42), 0.08, 1),
    (1.00, 128, 106, (-0.05, 0.8, 0.35), (-0.62, 0.42, -0.66), 0.04, 1),
]
BUNT3 = (62, 40, (0.95, 0.6, 0.15), (0.98, 0.1, 0.05), 0.32, 0.4)
K_FIXED = (0.0, 0.1, 0.2, 0.29, 0.38, 0.8, 0.9, 1.0)
K_CONTACT = (0.44, 0.5, 0.56, 0.62, 0.71)
CY_LEVELS = (1.1, 1.7, 2.3, 2.9)


def V(x, y, z):
    return Vector((x, y, z))


def lerp(a, b, t):
    return a + (b - a) * t


def clamp(v, a, b):
    return max(a, min(b, v))


def to_frame(f, H, cy):
    def res(v, i):
        if v == "C":
            return cy
        if v == "C+":
            return cy + .35
        return v * H if i == 1 else v
    return {"yaw": f[1], "hip": f[2], "hand": [res(v, i) for i, v in enumerate(f[3])], "bat": V(*f[4]).normalized(), "lean": f[5], "stride": f[6]}


def swing_frame(k, H, cy):
    if k is None:
        return to_frame(SWING3[0], H, cy)
    k = clamp(k, 0, 1)
    for n in range(len(SWING3) - 1):
        a, b = SWING3[n], SWING3[n + 1]
        if a[0] <= k <= b[0]:
            u = (k - a[0]) / (b[0] - a[0])
            e = u * u * (3 - 2 * u)
            A, B = to_frame(a, H, cy), to_frame(b, H, cy)
            return {"yaw": lerp(A["yaw"], B["yaw"], e), "hip": lerp(A["hip"], B["hip"], e), "hand": [lerp(x, y, e) for x, y in zip(A["hand"], B["hand"])],
                    "bat": A["bat"].lerp(B["bat"], e).normalized(), "lean": lerp(A["lean"], B["lean"], e), "stride": lerp(A["stride"], B["stride"], e)}
    return to_frame(SWING3[-1], H, cy)


def ik2(S, Hd, a, b, pole):
    d = Hd - S
    dist = d.length
    direc = d.normalized()
    dist = min(dist, (a + b) * .999)
    cos_a = clamp((a * a + dist * dist - b * b) / (2 * a * dist), -1, 1)
    sin_a = math.sqrt(1 - cos_a * cos_a)
    pv = pole - S
    perp = (pv - direc * pv.dot(direc)).normalized()
    elbow = S + direc * (a * cos_a) + perp * (a * sin_a)
    return elbow, S + direc * dist


def batter_pose(kid, side, k, cy, bunt):
    """Points in the game's batting space (x right, y up, z toward the pitcher), exactly as drawBatter3D places them."""
    d = bk.body_dims(kid)
    H, kk = d["H"], d["H"] / 4.4
    stance = kid.get("stance")
    crouch = .16 if stance == "crouched" else -.04 if stance == "upright" else .05
    if bunt:
        f = {"yaw": BUNT3[0], "hip": BUNT3[1], "hand": [BUNT3[2][0], BUNT3[2][1] * H, BUNT3[2][2]], "bat": V(*BUNT3[3]).normalized(), "lean": BUNT3[4], "stride": BUNT3[5]}
    else:
        f = swing_frame(k, H, cy)
    if k is None and not bunt:
        if stance == "open":
            f["yaw"] -= 6
        if stance == "closed":
            f["yaw"] += 4
    yaw, hip_yaw = f["yaw"] * DEG, f["hip"] * DEG
    fw = lambda a: V(math.cos(a), 0, math.sin(a))
    sx = lambda a: V(-math.sin(a), 0, math.cos(a))
    UP = V(0, 1, 0)
    lift = math.sin((k - .12) / .24 * math.pi) * .22 * kk if k is not None and .12 < k < .36 else 0
    open_x = -.18 if stance == "open" else .12 if stance == "closed" else 0
    back_foot, front_foot = V(-.04, .05, -.72 * kk), V(open_x, .05 + lift, (.5 + f["stride"] * .32) * kk)
    hip_h = d["hip"] * (1 - crouch * .6) - .08 * kk
    hip_c = V(-.16 * kk - crouch * .25, hip_h, lerp(back_foot.z, front_foot.z, .42))
    pw = d["sw"] * .6
    hip_f, hip_r = hip_c + sx(hip_yaw) * pw, hip_c - sx(hip_yaw) * pw
    leg_a, leg_b = d["hip"] * .52, d["hip"] * .53
    knee_pole = lambda p: p + V(1.2, -.3, .2)
    kb, ab = ik2(hip_r, back_foot, leg_a, leg_b, knee_pole(hip_r))
    kf, af = ik2(hip_f, front_foot, leg_a, leg_b, knee_pole(hip_f))
    torso_len = (H - d["headR"] * 2 - .06) - d["hip"]
    lean = f["lean"] + crouch * .4
    sc = hip_c + UP * (torso_len * math.cos(lean)) + fw(yaw) * (torso_len * math.sin(lean))
    sw = d["sw"] * .9
    sh_f, sh_r = sc + sx(yaw) * sw, sc - sx(yaw) * sw
    head = sc + UP * (.06 + d["headR"] * .95) + fw(yaw) * .06 + V(0, 0, .05)
    hand = V(f["hand"][0] * kk, f["hand"][1], f["hand"][2] * kk)
    bat_dir, bat_len = f["bat"].normalized(), 2.35 * kk
    top_hand = hand + bat_dir * (.75 * kk if bunt else .2 * kk)
    knob, tip = hand - bat_dir * (.1 * kk), hand + bat_dir * bat_len
    arm_a, arm_b = d["armLen"], d["armLen"] * .95
    ef, hf = ik2(sh_f, hand, arm_a, arm_b, sh_f + V(.35, -1, -.1))
    er, hr = ik2(sh_r, top_hand, arm_a, arm_b, sh_r + V(-.2, -.6, -.8) + UP * (.55 if k is None or k < .3 else 0))
    return {"yaw": yaw, "hipYaw": hip_yaw, "hipC": hip_c, "sc": sc, "head": head, "legs": {"f": (hip_f, kf, af), "r": (hip_r, kb, ab)},
            "arms": {"f": (sh_f, ef, hf), "r": (sh_r, er, hr)}, "feet": {"f": (front_foot, .25), "r": (back_foot, hip_yaw * .9)},
            "knob": knob, "tip": tip, "mid": knob.lerp(tip, .55), "batR": .16 * kk}


def world(p, dirx):
    """Game batting space (local to the batter, mirrored by side) to Blender: x right, y away from the camera, z up."""
    return Vector((-BAT_X * dirx + dirx * p.x, BAT_Z + p.z, p.y))


def world_dir(v, dirx):
    return Vector((dirx * v.x, v.z, v.y))


def limb_matrix(a, b):
    z = (a - b).normalized()
    ref = Vector((0, 1, 0)) if abs(z.y) < .9 else Vector((1, 0, 0))
    x = ref.cross(z).normalized()
    y = z.cross(x)
    m = Matrix((x, y, z)).transposed().to_4x4()
    m.translation = a
    return m


def facing_matrix(loc, toe):
    toe = Vector((toe.x, toe.y, 0)).normalized()
    m = Matrix.Rotation(math.atan2(toe.x, -toe.y), 4, "Z")
    m.translation = loc
    return m


class Batter:
    def __init__(self, scn, kid, helmet):
        self.kid = kid
        self.k = bk.Kid(scn, kid, glove=False, helmet=helmet, props=False)
        f = self.k.fig
        gloves = self.k.F.get("gloves") or "#f4f4f4"
        for ob in f.parts:
            if ob.type == "MESH" and ob.name.startswith("hand"):
                ob.data.materials[0] = bk.toon(gloves)
        for piv in list(self.k.shoulders.values()) + list(self.k.elbows.values()) + list(self.k.hands.values()) + \
                list(self.k.hips.values()) + list(self.k.knees.values()) + [self.k.head_pivot]:
            piv.parent = None
        self.feet = {s: next(o for o in f.parts if o.type == "EMPTY" and o.name.startswith("foot%d" % s)) for s in (-1, 1)}
        for ft in self.feet.values():
            ft.parent = None
        self.bat = self.build_bat(f)
        self.back_text(f, scn)

    def build_bat(self, f):
        pts = [(0, .055), (.05, .07), (.12, .045), (.5, .05), (.95, .1), (1.3, .155), (1.55, .16), (1.62, .12), (1.64, 0)]
        import bmesh
        bm = bmesh.new()
        n = 16
        rings = []
        for z, r in pts:
            rings.append([bm.verts.new((r * math.cos(2 * math.pi * j / n), r * math.sin(2 * math.pi * j / n), -z)) for j in range(n)])
        for a, b in zip(rings, rings[1:]):
            for j in range(n):
                bm.faces.new((a[j], a[(j + 1) % n], b[(j + 1) % n], b[j]))
        bm.faces.new(list(reversed(rings[0])))
        piv = f.pivot("bat")
        f.add(bm, bk.toon("#d9a066", "gloss"), piv, name="bat")
        self.bat_len = pts[-1][0]
        return piv

    def back_text(self, f, scn):
        k, L, F = self.k, self.k.L, self.k.F
        top = F.get("top")
        torso_col = F.get("coat") if top == "ragcoat" else F.get("mail") if top == "tabard" else L["shirt"]
        lum = sum(c * w for c, w in zip(bk.rgb(torso_col or "#808080"), (.2126, .7152, .0722)))
        ink = (F.get("stripe") or L["trim"]) if lum > .55 else "#ffffff"
        dep = k.tw * .62
        for text, size, dz in ((str(self.kid["number"]), k.th * .42, -.05), (self.kid["nick"].upper(), k.th * .12, .3)):
            for col, grow, off in ((bk.OUTLINE_HEX, 1.08, .012), (ink, 1.0, .02)):
                cu = bpy.data.curves.new("backtext", "FONT")
                cu.body = text
                cu.size = size * grow
                cu.align_x, cu.align_y = "CENTER", "CENTER"
                cu.extrude = .004
                ob = bpy.data.objects.new("backtext", cu)
                scn.collection.objects.link(ob)
                ob.parent = k.root
                ob.location = (0, dep / 2 + off, self.k.shY + .04 - k.th * .45 + dz * k.th)
                ob.rotation_euler = (math.pi / 2, 0, math.pi)
                ob.data.materials.append(bk.toon(col))
                f.parts.append(ob)
                f.layers.setdefault("body", []).append(ob)

    def pose(self, P, dirx):
        k = self.k
        hip_c, sc = world(P["hipC"], dirx), world(P["sc"], dirx)
        up = (sc - hip_c).normalized()
        fw = world_dir(Vector((math.cos(P["yaw"]), 0, math.sin(P["yaw"]))), dirx)
        fwd = (fw - up * fw.dot(up)).normalized()
        y_axis = -fwd
        x_axis = y_axis.cross(up).normalized()
        m = Matrix((x_axis, y_axis, up)).transposed().to_4x4()
        m.translation = hip_c - up * k.d["hip"]
        k.root.matrix_world = m
        front = int(dirx)
        sides = {"f": front, "r": -front}
        for key, (a, b, c) in P["arms"].items():
            s = sides[key]
            A, B, C = world(a, dirx), world(b, dirx), world(c, dirx)
            k.shoulders[s].matrix_world = limb_matrix(A, B)
            k.elbows[s].matrix_world = limb_matrix(B, C)
            k.hands[s].matrix_world = Matrix.Translation(C)
        for key, (a, b, c) in P["legs"].items():
            s = sides[key]
            A, B, C = world(a, dirx), world(b, dirx), world(c, dirx)
            k.hips[s].matrix_world = limb_matrix(A, B)
            k.knees[s].matrix_world = limb_matrix(B, C)
            foot, ang = P["feet"][key]
            toe = world_dir(Vector((math.cos(ang), 0, math.sin(ang))), dirx)
            self.feet[s].matrix_world = facing_matrix(C, toe)
        k.head_pivot.matrix_world = facing_matrix(world(P["head"], dirx), fw)
        knob, tip = world(P["knob"], dirx), world(P["tip"], dirx)
        bm = limb_matrix(knob, tip)
        scale = (tip - knob).length / self.bat_len
        self.bat.matrix_world = bm @ Matrix.Diagonal((1.25 * P["batR"] / .16, 1.25 * P["batR"] / .16, scale, 1))


def setup_scene():
    scn = bk.setup_scene()
    scn.render.resolution_x, scn.render.resolution_y = W, H_PX
    cam = scn.camera
    cam.data.type = "PERSP"
    cam.data.sensor_fit = "HORIZONTAL"
    cam.data.sensor_width = 36
    cam.data.lens = CAM_F / W * 36
    cam.data.shift_x = 0
    cam.data.shift_y = (CAM_H0 - H_PX / 2) / W
    cam.data.clip_start = .1
    cam.location = (0, CAM_Z, CAM_Y)
    cam.rotation_euler = (math.pi / 2, 0, 0)
    sun = bpy.data.objects.get("kids_sun")
    if sun:
        sun.rotation_euler = (math.radians(55), math.radians(30), math.radians(160))
    return scn


def project(p):
    s = CAM_F / max(.6, p.y - CAM_Z)
    return (round(W / 2 + p.x * s, 1), round(CAM_H0 - (p.z - CAM_Y) * s, 1))


def render_full(scn, tmp):
    path = os.path.join(tmp, "batter.png")
    scn.render.filepath = path
    scn.render.image_settings.file_format = "PNG"
    scn.render.image_settings.color_mode = "RGBA"
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(path, check_existing=False)
    px = np.array(img.pixels[:], dtype=np.float32).reshape(H_PX, W, 4)[::-1]
    bpy.data.images.remove(img)
    return px


def trim(px):
    a = px[:, :, 3] > .004
    if not a.any():
        return None
    ys, xs = np.where(a.any(1))[0], np.where(a.any(0))[0]
    y0, y1, x0, x1 = ys[0], ys[-1] + 1, xs[0], xs[-1] + 1
    return px[y0:y1, x0:x1], int(x0), int(y0)


def pack(cells):
    """Shelf packing, tallest first; returns the atlas (top-down rows) and each cell's [x, y, w, h]."""
    order = sorted(range(len(cells)), key=lambda i: -cells[i].shape[0])
    rects, x, y, shelf = [None] * len(cells), 0, 0, 0
    for i in order:
        h, w = cells[i].shape[:2]
        if x + w > ATLAS_W:
            x, y, shelf = 0, y + shelf, 0
        rects[i] = [x, y, w, h]
        x += w
        shelf = max(shelf, h)
    atlas = np.zeros((y + shelf, ATLAS_W, 4), dtype=np.float32)
    for i, (x, y, w, h) in enumerate(rects):
        atlas[y:y + h, x:x + w] = cells[i]
    return atlas, rects


def frames(kid):
    H = kid["height"]
    cys = sorted(set(round(clamp(c, .9, H * .75), 2) for c in CY_LEVELS))
    out = [(None, round(H * .48, 2), False), (None, round(H * .48, 2), True)]
    for k in K_FIXED:
        out.append((k, round(H * .48, 2), False))
    for k in K_CONTACT:
        for cy in cys:
            out.append((k, cy, False))
    return out


def build_kid(scn, kid, tmp):
    F = kid["look"].get("fit") or {}
    hatless = not F.get("hat") or F.get("hat") == "goggles"
    sides = ["R", "L"] if kid["bats"] == "S" else [kid["bats"]]
    cells, meta = [], []
    for layer in (("a", "h") if hatless else ("a",)):
        for o in list(scn.collection.all_objects):
            if o.type not in ("CAMERA", "LIGHT"):
                bpy.data.objects.remove(o, do_unlink=True)
        b = Batter(scn, kid, helmet=hatless)
        helm = b.k.fig.layers.get("helmet", [])
        if layer == "a":
            for ob in helm:
                ob.hide_render = True
        else:
            for ob in b.k.fig.parts:
                if ob.type in ("MESH", "FONT") and ob not in helm:
                    ob.is_holdout = True
        for side in sides:
            dirx = 1 if side == "R" else -1
            for k, cy, bunt in frames(kid):
                P = batter_pose(kid, side, k, cy, bunt)
                b.pose(P, dirx)
                bpy.context.view_layer.update()
                t = trim(render_full(scn, tmp))
                if t is None:
                    continue
                px, x0, y0 = t
                cells.append(px)
                meta.append({"layer": layer, "side": side, "k": k, "cy": cy, "bunt": bunt, "at": [x0, y0],
                             "tip": project(world(P["tip"], dirx)), "mid": project(world(P["mid"], dirx))})
    atlas, rects = pack(cells)
    for m, r in zip(meta, rects):
        m["rect"] = r
    return atlas, meta


def save_webp(scn, atlas, path):
    h, w = atlas.shape[:2]
    img = bpy.data.images.new("batter_atlas", w, h, alpha=True)
    img.pixels.foreach_set(atlas[::-1].ravel())
    s = scn.render.image_settings
    s.file_format = "WEBP"
    s.color_mode = "RGBA"
    s.quality = 88
    img.save_render(path, scene=scn)
    bpy.data.images.remove(img)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    only = set(int(x) for x in (argv or os.environ.get("SANDLOT_KIDS", "").replace(",", " ").split()) if str(x).isdigit())
    kids = [k for k in bk.roster() if not only or k["id"] in only]
    scn = setup_scene()
    os.makedirs(OUT_DIR, exist_ok=True)
    index_path = os.path.join(OUT_DIR, "batters.json")
    index = json.load(open(index_path)) if os.path.exists(index_path) else {}
    index.update({"version": 1, "batX": BAT_X, "batZ": BAT_Z})
    index.setdefault("kids", {})
    with tempfile.TemporaryDirectory() as tmp:
        for kid in kids:
            atlas, meta = build_kid(scn, kid, tmp)
            save_webp(scn, atlas, os.path.join(OUT_DIR, "bat-%d.webp" % kid["id"]))
            index["kids"][str(kid["id"])] = {"frames": meta}
            print("batter", kid["id"], kid["nick"], len(meta), "frames", atlas.shape[1], "x", atlas.shape[0])
    with open(index_path, "w") as f:
        json.dump(index, f, separators=(",", ":"))


if __name__ == "__main__":
    main()
