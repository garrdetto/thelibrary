import bpy, bmesh, math, os, sys, random
from mathutils import Vector, Euler

OUT = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else '/tmp/gfart'
ONLY = sys.argv[sys.argv.index('--') + 2].split(',') if '--' in sys.argv and len(sys.argv) > sys.argv.index('--') + 2 else None
SAMPLES = int(os.environ.get('GF_SAMPLES', '96'))
os.makedirs(OUT, exist_ok=True)

LOOKS = {
    'original': {
        'sun': (1.0, 0.9, 0.78), 'sun_power': 4.2, 'sky': (0.55, 0.72, 0.95), 'sky_power': 0.9,
        'hat': (0.62, 0.06, 0.04), 'hat_band': (0.85, 0.82, 0.74), 'pom': (0.9, 0.88, 0.82),
        'fish': {
            'perch': {'top': (0.16, 0.22, 0.06), 'side': (0.75, 0.6, 0.12), 'belly': (0.95, 0.92, 0.75), 'mark': (0.06, 0.09, 0.03), 'fin': (0.85, 0.3, 0.06), 'fin2': (0.55, 0.5, 0.25)},
            'walleye': {'top': (0.22, 0.18, 0.06), 'side': (0.62, 0.5, 0.2), 'belly': (0.95, 0.93, 0.82), 'mark': (0.1, 0.08, 0.03), 'fin': (0.55, 0.45, 0.2), 'fin2': (0.5, 0.42, 0.2)},
            'pike': {'top': (0.08, 0.16, 0.06), 'side': (0.22, 0.36, 0.12), 'belly': (0.92, 0.92, 0.75), 'mark': (0.82, 0.86, 0.5), 'fin': (0.75, 0.25, 0.06), 'fin2': (0.45, 0.4, 0.15)},
        },
        'shanties': [(0.6, 0.08, 0.05), (0.06, 0.22, 0.5), (0.8, 0.5, 0.06), (0.12, 0.35, 0.12)],
        'needles': (0.03, 0.12, 0.07), 'hill': (0.78, 0.85, 0.95), 'ice': (0.3, 0.58, 0.85), 'snow': (0.93, 0.96, 1.0), 'water': (0.01, 0.06, 0.1), 'glow': (1.0, 0.6, 0.25),
    },
    'wics': {
        'sun': (1.0, 1.0, 1.0), 'sun_power': 3.6, 'sky': (0.78, 0.84, 1.0), 'sky_power': 1.1,
        'hat': (0.0, 0.29, 0.62), 'hat_band': (1.0, 1.0, 1.0), 'pom': (1.0, 1.0, 1.0),
        'fish': {
            'perch': {'top': (0.012, 0.045, 0.16), 'side': (0.0, 0.29, 0.62), 'belly': (0.85, 0.93, 0.98), 'mark': (0.008, 0.03, 0.1), 'fin': (0.16, 0.22, 0.46), 'fin2': (0.5, 0.6, 0.8)},
            'walleye': {'top': (0.012, 0.045, 0.16), 'side': (0.16, 0.22, 0.46), 'belly': (0.86, 0.9, 0.95), 'mark': (0.006, 0.014, 0.04), 'fin': (0.0, 0.29, 0.62), 'fin2': (0.6, 0.7, 0.85)},
            'pike': {'top': (0.004, 0.012, 0.04), 'side': (0.012, 0.045, 0.16), 'belly': (0.72, 0.8, 1.0), 'mark': (0.27, 0.63, 0.85), 'fin': (0.0, 0.29, 0.62), 'fin2': (0.16, 0.22, 0.46)},
        },
        'shanties': [(0.0, 0.29, 0.62), (0.012, 0.045, 0.16), (0.16, 0.22, 0.46), (0.0, 0.29, 0.62)],
        'needles': (0.1, 0.14, 0.3), 'hill': (0.68, 0.67, 0.6), 'ice': (0.62, 0.7, 0.86), 'snow': (0.96, 0.97, 1.0), 'water': (0.008, 0.016, 0.045), 'glow': (0.6, 0.85, 1.0),
    },
}


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = SAMPLES
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 6
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    try:
        sc.view_settings.view_transform = 'AgX'
        sc.view_settings.look = 'AgX - Medium High Contrast'
    except Exception:
        pass
    return sc


def lights(look, elev=28, az=-35):
    L = LOOKS[look]
    sc = bpy.context.scene
    w = bpy.data.worlds.new('w')
    sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    bg.inputs[0].default_value = (*L['sky'], 1)
    bg.inputs[1].default_value = L['sky_power']
    sun = bpy.data.lights.new('sun', 'SUN')
    sun.energy = L['sun_power']
    sun.color = L['sun']
    sun.angle = math.radians(4)
    o = bpy.data.objects.new('sun', sun)
    o.rotation_euler = Euler((math.radians(90 - elev), 0, math.radians(90 + az)), 'XYZ')
    sc.collection.objects.link(o)
    rim = bpy.data.lights.new('rim', 'SUN')
    rim.energy = 1.4
    rim.color = (0.75, 0.85, 1.0)
    r = bpy.data.objects.new('rim', rim)
    r.rotation_euler = Euler((math.radians(70), 0, math.radians(200)), 'XYZ')
    sc.collection.objects.link(r)


def camera(cx, cz, scale, w, h, tilt=0.0):
    sc = bpy.context.scene
    cam = bpy.data.cameras.new('cam')
    cam.type = 'ORTHO'
    cam.ortho_scale = scale
    cam.clip_end = 400
    o = bpy.data.objects.new('cam', cam)
    o.location = (cx, -60 * math.cos(math.radians(tilt)), cz + 60 * math.sin(math.radians(tilt)))
    o.rotation_euler = Euler((math.radians(90 - tilt), 0, 0), 'XYZ')
    sc.collection.objects.link(o)
    sc.camera = o
    sc.render.resolution_x = w
    sc.render.resolution_y = h
    sc.render.resolution_percentage = 100
    return o


def render(name):
    path = os.path.join(OUT, name + '.png')
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print('rendered', path, flush=True)


def link(o):
    bpy.context.scene.collection.objects.link(o)
    return o


def mat(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    return m, nt, nt.nodes['Principled BSDF']


def node(nt, kind, **props):
    n = nt.nodes.new(kind)
    for k, v in props.items():
        if k.startswith('in_'):
            n.inputs[k[3:].replace('_', ' ')].default_value = v
        else:
            setattr(n, k, v)
    return n


def ramp(nt, stops, interp='LINEAR'):
    r = nt.nodes.new('ShaderNodeValToRGB')
    r.color_ramp.interpolation = interp
    els = r.color_ramp.elements
    while len(els) < len(stops):
        els.new(0.5)
    for e, (pos, col) in zip(els, stops):
        e.position = pos
        e.color = (*col, 1) if len(col) == 3 else col
    return r


def matte(p, rough=1.0):
    p.inputs['Roughness'].default_value = rough
    p.inputs['Specular IOR Level'].default_value = 0.0


def fur_mat(look):
    m, nt, p = mat('fur')
    matte(p)
    p.inputs['Base Color'].default_value = (0.86, 0.85, 0.8, 1)
    p.inputs['Subsurface Weight'].default_value = 0.35
    p.inputs['Subsurface Radius'].default_value = (0.4, 0.35, 0.3)
    p.inputs['Subsurface Scale'].default_value = 0.05
    p.inputs['Sheen Weight'].default_value = 0.6
    p.inputs['Sheen Roughness'].default_value = 0.6
    nz = node(nt, 'ShaderNodeTexNoise', in_Scale=160.0, in_Detail=6.0)
    bump = node(nt, 'ShaderNodeBump', in_Strength=0.35)
    nt.links.new(nz.outputs['Fac'], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], p.inputs['Normal'])
    return m


