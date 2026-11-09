MESHY_DIR = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../../assets-src/rackreel/meshy'))
FISH_LENGTH = 1.12
FISH_SNOUT = 0.5
FISH_TEXTURE_SIZE = 1024


def meshy_source(name):
    path = os.path.join(MESHY_DIR, name + '.glb')
    return path if os.path.exists(path) else None


def import_meshy(path):
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.import_scene.gltf(filepath=path)
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    bm = bmesh.new()
    image = None
    for o in meshes:
        tmp = bmesh.new()
        tmp.from_mesh(o.data)
        tmp.transform(o.matrix_world)
        me = bpy.data.meshes.new('tmp')
        tmp.to_mesh(me)
        tmp.free()
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
        for mat in o.data.materials:
            if mat and mat.node_tree and image is None:
                for node in mat.node_tree.nodes:
                    if node.type == 'BSDF_PRINCIPLED' and node.inputs['Base Color'].links:
                        src = node.inputs['Base Color'].links[0].from_node
                        if src.type == 'TEX_IMAGE' and src.image:
                            image = src.image
                if image is None:
                    for node in mat.node_tree.nodes:
                        if node.type == 'TEX_IMAGE' and node.image:
                            image = node.image
                            break
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-6)
    return bm, image


def save_texture(image, name):
    out = os.path.join(OUT, name + '.webp')
    copy = image.copy()
    copy.scale(FISH_TEXTURE_SIZE, FISH_TEXTURE_SIZE)
    scene = bpy.context.scene
    settings = scene.render.image_settings
    saved = (settings.file_format, settings.quality, settings.color_mode)
    settings.file_format = 'WEBP'
    settings.quality = 88
    settings.color_mode = 'RGB'
    copy.save_render(out, scene=scene)
    settings.file_format, settings.quality, settings.color_mode = saved
    bpy.data.images.remove(copy)
    return out


def fish_frame(bm):
    ys = [v.co.y for v in bm.verts]
    lo, hi = min(ys), max(ys)
    length = hi - lo

    def end_width(at):
        xs = [v.co.x for v in bm.verts if abs(v.co.y - at) < length * 0.12]
        return max(xs) - min(xs) if xs else 0.0
    head_neg = end_width(lo + length * 0.12) > end_width(hi - length * 0.12)
    if head_neg:
        bmesh.ops.rotate(bm, verts=bm.verts[:], cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi, 3, 'Z'))
    s = FISH_LENGTH / length
    bmesh.ops.scale(bm, vec=(s, s, s), verts=bm.verts[:])
    ys = [v.co.y for v in bm.verts]
    xs = [v.co.x for v in bm.verts]
    y0, y1 = min(ys), max(ys)
    mid = [v.co.z for v in bm.verts if y0 + 0.4 * (y1 - y0) < v.co.y < y0 + 0.75 * (y1 - y0)]
    mid.sort()
    zc = (mid[int(len(mid) * 0.1)] + mid[int(len(mid) * 0.9)]) / 2
    bmesh.ops.translate(bm, vec=(-(min(xs) + max(xs)) / 2, FISH_SNOUT - y1, -zc), verts=bm.verts[:])
    return FISH_SNOUT - FISH_LENGTH, FISH_SNOUT


def body_slab(bm, y):
    slab = []
    for e in bm.edges:
        a, b = e.verts[0].co, e.verts[1].co
        if (a.y - y) * (b.y - y) < 0:
            slab.append(a.lerp(b, (y - a.y) / (b.y - a.y)))
    if len(slab) < 6:
        return None
    w = max(abs(c.x) for c in slab)
    core = [c.z for c in slab if abs(c.x) > w * 0.35]
    return (min(core), max(core)) if len(core) >= 4 else None


def peduncle(bm, y0, y1):
    best_y, best_h = None, 1e9
    steps = 48
    for i in range(steps + 1):
        y = y0 + (y1 - y0) * (0.08 + 0.3 * i / steps)
        s = body_slab(bm, y)
        if not s:
            continue
        h = s[1] - s[0]
        if h < best_h:
            best_h, best_y = h, y
    s = body_slab(bm, best_y)
    return best_y, (s[0] + s[1]) / 2


def split_tail(bm, ycut):
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-5, plane_co=(0, ycut, 0), plane_no=(0, 1, 0))
    bm.normal_update()
    layer = bm.verts.layers.float_vector.new('n0')
    for v in bm.verts:
        v[layer] = v.normal
    tail_set = set(f for f in bm.faces if f.calc_center_median().y < ycut)
    parts = {}
    for name, keep in (('body', False), ('tail', True)):
        tmp = bm.copy()
        kill = [f for f, src in zip(tmp.faces, bm.faces) if (src in tail_set) != keep]
        bmesh.ops.delete(tmp, geom=kill, context='FACES')
        loose = [v for v in tmp.verts if not v.link_faces]
        bmesh.ops.delete(tmp, geom=loose, context='VERTS')
        cap(tmp)
        parts[name] = tmp
    return parts


def cap(bm):
    uv = bm.loops.layers.uv.active
    edges = [e for e in bm.edges if e.is_boundary]
    if not edges:
        return
    made = bmesh.ops.holes_fill(bm, edges=edges, sides=0)
    if uv is None:
        return
    for f in made['faces']:
        for loop in f.loops:
            for other in loop.vert.link_loops:
                if other.face is not f:
                    loop[uv].uv = other[uv].uv
                    break


def piece_from_textured(bm):
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.normal_update()
    uv = bm.loops.layers.uv.active
    n0 = bm.verts.layers.float_vector.get('n0')
    p = Piece()
    p.uv = []
    index = {}
    for f in bm.faces:
        tri = []
        for loop in f.loops:
            u, v = (loop[uv].uv if uv else (0.0, 0.0))
            key = (loop.vert.index, round(u, 5), round(v, 5))
            if key not in index:
                index[key] = len(p.pos)
                p.pos.append(tuple(loop.vert.co))
                p.nor.append(tuple(loop.vert[n0] if n0 else loop.vert.normal))
                p.col.append((1.0, 1.0, 1.0))
                p.uv.append((u, v))
            tri.append(index[key])
        p.tris.append(tuple(tri))
    return p


_procedural_fish = build_fish


def build_fish(kind, spec):
    name = 'fish-' + kind
    src = meshy_source(name)
    if not src:
        return _procedural_fish(kind, spec)
    bm, image = import_meshy(src)
    y0, y1 = fish_frame(bm)
    ycut, zcut = peduncle(bm, y0, y1)
    parts = split_tail(bm, ycut)
    bm.free()
    tag = 'tex:' + name
    if image is not None:
        save_texture(image, name)
    m = Model(name, ground=False, ao_dist=0.05, ao_strength=0.25)
    m.add('body', piece_from_textured(parts['body']), material=tag)
    m.add('tail', piece_from_textured(parts['tail']), pivot=(0, ycut, zcut), material=tag)
    for b in parts.values():
        b.free()
    write_model(m)
    print(name, 'tail cut at', round(ycut, 3))
