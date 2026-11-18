"""
Blender build of Montello's everyday detail parts: the house kit, the business kit and the ball-field kit (run with
`blender -b -P modules-src/tello/tools/build-town-kit.py -- house places fields`, then `pnpm assets` and commit
`public/models/tello/`). It reuses the part builder and exporter of build-montello.py.

  assets-src/models/tello/house-kit.glb   window-house, window-small, door-entry, door-garage, shutter, porch, stoop,
                                          chimney-cap, gutter, downspout, ac-unit: laid onto every house, garage and shed
                                          by world/HouseDetails.ts (kept low-poly: there are thousands of houses).
  assets-src/models/tello/places-kit.glb  pump, island, bollard, school-bus, lot-light, cart-corral, rtu, dock-door,
                                          wall-pack, entry-canopy: fuel stations, the grocery, the depot, the school
                                          and the lots (world/Businesses.ts, world/School.ts, world/Lots.ts).
  assets-src/models/tello/fields-kit.glb  base, plate, rubber, backstop, dugout, bleacher, fence-panel, fence-post,
                                          scoreboard: the baseball and softball fields (world/BallFields.ts);
                                          golf-flag, tee-marker, ball-washer, golf-bench, hole-sign: the golf course
                                          (world/GolfCourse.ts).

Every object is a root node named for the part; material names are the slots the page paints (trim, wall, stone, door,
garage, shingle, metal, glass, lit, wood, brick, paint). Parts face -Y in Blender (the glTF +Z the page faces them out
by), stand on z = 0 and are made of closed convex pieces, so no normals are guessed. Units are metres.
With `--preview`, also renders contact sheets to docs/tello/landmarks/. Deterministic.
"""
import importlib.util
import math
import os
import sys

os.environ['TELLO_KIT_IMPORT'] = '1'
HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('buildmont', os.path.join(HERE, 'build-montello.py'))
bm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bm)

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

bm.SLOT_COLORS.update({
    'garage': (0.93, 0.92, 0.88), 'lit': (1.0, 0.85, 0.55), 'paint': (0.85, 0.85, 0.82), 'dirt': (0.62, 0.5, 0.36),
    'bus': (0.96, 0.7, 0.05), 'black': (0.05, 0.05, 0.06),
})
DOCS = os.path.normpath(os.path.join(HERE, '..', '..', '..', 'docs', 'tello', 'landmarks'))


def solid(p, pts, faces, slot, color=None):
    """A closed convex solid from points and faces (vertex index lists); every face is wound to look outward."""
    c = Vector((0, 0, 0))
    for q in pts:
        c += Vector(q)
    c /= len(pts)
    for f in faces:
        vs = [Vector(pts[i]) for i in f]
        n = (vs[1] - vs[0]).cross(vs[2] - vs[0])
        mid = sum(vs, Vector((0, 0, 0))) / len(vs)
        if n.dot(mid - c) < 0:
            vs.reverse()
        p.face(vs, slot, color)


BOX_FACES = {'bottom': (0, 1, 3, 2), 'top': (4, 5, 7, 6), 'front': (0, 1, 5, 4), 'back': (2, 3, 7, 6), 'left': (0, 2, 6, 4), 'right': (1, 3, 7, 5)}


def bx(p, x0, y0, z0, x1, y1, z1, slot, color=None, skip=()):
    """A box whose front is the y0 side (out is -Y); `skip` leaves faces off (front, back, left, right, top, bottom)."""
    pts = [(x, y, z) for z in (z0, z1) for y in (y0, y1) for x in (x0, x1)]
    c = Vector((x0 + x1, y0 + y1, z0 + z1)) / 2
    for name, f in BOX_FACES.items():
        if name in skip:
            continue
        vs = [Vector(pts[i]) for i in f]
        n = (vs[1] - vs[0]).cross(vs[2] - vs[0])
        mid = sum(vs, Vector((0, 0, 0))) / 4
        if n.dot(mid - c) < 0:
            vs.reverse()
        p.face(vs, slot, color)


def hull_prism(p, prof, x0, x1, slot, color=None, skip_caps=False):
    """A convex (y, z) profile swept along x from x0 to x1."""
    n = len(prof)
    a = [(x0, y, z) for y, z in prof]
    b = [(x1, y, z) for y, z in prof]
    pts = a + b
    faces = [[i, (i + 1) % n, n + (i + 1) % n, n + i] for i in range(n)]
    if not skip_caps:
        faces += [list(range(n)), list(range(n, 2 * n))]
    solid(p, pts, faces, slot, color)


def cyl(p, cx, cy, z0, z1, r, slot, seg=6, color=None, axis='z'):
    pts = []
    for z in (z0, z1):
        for i in range(seg):
            a = 2 * math.pi * i / seg
            u, v = math.cos(a) * r, math.sin(a) * r
            pts.append((cx + u, cy + v, z) if axis == 'z' else (z, cy + u, cx + v))
    faces = [[i, (i + 1) % seg, seg + (i + 1) % seg, seg + i] for i in range(seg)]
    faces += [list(range(seg)), list(range(seg, 2 * seg))]
    solid(p, pts, faces, slot, color)


def fquad(p, x0, z0, x1, z1, y, slot, color=None):
    """A single quad facing out (-Y) at depth y."""
    p.face([Vector((x0, y, z0)), Vector((x1, y, z0)), Vector((x1, y, z1)), Vector((x0, y, z1))], slot, color)


def finish(p, smooth=30):
    return p.finish(bevel=0.0, smooth_angle=smooth, recalc=False)


# ---------------------------------------------------------------- house kit