def hair_mat():
    m, nt, p = mat('hair')
    nt.nodes.remove(p)
    h = nt.nodes.new('ShaderNodeBsdfHairPrincipled')
    h.parametrization = 'MELANIN'
    h.inputs['Melanin'].default_value = 0.04
    h.inputs['Melanin Redness'].default_value = 0.6
    h.inputs['Roughness'].default_value = 0.55
    h.inputs['Radial Roughness'].default_value = 0.8
    h.inputs['Coat'].default_value = 0.0
    h.inputs['Random Roughness'].default_value = 0.3
    out = nt.nodes['Material Output']
    nt.links.new(h.outputs[0], out.inputs['Surface'])
    return m


def solid(name, col, rough=1.0, spec=0.0, coat=0.0):
    m, nt, p = mat(name)
    p.inputs['Base Color'].default_value = (*col, 1)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Specular IOR Level'].default_value = spec
    p.inputs['Coat Weight'].default_value = coat
    return m


def knit_mat(name, col):
    m, nt, p = mat(name)
    matte(p)
    p.inputs['Base Color'].default_value = (*col, 1)
    p.inputs['Sheen Weight'].default_value = 0.8
    tc = node(nt, 'ShaderNodeTexCoord')
    wave = node(nt, 'ShaderNodeTexWave', wave_type='BANDS', bands_direction='X', in_Scale=55.0, in_Distortion=2.0, in_Detail=2.0)
    nt.links.new(tc.outputs['Object'], wave.inputs['Vector'])
    nz = node(nt, 'ShaderNodeTexNoise', in_Scale=300.0, in_Detail=4.0)
    add = node(nt, 'ShaderNodeMath', operation='ADD')
    nt.links.new(wave.outputs['Fac'], add.inputs[0])
    nt.links.new(nz.outputs['Fac'], add.inputs[1])
    bump = node(nt, 'ShaderNodeBump', in_Strength=0.7)
    nt.links.new(add.outputs[0], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], p.inputs['Normal'])
    return m


def metaball_mesh(name, elems, res=0.025, thresh=0.6):
    mb = bpy.data.metaballs.new(name)
    mb.resolution = res
    mb.render_resolution = res
    mb.threshold = thresh
    for e in elems:
        el = mb.elements.new(type='ELLIPSOID')
        el.co = e['co']
        el.radius = e.get('r', 1.0) * 1.74
        el.size_x, el.size_y, el.size_z = e['size']
        el.stiffness = e.get('stiff', 2.0)
        if 'rot' in e:
            el.rotation = Euler(e['rot'], 'XYZ').to_quaternion()
    o = link(bpy.data.objects.new(name + '_mb', mb))
    dg = bpy.context.evaluated_depsgraph_get()
    dg.update()
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
    bpy.data.objects.remove(o)
    me.shade_smooth()
    return link(bpy.data.objects.new(name, me))


def add_fur(o, count, length, children=8, rough=0.004, density=None, size=None):
    if os.environ.get('GF_NOFUR'):
        return
    mod = o.modifiers.new('fur', 'PARTICLE_SYSTEM')
    if density or size:
        dg, lg = o.vertex_groups.new(name='dens'), o.vertex_groups.new(name='len')
        for v in o.data.vertices:
            dg.add([v.index], density(v.co) if density else 1.0, 'REPLACE')
            lg.add([v.index], size(v.co) if size else 1.0, 'REPLACE')
        mod.particle_system.vertex_group_density = 'dens'
        mod.particle_system.vertex_group_length = 'len'
    s = mod.particle_system.settings
    s.type = 'HAIR'
    s.count = count
    s.hair_length = length
    s.length_random = 0.45
    s.use_advanced_hair = True
    s.normal_factor = length
    s.object_align_factor = (0.0, 0.0, -length * 0.6)
    s.factor_random = length * 0.2
    s.child_type = 'INTERPOLATED'
    s.child_percent = children
    s.rendered_child_count = children
    s.child_radius = 0.02
    s.clump_factor = 0.35
    s.roughness_1 = rough
    s.roughness_1_size = 0.6
    s.roughness_endpoint = 0.004
    s.radius_scale = 0.0012
    s.root_radius = 1.0
    s.tip_radius = 0.15
    s.material = 2
    s.display_step = 3
    s.render_step = 4


def sphere(name, loc, r, m, seg=48):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=seg // 2, radius=r)
    bm.to_mesh(me)
    bm.free()
    me.shade_smooth()
    o = link(bpy.data.objects.new(name, me))
    o.location = loc
    o.data.materials.append(m)
    return o


def surface_point(o, x, z, from_y=-5.0):
    hit, loc, nrm, idx = o.ray_cast(Vector((x, from_y, z)), Vector((0, 1, 0)))
    return (loc, nrm) if hit else (Vector((x, 0, z)), Vector((0, -1, 0)))


BEAR_BODY = [
    {'co': (-0.18, 0.0, 0.55), 'size': (0.72, 0.58, 0.5)},
    {'co': (0.02, 0.0, 1.12), 'size': (0.5, 0.46, 0.72), 'rot': (0, 0.18, 0)},
    {'co': (0.2, 0.0, 1.5), 'size': (0.4, 0.4, 0.38)},
    {'co': (0.3, 0.0, 1.86), 'size': (0.27, 0.27, 0.3), 'rot': (0, 0.4, 0)},
    {'co': (0.4, 0.0, 2.1), 'size': (0.32, 0.3, 0.29)},
    {'co': (0.68, 0.0, 2.03), 'size': (0.2, 0.15, 0.13), 'rot': (0, 0.12, 0)},
    {'co': (0.12, -0.32, 0.38), 'size': (0.38, 0.24, 0.3)},
    {'co': (0.48, -0.34, 0.1), 'size': (0.3, 0.17, 0.11)},
    {'co': (0.46, 0.34, 0.1), 'size': (0.28, 0.16, 0.1)},
    {'co': (0.32, 0.36, 0.9), 'size': (0.14, 0.14, 0.42), 'rot': (0, -0.35, 0)},
    {'co': (0.42, 0.38, 0.55), 'size': (0.15, 0.14, 0.1)},
    {'co': (0.22, 0.2, 2.34), 'size': (0.09, 0.06, 0.09)},
    {'co': (0.22, -0.2, 2.34), 'size': (0.09, 0.06, 0.09)},
]
BEAR_YAW = -24
SHOULDER = (0.25, -0.36, 1.45)
ARM_LEN = 0.85


