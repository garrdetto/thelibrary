"""Sandlot Sluggers 3D draft characters, fitted to the game's skeleton in Blender.

Run: blender -b --factory-startup -P modules-src/sandlot3d/tools/build-toons.py -- <meshyDir> [previewDir] [ids]

<meshyDir> holds the Meshy image-to-3D exports pNN.glb (A-pose, made from the draft card art in
public/modules/sprites/pNN.webp). For each one this script:
  1. converts it to rig space (+x the player's left, +y up, +z forward, feet on y = 0),
  2. finds hips, knees, ankles, shoulders, elbows, wrists and the neck from the front silhouette,
  3. skins it to bones placed on those joints (Blender's automatic weights),
  4. moves every bone onto the athlete skeleton (assets-src/models/sandlot3d/athlete.glb), stretching
     limbs to the game's arm and leg lengths so the IK poses land, keeping the head, hands and feet whole,
  5. binds the refitted mesh to the athlete bones plus head, hand_L/R and foot_L/R and writes
     assets-src/models/sandlot3d/toons/pNN.glb (one material, base colour at 1024 px).
Then `pnpm assets` optimizes them into public/models/sandlot3d/toons/.
Every bone carries its rest frame in `frame` (origin, along, front) like the athlete's.
"""
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.kdtree import KDTree

REPO = os.environ.get("SANDLOT_REPO") or os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
ATHLETE = os.path.join(REPO, "assets-src", "models", "sandlot3d", "athlete.glb")
OUT_DIR = os.path.join(REPO, "assets-src", "models", "sandlot3d", "toons")

LA = (.74, .68)
LL = (.92, .9)
NECK_Y = 3.34
HEAD_O = Vector((0, NECK_Y + .42, 0))
HEAD_SCALE = .8
HAND_SCALE = .92
TEX = 1024
SOLE_TO_ANKLE = .19

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
SRC = argv[0] if argv else os.path.join(REPO, ".meshy-cache", "sandlot-toons")
PREVIEW = argv[1] if len(argv) > 1 and argv[1] else None
IDS = [int(x) for x in argv[2].split(",")] if len(argv) > 2 and argv[2] else list(range(34))


def to_bl(p):
    return Vector((p[0], -p[2], p[1]))


def from_bl(p):
    return Vector((p[0], p[2], -p[1]))


def frame_matrix(o, t, n, sx=1.0, sy=1.0, sz=1.0):
    x = t.cross(n)
    return Matrix(((x.x * sx, t.x * sy, n.x * sz, o.x),
                   (x.y * sx, t.y * sy, n.y * sz, o.y),
                   (x.z * sx, t.z * sy, n.z * sz, o.z),
                   (0, 0, 0, 1)))


def perp(front, t):
    n = front - t * front.dot(t)
    if n.length < 1e-6:
        n = Vector((0, 0, 1)) - t * t.z
    return n.normalized()


def clear_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials, bpy.data.images, bpy.data.textures):
        for d in list(coll):
            coll.remove(d)


def limb_frame(origin, along, front):
    t = along.normalized()
    return origin, t, (front - t * front.dot(t)).normalized()


def athlete_frames():
    """The athlete skeleton (build-athlete.py build_limbs), in the same order."""
    hip_y, chest_y = 1.9, 2.0
    frames = {}
    for side, sg in (("L", 1), ("R", -1)):
        A, t, N = limb_frame(Vector((sg * .45, chest_y + 1.15, 0)), Vector((sg * .2, -1, .05)), -Vector((sg * .7, -1, -.7)).normalized())
        frames["upperarm_" + side] = (A, t, N, LA[0])
        frames["forearm_" + side] = (A + t * LA[0], t, N, LA[1])
        A, t, N = limb_frame(Vector((sg * .25, hip_y - .12, 0)), Vector((sg * .03, -1, 0)), Vector((0, .2, 1)).normalized())
        frames["thigh_" + side] = (A, t, N, LL[0])
        frames["shin_" + side] = (A + t * LL[0], t, N, LL[1])
    up, fwd = Vector((0, 1, 0)), Vector((0, 0, 1))
    frames["hips"] = (Vector((0, hip_y, 0)), up, fwd, .3)
    frames["chest"] = (Vector((0, chest_y, 0)), up, fwd, .5)
    frames["neck"] = (Vector((0, NECK_Y, 0)), up, fwd, .3)
    frames["head"] = (HEAD_O.copy(), up, fwd, .3)
    for side in ("L", "R"):
        o, t, n, ln = frames["forearm_" + side]
        frames["hand_" + side] = (o + t * LA[1], t.copy(), n.copy(), .2)
        o, t, n, ln = frames["thigh_" + side]
        frames["foot_" + side] = (o + t * (LL[0] + LL[1]), up, fwd, .2)
    return frames