def window_house(name='window-house', W=1.0, H=1.4, grid=True):
    p = bm.Part(name)
    c = 0.09
    sk = ('back', 'bottom')
    bx(p, -W / 2 - c, -0.05, 0, -W / 2, 0, H + c, 'trim', skip=sk)
    bx(p, W / 2, -0.05, 0, W / 2 + c, 0, H + c, 'trim', skip=sk)
    bx(p, -W / 2 - c - 0.02, -0.065, H, W / 2 + c + 0.02, 0, H + c + 0.03, 'trim', skip=('back',))
    bx(p, -W / 2 - c, -0.1, -0.05, W / 2 + c, 0, 0.03, 'trim', skip=('back', 'bottom'))
    fquad(p, -W / 2, 0.02, W / 2, H, -0.012, 'glass')
    if grid:
        bx(p, -0.014, -0.03, 0.02, 0.014, -0.01, H, 'trim', skip=('back', 'bottom', 'top'))
        bx(p, -W / 2, -0.03, H / 2 - 0.02, W / 2, -0.01, H / 2 + 0.02, 'trim', skip=('back', 'bottom', 'top'))
    return finish(p)


def door_entry():
    p = bm.Part('door-entry')
    W, H = 1.0, 2.1
    sk = ('back', 'bottom')
    bx(p, -W / 2 - 0.1, -0.06, 0, -W / 2, 0, H + 0.1, 'trim', skip=sk)
    bx(p, W / 2, -0.06, 0, W / 2 + 0.1, 0, H + 0.1, 'trim', skip=sk)
    bx(p, -W / 2 - 0.12, -0.075, H, W / 2 + 0.12, 0, H + 0.12, 'trim', skip=('back',))
    bx(p, -W / 2, -0.05, 0, W / 2, -0.01, H, 'door', skip=('back', 'bottom'))
    for cx in (-0.2, 0.2):
        for z0, z1 in ((0.15, 0.85), (0.95, 1.45)):
            bx(p, cx - 0.14, -0.065, z0, cx + 0.14, -0.05, z1, 'door', skip=('back', 'bottom'))
        fquad(p, cx - 0.12, 1.58, cx + 0.12, 1.98, -0.06, 'glass')
    bx(p, 0.3, -0.09, 1.0, 0.4, -0.05, 1.04, 'metal', skip=('back',))
    bx(p, -W / 2 - 0.08, -0.14, -0.02, W / 2 + 0.08, -0.01, 0.03, 'stone', skip=('back', 'bottom'))
    return finish(p)


def door_garage():
    p = bm.Part('door-garage')
    W, H = 2.6, 2.2
    sk = ('back', 'bottom')
    bx(p, -W / 2 - 0.1, -0.06, 0, -W / 2, 0, H + 0.1, 'trim', skip=sk)
    bx(p, W / 2, -0.06, 0, W / 2 + 0.1, 0, H + 0.1, 'trim', skip=sk)
    bx(p, -W / 2 - 0.1, -0.06, H, W / 2 + 0.1, 0, H + 0.1, 'trim', skip=('back',))
    bx(p, -W / 2, -0.04, 0, W / 2, -0.01, H, 'garage', skip=('back', 'bottom'))
    for k in range(1, 4):
        z = H * k / 4
        bx(p, -W / 2, -0.05, z - 0.015, W / 2, -0.04, z + 0.015, 'metal', skip=('back', 'bottom'))
    n = 4
    for i in range(n):
        x0 = -W / 2 + 0.12 + i * (W - 0.24) / n
        fquad(p, x0 + 0.04, H * 3 / 4 + 0.08, x0 + (W - 0.24) / n - 0.04, H - 0.1, -0.045, 'glass')
    bx(p, 0.0, -0.07, 1.0, 0.18, -0.045, 1.05, 'metal', skip=('back',))
    return finish(p)


def shutter():
    p = bm.Part('shutter')
    W, H = 0.42, 1.4
    bx(p, -W / 2, -0.04, 0, W / 2, -0.015, H, 'door', skip=('back', 'bottom'))
    for k in range(6):
        z = 0.15 + k * 0.2
        bx(p, -W / 2 + 0.05, -0.055, z, W / 2 - 0.05, -0.04, z + 0.06, 'door', skip=('back', 'bottom'))
    return finish(p)


def porch():
    p = bm.Part('porch')
    sk = ('back', 'bottom')
    bx(p, -1.5, -1.7, 0, 1.5, 0, 0.22, 'stone', skip=('back', 'bottom'))
    bx(p, -0.65, -2.0, 0, 0.65, -1.7, 0.147, 'stone', skip=('back', 'bottom'))
    bx(p, -0.65, -2.3, 0, 0.65, -2.0, 0.073, 'stone', skip=('back', 'bottom'))
    for sx in (-1.4, 1.4):
        bx(p, sx - 0.11, -1.61, 0.22, sx + 0.11, -1.39, 0.5, 'trim', skip=('bottom',))
        bx(p, sx - 0.07, -1.57, 0.5, sx + 0.07, -1.43, 2.2, 'trim', skip=('bottom', 'top'))
        bx(p, sx - 0.1, -1.6, 2.2, sx + 0.1, -1.4, 2.28, 'trim', skip=('bottom',))
        bx(p, sx - 0.02, -0.95 - 0.05, 0.22, sx + 0.02, -0.95 + 0.05, 0.95, 'trim', skip=('bottom', 'top'))
    for sx in (-1.4, 1.4):
        step = 1 if sx < 0 else -1
        xa, xb = sx, sx + step * 0.65
        lo, hi = min(xa, xb), max(xa, xb)
        bx(p, lo, -1.6, 0.9, hi, -1.5, 0.96, 'trim', skip=('back', 'bottom'))
        bx(p, lo, -1.6, 0.28, hi, -1.5, 0.32, 'trim', skip=('back', 'bottom'))
        for k in range(1, 4):
            x = lo + (hi - lo) * k / 4
            bx(p, x - 0.015, -1.56, 0.32, x + 0.015, -1.54, 0.9, 'trim', skip=('back', 'bottom'))
    bx(p, -1.55, -1.75, 2.28, 1.55, -1.45, 2.38, 'trim', skip=('bottom',))
    hull_prism(p, [(0.0, 2.72), (-1.95, 2.36), (-1.95, 2.45), (0.0, 2.82)], -1.65, 1.65, 'shingle')
    bx(p, -1.65, -1.97, 2.34, 1.65, -1.91, 2.5, 'trim', skip=('back', 'bottom'))
    return finish(p)