def bear(look, part):
    reset()
    L = LOOKS[look]
    lights(look)
    root = link(bpy.data.objects.new('root', None))
    furm, hairm = fur_mat(look), hair_mat()
    if part == 'body':
        b = metaball_mesh('bear', BEAR_BODY)
        b.data.materials.append(furm)
        b.data.materials.append(hairm)
        nose_m = solid('nose', (0.015, 0.015, 0.02), rough=0.45, spec=0.15)
        eye_m = solid('eye', (0.01, 0.008, 0.008), rough=0.05, spec=0.6, coat=1.0)
        claw_m = solid('claw', (0.04, 0.035, 0.03), rough=0.6, spec=0.1)
        tip, _ = surface_point(b, 0.84, 2.05)
        n = sphere('nose', (0.86, tip.y + 0.06, 2.06), 0.07, nose_m)
        n.scale = (0.8, 1.05, 0.75)
        for side in (-1, 1):
            hit, loc, nrm, _ = b.ray_cast(Vector((0.56, -5 * side, 2.18)), Vector((0, side, 0)))
            if hit:
                e = sphere('eye', loc + nrm * 0.004, 0.032, eye_m, 24)
        m_o = bpy.data.curves.new('mouth', 'CURVE')
        m_o.dimensions = '3D'
        m_o.bevel_depth = 0.008
        sp = m_o.splines.new('BEZIER')
        sp.bezier_points.add(2)
        mt, _ = surface_point(b, 0.72, 1.95)
        pts = [(0.84, mt.y - 0.01, 1.97), (0.74, mt.y - 0.02, 1.93), (0.62, mt.y + 0.02, 1.95)]
        for bp, co in zip(sp.bezier_points, pts):
            bp.co = co
            bp.handle_left_type = bp.handle_right_type = 'AUTO'
        mo = link(bpy.data.objects.new('mouth', m_o))
        mo.data.materials.append(nose_m)
        for i in range(4):
            c = bpy.data.meshes.new('claw')
            bm = bmesh.new()
            bmesh.ops.create_cone(bm, cap_ends=True, segments=12, radius1=0.018, radius2=0.002, depth=0.07)
            bm.to_mesh(c)
            bm.free()
            co = link(bpy.data.objects.new('claw', c))
            co.data.materials.append(claw_m)
            co.location = (0.77, -0.27 - i * 0.045, 0.05)
            co.rotation_euler = (0, math.radians(100), 0)
        hat_m, band_m, pom_m = knit_mat('hat', L['hat']), knit_mat('band', L['hat_band']), knit_mat('pom', L['pom'])
        hm = bpy.data.meshes.new('hat')
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=64, v_segments=32, radius=0.33)
        for v in list(bm.verts):
            if v.co.z < -0.02:
                bm.verts.remove(v)
        bm.to_mesh(hm)
        bm.free()
        hm.shade_smooth()
        hat = link(bpy.data.objects.new('hat', hm))
        hat.data.materials.append(hat_m)
        hat.location = (0.36, 0, 2.15)
        hat.scale = (1.0, 1.0, 1.25)
        hat.rotation_euler = (0, math.radians(-14), 0)
        sol = hat.modifiers.new('s', 'SOLIDIFY')
        sol.thickness = 0.02
        tm = bpy.data.meshes.new('band')
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=False, segments=64, radius1=0.35, radius2=0.335, depth=0.1)
        bm.to_mesh(tm)
        bm.free()
        tm.shade_smooth()
        band = link(bpy.data.objects.new('band', tm))
        band.data.materials.append(band_m)
        band.location = (0.36, 0, 2.16)
        band.rotation_euler = (0, math.radians(-14), 0)
        bs = band.modifiers.new('s', 'SOLIDIFY')
        bs.thickness = 0.05
        bsub = band.modifiers.new('sub', 'SUBSURF')
        bsub.levels = bsub.render_levels = 2
        pom = sphere('pom', (0.27, 0, 2.58), 0.1, pom_m)
        pom.data.materials.append(hairm)
        mod = pom.modifiers.new('fur', 'PARTICLE_SYSTEM')
        s = mod.particle_system.settings
        s.type = 'HAIR'
        s.count = 3000
        s.hair_length = 0.05
        s.use_advanced_hair = False
        s.radius_scale = 0.002
        s.material = 2
        s.child_type = 'INTERPOLATED'
        s.rendered_child_count = 6
        s.child_percent = 6
        s.roughness_1 = 0.02
        hat_c = Vector((0.36, 0.0, 2.15))
        add_fur(b, 30000, 0.04,
                density=lambda c: 0.0 if (c - hat_c).length < 0.36 and c.z > 2.12 else 1.0,
                size=lambda c: 0.25 if c.x > 0.62 and c.z > 1.88 else (0.55 if c.z > 1.9 else (0.6 if c.z < 0.2 and c.x > 0.3 else 1.0)))
        objs = [o for o in bpy.context.scene.objects if o.type in ('MESH', 'CURVE')]
    else:
        a = metaball_mesh('arm', [
            {'co': (0.04, 0.0, 0.0), 'size': (0.2, 0.18, 0.2)},
            {'co': (0.3, 0.0, -0.01), 'size': (0.24, 0.13, 0.13), 'stiff': 1.6},
            {'co': (0.56, 0.0, -0.02), 'size': (0.18, 0.12, 0.11), 'stiff': 1.6},
            {'co': (0.78, 0.0, -0.03), 'size': (0.13, 0.16, 0.1)},
        ])
        a.data.materials.append(furm)
        a.data.materials.append(hairm)
        claw_m = solid('claw', (0.04, 0.035, 0.03), rough=0.6, spec=0.1)
        for i in range(4):
            c = bpy.data.meshes.new('claw')
            bm = bmesh.new()
            bmesh.ops.create_cone(bm, cap_ends=True, segments=12, radius1=0.024, radius2=0.002, depth=0.1)
            bm.to_mesh(c)
            bm.free()
            co = link(bpy.data.objects.new('claw', c))
            co.data.materials.append(claw_m)
            co.location = (0.9, -0.1 + i * 0.065, -0.07)
            co.rotation_euler = (0, math.radians(110), 0)
        add_fur(a, 9000, 0.035, size=lambda c: max(0.25, min(1.0, (0.86 - c.x) * 3.0)))
        objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    for o in objs:
        o.parent = root
    if part == 'body':
        root.rotation_euler = (0, 0, math.radians(BEAR_YAW))
        camera(0.25, 1.35, 3.1, 620, 620)
    else:
        root.rotation_euler = (0, 0, math.radians(BEAR_YAW))
        camera(0.0, 0.0, 2.2, 440, 440)
    render(f'bear-{part}-{look}')


def fish_profile(kind, t):
    if kind == 'pike':
        return 0.105 * (t ** 0.45) * ((1 - t) ** 0.25) * 1.5
    if kind == 'walleye':
        return 0.15 * (t ** 0.5) * ((1 - t) ** 0.32) * 1.45
    return 0.19 * (t ** 0.55) * ((1 - t) ** 0.4) * 1.4


def smooth_outline(pts, per=10):
    out = []
    n = len(pts)
    for i in range(n):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[(i + 1) % n], pts[(i + 2) % n]
        for k in range(per):
            t = k / per
            t2, t3 = t * t, t * t * t
            out.append(tuple(0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3) for j in range(2)))
    return out


def fin(name, pts, m, y=0.0, thick=0.003, rot=None, base=None, curl=0.015):
    pts = smooth_outline(pts)
    bx, bz = base if base else pts[0]
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    vs = [bm.verts.new((x - bx, 0, z - bz)) for x, z in pts]
    f = bm.faces.new(vs)
    bmesh.ops.triangulate(bm, faces=[f])
    for _ in range(2):
        bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=1, use_grid_fill=True)
    for v in bm.verts:
        d = math.hypot(v.co.x, v.co.z)
        v.co.y += curl * math.sin(d * 40) * d * 4
    bm.to_mesh(me)
    bm.free()
    me.shade_smooth()
    o = link(bpy.data.objects.new(name, me))
    o.location = (bx, y, bz)
    if rot:
        o.rotation_euler = rot
    o.data.materials.append(m)
    s = o.modifiers.new('s', 'SOLIDIFY')
    s.thickness = thick
    return o