def import_character(path):
    clear_scene()
    bpy.ops.import_scene.gltf(filepath=path)
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    for o in bpy.data.objects:
        o.select_set(o in meshes)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.parent = None
    obj.matrix_world = obj.matrix_world.copy()
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for o in list(bpy.data.objects):
        if o is not obj:
            bpy.data.objects.remove(o, do_unlink=True)
    me = obj.data
    for v in me.vertices:
        v.co = from_bl(v.co)
    co = np.array([v.co[:] for v in me.vertices])
    lo, hi = co.min(0), co.max(0)
    shift = Vector((-(lo[0] + hi[0]) / 2, -lo[1], -(lo[2] + hi[2]) / 2))
    for v in me.vertices:
        v.co += shift
    return obj


def drop_strays(obj):
    """Loose pieces lying on the ground away from the feet (a cap set down beside the character)."""
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    H = max(v.co.y for v in bm.verts)
    seen, islands = set(), []
    for v in bm.verts:
        if v.index in seen:
            continue
        isl, stack = [], [v]
        seen.add(v.index)
        while stack:
            a = stack.pop()
            isl.append(a)
            for e in a.link_edges:
                b = e.other_vert(a)
                if b.index not in seen:
                    seen.add(b.index)
                    stack.append(b)
        islands.append(isl)
    owner = {}
    for k, isl in enumerate(islands):
        for a in isl:
            owner[a.index] = k
    kd = KDTree(len(bm.verts))
    for a in bm.verts:
        kd.insert(a.co, a.index)
    kd.balance()
    low = {k for k, isl in enumerate(islands) if max(a.co.y for a in isl) < .13 * H and len(isl) < .05 * len(bm.verts)}
    parent = {k: k for k in low}

    def root(k):
        while parent[k] != k:
            k = parent[k]
        return k
    anchored = set()
    for k in low:
        for a in islands[k]:
            for (_, j, d) in kd.find_range(a.co, .008 * H):
                o = owner[j]
                if o == k:
                    continue
                if o in low:
                    parent[root(o)] = root(k)
                else:
                    anchored.add(k)
    anchored = {root(k) for k in anchored}
    kill = [a for k in low if root(k) not in anchored for a in islands[k]]
    if kill:
        bmesh.ops.delete(bm, geom=kill, context="VERTS")
        bm.to_mesh(me)
    bm.free()
    co = np.array([v.co[:] for v in me.vertices])
    lo, hi = co.min(0), co.max(0)
    shift = Vector((-(lo[0] + hi[0]) / 2, -lo[1], 0))
    for v in me.vertices:
        v.co += shift
    return len(kill)