def stoop():
    p = bm.Part('stoop')
    bx(p, -0.75, -1.0, 0, 0.75, 0, 0.2, 'stone', skip=('back', 'bottom'))
    bx(p, -0.65, -1.35, 0, 0.65, -1.0, 0.1, 'stone', skip=('back', 'bottom'))
    for sx in (-0.7, 0.7):
        bx(p, sx - 0.03, -0.9, 2.0, sx + 0.03, -0.1, 2.08, 'trim', skip=('bottom',))
        bx(p, sx - 0.04, -0.95, 1.7, sx + 0.04, -0.87, 2.0, 'trim', skip=('bottom',))
    hull_prism(p, [(0.0, 2.55), (-1.0, 2.3), (-1.0, 2.37), (0.0, 2.63)], -0.85, 0.85, 'shingle')
    bx(p, -0.85, -1.02, 2.28, 0.85, -0.97, 2.4, 'trim', skip=('back', 'bottom'))
    return finish(p)


def chimney_cap():
    p = bm.Part('chimney-cap')
    for k, h in enumerate((0.38, 0.41, 0.44)):
        bx(p, -h, -h, k * 0.09, h, h, k * 0.09 + 0.09, 'brick', skip=('bottom',))
    bx(p, -0.47, -0.47, 0.27, 0.47, 0.47, 0.35, 'stone', skip=('bottom',))
    for cx in (-0.17, 0.17):
        cyl(p, cx, 0, 0.35, 0.78, 0.13, 'metal', seg=6)
    return finish(p)


def gutter():
    p = bm.Part('gutter')
    bx(p, 0, -0.03, -0.17, 1, 0, 0.03, 'trim', skip=('back', 'left', 'right'))
    hull_prism(p, [(-0.03, 0.03), (-0.14, 0.03), (-0.14, -0.04), (-0.12, -0.1), (-0.07, -0.13), (-0.03, -0.13)], 0, 1, 'metal', skip_caps=True)
    return finish(p)


def downspout():
    p = bm.Part('downspout')
    bx(p, -0.04, -0.09, 0, 0.04, -0.01, 1.0, 'metal', skip=('back', 'bottom', 'top'))
    return finish(p)


def ac_unit():
    p = bm.Part('ac-unit')
    bx(p, -0.45, -0.8, 0, 0.45, 0, 0.8, 'metal', skip=('bottom',))
    cyl(p, 0, -0.4, 0.8, 0.84, 0.3, 'black', seg=8)
    return finish(p)


def build_house():
    bm.reset()
    window_house()
    window_house('window-small', 0.6, 0.9, grid=False)
    door_entry()
    door_garage()
    shutter()
    porch()
    stoop()
    chimney_cap()
    gutter()
    downspout()
    ac_unit()
    export('house-kit.glb')


# ---------------------------------------------------------------- places kit

def pump():
    p = bm.Part('pump')
    bx(p, -0.3, -0.2, 0, 0.3, 0.2, 1.35, 'wall', skip=('bottom',))
    bx(p, -0.33, -0.23, 1.35, 0.33, 0.23, 1.47, 'metal', skip=('bottom',))
    bx(p, -0.25, -0.215, 0.95, 0.25, -0.2, 1.28, 'black', skip=('back', 'bottom', 'top'))
    bx(p, -0.25, 0.2, 0.95, 0.25, 0.215, 1.28, 'black', skip=('front', 'bottom', 'top'))
    fquad(p, -0.2, 1.05, 0.2, 1.22, -0.217, 'lit')
    bx(p, -0.12, -0.23, 0.5, 0.12, -0.2, 0.9, 'metal', skip=('back', 'bottom'))
    bx(p, -0.12, 0.2, 0.5, 0.12, 0.23, 0.9, 'metal', skip=('front', 'bottom'))
    for sy in (-1, 1):
        bx(p, 0.34, sy * 0.1 - 0.02, 0.3, 0.37, sy * 0.1 + 0.02, 1.2, 'black', skip=('bottom',))
    return finish(p)


def island():
    p = bm.Part('island')
    bx(p, -0.5, -0.55, 0, 0.5, 0.55, 0.18, 'stone', skip=('bottom',))
    return finish(p)


def bollard():
    p = bm.Part('bollard')
    cyl(p, 0, 0, 0, 0.95, 0.1, 'paint', seg=8)
    return finish(p)