def fin_mat(name, col, col2, rays=7.0, spots=False):
    m, nt, p = mat(name)
    p.inputs['Roughness'].default_value = 0.5
    p.inputs['Specular IOR Level'].default_value = 0.12
    p.inputs['Subsurface Weight'].default_value = 0.4
    p.inputs['Subsurface Radius'].default_value = (0.05, 0.03, 0.02)
    tc = node(nt, 'ShaderNodeTexCoord')
    sw = node(nt, 'ShaderNodeMapping')
    sw.inputs['Rotation'].default_value = (math.pi / 2, 0, 0)
    nt.links.new(tc.outputs['Object'], sw.inputs['Vector'])
    grad = node(nt, 'ShaderNodeTexGradient', gradient_type='RADIAL')
    nt.links.new(sw.outputs['Vector'], grad.inputs['Vector'])
    mul = node(nt, 'ShaderNodeMath', operation='MULTIPLY')
    mul.inputs[1].default_value = rays * 6.0
    nt.links.new(grad.outputs['Fac'], mul.inputs[0])
    sine = node(nt, 'ShaderNodeMath', operation='SINE')
    nt.links.new(mul.outputs[0], sine.inputs[0])
    wave = node(nt, 'ShaderNodeMapRange', in_From_Min=-1.0, in_From_Max=1.0)
    nt.links.new(sine.outputs[0], wave.inputs['Value'])
    wave.outputs[0].name = 'Fac'
    r = ramp(nt, [(0.0, col2), (0.6, col)])
    nt.links.new(wave.outputs[0], r.inputs['Fac'])
    if spots:
        vor = node(nt, 'ShaderNodeTexVoronoi', in_Scale=40.0)
        nt.links.new(tc.outputs['Object'], vor.inputs['Vector'])
        mix = node(nt, 'ShaderNodeMix', data_type='RGBA', blend_type='MULTIPLY')
        sr = ramp(nt, [(0.0, (0.1, 0.05, 0.02)), (0.25, (1, 1, 1))], 'CONSTANT')
        nt.links.new(vor.outputs['Distance'], sr.inputs['Fac'])
        mix.inputs['Factor'].default_value = 1.0
        nt.links.new(r.outputs['Color'], mix.inputs['A'])
        nt.links.new(sr.outputs['Color'], mix.inputs['B'])
        nt.links.new(mix.outputs['Result'], p.inputs['Base Color'])
    else:
        nt.links.new(r.outputs['Color'], p.inputs['Base Color'])
    p.inputs['Alpha'].default_value = 0.92
    bump = node(nt, 'ShaderNodeBump', in_Strength=0.3)
    nt.links.new(wave.outputs[0], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], p.inputs['Normal'])
    return m


def body_mat(kind, c):
    m, nt, p = mat('body_' + kind)
    p.inputs['Roughness'].default_value = 0.42
    p.inputs['Specular IOR Level'].default_value = 0.15
    p.inputs['Subsurface Weight'].default_value = 0.15
    p.inputs['Subsurface Radius'].default_value = (0.03, 0.02, 0.01)
    tc = node(nt, 'ShaderNodeTexCoord')
    sep = node(nt, 'ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['Object'], sep.inputs[0])
    hz = node(nt, 'ShaderNodeMapRange', in_From_Min=-0.12, in_From_Max=0.12)
    nt.links.new(sep.outputs['Z'], hz.inputs['Value'])
    base = ramp(nt, [(0.0, c['belly']), (0.42, c['belly']), (0.55, c['side']), (0.82, c['side']), (1.0, c['top'])])
    nt.links.new(hz.outputs['Result'], base.inputs['Fac'])
    if kind == 'perch':
        pat = node(nt, 'ShaderNodeTexWave', wave_type='BANDS', bands_direction='X', in_Scale=3.6, in_Distortion=2.5, in_Detail=1.5)
        nt.links.new(tc.outputs['Object'], pat.inputs['Vector'])
        pr = ramp(nt, [(0.0, (0, 0, 0)), (0.62, (0, 0, 0)), (0.72, (1, 1, 1))])
        nt.links.new(pat.outputs['Fac'], pr.inputs['Fac'])
    elif kind == 'walleye':
        pat = node(nt, 'ShaderNodeTexNoise', in_Scale=9.0, in_Detail=4.0, in_Roughness=0.6)
        nt.links.new(tc.outputs['Object'], pat.inputs['Vector'])
        pr = ramp(nt, [(0.0, (0, 0, 0)), (0.5, (0, 0, 0)), (0.62, (0.85, 0.85, 0.85))])
        nt.links.new(pat.outputs['Fac'], pr.inputs['Fac'])
    else:
        mp = node(nt, 'ShaderNodeMapping')
        mp.inputs['Scale'].default_value = (1.0, 1.0, 2.2)
        nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
        pat = node(nt, 'ShaderNodeTexVoronoi', in_Scale=26.0, in_Randomness=0.7)
        nt.links.new(mp.outputs['Vector'], pat.inputs['Vector'])
        pr = ramp(nt, [(0.0, (1, 1, 1)), (0.2, (1, 1, 1)), (0.28, (0, 0, 0))])
        nt.links.new(pat.outputs['Distance'], pr.inputs['Fac'])
    band = ramp(nt, [(0.0, (0, 0, 0)), (0.3, (0, 0, 0)), (0.45, (1, 1, 1)), (0.9, (1, 1, 1)), (1.0, (0.3, 0.3, 0.3))])
    nt.links.new(hz.outputs['Result'], band.inputs['Fac'])
    mask = node(nt, 'ShaderNodeMix', data_type='RGBA', blend_type='MULTIPLY')
    mask.inputs['Factor'].default_value = 1.0
    nt.links.new(pr.outputs['Color'], mask.inputs['A'])
    nt.links.new(band.outputs['Color'], mask.inputs['B'])
    mixc = node(nt, 'ShaderNodeMix', data_type='RGBA')
    nt.links.new(mask.outputs['Result'], mixc.inputs['Factor'])
    nt.links.new(base.outputs['Color'], mixc.inputs['A'])
    mixc.inputs['B'].default_value = (*c['mark'], 1)
    nt.links.new(mixc.outputs['Result'], p.inputs['Base Color'])
    sc = node(nt, 'ShaderNodeMapping')
    sc.inputs['Scale'].default_value = (1.0, 1.6, 1.0)
    nt.links.new(tc.outputs['Object'], sc.inputs['Vector'])
    scales = node(nt, 'ShaderNodeTexVoronoi', in_Scale=95.0 if kind != 'pike' else 140.0, feature='DISTANCE_TO_EDGE')
    nt.links.new(sc.outputs['Vector'], scales.inputs['Vector'])
    bump = node(nt, 'ShaderNodeBump', in_Strength=0.45, in_Distance=0.002)
    nt.links.new(scales.outputs['Distance'], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], p.inputs['Normal'])
    return m


