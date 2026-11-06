"""Sandlot Sluggers (2D) kid sprites, modeled and rendered in Blender.

Run headless:  blender -b -P modules-src/sandlot/tools/build-kids.py -- [kid ids...]
or exec it from Blender's Scripting tab (set SANDLOT_KIDS="1,2" to limit the kids, SANDLOT_KEEP=1 to keep the scene).

Reads the roster from the game (tools/export-roster.mjs, so looks and costumes always match index.html), builds each kid
as a posable cartoon figure (body proportions from the game's bodyDims, face, hair style, costume top, hat, shoes and
extras), renders every frame front-on with toon shading and an inverted-hull outline, and writes
public/modules/sprites/kids/<id>.webp (an 8 x 8 grid of CELL_W x CELL_H cells) plus public/modules/sprites/kids/kids.json:
per kid the frames, each with its set (g = glove, n = no glove, b = helmet base, h = helmet layer), its limb angles (the
game's la, ra, ll, rl in screen radians, so drawKid picks the nearest frame for any pose) and its hand, head and chest
anchors in cell pixels.
"""
import json
import math
import os
import subprocess
import sys
import tempfile

import bmesh
import bpy
import numpy as np
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT_DIR = os.path.join(REPO, "public", "modules", "sprites", "kids")
PPU = 24
CELL_W, CELL_H = 144, 176
FOOT_X, FOOT_Y = 72, 164
COLS = 8
OUTLINE_HEX = "#1a1410"
OUT_W = .045

PI = math.pi


# ---------------------------------------------------------------- data
def roster():
    js = os.path.join(HERE, "export-roster.mjs")
    node = os.environ.get("NODE", "node")
    out = subprocess.run([node, js], capture_output=True, text=True, check=True, cwd=REPO).stdout
    return json.loads(out)["kids"]


def lerp(a, b, t):
    return a + (b - a) * t


def body_dims(kid):
    H, b = kid["height"], kid["look"]["body"]
    longarms = "longarms" in kid["look"]["acc"]
    return {
        "H": H, "headR": H * (.128 if b == "tiny" else .106),
        "sw": H * {"tiny": .13, "average": .135, "lanky": .112, "stocky": .17}[b],
        "arm": H * (.068 if b == "stocky" else .054), "leg": H * (.08 if b == "stocky" else .058 if b == "lanky" else .068),
        "hip": H * (.47 if b == "lanky" else .4 if b == "tiny" else .44), "armLen": H * .19 * (1.4 if longarms else 1),
    }


# limb angles exactly as poseFor in index.html: radians from straight down, positive toward screen-right
STAND = {"la": (-.25, -.1), "ra": (.25, .1), "ll": (-.07, -.03), "rl": (.07, .03)}
PITCH = [
    (0.00, (-.35, 1.75), (.35, -1.75), (-.07, -.03), (.07, .03)),
    (0.32, (-.2, 2.05), (.2, -2.05), (.04, 0), (2.45, .2)),
    (0.62, (-1.95, -2.75), (1.35, 1.55), (-.22, -.08), (.78, .25)),
    (0.86, (-2.85, 2.55), (.75, -.35), (-.35, -.5), (.55, .1)),
    (1.00, (-2.55, 2.95), (.5, -.9), (-.45, -.6), (.5, .05)),
    (1.30, (.55, .25), (.25, -1.2), (-1.15, -.25), (.42, 0)),
    (1.60, (.3, .1), (.3, -1.0), (-.5, -.1), (.3, 0)),
]


def pitch_pose(w, lefty, side):
    F = []
    for f in PITCH:
        la = f[1]
        if side and f[0] == .86:
            la = (-1.75, -1.45)
        if side and f[0] == 1.0:
            la = (-1.6, -1.2)
        if side and f[0] == 1.3:
            la = (.9, .6)
        F.append((f[0], la, f[2], f[3], f[4]))
    a, b, k = F[0], F[-1], 0
    for n in range(len(F) - 1):
        if F[n][0] <= w <= F[n + 1][0]:
            a, b, k = F[n], F[n + 1], (w - F[n][0]) / (F[n + 1][0] - F[n][0])
            break
    e = k * k * (3 - 2 * k)
    mix = lambda u, v: (lerp(u[0], v[0], e), lerp(u[1], v[1], e))
    p = {"la": mix(a[1], b[1]), "ra": mix(a[2], b[2]), "ll": mix(a[3], b[3]), "rl": mix(a[4], b[4])}
    if lefty:
        p = {"la": (-p["ra"][0], -p["ra"][1]), "ra": (-p["la"][0], -p["la"][1]), "ll": (-p["rl"][0], -p["rl"][1]), "rl": (-p["ll"][0], -p["ll"][1])}
    return p


def run_pose(ph):
    s = math.sin(ph)
    a = abs(s)
    return {"ll": (s * .5 - .1, s * .5 - .1 - .35 * a), "rl": (-s * .5 + .1, -s * .5 + .1 + .35 * a),
            "la": (-.35 - s * .5, -1.2 - s * .4), "ra": (.35 - s * .5, 1.2 - s * .4)}


def frames_for(kid):
    """(set, name, pose) for every cell. g: glove + hat, n: no glove + hat (props on idle frames), b: helmet base, h: helmet only."""
    lefty, side = kid["throws"] == "L", kid.get("sig") == "NOODLE"
    out = []
    g = lambda name, p: out.append(("g", name, {**STAND, **p}))
    g("field", {"ll": (-.4, -.05), "rl": (.4, .05), "la": (-.75, -.3), "ra": (.75, .3)})
    g("catch", {"la": (-2.6, -2.9), "ra": (2.6, 2.9)})
    g("dive", {"la": (-2.9, -3.0), "ra": (2.7, 2.9), "ll": (-.15, -.1), "rl": (.3, .2)})
    for k in (0, .25, .5, .75, 1):
        g("throw", {"ra": (lerp(2.6, -.8, k), lerp(2.9, -.5, k)), "la": (-.8, -.4), "ll": (-.3, -.1), "rl": (.35, .2)})
    for w in (0, .16, .32, .47, .62, .74, .86, 1.0, 1.15, 1.3, 1.6):
        g("pitch", pitch_pose(w, lefty, side))
    for i in range(8):
        g("run", run_pose(i / 8 * 2 * PI))
    out.append(("n", "stand", dict(STAND)))
    for i in range(8):
        out.append(("n", "run", run_pose(i / 8 * 2 * PI)))
    for i in range(6):
        s = math.sin(i / 6 * 2 * PI)
        out.append(("n", "dance", {"la": (-2.3 + s * .5, -2.9 + s * .3), "ra": (2.3 + s * .5, 2.9 + s * .3), "ll": (-.15 + s * .25, -.1), "rl": (.15 + s * .25, .1)}))
    out.append(("n", "cheer", {**STAND, "la": (-2.7, -3.0), "ra": (2.7, 3.0)}))
    for st in ("b", "h"):
        out.append((st, "stand", dict(STAND)))
        for i in range(8):
            out.append((st, "run", run_pose(i / 8 * 2 * PI)))
    return out


# ---------------------------------------------------------------- materials
def srgb_to_lin(c):
    return c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4


def rgb(hexstr):
    h = hexstr.lstrip("#")
    if len(h) == 3:
        h = "".join(ch * 2 for ch in h)
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def lin(hexstr):
    return tuple(srgb_to_lin(c) for c in rgb(hexstr)) + (1,)


def shade(hexstr, k):
    r, g, b = rgb(hexstr)
    t = (1, 1, 1) if k > 0 else (0, 0, 0)
    m = abs(k)
    return "#%02x%02x%02x" % tuple(int(round((c + (tc - c) * m) * 255)) for c, tc in zip((r, g, b), t))


MATS = {}