def school_bus():
    p = bm.Part('school-bus')
    L, Wd = 10.6, 2.4
    bx(p, -L / 2, -Wd / 2, 0.55, L / 2 - 2.0, Wd / 2, 2.55, 'bus', skip=('bottom',))
    bx(p, L / 2 - 2.0, -Wd / 2 + 0.05, 0.55, L / 2, Wd / 2 - 0.05, 1.5, 'bus', skip=('bottom',))
    bx(p, -L / 2 - 0.12, -Wd / 2, 0.5, -L / 2, Wd / 2, 1.0, 'black', skip=('bottom',))
    bx(p, L / 2, -Wd / 2 + 0.05, 0.5, L / 2 + 0.14, Wd / 2 - 0.05, 0.95, 'black', skip=('bottom',))
    bx(p, -L / 2, -Wd / 2 - 0.01, 1.18, L / 2 - 2.0, -Wd / 2, 1.28, 'black', skip=('back', 'bottom'))
    bx(p, -L / 2, Wd / 2, 1.18, L / 2 - 2.0, Wd / 2 + 0.01, 1.28, 'black', skip=('front', 'bottom'))
    n = 9
    span = L - 2.6
    for i in range(n):
        x0 = -L / 2 + 0.5 + i * span / n
        x1 = x0 + span / n - 0.14
        for sy, yy in ((-1, -Wd / 2 - 0.02), (1, Wd / 2 + 0.02)):
            p.face([Vector((x0, yy, 1.5)), Vector((x1, yy, 1.5)), Vector((x1, yy, 2.2)), Vector((x0, yy, 2.2))] if sy < 0 else
                   [Vector((x1, yy, 1.5)), Vector((x0, yy, 1.5)), Vector((x0, yy, 2.2)), Vector((x1, yy, 2.2))], 'glass')
    xf = L / 2 - 2.0
    p.face([Vector((xf + 0.01, -1.0, 1.55)), Vector((xf + 0.01, 1.0, 1.55)), Vector((xf + 0.01, 1.0, 2.3)), Vector((xf + 0.01, -1.0, 2.3))], 'glass')
    for wx in (-3.4, 2.9):
        for sy in (-1, 1):
            pts = []
            r = 0.5
            for i in range(10):
                a = 2 * math.pi * i / 10
                pts.append((wx + math.cos(a) * r, sy * (Wd / 2 - 0.1) - 0.14, 0.5 + math.sin(a) * r))
                pts.append((wx + math.cos(a) * r, sy * (Wd / 2 - 0.1) + 0.14, 0.5 + math.sin(a) * r))
            faces = [[2 * i, 2 * i + 1, (2 * i + 3) % 20, (2 * i + 2) % 20] for i in range(10)]
            faces += [[2 * i for i in range(10)], [2 * i + 1 for i in range(10)]]
            solid(p, pts, faces, 'black')
    bx(p, -L / 2 + 0.2, -Wd / 2 + 0.2, 2.55, L / 2 - 2.2, Wd / 2 - 0.2, 2.62, 'bus', skip=('bottom',))
    return finish(p)


def lot_light():
    p = bm.Part('lot-light')
    cyl(p, 0, 0, 0, 0.55, 0.22, 'stone', seg=8)
    cyl(p, 0, 0, 0.55, 8.6, 0.09, 'metal', seg=8)
    bx(p, -1.0, -0.06, 8.5, 1.0, 0.06, 8.6, 'metal', skip=('bottom',))
    for sx in (-1.0, 1.0):
        bx(p, sx - 0.45, -0.22, 8.28, sx + 0.45, 0.22, 8.5, 'metal', skip=('bottom',))
        p.face([Vector((sx - 0.4, -0.2, 8.28)), Vector((sx + 0.4, -0.2, 8.28)), Vector((sx + 0.4, 0.2, 8.28)), Vector((sx - 0.4, 0.2, 8.28))], 'lit')
    return finish(p)


def cart_corral():
    p = bm.Part('cart-corral')
    for sx in (-0.4, 0.4):
        bx(p, sx - 0.02, -1.9, 0.0, sx + 0.02, -1.86, 1.1, 'metal', skip=('bottom',))
        bx(p, sx - 0.02, 1.86, 0.0, sx + 0.02, 1.9, 1.1, 'metal', skip=('bottom',))
        bx(p, sx - 0.02, -1.9, 1.05, sx + 0.02, 1.9, 1.1, 'metal', skip=('bottom',))
        bx(p, sx - 0.02, -1.9, 0.5, sx + 0.02, 1.9, 0.54, 'metal', skip=('bottom',))
    bx(p, -0.4, -1.9, 1.05, 0.4, -1.86, 1.1, 'metal', skip=('bottom',))
    bx(p, -0.4, 1.86, 1.05, 0.4, 1.9, 1.1, 'metal', skip=('bottom',))
    return finish(p)


def rtu():
    p = bm.Part('rtu')
    bx(p, -0.9, -0.55, 0, 0.9, 0.55, 0.8, 'metal', skip=('bottom',))
    cyl(p, 0.4, 0, 0.8, 0.9, 0.3, 'black', seg=8)
    bx(p, -0.9, -0.55, 0.8, -0.1, 0.55, 0.88, 'paint', skip=('bottom',))
    return finish(p)


def dock_door():
    p = bm.Part('dock-door')
    W, H, Z = 2.5, 2.7, 1.2
    bx(p, -W / 2 - 0.15, -0.1, Z - 0.1, -W / 2, 0, Z + H + 0.15, 'black', skip=('back', 'bottom'))
    bx(p, W / 2, -0.1, Z - 0.1, W / 2 + 0.15, 0, Z + H + 0.15, 'black', skip=('back', 'bottom'))
    bx(p, -W / 2 - 0.15, -0.1, Z + H, W / 2 + 0.15, 0, Z + H + 0.15, 'black', skip=('back', 'bottom'))
    bx(p, -W / 2, -0.08, Z, W / 2, -0.02, Z + H, 'garage', skip=('back', 'bottom'))
    for k in range(1, 6):
        z = Z + H * k / 6
        bx(p, -W / 2, -0.09, z - 0.012, W / 2, -0.08, z + 0.012, 'metal', skip=('back', 'bottom'))
    for sx in (-1.0, 1.0):
        bx(p, sx - 0.15, -0.25, Z - 0.2, sx + 0.15, 0, Z + 0.2, 'black', skip=('back', 'bottom'))
    bx(p, -1.35, -0.95, 0, 1.35, -0.25, Z - 0.05, 'stone', skip=('back', 'bottom'))
    bx(p, -0.3, -0.18, Z + H + 0.25, 0.3, 0, Z + H + 0.45, 'metal', skip=('back', 'bottom'))
    return finish(p)