def fish(look, kind):
    reset()
    lights(look, elev=40, az=-20)
    c = LOOKS[look]['fish'][kind]
    me = bpy.data.meshes.new('body')
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=96, v_segments=48, radius=0.5)
    for v in bm.verts:
        t = v.co.x + 0.5
        h = fish_profile(kind, max(0.0, min(1.0, t)))
        head = 1.0 if kind != 'pike' else 0.85
        v.co.z = v.co.z / 0.5 * h * (1.0 if v.co.z > 0 else 0.92)
        v.co.y = v.co.y / 0.5 * h * (0.42 if kind != 'pike' else 0.55) * head
        if t > 0.86:
            v.co.z -= (t - 0.86) * 0.12 * (1 if kind != 'pike' else 0.6)
    bm.to_mesh(me)
    bm.free()
    me.shade_smooth()
    body = link(bpy.data.objects.new('body', me))
    body.data.materials.append(body_mat(kind, c))
    sub = body.modifiers.new('sub', 'SUBSURF')
    sub.levels = sub.render_levels = 1
    fm = fin_mat('fin', c['fin'], c['fin2'], spots=(kind == 'pike' and look == 'original'))
    fm2 = fin_mat('fin2', c['fin2'], c['fin'], rays=9.0)
    if kind == 'pike':
        fin('tail', [(-0.44, 0.02), (-0.56, 0.12), (-0.65, 0.15), (-0.6, 0.04), (-0.58, 0.0), (-0.6, -0.04), (-0.65, -0.15), (-0.56, -0.12), (-0.44, -0.02)], fm, base=(-0.44, 0.0))
        fin('dorsal', [(-0.36, 0.02), (-0.24, 0.03), (-0.29, 0.11), (-0.38, 0.1)], fm, base=(-0.3, 0.02))
        fin('anal', [(-0.35, -0.02), (-0.24, -0.03), (-0.29, -0.1), (-0.38, -0.09)], fm, base=(-0.3, -0.02))
        fin('pelvic', [(-0.03, -0.04), (0.04, -0.04), (-0.05, -0.1)], fm, y=-0.01, base=(0.0, -0.04))
    else:
        big = 1.2 if kind == 'perch' else 1.0
        fin('tail', [(-0.43, 0.025), (-0.56, 0.15 * big), (-0.67, 0.2 * big), (-0.62, 0.06), (-0.59, 0.0), (-0.62, -0.06), (-0.67, -0.2 * big), (-0.56, -0.15 * big), (-0.43, -0.025)], fm, base=(-0.43, 0.0))
        fin('dorsal1', [(-0.06, 0.09 * big), (0.18, 0.1 * big), (0.13, 0.19 * big), (0.06, 0.22 * big), (-0.02, 0.2 * big), (-0.08, 0.15 * big)], fm2, base=(0.06, 0.09 * big))
        fin('dorsal2', [(-0.31, 0.05), (-0.08, 0.08 * big), (-0.13, 0.17 * big), (-0.29, 0.12)], fm, base=(-0.2, 0.06))
        fin('anal', [(-0.31, -0.05), (-0.14, -0.07), (-0.19, -0.15), (-0.31, -0.11)], fm, base=(-0.22, -0.06))
        fin('pelvic', [(0.1, -0.08), (0.2, -0.08), (0.08, -0.17)], fm, y=-0.02, base=(0.15, -0.08))
    pec_pts = [(0.0, 0.0), (0.03, 0.015), (-0.07, -0.04), (-0.09, -0.02)]
    loc, nrm = surface_point(body, 0.22, -0.03)
    fin('pectoral', [(x + 0.22, z - 0.03) for x, z in pec_pts], fm, y=loc.y - 0.01, base=(0.22, -0.03))
    eye_r = {'perch': 0.03, 'walleye': 0.04, 'pike': 0.025}[kind]
    ex = {'perch': 0.36, 'walleye': 0.37, 'pike': 0.38}[kind]
    ez = {'perch': 0.03, 'walleye': 0.035, 'pike': 0.02}[kind]
    loc, nrm = surface_point(body, ex, ez)
    iris = solid('iris', (0.85, 0.75, 0.75) if kind == 'walleye' else (0.75, 0.55, 0.1), rough=0.2, spec=0.5, coat=1.0)
    pupil = solid('pupil', (0.005, 0.005, 0.005), rough=0.05, spec=0.6, coat=1.0)
    e = sphere('eye', loc + Vector((0, eye_r * 0.35, 0)), eye_r, iris, 32)
    e.scale = (1, 0.5, 1)
    sphere('pupil', loc + Vector((0.004, -eye_r * 0.12, 0)), eye_r * 0.55, pupil, 24).scale = (1, 0.4, 1)
    gc = bpy.data.curves.new('gill', 'CURVE')
    gc.dimensions = '3D'
    gc.bevel_depth = 0.0025
    sp = gc.splines.new('BEZIER')
    sp.bezier_points.add(2)
    gx = {'perch': 0.25, 'walleye': 0.25, 'pike': 0.26}[kind]
    for bp, (x, z) in zip(sp.bezier_points, [(gx + 0.02, 0.07), (gx - 0.03, 0.0), (gx + 0.02, -0.07)]):
        l, _ = surface_point(body, x, z * (0.8 if kind == 'pike' else 1))
        bp.co = l - Vector((0, 0.003, 0))
        bp.handle_left_type = bp.handle_right_type = 'AUTO'
    go = link(bpy.data.objects.new('gill', gc))
    go.data.materials.append(solid('gillm', tuple(v * 0.45 for v in c['side']), rough=0.6))
    mc = bpy.data.curves.new('mouth', 'CURVE')
    mc.dimensions = '3D'
    mc.bevel_depth = 0.003
    sp = mc.splines.new('BEZIER')
    sp.bezier_points.add(1)
    for bp, (x, z) in zip(sp.bezier_points, [(0.49, -0.01), (0.4, -0.03)]):
        l, _ = surface_point(body, x, z)
        bp.co = l - Vector((0, 0.003, 0))
        bp.handle_left_type = bp.handle_right_type = 'AUTO'
    mo = link(bpy.data.objects.new('mouth', mc))
    mo.data.materials.append(solid('mouthm', (0.05, 0.03, 0.03), rough=0.6))
    camera(-0.08, 0.0, 1.24, 512, 256)
    render(f'fish-{kind}-{look}')


def snow_mat(look, name='snow'):
    L = LOOKS[look]
    m, nt, p = mat(name)
    matte(p)
    p.inputs['Base Color'].default_value = (*L['snow'], 1)
    p.inputs['Subsurface Weight'].default_value = 0.5
    p.inputs['Subsurface Radius'].default_value = (0.3, 0.5, 0.9)
    p.inputs['Subsurface Scale'].default_value = 0.05
    nz = node(nt, 'ShaderNodeTexNoise', in_Scale=60.0, in_Detail=8.0)
    bump = node(nt, 'ShaderNodeBump', in_Strength=0.25)
    nt.links.new(nz.outputs['Fac'], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], p.inputs['Normal'])
    return m


