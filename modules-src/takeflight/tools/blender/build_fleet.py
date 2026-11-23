"""Builds the Take Flight fleet beyond the Wren from parameter sets and exports each through the validating exporter.

Usage: blender -b --factory-startup -P build_fleet.py -- <out_dir> [aircraft ...]

Each aircraft is a dict: fuselage sections (x, half width, top, bottom, exponent, top exponent), wing (span, root and tip chord,
leading-edge x at root and sweep, height, dihedral, low or high), tail (conventional or T), engines (nose prop, wing-nacelle props
or rear-fuselage fans), tricycle gear (retractable gear folds in the page) and a generic cockpit with the painted panel. Node
names follow the exporter's rules (aileron_L, flap_L_1, gear_main_L, prop_1 / fan_1, spoiler_*, door_*, gear_door_*, light_*).
Author with nose +X, left wing +Y, up +Z.
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import aircraft_kit as kit  # noqa: E402
import export_aircraft  # noqa: E402
from build_wren import smooth_sections, wheel  # noqa: E402

SEGMENTS = 40


def mats_for(name, paint, stripe):
    return {
        'paint': kit.material(f'{name}_paint', paint, 0.55),
        'stripe': kit.material(f'{name}_stripe', stripe, 0.55),
        'cowl': kit.material(f'{name}_cowl', tuple(c * 0.92 for c in paint), 0.55),
        'glass': kit.material(f'{name}_glass', (0.05, 0.08, 0.11), 0.08, alpha=0.55),
        'tyre': kit.material(f'{name}_tyre', (0.03, 0.03, 0.03), 0.95),
        'metal': kit.material(f'{name}_metal', (0.55, 0.56, 0.58), 0.5, metallic=0.85),
        'prop': kit.material(f'{name}_prop', (0.06, 0.06, 0.06), 0.7),
        'disc': kit.material(f'{name}_prop_disc', (0.2, 0.2, 0.2), 0.8, alpha=0.18, double_sided=True),
        'interior': kit.material(f'{name}_interior', (0.23, 0.22, 0.21), 0.92),
        'panel': kit.material(f'{name}_panel', (0.08, 0.085, 0.09), 0.9),
        'screen': kit.material(f'{name}_screen', (0.02, 0.02, 0.02), 0.9),
        'seat': kit.material(f'{name}_seat', (0.30, 0.27, 0.24), 0.95),
        'yoke': kit.material(f'{name}_yoke', (0.06, 0.06, 0.06), 0.8),
        'intake': kit.material(f'{name}_intake', (0.04, 0.04, 0.045), 0.9),
    }


def fuselage(spec, mats, root, collection):
    sections = smooth_sections(spec['fuselage'], 4)
    bm = kit.loft(sections, SEGMENTS, cap_front=True, cap_back=True)
    w = spec['windows']
    glass = bmesh.new()
    remove = []
    bm.faces.ensure_lookup_table()
    for face in bm.faces:
        c = face.calc_center_median()
        n = face.normal
        front = w['front'][0] < c.x < w['front'][1] and c.z > w['front'][2] and n.z > 0.1 and n.x > 0.05 and abs(c.y) < w['front'][3]
        side = w['side'][0] < c.x < w['side'][1] and w['side'][2] < c.z < w['side'][3] and abs(n.y) > 0.55
        if front or side:
            verts = [glass.verts.new(v.co + n * 0.004) for v in face.verts]
            glass.faces.new(verts)
            remove.append(face)
    bmesh.ops.delete(bm, geom=remove, context='FACES_ONLY')
    for face in bm.faces:
        c = face.calc_center_median()
        if spec['stripe'][0] < c.z < spec['stripe'][1] and abs(face.normal.y) > 0.5:
            face.material_index = 1
    body = kit.new_object('fuselage', bm, mats['paint'], parent=root, collection=collection)
    body.data.materials.append(mats['stripe'])
    kit.new_object('glass', glass, mats['glass'], parent=root, collection=collection)


def wing_station(spec, y):
    wg = spec['wing']
    y = abs(y)
    t = min(1.0, y / (wg['span'] / 2))
    chord = wg['root'] + (wg['tip'] - wg['root']) * t
    le = wg['le'] - math.tan(math.radians(wg['sweep'])) * y
    z = wg['z'] + y * math.tan(math.radians(wg['dihedral']))
    return (y, le, chord, z, wg.get('twist', 1.0) * (1 - 2 * t))


def stations(spec, y0, y1):
    return [wing_station(spec, y0), wing_station(spec, y1)]


def hinge(spec, y0, y1, fraction):
    a = wing_station(spec, y0)
    b = wing_station(spec, y1)
    pa = Vector((a[1] - fraction * a[2], y0, a[3]))
    pb = Vector((b[1] - fraction * b[2], y1, b[3]))
    return (pa + pb) * 0.5


def wing_side(spec, side, mats, root, collection, points=20):
    sign = 1 if side == 'L' else -1
    wg = spec['wing']
    half = wg['span'] / 2
    code = wg.get('airfoil', '2412')
    flap_end = wg['flap_end']
    split = 0.74

    def place(bm):
        if side == 'R':
            kit.mirror_y(bm)
        return bm

    main = place(kit.wing_panel(stations(spec, 0.0, half), code=code, points=points, start=0.0, end=split))
    tip_te = place(kit.wing_panel(stations(spec, half - 0.3, half), code=code, points=points, start=split, end=1.0))
    root_te = place(kit.wing_panel(stations(spec, 0.0, wg['flap_start']), code=code, points=points, start=split, end=1.0))
    kit.merge(main, tip_te, root_te)
    kit.new_object(f'wing_{side}', main, mats['paint'], parent=root, collection=collection)
    flap = place(kit.wing_panel(stations(spec, wg['flap_start'], flap_end), code=code, points=points, start=split + 0.005, end=1.0))
    flap_obj = kit.new_object(f'flap_{side}_1', flap, mats['paint'], parent=root, collection=collection)
    h = hinge(spec, wg['flap_start'], flap_end, split + 0.005)
    kit.set_origin(flap_obj, (h.x, h.y * sign, h.z))
    aileron = place(kit.wing_panel(stations(spec, flap_end + 0.02, half - 0.32), code=code, points=points, start=split + 0.005, end=1.0))
    aileron_obj = kit.new_object(f'aileron_{side}', aileron, mats['paint'], parent=root, collection=collection)
    h = hinge(spec, flap_end + 0.02, half - 0.32, split + 0.005)
    kit.set_origin(aileron_obj, (h.x, h.y * sign, h.z))
    if spec.get('spoilers'):
        y0, y1 = spec['spoilers']
        a = wing_station(spec, y0)
        b = wing_station(spec, y1)
        x = (a[1] + b[1]) * 0.5 - 0.55 * (a[2] + b[2]) * 0.5
        sp = kit.box((0.35, y1 - y0, 0.02), (x, (y0 + y1) * 0.5 * sign, (a[3] + b[3]) * 0.5 + 0.06 * a[2]))
        spoiler = kit.new_object(f'spoiler_{side}', sp, mats['paint'], parent=root, collection=collection)
        kit.set_origin(spoiler, (x + 0.17, (y0 + y1) * 0.5 * sign, (a[3] + b[3]) * 0.5 + 0.06 * a[2]))
    tip = wing_station(spec, half)
    kit.empty(f'light_nav_{side}', (tip[1] - 0.15, (half + 0.03) * sign, tip[3]), parent=root, collection=collection)
    kit.empty(f'light_strobe_{side}', (tip[1] - 0.45, (half + 0.03) * sign, tip[3]), parent=root, collection=collection)
    st = wing_station(spec, half * 0.42)
    kit.empty(f'light_landing_{side}', (st[1] + 0.01, half * 0.42 * sign, st[3] - 0.03), parent=root, collection=collection)


def tail(spec, mats, root, collection, points=12):
    t = spec['tail']
    fin_h = t['fin_height']
    fin_x = t['fin_x']

    def fin_station(h):
        k = h / fin_h
        return (h, fin_x - t['fin_sweep'] * k, t['fin_root'] - (t['fin_root'] - t['fin_tip']) * k, 0.0, 0.0)

    rotate = Matrix.Rotation(math.radians(90), 4, 'X')
    lift = Matrix.Translation((0, 0, t['fin_base']))
    fin = kit.wing_panel([fin_station(0.0), fin_station(fin_h)], code='0010', points=points, start=0.0, end=0.66, cap_root=False)
    kit.transform(fin, lift @ rotate)
    kit.new_object('fin', fin, mats['paint'], parent=root, collection=collection)
    rudder = kit.wing_panel([fin_station(0.08), fin_station(fin_h)], code='0010', points=points, start=0.665, end=1.0)
    kit.transform(rudder, lift @ rotate)
    rudder_obj = kit.new_object('rudder', rudder, mats['stripe'], parent=root, collection=collection)
    st = fin_station(0.08)
    kit.set_origin(rudder_obj, (st[1] - 0.665 * st[2], 0.0, t['fin_base'] + 0.08))
    if t['t_tail']:
        top = fin_station(fin_h)
        stab_z = t['fin_base'] + fin_h
        stab_x = top[1]
    else:
        stab_z = t['stab_z']
        stab_x = t['stab_x']
    span = t['stab_span'] / 2

    def stab_station(y):
        k = y / span
        return (y, stab_x - t['stab_sweep'] * k, t['stab_root'] - (t['stab_root'] - t['stab_tip']) * k, stab_z, 0.0)

    stab = kit.wing_panel([stab_station(0.0), stab_station(span)], code='0010', points=points, start=0.0, end=0.62)
    stab_r = kit.mirror_y(kit.wing_panel([stab_station(0.0), stab_station(span)], code='0010', points=points, start=0.0, end=0.62))
    kit.merge(stab, stab_r)
    kit.new_object('stabilizer', stab, mats['paint'], parent=root, collection=collection)
    elevator = kit.wing_panel([stab_station(0.0), stab_station(span)], code='0010', points=points, start=0.625, end=1.0)
    elevator_r = kit.mirror_y(kit.wing_panel([stab_station(0.0), stab_station(span)], code='0010', points=points, start=0.625, end=1.0))
    kit.merge(elevator, elevator_r)
    elevator_obj = kit.new_object('elevator', elevator, mats['paint'], parent=root, collection=collection)
    rs = stab_station(0.0)
    kit.set_origin(elevator_obj, (rs[1] - 0.625 * rs[2], 0.0, stab_z))
    top = fin_station(fin_h)
    kit.empty('light_strobe_tail', (top[1] - top[2] * 0.5, 0.0, t['fin_base'] + fin_h + 0.05), parent=root, collection=collection)
    kit.empty('light_beacon', (fin_x - 0.3, 0.0, t['fin_base'] + 0.05), parent=root, collection=collection)


def propeller(name, hub, radius, blades, mats, root, collection, spinner=0.16):
    prop = bpy.data.objects.new(name, None)
    prop.location = hub
    collection.objects.link(prop)
    prop.parent = root
    sp = kit.loft([(spinner * 1.9, 0.0, 0.0, 0.0), (spinner * 1.4, spinner * 0.5, spinner * 0.5, -spinner * 0.5, 2.0), (spinner * 0.6, spinner * 0.85, spinner * 0.85, -spinner * 0.85, 2.0), (0.0, spinner, spinner, -spinner, 2.0)], 16, cap_front=False, cap_back=True)
    kit.new_object(f'{name}_spinner', sp, mats['paint'], parent=prop, collection=collection)
    for k in range(blades):
        st = []
        n = 6
        for i in range(n):
            r = spinner * 0.9 + (radius - spinner * 0.9) * i / (n - 1)
            chord = (0.2 - 0.09 * (i / (n - 1)) ** 1.5) * radius / 1.0
            st.append((r, 0.03, chord, 0.0, 30 - 18 * i / (n - 1)))
        blade = kit.wing_panel(st, code='4412', points=6)
        kit.transform(blade, Matrix.Rotation(math.radians(90), 4, 'Z'))
        kit.transform(blade, Matrix.Rotation(math.radians(90 + 360 * k / blades), 4, 'X'))
        kit.new_object(f'{name}_blade_{k + 1}', blade, mats['prop'], parent=prop, collection=collection)
    disc = kit.cylinder(radius, 0.005, 32, axis='X')
    kit.new_object(f'{name}_disc', disc, mats['disc'], parent=prop, collection=collection)


def engines(spec, mats, root, collection):
    e = spec['engines']
    if e['kind'] == 'nose':
        propeller('prop_1', Vector(e['hub']), e['radius'], e['blades'], mats, root, collection, e.get('spinner', 0.17))
        return
    if e['kind'] == 'wing':
        for i, y in enumerate(e['y']):
            for sign_index, sign in enumerate((1, -1)):
                index = i * 2 + sign_index + 1
                st = wing_station(spec, y)
                front = st[1] + e['ahead']
                back = st[1] - st[2] * 0.85
                r = e['nacelle']
                cz = st[3] - r * 0.35
                nac = kit.loft([(front, r * 0.7, cz + r * 0.7, cz - r * 0.7, 2.2), (front - 0.3, r, cz + r, cz - r, 2.4), (back + 0.4, r * 0.95, cz + r * 0.9, cz - r * 1.05, 2.4), (back, 0.05, cz + 0.05, cz - 0.05, 2.0)], 20)
                kit.transform(nac, Matrix.Translation((0, y * sign, 0)))
                kit.new_object(f'nacelle_{index}', nac, mats['cowl'], parent=root, collection=collection)
                propeller(f'prop_{index}', Vector((front + 0.02, y * sign, cz)), e['radius'], e['blades'], mats, root, collection, e.get('spinner', 0.14))
        return
    for index, sign in ((1, 1), (2, -1)):
        x0, y, z = e['pod']
        r = e['radius']
        length = e['length']
        pod = kit.loft([(x0, r * 0.92, z + r * 0.92, z - r * 0.92, 2.0), (x0 - 0.2, r, z + r, z - r, 2.0), (x0 - length * 0.7, r * 0.95, z + r * 0.95, z - r * 0.95, 2.0), (x0 - length, r * 0.55, z + r * 0.55, z - r * 0.55, 2.0)], 24, cap_front=False, cap_back=True)
        kit.transform(pod, Matrix.Translation((0, y * sign, 0)))
        kit.new_object(f'nacelle_{index}', pod, mats['cowl'], parent=root, collection=collection)
        pylon = kit.box((length * 0.45, abs(y) - 0.55, 0.12), (x0 - length * 0.5, (abs(y) * 0.5 + 0.27) * sign, z))
        kit.new_object(f'pylon_{index}', pylon, mats['paint'], parent=root, collection=collection)
        fan = bpy.data.objects.new(f'fan_{index}', None)
        fan.location = (x0 - 0.12, y * sign, z)
        collection.objects.link(fan)
        fan.parent = root
        face = kit.cylinder(r * 0.86, 0.04, 20, axis='X')
        kit.new_object(f'fan_{index}_face', face, mats['intake'], parent=fan, collection=collection)


def gear(spec, mats, root, collection):
    g = spec['gear']
    for side, sign in (('L', 1), ('R', -1)):
        top = Vector((g['main_x'], g['main_top_y'] * sign, g['main_top_z']))
        axle = Vector((g['main_x'], g['main_y'] * sign, g['axle_z']))
        leg = kit.strut(top, axle, 0.09, 0.05)
        node = kit.new_object(f'gear_main_{side}', leg, mats['metal'], parent=root, collection=collection)
        kit.set_origin(node, top)
        wheel(f'wheel_main_{side}', axle + Vector((0, 0.05 * sign, 0)), g['main_radius'], g['main_radius'] * 0.55, mats, node, collection, 18)
        if g.get('retract'):
            door = kit.box((0.6, 0.02, 0.4), (g['main_x'], g['main_top_y'] * sign * 0.8, g['main_top_z'] - 0.05))
            d = kit.new_object(f'gear_door_{side}', door, mats['paint'], parent=root, collection=collection)
            kit.set_origin(d, (g['main_x'], g['main_top_y'] * sign * 0.8, g['main_top_z']))
    top = Vector((g['nose_x'], 0.0, g['nose_top_z']))
    axle = Vector((g['nose_x'], 0.0, g['axle_z'] + 0.02))
    oleo = kit.cylinder(0.045, (top - axle).length, 12, axis='Z')
    kit.transform(oleo, Matrix.Translation((top + axle) * 0.5))
    fork = kit.box((0.06, 0.16, 0.12), axle + Vector((0, 0, 0.12)))
    kit.merge(oleo, fork)
    nose = kit.new_object('gear_nose', oleo, mats['metal'], parent=root, collection=collection)
    kit.set_origin(nose, top)
    wheel('wheel_nose', axle, g['nose_radius'], g['nose_radius'] * 0.5, mats, nose, collection, 16)
    if g.get('retract'):
        door = kit.box((0.5, 0.02, 0.3), (g['nose_x'], 0.18, g['nose_top_z'] - 0.05))
        d = kit.new_object('gear_door_nose', door, mats['paint'], parent=root, collection=collection)
        kit.set_origin(d, (g['nose_x'], 0.18, g['nose_top_z']))


def doors(spec, mats, root, collection):
    for name, (x, y, z, w, h) in spec.get('doors', {}).items():
        door = kit.box((w, 0.02, h), (x, y, z))
        d = kit.new_object(f'door_{name}', door, mats['stripe'], parent=root, collection=collection)
        kit.set_origin(d, (x + w / 2, y, z))


def cockpit(spec, mats, collection):
    root = bpy.data.objects.new(f"{spec['name']}_cockpit", None)
    collection.objects.link(root)
    c = spec['cabin']
    sections = [s for s in smooth_sections(spec['fuselage'], 3) if c['aft'] < s[0] < c['fore']]
    inner = [(x, hw - 0.035, top - 0.035, bottom + 0.05, e, te) for (x, hw, top, bottom, e, te) in sections]
    bm = kit.loft(inner, SEGMENTS, cap_front=True, cap_back=True)
    bmesh.ops.reverse_faces(bm, faces=bm.faces)
    w = spec['windows']
    remove = []
    for f in bm.faces:
        ctr = f.calc_center_median()
        n = -f.normal
        front = w['front'][0] < ctr.x < w['front'][1] and ctr.z > w['front'][2] - 0.04 and n.z > 0.1 and n.x > 0.05 and abs(ctr.y) < w['front'][3]
        side = w['side'][0] < ctr.x < w['side'][1] and w['side'][2] < ctr.z < w['side'][3] and abs(n.y) > 0.55
        if front or side:
            remove.append(f)
    bmesh.ops.delete(bm, geom=remove, context='FACES_ONLY')
    kit.new_object('cabin', bm, mats['interior'], parent=root, collection=collection)
    px, pz, half = c['panel']
    panel = kit.box((0.06, half * 2, 0.40), (px, 0.0, pz))
    glare = kit.box((0.22, half * 2 + 0.02, 0.04), (px - 0.05, 0.0, pz + 0.22))
    kit.merge(panel, glare)
    kit.new_object('panel', panel, mats['panel'], parent=root, collection=collection)
    screen = bmesh.new()
    sx = px - 0.032
    corners = [(sx, half * 0.98, pz - 0.17), (sx, -half * 0.98, pz - 0.17), (sx, -half * 0.98, pz + 0.19), (sx, half * 0.98, pz + 0.19)]
    verts = [screen.verts.new(co) for co in corners]
    face = screen.faces.new(verts)
    uv = screen.loops.layers.uv.new('UVMap')
    for loop, co in zip(face.loops, [(0, 0), (1, 0), (1, 1), (0, 1)]):
        loop[uv].uv = co
    if face.normal.x > 0:
        face.normal_flip()
    kit.new_object('panel_screen', screen, mats['screen'], parent=root, collection=collection)
    for side, sign in (('L', 1), ('R', -1)):
        base = Vector((px - 0.03, c['seat_y'] * sign, pz - 0.04))
        shaft = kit.cylinder(0.012, 0.3, 8, axis='X')
        kit.transform(shaft, Matrix.Translation(base + Vector((-0.15, 0, 0))))
        grip = kit.box((0.03, 0.26, 0.03), base + Vector((-0.30, 0, 0)))
        kit.merge(shaft, grip)
        yoke = kit.new_object(f'yoke_{side}', shaft, mats['yoke'], parent=root, collection=collection)
        kit.set_origin(yoke, base)
        seat = kit.merge(kit.box((0.5, 0.46, 0.10), (px - 0.9, c['seat_y'] * sign, c['floor'] + 0.34)), kit.box((0.10, 0.46, 0.62), (px - 1.2, c['seat_y'] * sign, c['floor'] + 0.66)))
        kit.new_object(f'seat_front_{side}', seat, mats['seat'], parent=root, collection=collection)
    throttle = kit.cylinder(0.008, 0.12, 8, axis='X')
    kit.transform(throttle, Matrix.Translation((px - 0.09, 0.0, pz - 0.1)))
    t = kit.new_object('throttle', throttle, mats['yoke'], parent=root, collection=collection)
    kit.set_origin(t, (px - 0.03, 0.0, pz - 0.1))
    floor = kit.box((c['fore'] - c['aft'], c['floor_half'] * 2, 0.02), ((c['fore'] + c['aft']) * 0.5, 0.0, c['floor']))
    kit.new_object('floor', floor, mats['interior'], parent=root, collection=collection)
    return root


DUET = {
    'name': 'duet',
    'category': 'twin',
    'colors': ((0.9, 0.9, 0.88), (0.55, 0.12, 0.1)),
    'fuselage': [
        (2.65, 0.10, 0.12, -0.10, 2.0, 2.0),
        (2.45, 0.32, 0.25, -0.30, 2.4, 2.4),
        (1.95, 0.52, 0.42, -0.48, 2.6, 2.6),
        (1.30, 0.60, 0.62, -0.55, 2.7, 3.0),
        (0.70, 0.64, 0.98, -0.56, 2.8, 4.0),
        (0.10, 0.65, 1.04, -0.55, 2.8, 4.2),
        (-0.90, 0.64, 1.02, -0.52, 2.8, 4.0),
        (-1.80, 0.56, 0.92, -0.40, 2.6, 3.0),
        (-2.80, 0.42, 0.76, -0.20, 2.5, 2.5),
        (-3.90, 0.28, 0.62, 0.02, 2.4, 2.4),
        (-4.90, 0.17, 0.55, 0.18, 2.3, 2.3),
        (-5.70, 0.07, 0.52, 0.30, 2.2, 2.2),
    ],
    'windows': {'front': (0.72, 1.32, 0.62, 0.48), 'side': (-1.6, 0.55, 0.42, 0.92)},
    'stripe': (-0.12, 0.02),
    'wing': {'span': 11.6, 'root': 1.95, 'tip': 1.1, 'le': 0.95, 'sweep': 2.0, 'z': -0.40, 'dihedral': 6.0, 'flap_start': 0.7, 'flap_end': 3.3, 'airfoil': '2415', 'twist': 1.5},
    'tail': {'t_tail': False, 'fin_x': -4.55, 'fin_base': 0.5, 'fin_height': 1.55, 'fin_root': 1.5, 'fin_tip': 0.75, 'fin_sweep': 0.95, 'stab_x': -4.9, 'stab_z': 0.42, 'stab_span': 4.4, 'stab_root': 1.0, 'stab_tip': 0.62, 'stab_sweep': 0.2},
    'engines': {'kind': 'wing', 'y': [1.75], 'ahead': 1.25, 'nacelle': 0.34, 'radius': 0.96, 'blades': 2, 'spinner': 0.15},
    'gear': {'retract': True, 'main_x': -0.25, 'main_top_y': 1.7, 'main_top_z': -0.5, 'main_y': 1.7, 'axle_z': -1.28, 'main_radius': 0.3, 'nose_x': 1.95, 'nose_top_z': -0.42, 'nose_radius': 0.24},
    'cabin': {'fore': 1.4, 'aft': -2.0, 'panel': (1.08, 0.40, 0.56), 'seat_y': 0.32, 'floor': -0.46, 'floor_half': 0.5},
}

FLEET = {'duet': DUET}


def build(spec, out_dir):
    kit.reset_scene()
    paint, stripe = spec['colors']
    mats = mats_for(spec['name'], paint, stripe)
    exterior = bpy.data.collections.new('exterior')
    bpy.context.scene.collection.children.link(exterior)
    root = bpy.data.objects.new(spec['name'], None)
    exterior.objects.link(root)
    fuselage(spec, mats, root, exterior)
    for side in ('L', 'R'):
        wing_side(spec, side, mats, root, exterior)
    tail(spec, mats, root, exterior)
    engines(spec, mats, root, exterior)
    gear(spec, mats, root, exterior)
    doors(spec, mats, root, exterior)
    cockpit_collection = bpy.data.collections.new('cockpit')
    bpy.context.scene.collection.children.link(cockpit_collection)
    cockpit_root = cockpit(spec, mats, cockpit_collection)
    return export_aircraft.export_aircraft(root, cockpit_root, name=spec['name'], category=spec['category'], out_dir=out_dir)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    out_dir = os.path.abspath(argv[0] if argv else 'assets-src/models/takeflight')
    names = argv[1:] or list(FLEET)
    ok = True
    for name in names:
        ok = build(FLEET[name], out_dir) and ok
    if not ok:
        sys.exit(1)


if __name__ == '__main__':
    main()