def wall_pack():
    p = bm.Part('wall-pack')
    bx(p, -0.25, -0.22, 0, 0.25, 0, 0.18, 'metal', skip=('back', 'bottom'))
    p.face([Vector((-0.22, -0.2, 0)), Vector((0.22, -0.2, 0)), Vector((0.22, -0.02, 0)), Vector((-0.22, -0.02, 0))], 'lit')
    return finish(p)


def entry_canopy():
    p = bm.Part('entry-canopy')
    W, D = 4.0, 2.4
    bx(p, -W / 2, -D, 3.3, W / 2, 0, 3.55, 'paint', skip=('back',))
    bx(p, -W / 2 - 0.05, -D - 0.05, 3.5, W / 2 + 0.05, 0.0, 3.62, 'trim', skip=('back', 'bottom'))
    for sx in (-W / 2 + 0.15, W / 2 - 0.15):
        bx(p, sx - 0.1, -D + 0.1, 0, sx + 0.1, -D + 0.3, 3.3, 'stone', skip=('bottom',))
    p.face([Vector((-W / 2 + 0.3, -D + 0.2, 3.299)), Vector((W / 2 - 0.3, -D + 0.2, 3.299)), Vector((W / 2 - 0.3, -0.2, 3.299)), Vector((-W / 2 + 0.3, -0.2, 3.299))][::-1], 'lit')
    return finish(p)


def build_places():
    bm.reset()
    pump()
    island()
    bollard()
    school_bus()
    lot_light()
    cart_corral()
    rtu()
    dock_door()
    wall_pack()
    entry_canopy()
    export('places-kit.glb')


# ---------------------------------------------------------------- fields kit

def base():
    p = bm.Part('base')
    bx(p, -0.19, -0.19, 0, 0.19, 0.19, 0.08, 'trim', skip=('bottom',))
    return finish(p)


def plate():
    p = bm.Part('plate')
    pts = [(-0.216, 0.0), (0.216, 0.0), (0.216, 0.216), (0.0, 0.432), (-0.216, 0.216)]
    verts = [(x, y, z) for z in (0.0, 0.03) for x, y in pts]
    faces = [[i, (i + 1) % 5, 5 + (i + 1) % 5, 5 + i] for i in range(5)] + [list(range(5)), list(range(5, 10))]
    solid(p, verts, faces, 'trim')
    return finish(p)


def rubber():
    p = bm.Part('rubber')
    bx(p, -0.3, -0.075, 0, 0.3, 0.075, 0.04, 'trim', skip=('bottom',))
    return finish(p)


def backstop():
    p = bm.Part('backstop')
    H = 6.0
    segs = [((-3.65, 0.0), (3.65, 0.0)), ((-3.65, 0.0), (-6.4, -2.75)), ((3.65, 0.0), (6.4, -2.75))]
    posts = []
    for (ax, ay), (bxx, by) in segs:
        for t in (0, 1):
            posts.append((ax + (bxx - ax) * t, ay + (by - ay) * t))
    seen = set()
    for x, y in posts:
        if (round(x, 2), round(y, 2)) in seen:
            continue
        seen.add((round(x, 2), round(y, 2)))
        cyl(p, x, y, 0, H, 0.07, 'metal', seg=6)
    for (ax, ay), (bxx, by) in segs:
        n = max(2, int(math.hypot(bxx - ax, by - ay) / 0.45))
        for z in (0.1, H * 0.5, H - 0.05):
            pts = [(ax, ay - 0.02, z - 0.025), (bxx, by - 0.02, z - 0.025), (bxx, by + 0.02, z - 0.025), (ax, ay + 0.02, z - 0.025),
                   (ax, ay - 0.02, z + 0.025), (bxx, by - 0.02, z + 0.025), (bxx, by + 0.02, z + 0.025), (ax, ay + 0.02, z + 0.025)]
            solid(p, pts, [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]], 'metal')
        for i in range(1, n):
            t = i / n
            x, y = ax + (bxx - ax) * t, ay + (by - ay) * t
            dx, dy = (bxx - ax), (by - ay)
            ln = math.hypot(dx, dy)
            nx, ny = -dy / ln * 0.012, dx / ln * 0.012
            pts = [(x - nx, y - ny, 0.1), (x + nx, y + ny, 0.1), (x + nx, y + ny, H - 0.05), (x - nx, y - ny, H - 0.05)]
            p.face([Vector(v) for v in pts], 'metal')
            p.face([Vector(v) for v in pts][::-1], 'metal')
    bx(p, -3.65, -0.2, H, 3.65, 0.2, H + 0.08, 'metal', skip=('bottom',))
    return finish(p)


