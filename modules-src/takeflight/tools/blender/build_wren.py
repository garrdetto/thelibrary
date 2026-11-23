"""Builds the Halden Wren T4 (high-wing four-seat trainer) and exports it through the validating exporter.

    blender -b -P modules-src/takeflight/tools/blender/build_wren.py -- assets-src/models/takeflight

Writes wren_lod0.glb, wren_lod1.glb, wren_lod2.glb and wren_cockpit.glb into the output folder, then run `pnpm assets`.
Geometry matches `shared/aircraft/wren.json`: wheels touch at z -1.28 (mains) and -1.30 (nose) below the CG reference.
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

SEGMENTS = 40

FUSELAGE = [
    (2.04, 0.36, 0.30, -0.36, 2.2),
    (1.92, 0.44, 0.38, -0.46, 2.4),
    (1.60, 0.52, 0.48, -0.54, 2.6),
    (1.20, 0.56, 0.58, -0.56, 2.7),
    (0.95, 0.58, 0.70, -0.56, 2.7),
    (0.60, 0.60, 0.90, -0.56, 2.8),
    (0.30, 0.61, 1.00, -0.55, 2.8),
    (-0.40, 0.61, 1.00, -0.53, 2.8),
    (-1.00, 0.58, 0.98, -0.48, 2.7),
    (-1.60, 0.50, 0.86, -0.36, 2.6),
    (-2.30, 0.40, 0.70, -0.20, 2.5),
    (-3.20, 0.29, 0.58, -0.02, 2.4),
    (-4.20, 0.20, 0.50, 0.12, 2.3),
    (-5.10, 0.13, 0.45, 0.22, 2.2),
    (-5.75, 0.07, 0.42, 0.28, 2.2),
]


def catmull(p0, p1, p2, p3, t):
    t2 = t * t
    t3 = t2 * t
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)


def smooth_sections(sections, per_span):
    out = []
    n = len(sections)
    for i in range(n - 1):
        a = sections[max(0, i - 1)]
        b = sections[i]
        c = sections[i + 1]
        d = sections[min(n - 1, i + 2)]
        for k in range(per_span):
            t = k / per_span
            out.append(tuple(catmull(a[j], b[j], c[j], d[j], t) for j in range(5)))
    out.append(sections[-1])
    return out


def window_kind(centre, normal):
    x, y, z = centre
    if 0.36 < x < 0.93 and z > 0.66 and normal.z > 0.15 and abs(y) < 0.5:
        return 'windshield'
    if -1.72 < x < 0.66 and 0.40 < z < 0.92 and abs(normal.y) > 0.55:
        if -0.10 < x < 0.06:
            return None
        return 'side'
    if -1.75 < x < -0.9 and z > 0.9 and normal.z > 0.55 and abs(y) < 0.35:
        return 'roof'
    return None


def build_fuselage(mats, root, collection, lod_segments=SEGMENTS, per_span=5, windows=True):
    sections = smooth_sections(FUSELAGE, per_span)
    bm = kit.loft(sections, lod_segments, cap_front=True, cap_back=False)
    tail_tip = bm.verts.new((-5.92, 0.0, 0.36))
    last = [v for v in bm.verts if abs(v.co.x - FUSELAGE[-1][0]) < 1e-5]
    last.sort(key=lambda v: math.atan2(v.co.z - 0.35, v.co.y))
    for i in range(len(last)):
        bm.faces.new((last[i], last[(i + 1) % len(last)], tail_tip))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    glass = bmesh.new()
    if windows:
        bm.faces.ensure_lookup_table()
        remove = []
        for face in bm.faces:
            kind = window_kind(face.calc_center_median(), face.normal)
            if kind is None:
                continue
            verts = []
            for v in face.verts:
                verts.append(glass.verts.new(v.co + face.normal * 0.004))
            glass.faces.new(verts)
            remove.append(face)
        bmesh.ops.delete(bm, geom=remove, context='FACES_ONLY')
    for face in bm.faces:
        c = face.calc_center_median()
        if -0.30 < c.z < -0.14 and c.x < 1.25 and abs(face.normal.y) > 0.5:
            face.material_index = 1
        elif c.x > 1.22:
            face.material_index = 2
    body = kit.new_object('fuselage', bm, mats['paint'], parent=root, collection=collection)
    body.data.materials.append(mats['stripe'])
    body.data.materials.append(mats['cowl'])
    if windows:
        kit.new_object('glass', glass, mats['glass'], parent=root, collection=collection)
    else:
        glass.free()
    return body


def wing_station(y):
    """(y, leading-edge x, chord, z, twist) of the Wren wing at span position y (left, metres)."""
    y = abs(y)
    dihedral = math.tan(math.radians(1.7))
    if y <= 2.6:
        le, chord = 0.55, 1.6
    else:
        t = (y - 2.6) / 2.9
        le, chord = 0.55 - 0.08 * t, 1.6 - 0.45 * t
    twist = 1.5 - 3.0 * (y / 5.5)
    return (y, le, chord, 1.02 + y * dihedral, twist)


def stations_between(y0, y1):
    ys = [y0] + [y for y in (2.6,) if y0 < y < y1] + [y1]
    return [wing_station(y) for y in ys]


def hinge_point(y0, y1, fraction):
    pts = []
    for y in (y0, y1):
        _, le, chord, z, twist = wing_station(y)
        pts.append(Vector((le - fraction * chord, y, z)))
    return (pts[0] + pts[1]) * 0.5


def build_wing_side(side, mats, root, collection, points=22):
    sign = 1 if side == 'L' else -1

    def place(bm):
        if side == 'R':
            kit.mirror_y(bm)
        return bm

    main = place(kit.wing_panel(stations_between(0.58, 5.5), points=points, start=0.0, end=0.74, cap_root=True, cap_tip=True))
    tip_te = place(kit.wing_panel(stations_between(5.2, 5.5), points=points, start=0.74, end=1.0))
    stub_te = place(kit.wing_panel(stations_between(0.58, 0.66), points=points, start=0.74, end=1.0))
    kit.merge(main, tip_te, stub_te)
    wing = kit.new_object(f'wing_{side}', main, mats['paint'], parent=root, collection=collection)

    flap = place(kit.wing_panel(stations_between(0.66, 3.0), points=points, start=0.745, end=1.0))
    flap_obj = kit.new_object(f'flap_{side}_1', flap, mats['paint'], parent=root, collection=collection)
    hinge = hinge_point(0.66, 3.0, 0.745)
    kit.set_origin(flap_obj, (hinge.x, hinge.y * sign, hinge.z - 0.03))

    aileron = place(kit.wing_panel(stations_between(3.02, 5.18), points=points, start=0.745, end=1.0))
    aileron_obj = kit.new_object(f'aileron_{side}', aileron, mats['paint'], parent=root, collection=collection)
    hinge = hinge_point(3.02, 5.18, 0.745)
    kit.set_origin(aileron_obj, (hinge.x, hinge.y * sign, hinge.z))

    tip = wing_station(5.5)
    nav = kit.empty(f'light_nav_{side}', (tip[1] - 0.15, 5.52 * sign, tip[3]), parent=root, collection=collection)
    kit.empty(f'light_strobe_{side}', (tip[1] - 0.45, 5.52 * sign, tip[3]), parent=root, collection=collection)
    if side == 'L':
        st = wing_station(2.2)
        kit.empty('light_landing_L', (st[1] + 0.01, 2.2, st[3] - 0.02), parent=root, collection=collection)
    strut_bm = kit.strut((-0.15, 0.56 * sign, -0.38), (-0.05, 2.62 * sign, wing_station(2.62)[3] - 0.06), 0.11, 0.035)
    kit.new_object(f'strut_{side}', strut_bm, mats['paint'], parent=root, collection=collection)
    return wing, nav


def tail_station(y):
    y = abs(y)
    t = y / 1.72
    return (y, -4.82 - 0.12 * t, 0.98 - 0.3 * t, 0.40, 0.0)


def build_tail(mats, root, collection, points=12):
    stab = kit.wing_panel([tail_station(0.0), tail_station(1.72)], code='0010', points=points, start=0.0, end=0.6)
    stab_r = kit.mirror_y(kit.wing_panel([tail_station(0.0), tail_station(1.72)], code='0010', points=points, start=0.0, end=0.6))
    kit.merge(stab, stab_r)
    kit.new_object('stabilizer', stab, mats['paint'], parent=root, collection=collection)
    elevator = kit.wing_panel([tail_station(0.0), tail_station(1.72)], code='0010', points=points, start=0.605, end=1.0)
    elevator_r = kit.mirror_y(kit.wing_panel([tail_station(0.0), tail_station(1.72)], code='0010', points=points, start=0.605, end=1.0))
    kit.merge(elevator, elevator_r)
    elevator_obj = kit.new_object('elevator', elevator, mats['paint'], parent=root, collection=collection)
    root_st = tail_station(0.0)
    kit.set_origin(elevator_obj, (root_st[1] - 0.605 * root_st[2], 0.0, root_st[3]))

    def fin_station(h):
        t = h / 1.32
        return (h, -4.45 - 0.92 * t, 1.42 - 0.8 * t, 0.0, 0.0)

    rotate = Matrix.Rotation(math.radians(90), 4, 'X')
    lift = Matrix.Translation((0, 0, 0.42))
    fin = kit.wing_panel([fin_station(0.0), fin_station(1.32)], code='0010', points=points, start=0.0, end=0.62, cap_root=False)
    kit.transform(fin, lift @ rotate)
    kit.new_object('fin', fin, mats['paint'], parent=root, collection=collection)
    rudder = kit.wing_panel([fin_station(0.05), fin_station(1.36)], code='0010', points=points, start=0.625, end=1.0)
    kit.transform(rudder, lift @ rotate)
    rudder_obj = kit.new_object('rudder', rudder, mats['stripe'], parent=root, collection=collection)
    st = fin_station(0.05)
    kit.set_origin(rudder_obj, (st[1] - 0.625 * st[2], 0.0, 0.47))
    top = fin_station(1.32)
    kit.empty('light_strobe_tail', (top[1] - top[2] * 0.5, 0.0, 0.42 + 1.34), parent=root, collection=collection)


def wheel(name, centre, radius, width, mats, parent, collection, segments=20):
    tyre = kit.torus(radius - width * 0.45, width * 0.45, segments, 10)
    hub = kit.cylinder(radius * 0.55, width * 0.8, 12, axis='Y')
    kit.transform(tyre, Matrix.Translation(centre))
    kit.transform(hub, Matrix.Translation(centre))
    tyre_obj = kit.new_object(name, tyre, mats['tyre'], parent=parent, collection=collection)
    hub_obj = kit.new_object(f'{name}_hub', hub, mats['metal'], parent=tyre_obj, collection=collection)
    kit.set_origin(tyre_obj, centre)
    kit.set_origin(hub_obj, centre)
    return tyre_obj


def build_gear(mats, root, collection, segments=20):
    for side, sign in (('L', 1), ('R', -1)):
        top = Vector((-0.42, 0.48 * sign, -0.46))
        axle = Vector((-0.42, 1.16 * sign, -1.0))
        leg = kit.strut(top, axle, 0.10, 0.03)
        gear = kit.new_object(f'gear_main_{side}', leg, mats['paint'], parent=root, collection=collection)
        kit.set_origin(gear, top)
        centre = Vector((-0.42, 1.25 * sign, -1.0))
        wheel(f'wheel_main_{side}', centre, 0.28, 0.15, mats, gear, collection, segments)
        pant = kit.loft([(0.18, 0.0, 0.0, 0.0), (0.12, 0.1, 0.06, -0.06), (-0.05, 0.13, 0.18, -0.22), (-0.30, 0.11, 0.16, -0.2), (-0.62, 0.0, 0.1, 0.02)], 16)
        kit.transform(pant, Matrix.Translation(centre + Vector((0, 0, 0.0))))
        pant_obj = kit.new_object(f'fairing_{side}', pant, mats['paint'], parent=gear, collection=collection)
        kit.set_origin(pant_obj, centre)
    top = Vector((1.05, 0.0, -0.48))
    axle = Vector((1.05, 0.0, -1.05))
    oleo = kit.cylinder(0.045, 0.6, 12, axis='Z')
    kit.transform(oleo, Matrix.Translation((top + axle) * 0.5))
    fork = kit.box((0.06, 0.16, 0.12), axle + Vector((0, 0, 0.12)))
    kit.merge(oleo, fork)
    nose = kit.new_object('gear_nose', oleo, mats['metal'], parent=root, collection=collection)
    kit.set_origin(nose, top)
    wheel('wheel_nose', axle, 0.25, 0.13, mats, nose, collection, segments)


def build_prop(mats, root, collection, blade_points=8):
    hub = Vector((2.07, 0.0, 0.0))
    prop = bpy.data.objects.new('prop_1', None)
    prop.location = hub
    collection.objects.link(prop)
    prop.parent = root
    spinner = kit.loft([(2.36, 0.0, 0.0, 0.0), (2.30, 0.07, 0.07, -0.07, 2.0), (2.18, 0.13, 0.13, -0.13, 2.0), (2.06, 0.165, 0.165, -0.165, 2.0)], 16, cap_front=False, cap_back=True)
    kit.transform(spinner, Matrix.Translation(-hub))
    spinner_obj = kit.new_object('spinner', spinner, mats['paint'], parent=prop, collection=collection)
    spinner_obj.location = (0, 0, 0)
    for k in range(2):
        stations = []
        for i in range(blade_points):
            r = 0.14 + 0.81 * i / (blade_points - 1)
            chord = 0.15 - 0.07 * (i / (blade_points - 1)) ** 1.5
            twist = 32 - 20 * i / (blade_points - 1)
            stations.append((r, 0.03, chord, 0.0, twist))
        blade = kit.wing_panel(stations, code='4412', points=6)
        kit.transform(blade, Matrix.Rotation(math.radians(90), 4, 'Z'))
        kit.transform(blade, Matrix.Rotation(math.radians(90 + 180 * k), 4, 'X'))
        kit.new_object(f'prop_1_blade_{k + 1}', blade, mats['prop'], parent=prop, collection=collection)
    disc = kit.cylinder(0.95, 0.005, 32, axis='X')
    kit.new_object('prop_1_disc', disc, mats['disc'], parent=prop, collection=collection)
    return prop


def materials():
    return {
        'paint': kit.material('wren_paint', (0.86, 0.87, 0.88), 0.58),
        'stripe': kit.material('wren_stripe', (0.05, 0.16, 0.36), 0.58),
        'cowl': kit.material('wren_cowl', (0.80, 0.81, 0.82), 0.6),
        'glass': kit.material('wren_glass', (0.06, 0.08, 0.1), 0.05, metallic=0.0),
        'tyre': kit.material('wren_tyre', (0.03, 0.03, 0.03), 0.95),
        'metal': kit.material('wren_metal', (0.55, 0.56, 0.58), 0.5, metallic=0.85),
        'prop': kit.material('wren_prop', (0.06, 0.06, 0.06), 0.7),
        'disc': kit.material('wren_prop_disc', (0.2, 0.2, 0.2), 0.8, alpha=0.18, double_sided=True),
        'interior': kit.material('wren_interior', (0.23, 0.22, 0.21), 0.92),
        'panel': kit.material('wren_panel', (0.08, 0.085, 0.09), 0.9),
        'screen': kit.material('wren_screen', (0.02, 0.02, 0.02), 0.9),
        'seat': kit.material('wren_seat', (0.30, 0.27, 0.24), 0.95),
        'yoke': kit.material('wren_yoke', (0.06, 0.06, 0.06), 0.8),
    }


def build_exterior(collection):
    mats = materials()
    root = bpy.data.objects.new('wren', None)
    collection.objects.link(root)
    build_fuselage(mats, root, collection)
    for side in ('L', 'R'):
        build_wing_side(side, mats, root, collection)
    build_tail(mats, root, collection)
    build_gear(mats, root, collection)
    build_prop(mats, root, collection)
    return root


def build_cockpit(collection):
    mats = materials()
    root = bpy.data.objects.new('wren_cockpit', None)
    collection.objects.link(root)
    sections = [s for s in smooth_sections(FUSELAGE, 3) if -2.1 < s[0] < 1.25]
    inner = [(x, hw - 0.035, top - 0.035, bottom + 0.05, e) for (x, hw, top, bottom, e) in sections]
    bm = kit.loft(inner, SEGMENTS, cap_front=True, cap_back=True)
    bmesh.ops.reverse_faces(bm, faces=bm.faces)
    remove = [f for f in bm.faces if window_kind(f.calc_center_median(), -f.normal) is not None]
    bmesh.ops.delete(bm, geom=remove, context='FACES_ONLY')
    kit.new_object('cabin', bm, mats['interior'], parent=root, collection=collection)
    panel = kit.box((0.06, 1.08, 0.40), (0.97, 0.0, 0.42))
    glare = kit.box((0.22, 1.10, 0.04), (0.92, 0.0, 0.64))
    kit.merge(panel, glare)
    kit.new_object('panel', panel, mats['panel'], parent=root, collection=collection)
    screen = bmesh.new()
    corners = [(0.938, 0.54, 0.25), (0.938, -0.54, 0.25), (0.938, -0.54, 0.61), (0.938, 0.54, 0.61)]
    verts = [screen.verts.new(c) for c in corners]
    face = screen.faces.new(verts)
    uv = screen.loops.layers.uv.new('UVMap')
    for loop, coords in zip(face.loops, [(0, 0), (1, 0), (1, 1), (0, 1)]):
        loop[uv].uv = coords
    if face.normal.x > 0:
        face.normal_flip()
    kit.new_object('panel_screen', screen, mats['screen'], parent=root, collection=collection)
    for side, sign in (('L', 1), ('R', -1)):
        base = Vector((0.94, 0.30 * sign, 0.38))
        shaft = kit.cylinder(0.012, 0.3, 8, axis='X')
        kit.transform(shaft, Matrix.Translation(base + Vector((-0.15, 0, 0))))
        grip = kit.box((0.03, 0.26, 0.03), base + Vector((-0.30, 0, 0)))
        horns = kit.merge(kit.box((0.03, 0.03, 0.09), base + Vector((-0.30, 0.13, 0.04))), kit.box((0.03, 0.03, 0.09), base + Vector((-0.30, -0.13, 0.04))))
        kit.merge(shaft, grip, horns)
        yoke = kit.new_object(f'yoke_{side}', shaft, mats['yoke'], parent=root, collection=collection)
        kit.set_origin(yoke, base)
        seat = kit.merge(kit.box((0.5, 0.46, 0.10), (0.05, 0.30 * sign, -0.12)), kit.box((0.10, 0.46, 0.62), (-0.25, 0.30 * sign, 0.20)))
        kit.new_object(f'seat_front_{side}', seat, mats['seat'], parent=root, collection=collection)
        rear = kit.merge(kit.box((0.5, 0.46, 0.10), (-0.85, 0.30 * sign, -0.10)), kit.box((0.10, 0.46, 0.58), (-1.15, 0.30 * sign, 0.20)))
        kit.new_object(f'seat_rear_{side}', rear, mats['seat'], parent=root, collection=collection)
    throttle = kit.cylinder(0.008, 0.12, 8, axis='X')
    kit.transform(throttle, Matrix.Translation((0.88, 0.0, 0.32)))
    knob = kit.cylinder(0.02, 0.02, 10, axis='X')
    kit.transform(knob, Matrix.Translation((0.82, 0.0, 0.32)))
    kit.merge(throttle, knob)
    t = kit.new_object('throttle', throttle, mats['yoke'], parent=root, collection=collection)
    kit.set_origin(t, (0.94, 0.0, 0.32))
    floor = kit.box((2.8, 1.0, 0.02), (-0.4, 0.0, -0.46))
    kit.new_object('floor', floor, mats['interior'], parent=root, collection=collection)
    return root


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    out_dir = os.path.abspath(argv[0] if argv else 'assets-src/models/takeflight')
    kit.reset_scene()
    exterior = bpy.data.collections.new('exterior')
    bpy.context.scene.collection.children.link(exterior)
    root = build_exterior(exterior)
    cockpit_collection = bpy.data.collections.new('cockpit')
    bpy.context.scene.collection.children.link(cockpit_collection)
    cockpit = build_cockpit(cockpit_collection)
    ok = export_aircraft.export_aircraft(root, cockpit, name='wren', category='trainer', out_dir=out_dir)
    if not ok:
        sys.exit(1)
    if len(argv) > 1:
        cockpit_collection.hide_render = True
        render_preview(argv[1])


def render_preview(path):
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'MATERIAL'
    scene.render.resolution_x = 1400
    scene.render.resolution_y = 900
    for name, location in (('a', (7.5, 8.5, 3.2)), ('b', (-9.0, -6.0, 4.5)), ('c', (0.0, 0.0, 14.0))):
        cam_data = bpy.data.cameras.new(f'cam_{name}')
        cam = bpy.data.objects.new(f'cam_{name}', cam_data)
        scene.collection.objects.link(cam)
        cam.location = location
        direction = Vector((-0.8, 0, 0.1)) - cam.location
        cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
        scene.camera = cam
        scene.render.filepath = path.replace('.png', f'_{name}.png')
        bpy.ops.render.render(write_still=True)


if __name__ == '__main__':
    main()
