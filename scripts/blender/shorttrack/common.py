"""Shared steps for the Short Track Showdown Blender scripts (truck.py, pace_car.py, props.py)."""

import argparse
import os
import sys

import bpy
import bmesh


def args(doc, defaults):
    """Parses the script's arguments after `--` (blender -b -P script -- ...) or from the command line (bpy module)."""
    inside = os.path.basename(sys.argv[0]).lower().startswith("blender")
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else ([] if inside else sys.argv[1:])
    parser = argparse.ArgumentParser(description=doc.splitlines()[0])
    for name, value in defaults.items():
        if isinstance(value, bool):
            parser.add_argument(f"--{name}", action="store_true")
        else:
            parser.add_argument(f"--{name}", default=value)
    return parser.parse_args(argv)


def triangle_count(obj):
    work = bmesh.new()
    work.from_mesh(obj.data)
    count = sum(len(face.verts) - 2 for face in work.faces)
    work.free()
    return count


def select_only(objects, active):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = active


def material(name, color, roughness, metallic, coat=0.0, emission=None, strength=0.0, alpha=1.0):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if coat:
        bsdf.inputs["Coat Weight"].default_value = coat
        bsdf.inputs["Coat Roughness"].default_value = 0.05
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = strength
    if alpha < 1.0:
        bsdf.inputs["Alpha"].default_value = alpha
        mat.surface_render_method = "BLENDED"
    mat.diffuse_color = (*color, 1.0)
    return mat


def bake_ao(objects, distance=0.25, floor=0.55):
    """Cycles AO into the `ao` colour attribute, within `distance` metres, lifted to floor..1."""
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 48
    scene.cycles.device = "CPU"
    scene.world = scene.world or bpy.data.worlds.new("World")
    scene.world.light_settings.distance = distance
    for obj in objects:
        data = obj.data
        attr = data.color_attributes.get("ao") or data.color_attributes.new(name="ao", type="BYTE_COLOR", domain="CORNER")
        data.color_attributes.active_color = attr
        select_only([obj], obj)
        bpy.ops.object.bake(type="AO", target="VERTEX_COLORS")
        values = [0.0] * (len(attr.data) * 4)
        attr.data.foreach_get("color", values)
        for i in range(0, len(values), 4):
            v = floor + (1 - floor) * values[i]
            values[i:i + 3] = (v, v, v)
        attr.data.foreach_set("color", values)


def try_bake(objects, **options):
    try:
        bake_ao(objects, **options)
    except RuntimeError as error:
        print(f"[shorttrack] AO bake skipped: {error}")


def decimate(obj, budget):
    """Collapse decimation to the budget, keeping material borders and UV seams while it can."""
    count = triangle_count(obj)
    delimit = {"MATERIAL", "SEAM", "UV"}
    for _ in range(6):
        if count <= budget:
            break
        select_only([obj], obj)
        mod = obj.modifiers.new("lod", "DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.ratio = budget / count * 0.98
        mod.use_collapse_triangulate = True
        mod.delimit = delimit
        bpy.ops.object.modifier_apply(modifier=mod.name)
        after = triangle_count(obj)
        if after > count * 0.97:
            delimit = {"MATERIAL"}
        count = after
    return count


def export(path, selected=False):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=selected,
        export_yup=True,
        export_apply=True,
        export_extras=True,
        export_attributes=True,
        export_vertex_color="ACTIVE",
        export_active_vertex_color_when_no_material=False,
        export_all_vertex_colors=True,
        export_normals=True,
        export_texcoords=True,
        export_draco_mesh_compression_enable=False,
    )