def dugout():
    p = bm.Part('dugout')
    L, D = 9.0, 2.6
    bx(p, -L / 2, 0, 0, L / 2, D, 0.1, 'stone', skip=('bottom',))
    bx(p, -L / 2, D - 0.2, 0.1, L / 2, D, 2.2, 'stone', skip=('bottom', 'top'))
    for sx in (-L / 2, L / 2 - 0.2):
        bx(p, sx, 0, 0.1, sx + 0.2, D, 2.0, 'stone', skip=('bottom',))
    bx(p, -L / 2 + 0.5, D - 0.75, 0.1, L / 2 - 0.5, D - 0.3, 0.5, 'wood', skip=('bottom',))
    bx(p, -L / 2 + 0.5, D - 0.4, 0.5, L / 2 - 0.5, D - 0.3, 1.0, 'wood', skip=('bottom',))
    hull_prism(p, [(-0.35, 2.05), (D + 0.1, 2.35), (D + 0.1, 2.4), (-0.35, 2.1)], -L / 2 - 0.2, L / 2 + 0.2, 'metal')
    for sx in (-L / 2 + 0.1, L / 2 - 0.1):
        cyl(p, sx, 0.05, 0.1, 2.05, 0.07, 'metal', seg=6)
    n = 14
    for i in range(n + 1):
        x = -L / 2 + 0.2 + (L - 0.4) * i / n
        bx(p, x - 0.012, 0.03, 0.1, x + 0.012, 0.05, 1.2, 'metal', skip=('back', 'bottom', 'top'))
    bx(p, -L / 2, 0.0, 1.2, L / 2, 0.1, 1.27, 'metal', skip=('bottom',))
    return finish(p)


def bleacher():
    p = bm.Part('bleacher')
    L = 4.6
    for k in range(4):
        y0 = -k * 0.0 + k * 0.8
        z = 0.5 + k * 0.4
        bx(p, -L / 2, y0, z, L / 2, y0 + 0.28, z + 0.05, 'metal', skip=('bottom',))
        bx(p, -L / 2, y0 + 0.28, z - 0.4, L / 2, y0 + 0.3, z, 'metal', skip=('bottom', 'top'))
    for sx in (-L / 2 + 0.1, 0.0, L / 2 - 0.1):
        hull_prism(p, [(0.0, 0.0), (0.0, 0.5), (3.2, 1.8), (3.2, 0.0)], sx - 0.02, sx + 0.02, 'metal')
    bx(p, -L / 2, 3.1, 1.9, L / 2, 3.15, 2.5, 'metal', skip=('bottom', 'back'))
    bx(p, -L / 2, 3.1, 2.45, L / 2, 3.15, 2.5, 'metal', skip=('bottom',))
    return finish(p)


def fence_panel():
    p = bm.Part('fence-panel')
    L, H = 3.0, 1.2
    bx(p, -0.04, -0.04, 0, 0.04, 0.04, H + 0.05, 'metal', skip=('bottom',))
    bx(p, 0.0, -0.05, H - 0.02, L, 0.05, H + 0.05, 'trim', skip=('bottom', 'left'))
    bx(p, 0.0, -0.015, 0.05, L, 0.015, 0.08, 'metal', skip=('bottom', 'left', 'right'))
    n = 12
    for i in range(1, n):
        x = L * i / n
        bx(p, x - 0.008, -0.008, 0.05, x + 0.008, 0.008, H - 0.02, 'metal', skip=('bottom', 'top'))
    return finish(p)


def scoreboard():
    p = bm.Part('scoreboard')
    for sx in (-1.6, 1.6):
        bx(p, sx - 0.1, -0.1, 0, sx + 0.1, 0.1, 3.4, 'metal', skip=('bottom',))
    bx(p, -2.2, -0.12, 2.2, 2.2, 0.12, 4.6, 'black', skip=('bottom',))
    bx(p, -2.1, -0.13, 2.3, 2.1, -0.12, 4.5, 'wall', skip=('back', 'bottom', 'top', 'left', 'right'))
    return finish(p)


def golf_flag():
    """The flagstick in its cup: a white cup liner flush with the green, a 2.3 m pin and a flag (`paint`, coloured per hole)."""
    p = bm.Part('golf-flag')
    cyl(p, 0, 0, -0.1, 0.012, 0.054, 'trim', seg=10)
    cyl(p, 0, 0, 0.0, 2.3, 0.0095, 'trim', seg=6)
    for k in range(5):
        z = 0.25 + k * 0.4
        cyl(p, 0, 0, z, z + 0.2, 0.0105, 'black', seg=6)
    bx(p, 0.01, -0.004, 1.88, 0.52, 0.004, 2.24, 'paint', skip=('bottom',))
    return finish(p)


def tee_marker():
    """A tee marker: a coloured ball (`paint`) on a short spike."""
    p = bm.Part('tee-marker')
    cyl(p, 0, 0, 0, 0.06, 0.012, 'metal', seg=6)
    pts = []
    r = 0.09
    for i in range(5):
        el = -math.pi / 2 + math.pi * i / 4
        for j in range(8):
            az = 2 * math.pi * j / 8
            pts.append((math.cos(el) * math.cos(az) * r, math.cos(el) * math.sin(az) * r, 0.15 + math.sin(el) * r))
    faces = []
    for i in range(4):
        for j in range(8):
            a = i * 8 + j; b = i * 8 + (j + 1) % 8
            faces.append([a, b, b + 8, a + 8])
    for f in faces:
        vs = [Vector(pts[k]) for k in f]
        n = (vs[1] - vs[0]).cross(vs[2] - vs[0])
        mid = sum(vs, Vector((0, 0, 0))) / 4
        if n.dot(mid - Vector((0, 0, 0.15))) < 0:
            vs.reverse()
        p.face(vs, 'paint')
    return finish(p, smooth=80)