def periodic_coords(nt, period, radius=None):
    radius = radius or period / (2 * math.pi)
    tc = node(nt, 'ShaderNodeNewGeometry')
    sep = node(nt, 'ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['Position'], sep.inputs[0])
    k = node(nt, 'ShaderNodeMath', operation='MULTIPLY', in_Value=0.0)
    k.inputs[1].default_value = 2 * math.pi / period
    nt.links.new(sep.outputs['X'], k.inputs[0])
    cs = node(nt, 'ShaderNodeMath', operation='COSINE')
    sn = node(nt, 'ShaderNodeMath', operation='SINE')
    nt.links.new(k.outputs[0], cs.inputs[0])
    nt.links.new(k.outputs[0], sn.inputs[0])
    mc = node(nt, 'ShaderNodeMath', operation='MULTIPLY')
    mc.inputs[1].default_value = radius
    ms = node(nt, 'ShaderNodeMath', operation='MULTIPLY')
    ms.inputs[1].default_value = radius
    nt.links.new(cs.outputs[0], mc.inputs[0])
    nt.links.new(sn.outputs[0], ms.inputs[0])
    comb = node(nt, 'ShaderNodeCombineXYZ')
    nt.links.new(mc.outputs[0], comb.inputs['X'])
    nt.links.new(ms.outputs[0], comb.inputs['Y'])
    nt.links.new(sep.outputs['Y'], comb.inputs['Z'])
    return comb


def pine_mesh(seed, look):
    from mathutils import Matrix
    rnd = random.Random(seed)
    L = LOOKS[look]
    bm = bmesh.new()
    tiers = rnd.randint(9, 12)
    height = rnd.uniform(5.5, 8.5)
    for i in range(tiers):
        t = i / tiers
        z0 = 0.7 + t * (height - 1.4)
        r = (1.0 - t) ** 1.05 * rnd.uniform(1.4, 1.8) + 0.18
        seg, rows = 40, 5
        prev = [bm.verts.new((0, 0, z0 + r * 0.85))]
        for row in range(1, rows + 1):
            f = row / rows
            ring = []
            for sgi in range(seg):
                a = 2 * math.pi * (sgi + (0.5 if row % 2 else 0)) / seg
                bough = 1.0 + 0.16 * math.sin(a * rnd.choice((5, 6, 7)) + seed) + rnd.uniform(-0.07, 0.07) * f
                rr = r * f * bough
                droop = (f ** 2.2) * r * 0.32 + rnd.uniform(0, 0.05)
                ring.append(bm.verts.new((math.cos(a) * rr, math.sin(a) * rr, z0 + r * 0.85 * (1 - f) - droop)))
            if len(prev) == 1:
                for sgi in range(seg):
                    bm.faces.new((prev[0], ring[sgi], ring[(sgi + 1) % seg]))
            else:
                for sgi in range(seg):
                    bm.faces.new((prev[sgi], ring[sgi], ring[(sgi + 1) % seg], prev[(sgi + 1) % seg]))
            prev = ring
    bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=0.16, radius2=0.08, depth=1.6, matrix=Matrix.Translation((0, 0, 0.8)))
    me = bpy.data.meshes.new(f'pine{seed}')
    bm.to_mesh(me)
    bm.free()
    me.shade_smooth()
    m, nt, p = mat(f'needles{seed}')
    matte(p)
    geo = node(nt, 'ShaderNodeNewGeometry')
    sep = node(nt, 'ShaderNodeSeparateXYZ')
    nt.links.new(geo.outputs['Normal'], sep.inputs[0])
    nz = node(nt, 'ShaderNodeTexNoise', in_Scale=5.0, in_Detail=8.0, in_Roughness=0.65)
    add = node(nt, 'ShaderNodeMath', operation='ADD')
    nt.links.new(sep.outputs['Z'], add.inputs[0])
    nt.links.new(nz.outputs['Fac'], add.inputs[1])
    half = node(nt, 'ShaderNodeMath', operation='MULTIPLY')
    half.inputs[1].default_value = 0.5
    nt.links.new(add.outputs[0], half.inputs[0])
    nd = L['needles']
    r = ramp(nt, [(0.0, tuple(v * 0.45 for v in nd)), (0.5, nd), (0.6, tuple(v * 1.25 for v in nd)), (0.63, L['snow'])])
    nt.links.new(half.outputs[0], r.inputs['Fac'])
    nt.links.new(r.outputs['Color'], p.inputs['Base Color'])
    nz2 = node(nt, 'ShaderNodeTexNoise', in_Scale=55.0, in_Detail=12.0)
    bump = node(nt, 'ShaderNodeBump', in_Strength=1.0)
    nt.links.new(nz2.outputs['Fac'], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], p.inputs['Normal'])
    me.materials.append(m)
    return me


def shore(look):
    reset()
    lights(look, elev=22, az=-40)
    L = LOOKS[look]
    period = 60.0
    hm = bpy.data.meshes.new('hills')
    bm = bmesh.new()
    nx, ny = 480, 40
    grid = []
    for j in range(ny + 1):
        row = []
        for i in range(nx + 1):
            x = -period * 0.25 + i / nx * period * 1.5
            y = 8 + j * 1.5
            h = 3.5 + 2.2 * math.sin(2 * math.pi * x / period * 2 + 1.0) + 1.1 * math.sin(2 * math.pi * x / period * 5 + 0.4) + j * 0.14
            row.append(bm.verts.new((x, y, max(0, h) * min(1, j / 4))))
        grid.append(row)
    for j in range(ny):
        for i in range(nx):
            bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
    bm.to_mesh(hm)
    bm.free()
    hm.shade_smooth()
    hills = link(bpy.data.objects.new('hills', hm))
    hills.hide_render = True
    hmat, nt, p = mat('hillm')
    matte(p)
    p.inputs['Base Color'].default_value = (*L['hill'], 1)
    p.inputs['Subsurface Weight'].default_value = 0.3
    hills.data.materials.append(hmat)
    gm = bpy.data.meshes.new('ground')
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=4, y_segments=4, size=1)
    bm.to_mesh(gm)
    bm.free()
    g = link(bpy.data.objects.new('ground', gm))
    g.scale = (period * 2, 20, 1)
    g.location = (period / 2, -10, 0)
    g.data.materials.append(snow_mat(look))
    rnd = random.Random(42)
    pines = [pine_mesh(s, look) for s in range(5)]
    twig = bpy.data.textures.new('twig', 'CLOUDS')
    twig.noise_scale = 0.35
    spots = []
    x = 0.0
    while x < period:
        spots.append((x, rnd.uniform(0, 7), rnd.uniform(0.55, 1.15), rnd.randrange(5), rnd.uniform(0, 6.28)))
        x += rnd.uniform(0.5, 1.6)
    for (x, y, s, k, rz) in spots:
        for off in (-period, 0, period):
            o = link(bpy.data.objects.new('pine', pines[k]))
            o.location = (x + off, y, 0)
            o.scale = (s, s, s * rnd.uniform(0.9, 1.1))
            o.rotation_euler = (0, 0, rz)
            d = o.modifiers.new('d', 'DISPLACE')
            d.texture = twig
            d.strength = 0.25
    camera(period / 2, 4.6, period, 2400, 360, tilt=4)
    render(f'shore-{look}')