def silhouette(obj, rows=320):
    me = obj.data
    co = np.array([v.co[:] for v in me.vertices])
    H = co[:, 1].max()
    cell = H / rows
    xmin = co[:, 0].min()
    cols = int(math.ceil((co[:, 0].max() - xmin) / cell)) + 2
    img = np.zeros((rows + 2, cols), dtype=bool)
    me.calc_loop_triangles()
    tris = np.array([t.vertices[:] for t in me.loop_triangles])
    P = np.stack([(co[:, 0] - xmin) / cell, co[:, 1] / cell], 1)
    for a, b, c in tris:
        pa, pb, pc = P[a], P[b], P[c]
        x0, x1 = int(min(pa[0], pb[0], pc[0])), int(max(pa[0], pb[0], pc[0])) + 1
        y0, y1 = int(min(pa[1], pb[1], pc[1])), int(max(pa[1], pb[1], pc[1])) + 1
        gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + .5, np.arange(y0, y1 + 1) + .5)
        d = (pb[1] - pc[1]) * (pa[0] - pc[0]) + (pc[0] - pb[0]) * (pa[1] - pc[1])
        if abs(d) < 1e-9:
            img[min(int(pa[1]), rows + 1), min(int(pa[0]), cols - 1)] = True
            continue
        l1 = ((pb[1] - pc[1]) * (gx - pc[0]) + (pc[0] - pb[0]) * (gy - pc[1])) / d
        l2 = ((pc[1] - pa[1]) * (gx - pc[0]) + (pa[0] - pc[0]) * (gy - pc[1])) / d
        inside = (l1 >= -.02) & (l2 >= -.02) & (1 - l1 - l2 >= -.02)
        ys, xs = np.nonzero(inside)
        img[np.clip(ys + y0, 0, rows + 1), np.clip(xs + x0, 0, cols - 1)] = True
    return img, cell, xmin, H, co


def runs(row):
    out, start = [], None
    for i, v in enumerate(row):
        if v and start is None:
            start = i
        if not v and start is not None:
            out.append([start, i - 1])
            start = None
    if start is not None:
        out.append([start, len(row) - 1])
    merged = []
    for r in out:
        if merged and r[0] - merged[-1][1] <= 2:
            merged[-1][1] = r[1]
        else:
            merged.append(r)
    return merged