def ball_washer():
    """A ball washer on its post with a towel hook and a small litter bin."""
    p = bm.Part('ball-washer')
    cyl(p, 0, 0, 0, 0.95, 0.035, 'metal', seg=6)
    bx(p, -0.13, -0.09, 0.82, 0.13, 0.09, 1.08, 'paint', skip=('bottom',))
    cyl(p, 0.0, 0.0, 1.08, 1.32, 0.012, 'metal', seg=6)
    bx(p, -0.04, -0.04, 1.32, 0.04, 0.04, 1.36, 'black')
    cyl(p, 0.42, 0.0, 0, 0.7, 0.2, 'paint', seg=10)
    return finish(p)


def golf_bench():
    """A slatted bench on two concrete feet."""
    p = bm.Part('golf-bench')
    L = 1.8
    for sx in (-L / 2 + 0.15, L / 2 - 0.25):
        bx(p, sx, -0.25, 0, sx + 0.1, 0.25, 0.42, 'stone', skip=('bottom',))
    for k in range(3):
        y = -0.25 + k * 0.17
        bx(p, -L / 2, y, 0.42, L / 2, y + 0.13, 0.47, 'wood', skip=('bottom',))
    for k in range(2):
        z = 0.6 + k * 0.17
        bx(p, -L / 2, 0.24, z, L / 2, 0.29, z + 0.12, 'wood')
    for sx in (-L / 2 + 0.18, L / 2 - 0.22):
        bx(p, sx, 0.25, 0.42, sx + 0.05, 0.3, 0.92, 'metal')
    return finish(p)


def hole_sign():
    """The hole sign beside each tee: two posts and a dark board (the page letters it); the board's face is at y = -0.06."""
    p = bm.Part('hole-sign')
    for sx in (-0.45, 0.45):
        bx(p, sx - 0.05, -0.05, 0, sx + 0.05, 0.05, 1.0, 'wood', skip=('bottom',))
    bx(p, -0.6, -0.05, 0.55, 0.6, 0.05, 1.45, 'black')
    bx(p, -0.66, -0.07, 1.45, 0.66, 0.07, 1.52, 'wood')
    return finish(p)


def build_fields():
    bm.reset()
    base()
    plate()
    rubber()
    backstop()
    dugout()
    bleacher()
    fence_panel()
    scoreboard()
    golf_flag()
    tee_marker()
    ball_washer()
    golf_bench()
    hole_sign()
    export('fields-kit.glb')


# ---------------------------------------------------------------- assembled previews

def inst(src, loc=(0, 0, 0), rot=0.0, scale=(1, 1, 1)):
    o = src.copy()
    o.data = src.data
    o.location = Vector(loc)
    o.rotation_euler = (0, 0, math.radians(rot))
    o.scale = Vector(scale)
    bpy.context.scene.collection.objects.link(o)
    return o


def block(name, x0, y0, z0, x1, y1, z1, slot):
    p = bm.Part(name)
    bx(p, x0, y0, z0, x1, y1, z1, slot)
    return finish(p)


def lib():
    return {o.name: o for o in bpy.context.scene.collection.objects if o.type == 'MESH'}


