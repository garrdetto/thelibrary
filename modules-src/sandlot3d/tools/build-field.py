"""Sandlot Sluggers 3D field detail textures, baked in Blender.

Run inside Blender (`blender -b -P modules-src/sandlot3d/tools/build-field.py`, or exec it from the Scripting tab).
Writes assets-src/models/sandlot3d/field_detail.glb: two small planes, `grass` and `dirt`, whose materials carry
seamless tiling detail maps (base color detail, normal, roughness). The game samples them in world space under the
painted field canvas; `pnpm assets` turns the PNGs into WebP.

Patterns are Cycles shader nodes evaluated on a torus in 4D (u and v each wrap a circle), so every map tiles with no
seam. Height and albedo are baked as emission; normals and roughness come from the height with wrapping differences.
"""
import math
import os

import bpy
import numpy as np

REPO = os.environ.get("SANDLOT_REPO") or os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
OUT = os.path.join(REPO, "assets-src", "models", "sandlot3d", "field_detail.glb")
SIZE = 512
TAU = 2 * math.pi


def scene():
    scn = bpy.data.scenes.get("SandlotField") or bpy.data.scenes.new("SandlotField")
    for o in list(scn.collection.all_objects):
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.context.window.scene = scn
    scn.render.engine = "CYCLES"
    scn.cycles.samples = 4
    scn.cycles.device = "CPU"
    scn.render.bake.margin = 0
    return scn


class Graph:
    def __init__(self, mat):
        self.nt = mat.node_tree
        self.nt.nodes.clear()
        self.x = 0

    def node(self, kind, **inputs):
        n = self.nt.nodes.new(kind)
        n.location = (self.x, 0)
        self.x += 200
        for k, v in inputs.items():
            if k.startswith("_"):
                setattr(n, k[1:], v)
            elif hasattr(v, "bl_idname") or isinstance(v, bpy.types.NodeSocket):
                self.nt.links.new(v, n.inputs[k])
            else:
                n.inputs[k].default_value = v
        return n

    def math(self, op, a, b=None):
        n = self.node("ShaderNodeMath", _operation=op)
        for i, v in enumerate((a, b)):
            if v is None:
                continue
            if isinstance(v, bpy.types.NodeSocket):
                self.nt.links.new(v, n.inputs[i])
            else:
                n.inputs[i].default_value = v
        return n.outputs[0]

    def torus(self, radius):
        """(x, y, z, w) on a 4D torus from the UVs: seamless input for 4D noise and Voronoi."""
        uv = self.node("ShaderNodeTexCoord").outputs["UV"]
        sep = self.node("ShaderNodeSeparateXYZ", Vector=uv)
        u = self.math("MULTIPLY", sep.outputs[0], TAU)
        v = self.math("MULTIPLY", sep.outputs[1], TAU)
        cu, su = self.math("MULTIPLY", self.math("COSINE", u), radius), self.math("MULTIPLY", self.math("SINE", u), radius)
        cv, sv = self.math("MULTIPLY", self.math("COSINE", v), radius), self.math("MULTIPLY", self.math("SINE", v), radius)
        vec = self.node("ShaderNodeCombineXYZ", X=cu, Y=su, Z=cv).outputs[0]
        return vec, sv

    def noise(self, vec, w, scale, detail=4, rough=.55):
        n = self.node("ShaderNodeTexNoise", _noise_dimensions="4D", Vector=vec, W=w, Scale=scale, Detail=detail, Roughness=rough)
        return n.outputs["Fac"]

    def voronoi(self, vec, w, scale, feature="F1", out="Distance"):
        n = self.node("ShaderNodeTexVoronoi", _voronoi_dimensions="4D", _feature=feature, Vector=vec, W=w, Scale=scale)
        return n.outputs[out]

    def emit(self, value):
        em = self.node("ShaderNodeEmission", Color=(1, 1, 1, 1), Strength=1)
        self.nt.links.new(value, em.inputs["Color"])
        out = self.node("ShaderNodeOutputMaterial")
        self.nt.links.new(em.outputs[0], out.inputs["Surface"])


def grass_channels(g):
    """Mown turf seen from above: fine blade speckle, clumps, and slow patches of lighter and darker grass."""
    vec, w = g.torus(1.0)
    blades = g.noise(vec, w, 90, 2, .7)
    clumps = g.voronoi(vec, w, 28)
    tufts = g.math("SUBTRACT", 1, g.math("POWER", clumps, .6))
    patch = g.noise(vec, w, 3.2, 3, .5)
    height = g.math("ADD", g.math("MULTIPLY", blades, .65), g.math("MULTIPLY", tufts, .35))
    albedo = g.math("ADD", g.math("MULTIPLY", patch, .55), g.math("MULTIPLY", blades, .45))
    return height, albedo