def toon(hexstr, kind="matte", pattern=None):
    """Cel shading: diffuse light quantised into three bands, times the colour, as emission (exact colours under Standard view)."""
    key = (hexstr, kind, json.dumps(pattern))
    if key in MATS:
        return MATS[key]
    m = bpy.data.materials.new("kid_%s_%s" % (hexstr.lstrip("#"), kind))
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    dif = nt.nodes.new("ShaderNodeBsdfDiffuse")
    s2r = nt.nodes.new("ShaderNodeShaderToRGB")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    nt.links.new(dif.outputs[0], s2r.inputs[0])
    nt.links.new(s2r.outputs["Color"], ramp.inputs["Fac"])
    cr = ramp.color_ramp
    cr.interpolation = "CONSTANT"
    lo, mid, hi = (.58, .82, 1.0) if kind != "gloss" else (.5, .8, 1.15)
    cr.elements[0].position, cr.elements[0].color = 0, (lo, lo, lo, 1)
    cr.elements[1].position, cr.elements[1].color = .12, (mid, mid, mid, 1)
    e = cr.elements.new(.32)
    e.color = (1, 1, 1, 1)
    if kind in ("gloss", "metal"):
        e2 = cr.elements.new(.62)
        e2.color = (1.35, 1.35, 1.35, 1)
    mul = nt.nodes.new("ShaderNodeMix")
    mul.data_type = "RGBA"
    mul.blend_type = "MULTIPLY"
    mul.inputs["Factor"].default_value = 1
    nt.links.new(ramp.outputs["Color"], mul.inputs[6])
    base = base_color_node(nt, hexstr, pattern)
    nt.links.new(base, mul.inputs[7])
    em = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(mul.outputs[2], em.inputs["Color"])
    if kind == "glass":
        tr = nt.nodes.new("ShaderNodeBsdfTransparent")
        mix = nt.nodes.new("ShaderNodeMixShader")
        mix.inputs[0].default_value = .3
        nt.links.new(tr.outputs[0], mix.inputs[1])
        nt.links.new(em.outputs[0], mix.inputs[2])
        nt.links.new(mix.outputs[0], out.inputs["Surface"])
        for attr, val in (("surface_render_method", "BLENDED"), ("blend_method", "BLEND")):
            try:
                setattr(m, attr, val)
            except (AttributeError, TypeError):
                pass
    else:
        nt.links.new(em.outputs[0], out.inputs["Surface"])
    MATS[key] = m
    return m


def base_color_node(nt, hexstr, pattern):
    col = nt.nodes.new("ShaderNodeRGB")
    col.outputs[0].default_value = lin(hexstr)
    if not pattern:
        return col.outputs[0]
    kind, other = pattern
    tc = nt.nodes.new("ShaderNodeTexCoord")
    c2 = nt.nodes.new("ShaderNodeRGB")
    c2.outputs[0].default_value = lin(other)
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    nt.links.new(col.outputs[0], mix.inputs[6])
    nt.links.new(c2.outputs[0], mix.inputs[7])
    if kind == "pinstripe":
        w = nt.nodes.new("ShaderNodeTexWave")
        w.bands_direction = "X"
        w.inputs["Scale"].default_value = 9
        w.inputs["Distortion"].default_value = 0
        nt.links.new(tc.outputs["Object"], w.inputs["Vector"])
        gt = nt.nodes.new("ShaderNodeMath")
        gt.operation = "GREATER_THAN"
        gt.inputs[1].default_value = .9
        nt.links.new(w.outputs["Fac"], gt.inputs[0])
        nt.links.new(gt.outputs[0], mix.inputs["Factor"])
    elif kind == "plaid":
        acc = None
        for d in ("X", "Z"):
            w = nt.nodes.new("ShaderNodeTexWave")
            w.wave_type = "BANDS"
            w.bands_direction = d
            w.inputs["Scale"].default_value = 3.2
            nt.links.new(tc.outputs["Object"], w.inputs["Vector"])
            gt = nt.nodes.new("ShaderNodeMath")
            gt.operation = "GREATER_THAN"
            gt.inputs[1].default_value = .62
            nt.links.new(w.outputs["Fac"], gt.inputs[0])
            if acc is None:
                acc = gt
            else:
                mx = nt.nodes.new("ShaderNodeMath")
                mx.operation = "MAXIMUM"
                nt.links.new(acc.outputs[0], mx.inputs[0])
                nt.links.new(gt.outputs[0], mx.inputs[1])
                acc = mx
        nt.links.new(acc.outputs[0], mix.inputs["Factor"])
    elif kind == "splatter":
        v = nt.nodes.new("ShaderNodeTexVoronoi")
        v.inputs["Scale"].default_value = 6
        nt.links.new(tc.outputs["Object"], v.inputs["Vector"])
        lt = nt.nodes.new("ShaderNodeMath")
        lt.operation = "LESS_THAN"
        lt.inputs[1].default_value = .14
        nt.links.new(v.outputs["Distance"], lt.inputs[0])
        nt.links.new(lt.outputs[0], mix.inputs["Factor"])
        vc = v.outputs["Color"]
        nt.links.new(vc, mix.inputs[7])
    return mix.outputs[2]


def outline_mat():
    if "kid_outline" in bpy.data.materials:
        return bpy.data.materials["kid_outline"]
    m = bpy.data.materials.new("kid_outline")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = lin(OUTLINE_HEX)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(em.outputs[0], out.inputs["Surface"])
    m.use_backface_culling = True
    return m


# ---------------------------------------------------------------- geometry
def bm_sphere(seg=20, ring=12):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=ring, radius=1)
    return bm