def shanty(look, idx):
    reset()
    lights(look, elev=30, az=-45)
    L = LOOKS[look]
    col = L['shanties'][idx]
    root = link(bpy.data.objects.new('root', None))
    m, nt, p = mat('wall')
    p.inputs['Roughness'].default_value = 0.85
    p.inputs['Specular IOR Level'].default_value = 0.075
    tc = node(nt, 'ShaderNodeTexCoord')
    wave = node(nt, 'ShaderNodeTexWave', wave_type='BANDS', bands_direction='Z', in_Scale=9.0, in_Distortion=0.4)
    nt.links.new(tc.outputs['Object'], wave.inputs['Vector'])
    nz = node(nt, 'ShaderNodeTexNoise', in_Scale=30.0, in_Detail=8.0)
    r = ramp(nt, [(0.0, tuple(v * 0.55 for v in col)), (0.2, col), (1.0, tuple(min(1, v * 1.15) for v in col))])
    mix = node(nt, 'ShaderNodeMath', operation='MULTIPLY')
    nt.links.new(wave.outputs['Fac'], mix.inputs[0])
    nt.links.new(nz.outputs['Fac'], mix.inputs[1])
    nt.links.new(wave.outputs['Fac'], r.inputs['Fac'])
    nt.links.new(r.outputs['Color'], p.inputs['Base Color'])
    bump = node(nt, 'ShaderNodeBump', in_Strength=0.5)
    nt.links.new(mix.outputs[0], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], p.inputs['Normal'])
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    me = bpy.data.meshes.new('box')
    bm.to_mesh(me)
    bm.free()
    box = link(bpy.data.objects.new('box', me))
    box.scale = (2.0, 1.6, 1.8)
    box.location = (0, 0, 0.9)
    box.data.materials.append(m)
    bev = box.modifiers.new('b', 'BEVEL')
    bev.width = 0.03
    bev.segments = 3
    snow = snow_mat(look)
    rm = bpy.data.meshes.new('roof')
    bm = bmesh.new()
    vs = [bm.verts.new(v) for v in [(-1.15, -0.95, 1.75), (1.15, -0.95, 1.75), (1.15, 0.0, 2.45), (-1.15, 0.0, 2.45), (-1.15, 0.95, 1.75), (1.15, 0.95, 1.75)]]
    bm.faces.new((vs[0], vs[1], vs[2], vs[3]))
    bm.faces.new((vs[3], vs[2], vs[5], vs[4]))
    bm.to_mesh(rm)
    bm.free()
    roof = link(bpy.data.objects.new('roof', rm))
    roof.data.materials.append(snow)
    sol = roof.modifiers.new('s', 'SOLIDIFY')
    sol.thickness = 0.16
    rb = roof.modifiers.new('rb', 'BEVEL')
    rb.width = 0.06
    rb.segments = 4
    rsub = roof.modifiers.new('sub', 'SUBSURF')
    rsub.levels = rsub.render_levels = 1
    rsub.subdivision_type = 'SIMPLE'
    disp = roof.modifiers.new('d', 'DISPLACE')
    tex = bpy.data.textures.new('cl', 'CLOUDS')
    tex.noise_scale = 0.4
    disp.texture = tex
    disp.strength = 0.08
    gm = bpy.data.meshes.new('g2')
    bm = bmesh.new()
    for xx in (-1.0, 1.0):
        v = [bm.verts.new((xx, -0.8, 1.8)), bm.verts.new((xx, 0.8, 1.8)), bm.verts.new((xx, 0.0, 2.38))]
        bm.faces.new(v)
    bm.to_mesh(gm)
    bm.free()
    ge = link(bpy.data.objects.new('gables', gm))
    ge.data.materials.append(m)
    door_m = solid('door', tuple(v * 0.35 for v in col), rough=0.9, spec=0.05)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    dm = bpy.data.meshes.new('door')
    bm.to_mesh(dm)
    bm.free()
    door = link(bpy.data.objects.new('door', dm))
    door.scale = (0.7, 0.05, 1.3)
    door.location = (-0.35, -0.81, 0.7)
    door.data.materials.append(door_m)
    win_m, wnt, wp = mat('window')
    wp.inputs['Base Color'].default_value = (*L['glow'], 1)
    wp.inputs['Emission Color'].default_value = (*L['glow'], 1)
    wp.inputs['Emission Strength'].default_value = 3.0
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    wm = bpy.data.meshes.new('win')
    bm.to_mesh(wm)
    bm.free()
    win = link(bpy.data.objects.new('win', wm))
    win.scale = (0.45, 0.05, 0.38)
    win.location = (0.5, -0.81, 1.15)
    win.data.materials.append(win_m)
    pipe_m = solid('pipe', (0.15, 0.15, 0.16), rough=0.6, spec=0.08)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=24, radius1=0.09, radius2=0.09, depth=0.9)
    pm = bpy.data.meshes.new('pipe')
    bm.to_mesh(pm)
    bm.free()
    pipe = link(bpy.data.objects.new('pipe', pm))
    pipe.location = (0.6, 0.3, 2.55)
    pipe.data.materials.append(pipe_m)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=16, radius=1.0)
    for v in bm.verts:
        v.co.z = max(0.0, v.co.z) * 0.2
    sm = bpy.data.meshes.new('drift')
    bm.to_mesh(sm)
    bm.free()
    sm.shade_smooth()
    drift = link(bpy.data.objects.new('drift', sm))
    drift.scale = (1.35, 1.15, 1.0)
    dd = drift.modifiers.new('d', 'DISPLACE')
    dtex = bpy.data.textures.new('dcl', 'CLOUDS')
    dtex.noise_scale = 0.35
    dd.texture = dtex
    dd.strength = 0.12
    drift.location = (0.2, 0.1, 0.0)
    drift.data.materials.append(snow)
    for o in list(bpy.context.scene.objects):
        if o.type == 'MESH':
            o.parent = root
    root.rotation_euler = (0, 0, math.radians(-28 + idx * 14))
    camera(0.0, 1.35, 3.6, 300, 300, tilt=10)
    render(f'shanty{idx}-{look}')