def dirt_channels(g):
    """Infield clay: fine grit, scattered pebbles and soft raked ridges."""
    vec, w = g.torus(1.0)
    grit = g.noise(vec, w, 160, 2, .8)
    cells = g.voronoi(vec, w, 22)
    pebble = g.math("SUBTRACT", 1, g.math("MINIMUM", g.math("MULTIPLY", cells, 3.2), 1))
    pick = g.voronoi(vec, w, 22, "F1", "Color")
    keep = g.math("GREATER_THAN", g.node("ShaderNodeSeparateColor", Color=pick).outputs[0], .55)
    pebble = g.math("MULTIPLY", pebble, keep)
    ridges = g.noise(vec, w, 5, 2, .4)
    height = g.math("ADD", g.math("ADD", g.math("MULTIPLY", grit, .45), g.math("MULTIPLY", pebble, .6)), g.math("MULTIPLY", ridges, .2))
    albedo = g.math("ADD", g.math("MULTIPLY", g.noise(vec, w, 7, 3, .5), .6), g.math("MULTIPLY", pebble, .4))
    return height, albedo


def bake(obj, mat, build, which):
    g = Graph(mat)
    height, albedo = build(g)
    g.emit(height if which == "height" else albedo)
    img = bpy.data.images.get("bake_" + which) or bpy.data.images.new("bake_" + which, SIZE, SIZE, float_buffer=True)
    if img.size[0] != SIZE:
        img.scale(SIZE, SIZE)
    tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
    tex.image = img
    mat.node_tree.nodes.active = tex
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.bake(type="EMIT", margin=0)
    px = np.array(img.pixels[:], dtype=np.float32).reshape(SIZE, SIZE, 4)[:, :, 0]
    return px


def normalize(a):
    lo, hi = np.percentile(a, 1), np.percentile(a, 99)
    return np.clip((a - lo) / max(hi - lo, 1e-6), 0, 1)


def normal_map(h, strength):
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * strength
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * strength
    n = np.stack([-dx, -dy, np.ones_like(h)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * .5 + .5


def image(name, rgb, non_color):
    img = bpy.data.images.get(name) or bpy.data.images.new(name, SIZE, SIZE)
    if img.size[0] != SIZE:
        img.scale(SIZE, SIZE)
    img.colorspace_settings.name = "Non-Color" if non_color else "sRGB"
    rgba = np.ones((SIZE, SIZE, 4), dtype=np.float32)
    rgba[:, :, :3] = rgb if rgb.ndim == 3 else rgb[:, :, None]
    img.pixels.foreach_set(rgba.ravel())
    img.update()
    img.file_format = "PNG"
    img.pack()
    return img


def surface(name, build, strength, rough_lo, rough_hi):
    me = bpy.data.meshes.new(name)
    me.from_pydata([(-.5, -.5, 0), (.5, -.5, 0), (.5, .5, 0), (-.5, .5, 0)], [], [(0, 1, 2, 3)])
    uv = me.uv_layers.new(name="UVMap")
    for li, c in enumerate([(0, 0), (1, 0), (1, 1), (0, 1)]):
        uv.data[li].uv = c
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    bakemat = bpy.data.materials.get("bake_" + name) or bpy.data.materials.new("bake_" + name)
    bakemat.use_nodes = True
    me.materials.append(bakemat)
    h = normalize(bake(obj, bakemat, build, "height"))
    a = normalize(bake(obj, bakemat, build, "albedo"))

    detail = image(name + "_detail", .55 + .45 * a, False)
    nrm = image(name + "_normal", normal_map(h, strength), True)
    rough = image(name + "_roughness", rough_lo + (rough_hi - rough_lo) * (1 - h), True)

    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(bsdf.outputs[0], out.inputs["Surface"])
    t_col, t_nrm, t_rgh = (nt.nodes.new("ShaderNodeTexImage") for _ in range(3))
    t_col.image, t_nrm.image, t_rgh.image = detail, nrm, rough
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(t_col.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(t_nrm.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    nt.links.new(t_rgh.outputs["Color"], bsdf.inputs["Roughness"])
    bsdf.inputs["Metallic"].default_value = 0
    me.materials.clear()
    me.materials.append(mat)
    return obj


def build():
    scene()
    objs = [surface("grass", grass_channels, 6.0, .72, .95), surface("dirt", dirt_channels, 9.0, .82, 1.0)]
    objs[1].location.x = 1.5
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=OUT, use_selection=True, use_active_scene=True, export_format="GLB",
                              export_image_format="AUTO", export_materials="EXPORT", export_texcoords=True)
    print("field detail", OUT)


build()