def bm_capsule(r, length, seg=14):
    """Capsule from the origin down -Z by `length`, radius r, rounded ends."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=10, radius=r)
    for v in bm.verts:
        if v.co.z < 0:
            v.co.z -= length
    return bm


def bm_cyl(r1, r2, depth, seg=20):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r1, radius2=r2, depth=depth)
    return bm


def bm_box(sx, sy, sz, bevel=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    for v in bm.verts:
        v.co.x *= sx
        v.co.y *= sy
        v.co.z *= sz
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges) + list(bm.verts), offset=min(bevel, min(sx, sy, sz) * .49), segments=3, affect="EDGES", profile=.5)
    return bm


def bm_torus(R, r, seg=24, rs=8, arc=2 * PI, start=0.0):
    bm = bmesh.new()
    rings = []
    closed = arc >= 2 * PI - 1e-6
    n = seg if closed else seg + 1
    for i in range(n):
        a = start + arc * i / seg
        c, s = math.cos(a), math.sin(a)
        ring = []
        for j in range(rs):
            b = 2 * PI * j / rs
            ring.append(bm.verts.new(((R + r * math.cos(b)) * c, (R + r * math.cos(b)) * s, r * math.sin(b))))
        rings.append(ring)
    for i in range(seg if closed else seg):
        a, b = rings[i], rings[(i + 1) % n]
        for j in range(rs):
            bm.faces.new((a[j], b[j], b[(j + 1) % rs], a[(j + 1) % rs]))
    return bm


def cut(bm, keep):
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not keep(v.co)], context="VERTS")
    return bm


class Figure:
    def __init__(self, scene):
        self.scene = scene
        self.parts = []
        self.layers = {}

    def add(self, bm, mat, parent=None, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), outline=True, layer="body", name="part"):
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        for p in me.polygons:
            p.use_smooth = True
        me.materials.append(mat)
        ob = bpy.data.objects.new(name, me)
        self.scene.collection.objects.link(ob)
        ob.parent = parent
        ob.location, ob.rotation_euler, ob.scale = loc, rot, scale
        if outline:
            me.materials.append(outline_mat())
            sol = ob.modifiers.new("outline", "SOLIDIFY")
            sol.thickness = OUT_W / max(.2, min(scale) if min(scale) > 0 else 1)
            sol.offset = 1
            sol.use_flip_normals = True
            sol.use_rim = False
            sol.material_offset = 1
        self.parts.append(ob)
        self.layers.setdefault(layer, []).append(ob)
        return ob

    def pivot(self, name, parent=None, loc=(0, 0, 0)):
        e = bpy.data.objects.new(name, None)
        self.scene.collection.objects.link(e)
        e.parent = parent
        e.location = loc
        self.parts.append(e)
        return e


# ---------------------------------------------------------------- the kid
TOP_LONG = {"labcoat", "robe", "chefcoat", "pirate", "ragcoat", "smock", "tabard", "gi"}
TOP_OPEN = {"blazer", "leather", "suit", "tux", "labcoat", "bomber", "pirate", "ragcoat"}
HAT_HIDES_HAIR = {"knighthelm", "ninjahood", "spacehelmet", "scuba", "witchhat", "toque", "tophat", "beanie", "aviator", "hardhat", "firehelmet", "safari", "policecap", "mailcap", "cap", "backcap", "straw", "tricorn", "beret"}


class Kid:
    def __init__(self, scene, kid, glove=False, helmet=False, props=False):
        self.k, self.L = kid, kid["look"]
        self.F = self.L.get("fit") or {}
        self.acc = set(self.L["acc"])
        self.d = body_dims(kid)
        self.fig = Figure(scene)
        self.glove, self.helmet, self.props = glove, helmet, props
        self.build()

    # helpers
    def m(self, hexstr, kind="matte", pattern=None):
        return toon(hexstr, kind, pattern)

    def build(self):
        d, F, L = self.d, self.F, self.L
        H, R = d["H"], d["headR"]
        self.root = self.fig.pivot("root")
        self.shY = H - R * 2 - .06
        self.headZ = H - R
        top = F.get("top")
        self.tw = d["sw"] * 2 * (1.12 if top in ("turnout", "spacesuit") else 1.06 if top == "robe" else 1)
        self.th = (self.shY - d["hip"]) * 1.06
        self.legs()
        self.torso()
        self.arms()
        self.head()

    # ---- legs and shoes
    def legs(self):
        d, F, L = self.d, self.F, self.L
        top = F.get("top")
        legW = d["leg"] * (1.25 if top == "spacesuit" or F.get("shoe") == "armor" else 1.15 if top == "turnout" else 1)
        r = legW * .5
        L1, L2 = d["hip"] * .52, d["hip"] * .5
        pants = F.get("overalls") or ("#4a6886" if "overalls" in self.acc and not F.get("overalls") else None) or L["pants"]
        if top in ("coveralls", "spacesuit", "wetsuit", "gi"):
            pants = L["shirt"] if top != "gi" else L["pants"]
        pm = self.m(pants)
        self.hips = {}
        self.knees = {}
        for side in (-1, 1):
            hp = self.fig.pivot("hip%d" % side, self.root, (side * d["sw"] * .45, 0, d["hip"]))
            self.fig.add(bm_capsule(r, L1), pm, hp, name="thigh")
            kn = self.fig.pivot("knee%d" % side, hp, (0, 0, -L1))
            low = self.m(F["greaves"], "metal") if F.get("greaves") else pm
            self.fig.add(bm_capsule(r * (1.12 if F.get("greaves") else 1), L2), low, kn, name="shin")
            if "highsocks" in self.acc:
                self.fig.add(bm_capsule(r * 1.04, L2 * .45), self.m(L["trim"]), kn, (0, 0, -L2 * .5), outline=False, name="sock")
            if top in ("turnout", "spacesuit", "track", "wetsuit"):
                band = F.get("stripes") or L["trim"]
                self.fig.add(bm_cyl(r * 1.08, r * 1.08, r * .45), self.m(band), kn, (0, 0, -L2 * .45), outline=False, name="legband")
            if F.get("patches"):
                self.fig.add(bm_box(r * 1.1, r * .3, r * 1.1, .02), self.m("#6b5a3a"), kn, (0, -r * .9, -L1 * .05), name="patch")
            ft = self.fig.pivot("foot%d" % side, kn, (0, 0, -L2))
            self.shoe(ft, side, legW)
            self.hips[side], self.knees[side], self.feet = hp, kn, None
        self.L1, self.L2 = L1, L2
        if top in TOP_LONG:
            col = "#7a7f74" if top == "ragcoat" else F.get("coat") or L["shirt"]
            skirt_len = d["hip"] * (.62 if top in ("robe", "gi") else .5)
            bm = bm_cyl(self.tw * .5, self.tw * (.62 if top != "gi" else .55), skirt_len, 24)
            pat = ("splatter", "#ffffff") if F.get("splatter") else None
            self.fig.add(bm, self.m(col, pattern=pat), self.root, (0, 0, d["hip"] + .05 - skirt_len / 2), scale=(1, .62, 1), name="skirt")
            if top == "robe":
                self.fig.add(bm_cyl(self.tw * .63, self.tw * .63, .08, 24), self.m(L["trim"]), self.root, (0, 0, d["hip"] + .05 - skirt_len), scale=(1, .62, 1), outline=False, name="hem")

    def shoe(self, parent, side, w):
        F, L = self.F, self.L
        kind = F.get("shoe") or "sneakers"
        col = L["shoes"]
        s = w
        if kind == "boots":
            self.fig.add(bm_cyl(s * .62, s * .62, s * 1.4), self.m(shade(col, .05)), parent, (0, 0, s * .45), name="bootshaft")
            self.fig.add(bm_box(s * 1.2, s * 1.8, s * .7, s * .3), self.m(col), parent, (side * s * .15, -s * .45, -s * .05), name="boot")
        elif kind == "spaceboots":
            self.fig.add(bm_cyl(s * .78, s * .7, s * 1.6), self.m(col), parent, (0, 0, s * .5), name="spaceshaft")
            self.fig.add(bm_box(s * 1.4, s * 2.0, s * .8, s * .35), self.m(col), parent, (side * s * .15, -s * .5, -s * .1), name="spaceboot")
            self.fig.add(bm_cyl(s * .82, s * .82, s * .25), self.m("#9aa3ad"), parent, (0, 0, s * .9), outline=False, name="cuff")
        elif kind == "flippers":
            self.fig.add(bm_box(s * 1.6, s * 3.2, s * .25, s * .1), self.m(col), parent, (side * s * .2, -s * 1.3, -s * .3), name="flipper")
        elif kind == "sandals":
            self.fig.add(bm_box(s * 1.0, s * 1.6, s * .5, s * .25), self.m(self.L["skin"]), parent, (side * s * .1, -s * .4, 0), name="foot")
            self.fig.add(bm_box(s * 1.1, s * 1.7, s * .18, s * .05), self.m("#e0b48a"), parent, (side * s * .1, -s * .4, -s * .3), name="sole")
            self.fig.add(bm_box(s * 1.12, s * .3, s * .3, s * .05), self.m(col), parent, (side * s * .1, -s * .9, -s * .05), outline=False, name="strap")
        elif kind == "armor":
            self.fig.add(bm_box(s * 1.3, s * 1.9, s * .8, s * .3), self.m(col, "metal"), parent, (side * s * .15, -s * .45, -s * .05), name="sabaton")
        else:
            gloss = kind in ("dress", "cleats")
            low = kind in ("flats", "dress", "tabi")
            self.fig.add(bm_box(s * 1.15, s * 1.85, s * (.55 if low else .75), s * .3), self.m(col, "gloss" if gloss else "matte"), parent, (side * s * .15, -s * .45, 0), name="shoe")
            if kind in ("sneakers", "cleats"):
                self.fig.add(bm_box(s * 1.2, s * 1.9, s * .22, s * .08), self.m("#f2f2ee" if kind == "sneakers" else "#202020"), parent, (side * s * .15, -s * .45, -s * .32), outline=False, name="sole")
            if kind == "tabi":
                self.fig.add(bm_box(s * .06, s * .5, s * .5, 0), self.m("#101010"), parent, (side * s * .15, -s * 1.38, 0), outline=False, name="split")

    # ---- torso and costume top
    def torso(self):
        d, F, L = self.d, self.F, self.L
        top = F.get("top")
        tw, th = self.tw, self.th
        dep = tw * .62
        zt = self.shY + .04
        zc = zt - th / 2
        self.chest = Vector((0, -dep / 2, zc + th * .1))
        col = "#7a7f74" if top == "ragcoat" else L["shirt"]
        pat = None
        if top == "plaid" or F.get("plaid"):
            pat = ("plaid", F.get("plaid") or shade(col, -.35))
        if top == "pinstripe":
            pat = ("pinstripe", F.get("pinstripe") or "#2a3a6a")
        if F.get("splatter"):
            pat = ("splatter", "#ffffff")
        rad = min(d["sw"] * .6, th * .45)
        body = self.fig.add(bm_box(tw, dep, th, rad), self.m(col, pattern=pat), self.root, (0, 0, zc), name="torso")
        front = -dep / 2
        R = self.m
        add = lambda bm, mat, loc, rot=(0, 0, 0), scale=(1, 1, 1), outline=False, name="detail": self.fig.add(bm, mat, self.root, loc, rot, scale, outline, name=name)
        if F.get("cape"):
            add(bm_box(tw * 1.25, .04, th + d["hip"] * .55, .02), R(F["cape"]), (0, dep / 2 + .03, zt - (th + d["hip"] * .55) / 2), outline=True, name="cape")
        if F.get("tank"):
            add(bm_cyl(tw * .2, tw * .2, th * .95), R(F["tank"], "gloss"), (0, dep / 2 + tw * .18, zc + .05), outline=True, name="tank")
        if top == "spacesuit":
            add(bm_box(tw * 1.2, tw * .4, th * .85, .08), R(shade(col, -.12)), (0, dep / 2 + tw * .15, zc + .05), outline=True, name="pack")
        if top in TOP_OPEN:
            inner = F.get("inner") or ("#ffffff" if top in ("tux", "labcoat") else shade(col, .5))
            add(bm_box(tw * .3, .02, th * .92, .02), R(inner), (0, front - .005, zc + th * .03), name="inner")
            for s in (-1, 1):
                add(bm_box(tw * .1, .03, th * .45, .01), R(shade(col, -.15)), (s * tw * .17, front - .015, zt - th * .25), (0, s * .0, s * .35), name="lapel")
            if top == "bomber" or F.get("collar"):
                add(bm_torus(tw * .26, tw * .07, 24, 8), R(F.get("collar") or "#d9c8a9"), (0, 0, zt - .02), (0, 0, 0), (1, .9, .6), True, "collar")
        if F.get("tie"):
            add(bm_box(tw * .1, .02, th * .62, .01), R(F["tie"]), (0, front - .03, zt - th * .36), name="tie")
        if F.get("bowtie"):
            for s in (-1, 1):
                add(bm_cyl(tw * .09, .005, tw * .16, 3), R(F["bowtie"]), (s * tw * .06, front - .03, zt - .06), (0, PI / 2 * s, 0), outline=True, name="bow")
        if top == "chefcoat":
            for row in range(3):
                for s in (-1, 1):
                    add(bm_sphere(8, 6), R("#d8d4c8"), (s * tw * .14, front - .02, zt - th * (.25 + row * .22)), scale=(.035, .02, .035), name="button")
        if top in ("vest", "turnout", "safari", "police", "postal") or F.get("vest") or F.get("pockets"):
            if F.get("vest"):
                for s in (-1, 1):
                    add(bm_box(tw * .36, .03, th * .9, .03), R(F["vest"]), (s * tw * .29, front - .01, zc), name="vest")
                    add(bm_box(tw * .36, .032, th * .08, 0), R("#e6e6e0"), (s * tw * .29, front - .02, zc - th * .1), name="reflect")
            if top in ("safari", "police", "postal") or F.get("pockets"):
                for s in (-1, 1):
                    add(bm_box(tw * .22, .025, th * .2, .02), R(shade(col, -.1)), (s * tw * .23, front - .01, zt - th * .3), outline=True, name="pocket")
        if top == "turnout":
            for z in (.3, .72):
                add(bm_box(tw * 1.01, dep * 1.01, th * .09, .02), R(F.get("stripes") or "#e9e35a"), (0, 0, zt - th * z), name="stripe")
        if F.get("stripe"):
            add(bm_box(tw * 1.005, dep * 1.005, th * .14, .02), R(F["stripe"]), (0, 0, zc + th * .1), name="stripe")
        if F.get("panel"):
            add(bm_box(tw * .4, .04, th * .3, .02), R(F["panel"]), (0, front - .02, zc + th * .1), outline=True, name="panel")
            for i in range(3):
                add(bm_sphere(8, 6), R(["#e74c3c", "#f1c40f", "#2ecc71"][i]), ((i - 1) * tw * .1, front - .045, zc + th * .1), scale=(.03, .02, .03), name="light")
        if F.get("badge"):
            add(bm_cyl(tw * .07, tw * .07, .02, 5), R("#f4c542", "metal"), (tw * .24, front - .02, zt - th * .26), (PI / 2, 0, 0), outline=True, name="badge")
        if F.get("belt") or top in ("police", "safari", "gi") or F.get("toolbelt"):
            bc = F.get("belt") if isinstance(F.get("belt"), str) else ("#2a1d14" if top != "gi" else "#111111")
            add(bm_box(tw * 1.03, dep * 1.03, th * .1, .03), R(bc), (0, 0, zc - th * .44), name="belt")
            if F.get("toolbelt"):
                for s in (-1, 1):
                    add(bm_box(tw * .16, .06, th * .16, .02), R("#6b4a2b"), (s * tw * .36, front - .03, zc - th * .52), outline=True, name="tool")
                add(bm_cyl(.025, .025, th * .3), R("#9aa3ad", "metal"), (tw * .36, front - .05, zc - th * .4), outline=True, name="hammer")
        if F.get("suspenders"):
            for s in (-1, 1):
                add(bm_box(tw * .07, .02, th, 0), R(F["suspenders"]), (s * tw * .22, front - .015, zc), name="suspender")
        if F.get("overalls") or "overalls" in self.acc:
            oc = F.get("overalls") or "#4a6886"
            add(bm_box(tw * .58, .03, th * .48, .04), R(oc), (0, front - .01, zc - th * .25), outline=True, name="bib")
            for s in (-1, 1):
                add(bm_box(tw * .08, .03, th * .55, 0), R(oc), (s * tw * .2, front - .012, zt - th * .27), name="strap")
                add(bm_sphere(8, 6), R("#d8c060", "metal"), (s * tw * .2, front - .035, zc + th * .02), scale=(.03, .015, .03), name="clasp")
        if F.get("sash"):
            add(bm_box(tw * .2, dep * 1.04, th * 1.15, .02), R(F["sash"]), (0, 0, zc), (0, -.75, 0), name="sash")
        if F.get("satchel"):
            add(bm_box(tw * .08, dep * 1.04, th * 1.2, 0), R(shade(F["satchel"], -.2)), (0, 0, zc), (0, .7, 0), name="satchelstrap")
            add(bm_box(tw * .45, tw * .18, th * .38, .04), R(F["satchel"]), (tw * .55, -dep * .15, zc - th * .48), outline=True, name="satchel")
        if top == "hoodie":
            add(bm_box(tw * .55, .03, th * .26, .05), R(shade(col, -.12)), (0, front - .01, zc - th * .2), outline=True, name="pouch")
            for s in (-1, 1):
                add(bm_cyl(.012, .012, th * .25), R("#f4f1ea"), (s * tw * .08, front - .02, zt - th * .18), name="string")
            add(bm_torus(tw * .26, tw * .1, 20, 8), R(col), (0, dep * .2, zt + .02), (PI * .1, 0, 0), (1, .8, .7), True, "hood")
        if top == "armor":
            for s in (-1, 1):
                add(bm_sphere(14, 10), R(shade(col, .08), "metal"), (s * tw * .48, 0, self.shY - .02), scale=(d["arm"] * 1.4, d["arm"] * 1.3, d["arm"] * .95), outline=True, name="pauldron")
        if top == "tabard" or F.get("mail"):
            pass
        if F.get("scarf"):
            add(bm_torus(tw * .24, tw * .09, 20, 8), R(F["scarf"]), (0, 0, zt - .01), (0, 0, 0), (1, .9, .7), True, "scarf")
            add(bm_box(tw * .14, .04, th * .45, .03), R(F["scarf"]), (tw * .12, front - .04, zt - th * .25), (0, .15, 0), outline=True, name="scarftail")
        if F.get("stethoscope"):
            add(bm_torus(tw * .22, .018, 24, 6, PI * 1.1, PI * .95), R("#5a6068"), (0, front - .03, zt - .02), (PI / 2, 0, 0), name="steth")
            add(bm_cyl(.05, .05, .03), R("#c0c6cc", "metal"), (tw * .1, front - .04, zt - th * .45), (PI / 2, 0, 0), outline=True, name="stethdisc")
        if "chain" in self.acc:
            add(bm_torus(tw * .24, .02, 24, 6, PI * .8, PI * 1.1), R("#f9ca24", "metal"), (0, front - .02, zt - .05), (PI / 2, 0, 0), name="chain")
        if F.get("studs"):
            for s in (-1, 1):
                for i in range(3):
                    add(bm_sphere(8, 6), R("#d0d4d8", "metal"), (s * tw * (.32 + i * .06), front, zt - .05), scale=(.025, .025, .025), name="stud")
        if F.get("script"):
            try:
                cu = bpy.data.curves.new("script", "FONT")
                cu.body = F["script"]
                cu.size = tw * .2
                cu.align_x = "CENTER"
                cu.extrude = .005
                ob = bpy.data.objects.new("script", cu)
                self.fig.scene.collection.objects.link(ob)
                ob.parent = self.root
                ob.location = (0, front - .02, zt - th * .4)
                ob.rotation_euler = (PI / 2, 0, 0)
                ob.data.materials.append(R(L["trim"]))
                self.fig.parts.append(ob)
                self.fig.layers.setdefault("body", []).append(ob)
            except Exception:
                pass
        if "flour" in self.acc:
            for i, (x, z) in enumerate(((.2, .3), (-.15, .55), (.05, .7))):
                add(bm_sphere(8, 6), R("#f6f3ea"), (x * tw, front - .01, zt - th * z), scale=(.07, .02, .05), name="flour")

    # ---- arms, hands, glove, props
    def arms(self):
        d, F, L = self.d, self.F, self.L
        top = F.get("top")
        sl = F.get("sleeve") or "long"
        if top == "pinstripe":
            scol = F.get("undersleeve") or L["trim"]
        elif top == "ragcoat":
            scol = F.get("coat") or "#7a7f74"
        elif F.get("mail"):
            scol = F["mail"]
        else:
            scol = L["shirt"]
        armW = d["arm"] * (1.3 if top in ("spacesuit", "turnout") else 1)
        r = armW * .5
        hand_col = F.get("gloves") or L["skin"]
        self.shoulders, self.elbows, self.hands = {}, {}, {}
        g_side = 1 if (self.k["throws"] == "R") != ("wrongglove" in self.acc) else -1
        self.g_side = g_side
        for side in (-1, 1):
            sp = self.fig.pivot("sh%d" % side, self.root, (side * (self.tw / 2 - d["arm"] * .35), 0, self.shY - d["arm"] * .4))
            upper = self.m(scol, "metal" if F.get("mail") else "matte") if sl != "none" else self.m(L["skin"])
            if sl == "short":
                self.fig.add(bm_capsule(r, d["armLen"]), self.m(L["skin"]), sp, name="upperarm")
                self.fig.add(bm_capsule(r * 1.3, d["armLen"] * .5), self.m(scol), sp, name="sleeve")
            else:
                self.fig.add(bm_capsule(r, d["armLen"]), upper, sp, name="upperarm")
            el = self.fig.pivot("el%d" % side, sp, (0, 0, -d["armLen"]))
            fore = upper if sl == "long" else self.m(L["skin"])
            self.fig.add(bm_capsule(r * .95, d["armLen"] * .95), fore, el, name="forearm")
            if top == "robe":
                self.fig.add(bm_cyl(r * 1.1, r * 2.6, d["armLen"] * .6), self.m(scol), el, (0, 0, -d["armLen"] * .55), name="widesleeve")
            if top in ("turnout", "track", "spacesuit") and sl == "long":
                self.fig.add(bm_cyl(r * 1.05, r * 1.05, r * .5), self.m(F.get("stripes") or L["trim"]), el, (0, 0, -d["armLen"] * .55), outline=False, name="armband")
            if F.get("bracers"):
                self.fig.add(bm_cyl(r * 1.25, r * 1.15, d["armLen"] * .4), self.m(F["bracers"], "metal"), el, (0, 0, -d["armLen"] * .6), name="bracer")
            if "wristbands" in self.acc:
                self.fig.add(bm_cyl(r * 1.15, r * 1.15, r * .8), self.m("#e74c3c"), el, (0, 0, -d["armLen"] * .8), name="wristband")
            hd = self.fig.pivot("hand%d" % side, el, (0, 0, -d["armLen"] * .95))
            hr = d["arm"] * .62 * (1.15 if F.get("gloves") else 1)
            self.fig.add(bm_sphere(14, 10), self.m(hand_col), hd, scale=(hr, hr, hr), name="hand")
            self.shoulders[side], self.elbows[side], self.hands[side] = sp, el, hd
            if self.glove and side == g_side:
                gl = self.fig.pivot("glove", hd)
                a = d["arm"]
                self.fig.add(bm_sphere(16, 12), self.m("#8b5a2b"), gl, (0, -a * .2, a * .35), scale=(a * 1.3, a * .7, a * 1.2), name="mitt")
                self.fig.add(bm_sphere(12, 8), self.m("#c98b4f"), gl, (0, -a * .85, a * .2), scale=(a * .55, a * .1, a * .45), outline=False, name="pocket")
                self.glove_pivot = gl
            if self.props and side == -g_side:
                self.prop(hd)

    def prop(self, hand):
        F, a = self.F, self.d["arm"]
        R = self.m
        if F.get("whisk"):
            self.fig.add(bm_cyl(a * .15, a * .15, a * 2.4), R("#7f8790", "metal"), hand, (0, 0, a * 1.2), name="whisk")
            self.fig.add(bm_sphere(10, 8), R("#c8ccd0", "metal"), hand, (0, 0, a * 3), scale=(a * .5, a * .5, a * 1.1), name="whiskhead")
        elif F.get("wand"):
            self.fig.add(bm_cyl(a * .1, a * .14, a * 3.4), R("#5a3d2b"), hand, (a * .4, 0, a * 1.7), (0, .25, 0), name="wand")
            self.fig.add(bm_sphere(10, 8), R("#fff6a0", "gloss"), hand, (a * .85, 0, a * 3.5), scale=(a * .35,) * 3, name="star")
        elif F.get("beaker"):
            self.fig.add(bm_cyl(a * .55, a * .45, a * 1.2), R("#bfe8f2", "glass"), hand, (0, -a * .2, a * .6), name="beaker")
            self.fig.add(bm_cyl(a * .44, a * .4, a * .55), R("#7be35a"), hand, (0, -a * .2, a * .3), outline=False, name="liquid")
        elif F.get("plunger"):
            self.fig.add(bm_cyl(a * .12, a * .12, a * 3), R("#c9a26b"), hand, (0, 0, a * 1.4), name="handle")
            self.fig.add(bm_cyl(a * .3, a * .7, a * .6), R("#b8322a", "gloss"), hand, (0, 0, a * 3), name="cup")
        elif F.get("plushie"):
            self.fig.add(bm_sphere(12, 8), R("#b68655"), hand, (0, -a * .3, a * .2), scale=(a * .9,) * 3, name="bear")
            self.fig.add(bm_sphere(12, 8), R("#b68655"), hand, (0, -a * .3, a * 1.2), scale=(a * .65,) * 3, name="bearhead")

    # ---- head, face, hair, headwear
    def head(self):
        d, F, L = self.d, self.F, self.L
        R = d["headR"]
        hp = self.fig.pivot("head", self.root, (0, 0, self.headZ))
        self.head_pivot = hp
        skin = self.m(L["skin"])
        self.fig.add(bm_sphere(28, 18), skin, hp, scale=(R, R * .95, R * .98), name="skull")
        for s in (-1, 1):
            self.fig.add(bm_sphere(10, 8), skin, hp, (s * R * .96, 0, -R * .05), scale=(R * .16, R * .1, R * .22), name="ear")
        self.face(hp, R)
        hat = None if self.helmet else F.get("hat")
        if not hat or hat not in HAT_HIDES_HAIR or hat in ("cap", "backcap", "beret", "straw", "tricorn"):
            self.hair(hp, R, under=bool(hat) or self.helmet)
        if F.get("beard"):
            bm = cut(bm_sphere(24, 14), lambda c: c.z < -.15 and c.y < .3 and not (abs(c.x) < .3 and -.5 < c.z < -.3))
            self.fig.add(bm, self.m(F["beard"]), hp, scale=(R * 1.03, R, R * 1.02), name="beard")
        if self.helmet:
            self.batting_helmet(hp, R)
        elif hat:
            self.hat(hp, R, hat)
        if F.get("band"):
            self.fig.add(bm_torus(R * 1.0, R * .09, 28, 6), self.m(F["band"]), hp, (0, 0, R * .3), name="band")

    def face(self, hp, R):
        acc, F = self.acc, self.F
        add = lambda bm, mat, loc, scale, rot=(0, 0, 0), name="face": self.fig.add(bm, mat, hp, loc, rot, scale, False, name=name)
        white, dark = self.m("#fbfaf6"), self.m("#1b1410")
        sleepy, frown, crossed = "sleepyeyes" in acc, "frown" in acc, "crossed" in acc
        for s in (-1, 1):
            ex, ez = s * R * .36, -R * .02
            add(bm_sphere(12, 8), white, (ex, -R * .88, ez), (R * .2, R * .1, R * .24 * (.55 if sleepy else 1)), name="eyewhite")
            px = ex - s * R * .07 if crossed else ex + s * R * .02
            add(bm_sphere(10, 8), dark, (px, -R * .96, ez - R * .02), (R * .1, R * .06, R * .13 * (.6 if sleepy else 1)), name="pupil")
            add(bm_box(R * .3, R * .04, R * .06, 0), self.m(shade(self.L["hairColor"], -.1)), (ex, -R * .92, ez + R * .3), (0, -s * (.25 if frown else -.1), 0), name="brow")
            if sleepy:
                add(bm_sphere(12, 8), self.m(shade(self.L["skin"], -.06)), (ex, -R * .9, ez + R * .06), (R * .22, R * .1, R * .14), name="lid")
        add(bm_sphere(10, 8), self.m(shade(self.L["skin"], -.12)), (0, -R * .98, -R * .22), (R * .1, R * .08, R * .08), name="nose")
        arc = PI * .5
        add(bm_torus(R * .25, R * .035, 16, 6, arc, (PI * 1.25 if not frown else PI * .25)), dark, (0, -R * .9, -R * .48 + (R * .26 if frown else 0) - (0 if not frown else R * .05)), (1, 1, 1), (PI / 2, 0, 0), name="mouth")
        for s in (-1, 1):
            add(bm_sphere(10, 8), self.m(shade(self.L["skin"], -.02)), (s * R * .55, -R * .78, -R * .32), (R * .16, R * .06, R * .1), name="cheek")
        if F.get("shades"):
            for s in (-1, 1):
                add(bm_box(R * .42, R * .08, R * .26, R * .06), self.m("#111111", "gloss"), (s * R * .36, -R * 1.0, -R * .02), (1, 1, 1), name="lens")
            add(bm_box(R * .3, R * .04, R * .05, 0), self.m("#111111"), (0, -R * 1.0, R * .05), (1, 1, 1), name="bridge")
        if F.get("eyepatch"):
            add(bm_cyl(R * .2, R * .2, R * .06), self.m("#111111"), (R * .36, -R * 1.0, -R * .02), (1, 1, 1), (PI / 2, 0, 0), name="patch")
            add(bm_torus(R * 1.0, R * .03, 28, 6), self.m("#111111"), (0, 0, R * .08), (1, 1, 1), (0, .35, 0), name="strap")
        if "flour" in acc:
            add(bm_sphere(8, 6), self.m("#f6f3ea"), (-R * .5, -R * .8, -R * .3), (R * .14, R * .05, R * .1), name="flourface")

    def hair_shell(self, hp, R, front=.32, back=-.45, lift=1.06, col=None):
        def keep(c):
            b = (c.y + 1) / 2
            return c.z > lerp(front, back, b)
        bm = cut(bm_sphere(28, 18), keep)
        return self.fig.add(bm, col or self.m(self.L["hairColor"]), hp, scale=(R * lift, R * lift * .97, R * lift), name="hair")

    def hair(self, hp, R, under=False):
        st, L = self.L["hair"], self.L
        hc = self.m(L["hairColor"])
        add = lambda bm, loc, scale, rot=(0, 0, 0), name="hair": self.fig.add(bm, hc, hp, loc, rot, scale, name=name)
        if st == "mohawk":
            for i in range(7):
                a = (i - 3) * .32
                add(bm_cyl(R * .14, 0, R * .5, 6), (0, math.sin(a) * R * .9, math.cos(a) * R * .95 + R * .15), (1, 1, 1), (a, 0, 0), name="spike")
            return
        self.hair_shell(hp, R, .3 if st not in ("bob", "longstraight", "shaggy") else .22, -.5 if st != "bob" else -.75)
        if under:
            return
        if st == "spiky":
            for i in range(9):
                a = (i - 4) * .32
                add(bm_cyl(R * .16, 0, R * .45, 6), (math.sin(a) * R * .75, -R * .1, math.cos(a) * R * .85 + R * .15), (1, 1, 1), (0, a, 0), name="spike")
        elif st == "bob":
            for s in (-1, 1):
                add(bm_box(R * .35, R * 1.2, R * 1.1, R * .15), (s * R * .9, R * .1, -R * .35), (1, 1, 1), name="bobside")
            add(bm_box(R * 1.3, R * .25, R * .3, R * .12), (0, -R * .82, R * .55), (1, 1, 1), name="bangs")
        elif st == "ponytail":
            add(bm_capsule(R * .22, R * 1.1), (R * .55, R * .75, R * .3), (1, 1, 1), (0, -.6, 0), name="tail")
            add(bm_sphere(10, 8), (R * .45, R * .7, R * .35), (R * .18,) * 3, name="tie")
        elif st == "side":
            add(bm_sphere(16, 10), (-R * .35, -R * .7, R * .55), (R * .6, R * .3, R * .25), (0, .4, 0), name="sweep")
        elif st == "braidsingle":
            for i in range(6):
                add(bm_sphere(10, 8), (R * (.75 + .05 * i), R * .1 - i * R * .05, -R * (.5 + i * .3)), (R * .2,) * 3, name="braid")
        elif st == "longstraight":
            add(bm_box(R * 2.15, R * .5, R * 2.0, R * .2), (0, R * .45, -R * .7), (1, 1, 1), name="long")
            add(bm_box(R * 1.3, R * .22, R * .25, R * .1), (0, -R * .85, R * .58), (1, 1, 1), name="bangs")
        elif st == "messybun":
            add(bm_sphere(14, 10), (R * .1, R * .3, R * 1.05), (R * .42, R * .42, R * .38), name="bun")
            for i in range(3):
                add(bm_capsule(R * .05, R * .45), (R * (-.6 + .5 * i), -R * .7, R * .55), (1, 1, 1), (0, (i - 1) * .4, 0), name="strand")
        elif st == "shaggy":
            for i in range(9):
                a = (i - 4) * .3
                add(bm_sphere(10, 8), (math.sin(a) * R * .95, -math.cos(a) * R * .65, R * (.35 + .05 * (i % 2))), (R * .26,) * 3, name="shag")
        elif st == "curlyshort":
            for i in range(18):
                a, b = i * 2.4, .25 + (i % 6) * .12
                add(bm_sphere(10, 8), (math.cos(a) * R * .9 * math.cos(b), math.sin(a) * R * .9 * math.cos(b), R * (.35 + .6 * math.sin(b))), (R * .26,) * 3, name="curl")

    def dome(self, hp, R, col, lift=1.1, z0=.05, kind="matte", name="dome"):
        bm = cut(bm_sphere(28, 16), lambda c: c.z > z0)
        return self.fig.add(bm, self.m(col, kind), hp, scale=(R * lift, R * lift, R * lift), name=name)

    def brim(self, hp, R, col, r, z, y=0.0, sy=1.0, thick=.06, seg=32, kind="matte"):
        return self.fig.add(bm_cyl(R * r, R * r, R * thick, seg), self.m(col, kind), hp, (0, R * y, R * z), scale=(1, sy, 1), name="brim")

    def bill(self, hp, R, col, back=False):
        y = R * (.95 if back else -.95)
        return self.fig.add(bm_box(R * 1.2, R * .9, R * .07, R * .05), self.m(col), hp, (0, y, R * .42), (.18 * (-1 if back else 1), 0, 0), name="bill")

    def hat(self, hp, R, hat):
        F = self.F
        col = F.get("hatColor") or "#c0392b"
        add = lambda bm, mat, loc, scale=(1, 1, 1), rot=(0, 0, 0), outline=True, name="hat": self.fig.add(bm, mat, hp, loc, rot, scale, outline, name=name)
        if hat in ("cap", "backcap"):
            self.dome(hp, R, col, 1.08, .15)
            self.bill(hp, R, col, hat == "backcap")
        elif hat == "hardhat":
            self.dome(hp, R, col, 1.14, .1, "gloss")
            self.brim(hp, R, col, 1.32, .18, kind="gloss")
            add(bm_box(R * .14, R * 2.1, R * .14, R * .05), self.m(shade(col, -.1)), (0, 0, R * 1.1), name="ridge")
        elif hat == "firehelmet":
            self.dome(hp, R, col, 1.14, .1, "gloss")
            self.brim(hp, R, col, 1.35, .15, y=.25, sy=1.25, kind="gloss")
            add(bm_box(R * .6, R * .06, R * .55, R * .1), self.m("#f4c542", "metal"), (0, -R * 1.05, R * .55), name="shield")
        elif hat in ("policecap", "mailcap"):
            add(bm_cyl(R * 1.02, R * 1.02, R * .32), self.m(shade(col, -.2)), (0, 0, R * .5), name="band")
            add(bm_cyl(R * 1.2, R * 1.1, R * .4), self.m(col), (0, 0, R * .82), scale=(1, 1.02, 1), name="crown")
            self.bill(hp, R, "#151515")
            if hat == "policecap":
                add(bm_cyl(R * .14, R * .14, R * .04, 6), self.m("#f4c542", "metal"), (0, -R * 1.05, R * .75), rot=(PI / 2, 0, 0), name="badge")
        elif hat == "tophat":
            add(bm_cyl(R * .72, R * .78, R * 1.3), self.m(col), (0, 0, R * 1.35), name="crown")
            self.brim(hp, R, col, 1.25, .7)
            add(bm_cyl(R * .79, R * .79, R * .2), self.m("#8e1b1b"), (0, 0, R * .86), outline=False, name="ribbon")
        elif hat == "safari":
            self.dome(hp, R, col, 1.16, .05)
            self.brim(hp, R, col, 1.45, .12, sy=1.1)
        elif hat == "aviator":
            self.dome(hp, R, col, 1.1, -.2)
            for s in (-1, 1):
                add(bm_box(R * .3, R * .6, R * .8, R * .12), self.m(col), (s * R * .95, R * .05, -R * .25), name="flap")
            self.goggles(hp, R, R * .6)
        elif hat == "beret":
            add(bm_sphere(20, 12), self.m(col), (R * .15, 0, R * .75), (R * 1.15, R * 1.05, R * .42), (0, -.25, 0), name="beret")
            add(bm_cyl(R * .06, R * .06, R * .2), self.m(col), (R * .2, 0, R * 1.2), name="nub")
        elif hat == "spacehelmet":
            add(bm_sphere(28, 18), self.m("#cfe8ff", "glass"), (0, 0, R * .05), (R * 1.45,) * 3, name="bubble")
            add(bm_torus(R * 1.2, R * .2, 32, 8), self.m(col, "gloss"), (0, 0, -R * 1.05), name="collar")
        elif hat == "scuba":
            add(bm_box(R * 1.15, R * .3, R * .55, R * .2), self.m("#bfe8f2", "glass"), (0, -R * .95, R * .02), name="mask")
            add(bm_torus(R * 1.0, R * .07, 28, 6), self.m(col), (0, 0, R * .02), name="strap")
            add(bm_capsule(R * .08, R * 1.1), self.m(col), (R * .75, -R * .3, R * 1.0), name="snorkel")
            self.hair_shell(hp, R)
        elif hat == "knighthelm":
            add(bm_cyl(R * 1.12, R * 1.1, R * 2.0, 28), self.m(col, "metal"), (0, 0, 0), name="helm")
            self.dome(hp, R, col, 1.12, 0, "metal", "helmtop")
            add(bm_box(R * 1.2, R * .1, R * .12, 0), self.m("#151515"), (0, -R * 1.1, R * .05), outline=False, name="slit")
            add(bm_sphere(12, 8), self.m(F.get("plume") or "#c0392b"), (0, R * .2, R * 1.35), (R * .25, R * .7, R * .35), name="plume")
        elif hat == "witchhat":
            self.brim(hp, R, col, 1.7, .55)
            add(bm_cyl(R * .85, 0, R * 1.9, 24), self.m(col), (R * .1, 0, R * 1.45), rot=(0, -.15, 0), name="cone")
            add(bm_cyl(R * .86, R * .8, R * .22), self.m(shade(col, .35)), (0, 0, R * .7), outline=False, name="band")
            self.hair(hp, R, under=False) if self.L["hair"] in ("longstraight", "bob") else None
        elif hat == "toque":
            add(bm_cyl(R * .95, R * 1.0, R * .5), self.m(col), (0, 0, R * .6), name="band")
            add(bm_sphere(20, 12), self.m(col), (0, 0, R * 1.25), (R * 1.15, R * 1.1, R * .7), name="puff")
        elif hat == "goggles":
            self.hair_shell(hp, R)
            self.goggles(hp, R, R * .45)
        elif hat == "ninjahood":
            bm = cut(bm_sphere(28, 18), lambda c: not (c.y < -.3 and -.25 < c.z < .2 and abs(c.x) < .75))
            add(bm, self.m(col), (0, 0, 0), (R * 1.08,) * 3, name="hood")
        elif hat == "tricorn":
            self.dome(hp, R, col, 1.06, .2)
            add(bm_cyl(R * 1.55, R * 1.4, R * .3, 3), self.m(col), (0, 0, R * .75), rot=(0, 0, PI / 2), name="tricorn")
            add(bm_cyl(R * 1.57, R * 1.57, R * .08, 3), self.m("#d4af37"), (0, 0, R * .9), rot=(0, 0, PI / 2), outline=False, name="trim")
        elif hat == "headphones":
            self.hair_shell(hp, R)
            add(bm_torus(R * 1.12, R * .08, 24, 6, PI, 0), self.m(col), (0, 0, R * .05), rot=(PI / 2, 0, 0), name="band")
            for s in (-1, 1):
                add(bm_cyl(R * .32, R * .32, R * .25), self.m(col, "gloss"), (s * R * 1.08, 0, 0), rot=(0, PI / 2, 0), name="cup")
        elif hat == "beanie":
            self.dome(hp, R, col, 1.1, .1)
            add(bm_torus(R * 1.05, R * .14, 28, 8), self.m(shade(col, -.15)), (0, 0, R * .2), name="cuff")
            add(bm_sphere(12, 8), self.m(shade(col, .3)), (0, 0, R * 1.2), (R * .28,) * 3, name="pom")
        elif hat == "straw":
            self.dome(hp, R, col, 1.07, .3)
            self.brim(hp, R, col, 1.85, .45)
            add(bm_cyl(R * .82, R * .82, R * .18), self.m("#8e1b1b"), (0, 0, R * .55), outline=False, name="ribbon")
        else:
            self.dome(hp, R, col, 1.08, .15)

    def goggles(self, hp, R, z):
        add = lambda bm, mat, loc, scale=(1, 1, 1), rot=(0, 0, 0), name="goggles": self.fig.add(bm, mat, hp, loc, rot, scale, True, name=name)
        add(bm_torus(R * 1.04, R * .07, 28, 6), self.m("#3a2a1e"), (0, 0, z))
        for s in (-1, 1):
            add(bm_cyl(R * .24, R * .26, R * .2), self.m("#9ad1e8", "gloss"), (s * R * .32, -R * .98, z), rot=(PI / 2, 0, 0), name="lens")

    def batting_helmet(self, hp, R):
        """White so the game can tint it with the batting team's colour; it renders into its own layer."""
        bm = cut(bm_sphere(28, 16), lambda c: c.z > -.15 or (c.x > .2 and c.z > -.75 and c.y > -.5))
        self.fig.add(bm, toon("#f4f4f4", "gloss"), hp, scale=(R * 1.16,) * 3, layer="helmet", name="helmet")
        self.fig.add(bm_box(R * 1.3, R * .55, R * .07, R * .05), toon("#f4f4f4", "gloss"), hp, (0, -R * 1.0, R * .28), (.2, 0, 0), layer="helmet", name="helmetbill")

    # ---- posing
    def pose(self, p):
        def setl(piv, child, a):
            piv.rotation_euler = (0, -a[0], 0)
            child.rotation_euler = (0, -(a[1] - a[0]), 0)
        setl(self.shoulders[-1], self.elbows[-1], p["la"])
        setl(self.shoulders[1], self.elbows[1], p["ra"])
        setl(self.hips[-1], self.knees[-1], p["ll"])
        setl(self.hips[1], self.knees[1], p["rl"])
        for ob in self.fig.parts:
            if ob.type == "EMPTY" and ob.name.startswith(("foot", "hand")):
                par, acc = ob.parent, 0.0
                while par is not None:
                    acc += par.rotation_euler.y
                    par = par.parent
                ob.rotation_euler = (0, -acc, 0)