def ice(look):
    reset()
    lights(look, elev=18, az=-30)
    L = LOOKS[look]
    period = 40.0
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=0.5)
    me = bpy.data.meshes.new('ice')
    bm.to_mesh(me)
    bm.free()
    o = link(bpy.data.objects.new('ice', me))
    o.scale = (period * 3, 60, 1)
    o.location = (period / 2, 20, 0)
    m, nt, p = mat('icem')
    pc = periodic_coords(nt, period)
    stretch = node(nt, 'ShaderNodeMapping')
    stretch.inputs['Scale'].default_value = (0.35, 0.35, 2.2)
    nt.links.new(pc.outputs[0], stretch.inputs['Vector'])
    snow_n = node(nt, 'ShaderNodeTexNoise', in_Scale=0.35, in_Detail=8.0, in_Roughness=0.62)
    nt.links.new(stretch.outputs['Vector'], snow_n.inputs['Vector'])
    sm = ramp(nt, [(0.0, (0, 0, 0)), (0.5, (0, 0, 0)), (0.64, (1, 1, 1))])
    nt.links.new(snow_n.outputs['Fac'], sm.inputs['Fac'])
    warp = node(nt, 'ShaderNodeTexNoise', in_Scale=0.5, in_Detail=6.0)
    nt.links.new(pc.outputs[0], warp.inputs['Vector'])
    wsc = node(nt, 'ShaderNodeVectorMath', operation='SCALE')
    wsc.inputs['Scale'].default_value = 1.6
    nt.links.new(warp.outputs['Color'], wsc.inputs[0])
    wadd = node(nt, 'ShaderNodeVectorMath', operation='ADD')
    nt.links.new(pc.outputs[0], wadd.inputs[0])
    nt.links.new(wsc.outputs[0], wadd.inputs[1])
    crack = node(nt, 'ShaderNodeTexVoronoi', in_Scale=0.16, feature='DISTANCE_TO_EDGE')
    nt.links.new(wadd.outputs[0], crack.inputs['Vector'])
    cr = ramp(nt, [(0.0, (0.9, 0.9, 0.9)), (0.012, (0, 0, 0))])
    nt.links.new(crack.outputs['Distance'], cr.inputs['Fac'])
    streak_map = node(nt, 'ShaderNodeMapping')
    streak_map.inputs['Scale'].default_value = (0.25, 0.25, 3.0)
    nt.links.new(pc.outputs[0], streak_map.inputs['Vector'])
    streak = node(nt, 'ShaderNodeTexNoise', in_Scale=0.8, in_Detail=8.0)
    nt.links.new(streak_map.outputs['Vector'], streak.inputs['Vector'])
    deep = node(nt, 'ShaderNodeTexNoise', in_Scale=0.25, in_Detail=4.0)
    nt.links.new(pc.outputs[0], deep.inputs['Vector'])
    dmix = node(nt, 'ShaderNodeMath', operation='MULTIPLY')
    nt.links.new(streak.outputs['Fac'], dmix.inputs[0])
    nt.links.new(deep.outputs['Fac'], dmix.inputs[1])
    icecol = ramp(nt, [(0.12, tuple(v * 0.62 for v in L['ice'])), (0.3, L['ice']), (0.5, tuple(min(1, v * 1.15) for v in L['ice']))])
    nt.links.new(dmix.outputs[0], icecol.inputs['Fac'])
    mixc = node(nt, 'ShaderNodeMix', data_type='RGBA')
    nt.links.new(cr.outputs['Color'], mixc.inputs['Factor'])
    nt.links.new(icecol.outputs['Color'], mixc.inputs['A'])
    mixc.inputs['B'].default_value = (0.95, 0.98, 1.0, 1)
    mixs = node(nt, 'ShaderNodeMix', data_type='RGBA')
    nt.links.new(sm.outputs['Color'], mixs.inputs['Factor'])
    nt.links.new(mixc.outputs['Result'], mixs.inputs['A'])
    mixs.inputs['B'].default_value = (*L['snow'], 1)
    nt.links.new(mixs.outputs['Result'], p.inputs['Base Color'])
    p.inputs['Specular IOR Level'].default_value = 0.35
    rough = node(nt, 'ShaderNodeMapRange', in_To_Min=0.3, in_To_Max=0.95)
    nt.links.new(sm.outputs['Color'], rough.inputs['Value'])
    nt.links.new(rough.outputs['Result'], p.inputs['Roughness'])
    p.inputs['Subsurface Weight'].default_value = 0.3
    fine = node(nt, 'ShaderNodeTexNoise', in_Scale=6.0, in_Detail=12.0)
    nt.links.new(pc.outputs[0], fine.inputs['Vector'])
    hsum = node(nt, 'ShaderNodeMath', operation='ADD')
    nt.links.new(fine.outputs['Fac'], hsum.inputs[0])
    nt.links.new(sm.outputs['Color'], hsum.inputs[1])
    bump = node(nt, 'ShaderNodeBump', in_Strength=0.25)
    nt.links.new(hsum.outputs[0], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], p.inputs['Normal'])
    o.data.materials.append(m)
    camera(period / 2, 0.0, period, 2000, 220, tilt=35)
    bpy.context.scene.render.film_transparent = False
    render(f'ice-{look}')


def hole(look):
    reset()
    lights(look, elev=24, az=-35)
    L = LOOKS[look]
    snow = snow_mat(look, 'rimsnow')
    snt = snow.node_tree
    geo = node(snt, 'ShaderNodeNewGeometry')
    ln = node(snt, 'ShaderNodeVectorMath', operation='LENGTH')
    snt.links.new(geo.outputs['Position'], ln.inputs[0])
    fade = node(snt, 'ShaderNodeMapRange', in_From_Min=0.8, in_From_Max=1.15, in_To_Min=1.0, in_To_Max=0.0)
    snt.links.new(ln.outputs['Value'], fade.inputs['Value'])
    snt.links.new(fade.outputs['Result'], snt.nodes['Principled BSDF'].inputs['Alpha'])
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=True, segments=96, radius=1.0)
    me = bpy.data.meshes.new('rim')
    bm.to_mesh(me)
    bm.free()
    bm = bmesh.new()
    nr, ns = 24, 96
    rings = []
    for i in range(nr + 1):
        r = 0.55 + i / nr * 0.65
        row = []
        for s in range(ns):
            a = 2 * math.pi * s / ns
            h = 0.16 * math.exp(-((r - 0.7) / 0.14) ** 2) * (1 + 0.35 * math.sin(a * 5 + 1) + 0.2 * math.sin(a * 11))
            row.append(bm.verts.new((math.cos(a) * r, math.sin(a) * r * 0.9, h)))
        rings.append(row)
    for i in range(nr):
        for s in range(ns):
            bm.faces.new((rings[i][s], rings[i][(s + 1) % ns], rings[i + 1][(s + 1) % ns], rings[i + 1][s]))
    inner = [bm.verts.new((v.co.x, v.co.y, -0.3)) for v in rings[0]]
    for s in range(ns):
        bm.faces.new((rings[0][(s + 1) % ns], rings[0][s], inner[s], inner[(s + 1) % ns]))
    rm = bpy.data.meshes.new('rim')
    bm.to_mesh(rm)
    bm.free()
    rm.shade_smooth()
    rim = link(bpy.data.objects.new('rim', rm))
    rim.data.materials.append(snow)
    wm, nt, p = mat('water')
    p.inputs['Base Color'].default_value = (*L['water'], 1)
    p.inputs['Roughness'].default_value = 0.04
    p.inputs['Specular IOR Level'].default_value = 0.6
    nz = node(nt, 'ShaderNodeTexWave', wave_type='RINGS', in_Scale=6.0, in_Distortion=1.5)
    bump = node(nt, 'ShaderNodeBump', in_Strength=0.12)
    nt.links.new(nz.outputs['Fac'], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], p.inputs['Normal'])
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=True, segments=96, radius=0.58)
    wme = bpy.data.meshes.new('water')
    bm.to_mesh(wme)
    bm.free()
    water = link(bpy.data.objects.new('water', wme))
    water.location.z = -0.06
    water.scale.y = 0.9
    water.data.materials.append(wm)
    camera(0.0, 0.0, 3.0, 420, 160, tilt=24)
    render(f'hole-{look}')


JOBS = []
for look in ('original', 'wics'):
    JOBS += [('bear-body-' + look, lambda l=look: bear(l, 'body')), ('bear-arm-' + look, lambda l=look: bear(l, 'arm'))]
    JOBS += [(f'fish-{k}-' + look, lambda l=look, k=k: fish(l, k)) for k in ('perch', 'walleye', 'pike')]
    JOBS += [(f'shanty{i}-' + look, lambda l=look, i=i: shanty(l, i)) for i in range(4)]
    JOBS += [('shore-' + look, lambda l=look: shore(l)), ('ice-' + look, lambda l=look: ice(l)), ('hole-' + look, lambda l=look: hole(l))]

for name, job in JOBS:
    if ONLY and not any(name.startswith(o) for o in ONLY):
        continue
    job()