def landmarks(obj):
    img, cell, xmin, H, co = silhouette(obj)
    X = lambda c: xmin + (c + .5) * cell
    Y = lambda r: (r + .5) * cell
    R = lambda y: int(y / cell)
    cx = -xmin / cell

    def near(rs, c):
        return min(rs, key=lambda r: 0 if r[0] <= c <= r[1] else min(abs(r[0] - c), abs(r[1] - c)))

    # legs: the two runs either side of the centre from the ankles up, until one run spans both (the crotch)
    r_ank = R(.05 * H)
    rs = runs(img[r_ank])
    left = [r for r in rs if (r[0] + r[1]) / 2 > cx]
    right = [r for r in rs if (r[0] + r[1]) / 2 < cx]
    crotch = None
    leg_c = {}
    if left and right:
        lr, rr = min(left, key=lambda r: r[0]), max(right, key=lambda r: r[1])
        for row in range(r_ank, R(.62 * H)):
            rs = runs(img[row])
            ol = [r for r in rs if r[0] <= lr[1] + 1 and r[1] >= lr[0] - 1]
            orr = [r for r in rs if r[0] <= rr[1] + 1 and r[1] >= rr[0] - 1]
            if not ol or not orr:
                break
            if any(a is b for a in ol for b in orr):
                crotch = Y(row)
                break
            lr = min(ol, key=lambda r: abs((r[0] + r[1]) / 2 - (lr[0] + lr[1]) / 2))
            rr = min(orr, key=lambda r: abs((r[0] + r[1]) / 2 - (rr[0] + rr[1]) / 2))
            leg_c[row] = (X((lr[0] + lr[1]) / 2), X((rr[0] + rr[1]) / 2))
    robe = crotch is None or crotch < .24 * H

    # arms: per side, the run outside the torso run, from the hand tip up to the armpit
    arm = {}
    for side, sg in (("L", 1), ("R", -1)):
        track, widths = [], []
        for row in range(R(.82 * H), R(.06 * H), -1):
            rs = runs(img[row])
            if not rs:
                break
            if not track:
                torso = near(rs, cx)
                outer = [r for r in rs if (r[0] > torso[1] if sg > 0 else r[1] < torso[0])]
                if outer:
                    o = min(outer, key=lambda r: r[0]) if sg > 0 else max(outer, key=lambda r: r[1])
                    track.append((row, o, torso))
                    widths.append(o[1] - o[0])
                continue
            prev = track[-1][1]
            nxt = [r for r in rs if r[0] <= prev[1] + 1 and r[1] >= prev[0] - 1]
            o = min(nxt, key=lambda r: abs((r[0] + r[1]) - (prev[0] + prev[1]))) if nxt else None
            w = o[1] - o[0] if o else 0
            if not o or o[0] <= cx <= o[1] or (len(widths) > 6 and w > 1.9 * sorted(widths)[len(widths) // 2] + 2):
                if len(track) < .08 * H / cell:
                    track, widths = [], []
                    continue
                break
            track.append((row, o, None))
            widths.append(w)
        if len(track) < 5:
            raise RuntimeError("no arm found on side " + side)
        top_row, _, torso_top = track[0]
        bot_row, o_bot, _ = track[-1]
        edge = X(torso_top[1]) if sg > 0 else X(torso_top[0])
        arm[side] = dict(armpit=Y(top_row), edge=edge, tip=Vector((X((o_bot[0] + o_bot[1]) / 2), Y(bot_row), 0)))

    y_arm = (arm["L"]["armpit"] + arm["R"]["armpit"]) / 2
    if robe:
        crotch = .42 * y_arm / .62
        leg_c = {}
    # neck: the narrowest torso row between the armpits and the head
    best, y_neck = 1e9, y_arm + .1 * H
    for row in range(R(y_arm + .02 * H), R(y_arm + .15 * H)):
        rs = runs(img[row])
        if not rs:
            continue
        t = near(rs, cx)
        w = t[1] - t[0]
        if w < best:
            best, y_neck = w, Y(row)

    def zmean(p, rad):
        d = np.hypot(co[:, 0] - p.x, co[:, 1] - p.y)
        m = d < rad
        if m.sum() < 4:
            m = d < rad * 2.5
        return float(co[m, 2].mean()) if m.any() else 0.0

    J = {}
    y_hip = crotch + .035 * H
    below = [r for r in leg_c if Y(r) < crotch - .04 * H]
    if below:
        lx, rx = leg_c[max(below)]
    else:
        lx, rx = .085 * H, -.085 * H
    ank = runs(img[R(.05 * H)])
    ax = {}
    for side, sg, hx in (("L", 1, lx), ("R", -1, rx)):
        cand = [r for r in ank if ((r[0] + r[1]) / 2 - cx) * sg > 0]
        a = (X((min(cand, key=lambda r: abs(X((r[0] + r[1]) / 2) - hx))[0] + min(cand, key=lambda r: abs(X((r[0] + r[1]) / 2) - hx))[1]) / 2)
             if cand and not robe else hx * .9)
        ax[side] = a
        hip = Vector((hx * .92, y_hip, 0))
        ankle = Vector((a, .05 * H, 0))
        hip.z = zmean(hip, .05 * H)
        ankle.z = zmean(ankle, .03 * H) - .01 * H
        knee = (hip + ankle) / 2
        knee.z = zmean(knee, .04 * H) + .01 * H
        J["hip_" + side], J["knee_" + side], J["ankle_" + side] = hip, knee, ankle
    for side, sg in (("L", 1), ("R", -1)):
        A = arm[side]
        sh = Vector((A["edge"] - sg * .012 * H, A["armpit"] + .035 * H, 0))
        tip = A["tip"]
        wrist = sh + (tip - sh) * .78
        elbow = sh + (tip - sh) * .43
        sh.z = zmean(sh, .05 * H)
        tip.z = zmean(tip, .04 * H)
        wrist.z = zmean(wrist, .03 * H)
        elbow.z = zmean(elbow, .03 * H) - .01 * H
        J["shoulder_" + side], J["elbow_" + side], J["wrist_" + side], J["tip_" + side] = sh, elbow, wrist, tip
    z_t = zmean(Vector((0, (y_hip + y_arm) / 2, 0)), .08 * H)
    J["hips"] = Vector((0, y_hip, z_t))
    J["shoulders"] = Vector((0, (J["shoulder_L"].y + J["shoulder_R"].y) / 2, z_t))
    J["neck"] = Vector((0, y_neck, zmean(Vector((0, y_neck, 0)), .04 * H)))
    J["H"] = H
    J["robe"] = robe
    return J


def plan(J, T):
    """Char-space bone frames and the affine map that moves each onto the athlete skeleton."""
    up, fwd = Vector((0, 1, 0)), Vector((0, 0, 1))
    H = J["H"]
    char, maps = {}, {}
    leg = ((J["hip_L"] - J["ankle_L"]).length + (J["hip_R"] - J["ankle_R"]).length) / 2
    s = (LL[0] + LL[1]) / leg
    hip_t = Vector((0, T["thigh_L"][0].y, 0))
    hips_c = J["hips"]
    maps["hips"] = Matrix.Translation(hip_t) @ Matrix.Scale(s, 4) @ Matrix.Translation(-hips_c)
    char["hips"] = (hips_c, up, fwd, .2 * H)
    c0 = hips_c + up * ((T["chest"][0].y - hip_t.y) / s)
    sh_y = J["shoulders"].y
    shoulder_t = T["upperarm_L"][0].y
    r = (shoulder_t - T["chest"][0].y) / max(sh_y - c0.y, .05 * H)
    chest_m = Matrix.Translation(Vector((0, T["chest"][0].y, 0))) @ Matrix.Diagonal((s, r, s, 1)) @ Matrix.Translation(-c0)
    maps["chest"] = chest_m
    char["chest"] = (c0, up, fwd, sh_y - c0.y)
    maps["neck"] = chest_m
    char["neck"] = (Vector((0, sh_y, J["neck"].z)), up, fwd, max(J["neck"].y - sh_y, .03 * H))
    pn = J["neck"]
    hs = s * HEAD_SCALE
    maps["head"] = Matrix.Translation(chest_m @ pn) @ Matrix.Scale(hs, 4) @ Matrix.Translation(-pn)
    char["head"] = (pn, up, fwd, H - pn.y)
    for side in ("L", "R"):
        for (a, b, name_u, name_l, L) in (("shoulder_", "elbow_", "upperarm_", "forearm_", LA), ("hip_", "knee_", "thigh_", "shin_", LL)):
            end = "wrist_" if a == "shoulder_" else "ankle_"
            A, B, C = J[a + side], J[b + side], J[end + side]
            for name, p, q, ln in ((name_u, A, B, L[0]), (name_l, B, C, L[1])):
                to, tt, tn, _ = T[name + side]
                t = (q - p).normalized()
                n = perp(tn, t)
                char[name + side] = (p, t, n, (q - p).length)
                maps[name + side] = frame_matrix(to, tt, tn) @ Matrix.Diagonal((s, ln / (q - p).length, s, 1)) @ frame_matrix(p, t, n).inverted()
        W, tip = J["wrist_" + side], J["tip_" + side]
        to, tt, tn, _ = T["hand_" + side]
        t = (J["wrist_" + side] - J["elbow_" + side]).normalized()
        n = perp(tn, t)
        char["hand_" + side] = (W, t, n, max((tip - W).length, .02 * H))
        maps["hand_" + side] = frame_matrix(to, tt, tn) @ Matrix.Scale(s * HAND_SCALE, 4) @ frame_matrix(W, t, n).inverted()
        an = J["ankle_" + side]
        to = T["foot_" + side][0]
        char["foot_" + side] = (an, up, fwd, .06 * H)
        maps["foot_" + side] = Matrix.Translation(to) @ Matrix.Scale(s, 4) @ Matrix.Translation(-Vector((an.x, SOLE_TO_ANKLE / s, an.z)))
    return char, maps, s


def make_armature(name, frames):
    arm = bpy.data.armatures.new(name)
    rig = bpy.data.objects.new(name, arm)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    for bn, (o, t, n, ln) in frames.items():
        eb = arm.edit_bones.new(bn)
        eb.head = to_bl(o)
        eb.tail = to_bl(o + t * max(ln, 1e-3))
        eb.align_roll(to_bl(n))
        eb.use_deform = True
    bpy.ops.object.mode_set(mode="OBJECT")
    return rig


def select_only(*objs):
    for o in bpy.context.scene.objects:
        o.select_set(o in objs)
    bpy.context.view_layer.objects.active = objs[-1]


def auto_weights(obj, rig, H):
    """Heat weights on a watertight voxel proxy (Meshy's part-separated meshes defeat the solve), copied to the real mesh."""
    for v in obj.data.vertices:
        v.co = to_bl(v.co)
    proxy = obj.copy()
    proxy.data = obj.data.copy()
    proxy.vertex_groups.clear()
    bpy.context.scene.collection.objects.link(proxy)
    base = proxy.data.copy()
    for div in (110, 80, 60, 45):
        proxy.data = base.copy()
        proxy.vertex_groups.clear()
        rm = proxy.modifiers.new("Remesh", "REMESH")
        rm.mode = "VOXEL"
        rm.voxel_size = H / div
        select_only(proxy)
        bpy.ops.object.modifier_apply(modifier=rm.name)
        select_only(proxy, rig)
        bpy.ops.object.parent_set(type="ARMATURE_AUTO")
        proxy.parent = None
        proxy.modifiers.clear()
        done = sum(1 for v in proxy.data.vertices if any(g.weight > 1e-4 for g in v.groups))
        if done > .98 * len(proxy.data.vertices):
            break
        print("  heat solve incomplete at voxel H/%d (%d of %d)" % (div, done, len(proxy.data.vertices)))
    for g in proxy.vertex_groups:
        obj.vertex_groups.new(name=g.name)
    dt = obj.modifiers.new("Weights", "DATA_TRANSFER")
    dt.object = proxy
    dt.use_vert_data = True
    dt.data_types_verts = {"VGROUP_WEIGHTS"}
    dt.vert_mapping = "POLYINTERP_NEAREST"
    dt.layers_vgroup_select_src = "ALL"
    dt.layers_vgroup_select_dst = "NAME"
    select_only(obj)
    bpy.ops.object.modifier_apply(modifier=dt.name)
    bpy.data.objects.remove(proxy, do_unlink=True)
    for v in obj.data.vertices:
        v.co = from_bl(v.co)


def fill_weights(obj, char):
    """Vertices the heat solve left empty take the nearest bone segment."""
    names = list(char.keys())
    groups = {g.index: g.name for g in obj.vertex_groups}
    for n in names:
        if n not in obj.vertex_groups:
            obj.vertex_groups.new(name=n)
    segs = {n: (char[n][0], char[n][0] + char[n][1] * char[n][3]) for n in names}
    empty = 0
    for v in obj.data.vertices:
        tot = sum(g.weight for g in v.groups if groups.get(g.group) in char)
        if tot > 1e-4:
            continue
        empty += 1
        ds = []
        for n, (a, b) in segs.items():
            ab = b - a
            t = max(0, min(1, (v.co - a).dot(ab) / max(ab.length_squared, 1e-9)))
            ds.append(((v.co - (a + ab * t)).length, n))
        ds.sort()
        near2 = ds[:2]
        ws = [1 / max(d, 1e-5) ** 4 for d, _ in near2]
        for (d, n), w in zip(near2, ws):
            obj.vertex_groups[n].add([v.index], w / sum(ws), "REPLACE")
    return empty


def vertex_weights(obj, names):
    idx = {obj.vertex_groups[n].index: n for n in names if n in obj.vertex_groups}
    out = []
    for v in obj.data.vertices:
        w = [(idx[g.group], g.weight) for g in v.groups if g.group in idx and g.weight > 1e-4]
        w.sort(key=lambda x: -x[1])
        w = w[:4]
        tot = sum(x[1] for x in w) or 1
        out.append([(n, x / tot) for n, x in w])
    return out


def refit(obj, weights, maps):
    for v, w in zip(obj.data.vertices, weights):
        p = Vector((0, 0, 0))
        for n, x in w:
            p += (maps[n] @ v.co) * x
        v.co = p


def bake_texture(obj):
    img = None
    for m in obj.data.materials:
        if m and m.use_nodes:
            for nd in m.node_tree.nodes:
                if nd.type == "TEX_IMAGE" and nd.image:
                    img = nd.image
                    break
        if img:
            break
    mat = bpy.data.materials.new("toon")
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Roughness"].default_value = .75
    bsdf.inputs["Metallic"].default_value = 0
    if img:
        if max(img.size) > TEX:
            img.scale(TEX, TEX)
        img.pack()
        tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
        tex.image = img
        mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    for p in obj.data.polygons:
        p.material_index = 0
        p.use_smooth = True


def preview(obj, rig, path):
    scn = bpy.context.scene
    cam_d = bpy.data.cameras.new("cam")
    cam_d.type = "ORTHO"
    cam_d.ortho_scale = 5.0
    cam = bpy.data.objects.new("cam", cam_d)
    scn.collection.objects.link(cam)
    cam.location = (0, -12, 2.2)
    cam.rotation_euler = (math.pi / 2, 0, 0)
    scn.camera = cam
    try:
        scn.render.engine = "BLENDER_WORKBENCH"
    except TypeError:
        pass
    scn.display.shading.color_type = "TEXTURE"
    scn.display.shading.light = "STUDIO"
    scn.render.resolution_x, scn.render.resolution_y = 360, 480
    scn.render.film_transparent = False
    scn.render.filepath = path
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)


def build(i, T):
    src = os.path.join(SRC, "p%02d.glb" % i)
    obj = import_character(src)
    strays = drop_strays(obj)
    J = landmarks(obj)
    if os.environ.get("TOON_DEBUG"):
        for k, v in J.items():
            print("  ", k, tuple(round(c / J["H"], 3) for c in v) if isinstance(v, Vector) else v)
    char, maps, s = plan(J, T)
    crig = make_armature("fit", char)
    auto_weights(obj, crig, J["H"])
    empty = fill_weights(obj, char)
    weights = vertex_weights(obj, list(char.keys()))
    obj.parent = None
    obj.modifiers.clear()
    bpy.data.objects.remove(crig, do_unlink=True)
    refit(obj, weights, maps)
    obj.vertex_groups.clear()
    for n in T:
        obj.vertex_groups.new(name=n)
    for vi, w in enumerate(weights):
        for n, x in w:
            obj.vertex_groups[n].add([vi], x, "REPLACE")
    for v in obj.data.vertices:
        v.co = to_bl(v.co)
    obj.data.update()
    bpy.context.view_layer.objects.active = obj
    if obj.data.has_custom_normals:
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
    bake_texture(obj)
    rig = make_armature("ToonRig", T)
    for n, (o, t, nn, ln) in T.items():
        rig.pose.bones[n]["frame"] = [round(c, 6) for c in (*o, *t, *nn)]
    obj.name = "Toon"
    obj.parent = rig
    mod = obj.modifiers.new("Armature", "ARMATURE")
    mod.object = rig
    os.makedirs(OUT_DIR, exist_ok=True)
    out = os.path.join(OUT_DIR, "p%02d.glb" % i)
    for o in bpy.context.scene.objects:
        o.select_set(o in (obj, rig))
    bpy.ops.export_scene.gltf(filepath=out, use_selection=True, export_format="GLB", export_skins=True, export_extras=True,
                              export_animations=False, export_yup=True, export_apply=False, export_texcoords=True,
                              export_normals=True, export_materials="EXPORT", export_image_format="AUTO")
    if PREVIEW:
        os.makedirs(PREVIEW, exist_ok=True)
        preview(obj, rig, os.path.join(PREVIEW, "p%02d.png" % i))
    print("toon p%02d scale %.3f robe %s strays %d unweighted %d verts %d -> %s" % (i, s, J["robe"], strays, empty, len(obj.data.vertices), out))


T = athlete_frames()
for i in IDS:
    try:
        build(i, T)
    except Exception as e:
        import traceback
        traceback.print_exc()
        print("toon p%02d FAILED %s" % (i, e))