# ---------------------------------------------------------------- scene and rendering
def setup_scene():
    scn = bpy.data.scenes.get("SandlotKids") or bpy.data.scenes.new("SandlotKids")
    if bpy.context.window:
        bpy.context.window.scene = scn
    for o in list(scn.collection.all_objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for eng in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
        try:
            scn.render.engine = eng
            break
        except TypeError:
            continue
    scn.render.resolution_x, scn.render.resolution_y = CELL_W, CELL_H
    scn.render.resolution_percentage = 100
    scn.render.film_transparent = True
    scn.view_settings.view_transform = "Standard"
    scn.view_settings.look = "None"
    try:
        scn.eevee.taa_render_samples = 16
    except AttributeError:
        pass
    world = bpy.data.worlds.get("kids_world") or bpy.data.worlds.new("kids_world")
    world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs["Color"].default_value = (1, 1, 1, 1)
    bg.inputs["Strength"].default_value = .35
    scn.world = world
    cam_data = bpy.data.cameras.new("kids_cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = CELL_H / PPU
    cam = bpy.data.objects.new("kids_cam", cam_data)
    scn.collection.objects.link(cam)
    cam.rotation_euler = (PI / 2, 0, 0)
    cy = (CELL_H / 2 - FOOT_Y) / PPU
    cx = (CELL_W / 2 - FOOT_X) / PPU
    cam.location = (cx, -30, -cy)
    scn.camera = cam
    sun_data = bpy.data.lights.new("kids_sun", "SUN")
    sun_data.energy = 3.0
    sun = bpy.data.objects.new("kids_sun", sun_data)
    scn.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(50), math.radians(-35), math.radians(-20))
    return scn


def project(scn, p):
    co = world_to_camera_view(scn, scn.camera, p)
    return (round(co.x * CELL_W, 1), round((1 - co.y) * CELL_H, 1))


def render_cell(scn, path):
    scn.render.filepath = path
    scn.render.image_settings.file_format = "PNG"
    scn.render.image_settings.color_mode = "RGBA"
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(path, check_existing=False)
    px = np.array(img.pixels[:], dtype=np.float32).reshape(CELL_H, CELL_W, 4)
    bpy.data.images.remove(img)
    return px


def build_kid(scn, kid, tmp):
    frames = frames_for(kid)
    sets = {}
    for st, name, pose in frames:
        sets.setdefault(st, []).append((name, pose))
    atlas = np.zeros((CELL_H * math.ceil(len(frames) / COLS), CELL_W * COLS, 4), dtype=np.float32)
    meta, index = [], 0
    for st in ("g", "n", "b", "h"):
        if st not in sets:
            continue
        for o in list(scn.collection.all_objects):
            if o.type not in ("CAMERA", "LIGHT"):
                bpy.data.objects.remove(o, do_unlink=True)
        k = Kid(scn, kid, glove=st == "g", helmet=st in ("b", "h"), props=st == "n")
        if st == "b":
            for ob in k.fig.layers.get("helmet", []):
                ob.hide_render = True
        if st == "h":
            for ob in k.fig.parts:
                if ob.type in ("MESH", "FONT") and ob not in k.fig.layers.get("helmet", []):
                    ob.is_holdout = True
        for name, pose in sets[st]:
            k.pose(pose)
            bpy.context.view_layer.update()
            px = render_cell(scn, os.path.join(tmp, "cell.png"))
            r, c = divmod(index, COLS)
            atlas[(atlas.shape[0] - (r + 1) * CELL_H):(atlas.shape[0] - r * CELL_H), c * CELL_W:(c + 1) * CELL_W] = px
            hw = lambda ob: project(scn, ob.matrix_world.translation)
            meta.append({"set": st, "pose": name, "la": pose["la"], "ra": pose["ra"], "ll": pose["ll"], "rl": pose["rl"],
                         "hands": {"-1": hw(k.hands[-1]), "1": hw(k.hands[1])}, "head": hw(k.head_pivot),
                         "chest": project(scn, k.root.matrix_world @ k.chest)})
            index += 1
    return atlas, meta, k.g_side


def save_webp(scn, atlas, path):
    h, w = atlas.shape[:2]
    img = bpy.data.images.new("kid_atlas", w, h, alpha=True)
    img.pixels.foreach_set(atlas.ravel())
    s = scn.render.image_settings
    s.file_format = "WEBP"
    s.color_mode = "RGBA"
    s.quality = 90
    img.save_render(path, scene=scn)
    bpy.data.images.remove(img)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    only = set(int(x) for x in (argv or os.environ.get("SANDLOT_KIDS", "").replace(",", " ").split()) if str(x).isdigit())
    kids = [k for k in roster() if not only or k["id"] in only]
    scn = setup_scene()
    os.makedirs(OUT_DIR, exist_ok=True)
    index_path = os.path.join(OUT_DIR, "kids.json")
    index = json.load(open(index_path)) if os.path.exists(index_path) else {}
    index.update({"version": 1, "cell": [CELL_W, CELL_H], "foot": [FOOT_X, FOOT_Y], "ppu": PPU, "cols": COLS})
    index.setdefault("kids", {})
    with tempfile.TemporaryDirectory() as tmp:
        for kid in kids:
            atlas, meta, g_side = build_kid(scn, kid, tmp)
            save_webp(scn, atlas, os.path.join(OUT_DIR, "%d.webp" % kid["id"]))
            index["kids"][str(kid["id"])] = {"frames": meta, "gloveSide": g_side, "rows": math.ceil(len(meta) / COLS)}
            print("kid", kid["id"], kid["nick"], len(meta), "frames")
    with open(index_path, "w") as f:
        json.dump(index, f, separators=(",", ":"))
    if not os.environ.get("SANDLOT_KEEP"):
        for o in list(scn.collection.all_objects):
            if o.type not in ("CAMERA", "LIGHT"):
                bpy.data.objects.remove(o, do_unlink=True)


if __name__ == "__main__":
    main()