def stage(name, cam_loc, look_at, ortho, width=1800, height=1000):
    scene = bpy.context.scene
    for m in bpy.data.materials:
        c = bm.SLOT_COLORS.get(m.name.split('.')[0])
        if c:
            m.diffuse_color = (*c, 1)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = ortho
    cam.location = Vector(cam_loc)
    cam.rotation_euler = (Vector(look_at) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.collection.objects.link(cam)
    scene.camera = cam
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.engine = 'BLENDER_WORKBENCH'
    sh = scene.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'MATERIAL'
    scene.world = bpy.data.worlds.new('w')
    scene.world.color = (0.62, 0.74, 0.86)
    ground = bpy.data.objects.new('ground', bpy.data.meshes.new('ground'))
    ground.data.from_pydata([(-90, -90, -0.02), (90, -90, -0.02), (90, 90, -0.02), (-90, 90, -0.02)], [], [(0, 1, 2, 3)])
    gmat = bpy.data.materials.new('gnd')
    gmat.diffuse_color = (0.46, 0.55, 0.36, 1)
    ground.data.materials.append(gmat)
    scene.collection.objects.link(ground)
    os.makedirs(DOCS, exist_ok=True)
    scene.render.filepath = os.path.join(DOCS, name)
    bpy.ops.render.render(write_still=True)
    print('rendered', scene.render.filepath)


def demo_house():
    build_house()
    L = lib()
    for o in L.values():
        o.location = Vector((200, 200, 0))
    wall = block('demo-wall', -5.5, -3.5, 0, 5.5, 3.5, 2.8, 'wall')
    roof = bm.Part('demo-roof')
    hull_prism(roof, [(-4.2, 2.7), (4.2, 2.7), (0.0, 5.2)], -6.0, 6.0, 'shingle')
    finish(roof)
    for o in (wall, roof):
        o.location = Vector((0, 0, 0))
    fy = -3.5
    inst(L['porch'], (-1.6, fy, 0.1), 0, (1.0, 1, 1))
    inst(L['door-entry'], (-1.6, fy, 0.12))
    for x in (-4.0, 1.2, 3.4):
        inst(L['window-house'], (x, fy, 0.95), 0, (1.0, 1, 1.0))
    inst(L['shutter'], (-4.0 - 0.8, fy, 0.95))
    inst(L['shutter'], (-4.0 + 0.8, fy, 0.95))
    inst(L['gutter'], (-6.0, fy - 0.3, 2.62), 0, (12.0, 1, 1))
    inst(L['downspout'], (5.7, fy - 0.2, 0.0), 0, (1, 1, 2.6))
    inst(L['chimney-cap'], (3.5, 0.0, 5.3))
    inst(L['ac-unit'], (5.45, 1.0, 0.0), -90)
    stage('house-assembled.png', (14, -20, 12), (0, 0, 2.2), 18)


def demo_station():
    build_places()
    L = lib()
    for o in L.values():
        o.location = Vector((300, 300, 0))
    store = block('demo-store', -9, 4, 0, 9, 14, 3.4, 'wall')
    slab = block('demo-slab', -7, -9, 4.4, 7, -1, 4.9, 'paint')
    for sx in (-6, 6):
        for sy in (-8, -2):
            cyl_part = bm.Part('demo-post')
            cyl(cyl_part, sx, sy, 0, 4.4, 0.2, 'paint', seg=8)
            finish(cyl_part)
    inst(L['entry-canopy'], (3.0, 4.0, 0.0))
    for ix in (-3.0, 3.0):
        inst(L['island'], (ix, -5, 0), 0, (4.4, 1, 1))
        for px in (-1.3, 1.3):
            inst(L['pump'], (ix + px, -5, 0.18))
    for bx_ in (-5.5, 5.5):
        inst(L['bollard'], (bx_, -5, 0))
    inst(L['lot-light'], (-9, -10, 0))
    for k in range(5):
        inst(L['school-bus'], (-26 + k * 3.3, -26, 0), 90)
    inst(L['rtu'], (-3, 9, 3.4))
    inst(L['cart-corral'], (12, 4, 0), 0)
    inst(L['dock-door'], (-12.0, 4.0, 0.0), 0, (1, 1, 1))
    stage('fuel-station-assembled.png', (22, -42, 24), (0, -6, 2), 62)


def demo_field():
    build_fields()
    L = lib()
    for o in L.values():
        o.location = Vector((300, 300, 0))
    inst(L['plate'], (0, 0, 0.0))
    for ang in (45, 135, 225):
        a = math.radians(ang)
        inst(L['base'], (math.cos(a) * 27.4 * 0.0 + (27.4 * math.cos(math.radians(45)) if ang == 45 else (-27.4 * math.cos(math.radians(45)) if ang == 225 else 0)), 27.4 * math.sin(math.radians(45)) if ang != 135 else 38.8, 0.0))
    inst(L['rubber'], (0, 18.4, 0.1))
    inst(L['backstop'], (0, -10, 0), 180)
    inst(L['dugout'], (-16, 8, 0), -90)
    inst(L['dugout'], (16, 8, 0), 90)
    inst(L['bleacher'], (-18, 24, 0), -90)
    inst(L['bleacher'], (18, 24, 0), 90)
    for k in range(18):
        inst(L['fence-panel'], (-27 + k * 3.0, 55, 0))
    stage('ball-field-assembled.png', (30, -48, 34), (0, 18, 1), 80)


# ---------------------------------------------------------------- output

def export(name):
    bm.export(os.path.join(bm.OUT, name))
    return name


def preview(name, per_row=6, spacing=7.0):
    """A contact sheet: every part in the scene lined up in rows, rendered with the workbench engine."""
    objs = [o for o in bpy.context.scene.collection.objects if o.type == 'MESH']
    objs.sort(key=lambda o: o.name)
    for m in bpy.data.materials:
        slot = m.name.split('.')[0]
        c = bm.SLOT_COLORS.get(slot)
        if c:
            m.diffuse_color = (*c, 1)
    xs = []
    for i, o in enumerate(objs):
        row, col = divmod(i, per_row)
        o.location = Vector((col * spacing, row * spacing, 0))
        o.rotation_euler = (0, 0, math.radians(-35))
        xs.append(o.location)
    cx = (per_row - 1) * spacing / 2
    rows = (len(objs) + per_row - 1) // per_row
    cy = (rows - 1) * spacing / 2
    scene = bpy.context.scene
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = per_row * spacing * 0.72
    cam.location = Vector((cx + 14, cy - 22, 18 + rows * 1.5))
    direction = Vector((cx, cy, 1.0)) - cam.location
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    scene.collection.objects.link(cam)
    scene.camera = cam
    scene.render.resolution_x = 1800
    scene.render.resolution_y = 1000
    scene.render.engine = 'BLENDER_WORKBENCH'
    sh = scene.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'MATERIAL'
    sh.show_cavity = True
    scene.world = bpy.data.worlds.new('w')
    scene.world.color = (0.62, 0.74, 0.86)
    ground = bpy.data.objects.new('ground', bpy.data.meshes.new('ground'))
    gm = ground.data
    s = 80
    gm.from_pydata([(-s, -s, -0.02), (s, -s, -0.02), (s, s, -0.02), (-s, s, -0.02)], [], [(0, 1, 2, 3)])
    gmat = bpy.data.materials.new('gnd')
    gmat.diffuse_color = (0.5, 0.58, 0.4, 1)
    gm.materials.append(gmat)
    scene.collection.objects.link(ground)
    os.makedirs(DOCS, exist_ok=True)
    scene.render.filepath = os.path.join(DOCS, name)
    bpy.ops.render.render(write_still=True)
    print('rendered', scene.render.filepath)


if __name__ == '__main__' or os.environ.get('TELLO_KIT_RUN') == '1':
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else ['house', 'places', 'fields']
    show = 'preview' in args
    if 'demo' in args:
        demo_house()
        bpy.ops.wm.read_factory_settings(use_empty=True)
        demo_station()
        bpy.ops.wm.read_factory_settings(use_empty=True)
        demo_field()
        sys.exit(0)
    if 'house' in args:
        build_house()
        if show:
            preview('house-kit.png', per_row=6, spacing=6.0)
    if 'places' in args:
        build_places()
        if show:
            preview('places-kit.png', per_row=5, spacing=14.0)
    if 'fields' in args:
        build_fields()
        if show:
            preview('fields-kit.png', per_row=4, spacing=12.0)
