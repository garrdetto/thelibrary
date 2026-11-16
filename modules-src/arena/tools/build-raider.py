"""Builds Vector Arena's Rolling Siege raider: the Meshy-rigged man seated in a wheelchair built here, bat raised.

blender -b --factory-startup -P modules-src/arena/tools/build-raider.py -- <rigged.glb> <out.glb> [preview.png]

Output nodes (Blender Z-up, the rider faces -Y, which is +Z in glTF):
  Raider            root at the floor between the wheels
    Body            seated rider and the chair frame, seat, footrests and casters
    Prop_Shoulder   empty at the right shoulder joint; the module swings it
      Prop_Arm      right arm, hand and bat
    Wheel_L/R       rear wheels, origin at the axle, spin about local X
"""
import bpy
import bmesh
import math
import sys
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:]
SOURCE, OUT = argv[0], argv[1]
PREVIEW = argv[2] if len(argv) > 2 else ""

SEAT_Z = 0.50
WHEEL_R = 0.30
WHEEL_X = 0.30
WHEEL_Y = 0.10
ARM_BONES = {"RightArm", "RightForeArm", "RightHand"}

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SOURCE)
for obj in list(bpy.data.objects):
    if obj.type == "MESH" and obj.name.lower().startswith("icosphere"):
        bpy.data.objects.remove(obj, do_unlink=True)

arm_obj = next(o for o in bpy.data.objects if o.type == "ARMATURE")
body = next(o for o in bpy.data.objects if o.type == "MESH")
scene = bpy.context.scene


def world_dir(pb):
    m = arm_obj.matrix_world @ pb.matrix
    head = m.to_translation()
    tail = arm_obj.matrix_world @ (pb.matrix @ Vector((0, pb.length, 0)))
    return head, (tail - head).normalized()


def aim(name, direction):
    pb = arm_obj.pose.bones[name]
    bpy.context.view_layer.update()
    head, current = world_dir(pb)
    want = Vector(direction).normalized()
    rot = current.rotation_difference(want).to_matrix().to_4x4()
    world = arm_obj.matrix_world @ pb.matrix
    pivot = Matrix.Translation(head)
    world = pivot @ rot @ pivot.inverted() @ world
    pb.matrix = arm_obj.matrix_world.inverted() @ world
    bpy.context.view_layer.update()


def twist(name, axis, angle):
    pb = arm_obj.pose.bones[name]
    bpy.context.view_layer.update()
    head, _ = world_dir(pb)
    world = arm_obj.matrix_world @ pb.matrix
    pivot = Matrix.Translation(head)
    world = pivot @ Matrix.Rotation(angle, 4, Vector(axis)) @ pivot.inverted() @ world
    pb.matrix = arm_obj.matrix_world.inverted() @ world
    bpy.context.view_layer.update()


bpy.context.view_layer.objects.active = arm_obj
bpy.ops.object.mode_set(mode="POSE")

aim("Spine02", (0, -0.16, 1))
aim("Spine01", (0, -0.12, 1))
aim("Spine", (0, -0.05, 1))
aim("neck", (0, -0.12, 1))
aim("Head", (0, -0.25, 1))
for side, sx in (("Left", 1), ("Right", -1)):
    aim(f"{side}UpLeg", (sx * 0.12, -1, -0.06))
    aim(f"{side}Leg", (sx * 0.04, -0.18, -1))
    aim(f"{side}Foot", (0, -1, -0.45))
    aim(f"{side}ToeBase", (0, -1, -0.1))

aim("LeftShoulder", (1, 0, -0.15))
aim("LeftArm", (0.32, 0.18, -1))
aim("LeftForeArm", (0.18, -0.25, -1))
aim("LeftHand", (0.12, -0.2, -1))

aim("RightShoulder", (-1, 0, 0.1))
aim("RightArm", (-0.75, 0.25, 0.45))
aim("RightForeArm", (0.05, 0.05, 1))
aim("RightHand", (0.0, 0.25, 1))

bpy.context.view_layer.update()
hand_pb = arm_obj.pose.bones["RightHand"]
hand_head, hand_dir = world_dir(hand_pb)
shoulder_head, _ = world_dir(arm_obj.pose.bones["RightArm"])
hips = arm_obj.matrix_world @ arm_obj.pose.bones["Hips"].matrix.to_translation()
bpy.ops.object.mode_set(mode="OBJECT")

groups = {g.index: g.name for g in body.vertex_groups}
arm_vertex = []
for v in body.data.vertices:
    total = sum(g.weight for g in v.groups)
    arm = sum(g.weight for g in v.groups if groups.get(g.group) in ARM_BONES)
    arm_vertex.append(total > 0 and arm / total > 0.5)

bpy.context.view_layer.objects.active = body
body.select_set(True)
for mod in body.modifiers:
    if mod.type == "ARMATURE":
        bpy.ops.object.modifier_apply(modifier=mod.name)
body.parent = None
body.matrix_world = body.matrix_world.copy()
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.data.objects.remove(arm_obj, do_unlink=True)

mesh = body.data
bm = bmesh.new()
bm.from_mesh(mesh)
bm.verts.ensure_lookup_table()
arm_faces = [f for f in bm.faces if sum(arm_vertex[v.index] for v in f.verts) * 2 > len(f.verts)]
for f in bm.faces:
    f.select = f in arm_faces
bm.to_mesh(mesh)
bm.free()
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.separate(type="SELECTED")
bpy.ops.object.mode_set(mode="OBJECT")
arm_mesh = next(o for o in bpy.context.selected_objects if o != body)
arm_mesh.name = "Prop_Arm"
body.name = "Body"

seat_offset = Vector((0, 0, SEAT_Z + 0.06)) - Vector((0, 0, hips.z - 0.08))
seat_offset.x = -hips.x
seat_offset.y = -hips.y + 0.02
for obj in (body, arm_mesh):
    obj.location += seat_offset
    bpy.context.view_layer.objects.active = obj
    for o in bpy.context.selected_objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=True)
hand_head += seat_offset
shoulder_head += seat_offset

for img in bpy.data.images:
    if img.size[0] > 1024:
        img.scale(1024, 1024)


def material(name, color, metallic, roughness):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    return mat


FRAME = material("Frame", (0.32, 0.34, 0.37), 0.85, 0.32)
TIRE = material("Tire", (0.025, 0.025, 0.028), 0.0, 0.85)
VINYL = material("Vinyl", (0.05, 0.05, 0.06), 0.0, 0.55)
RIM = material("Rim", (0.62, 0.64, 0.67), 1.0, 0.22)
WOOD = material("Wood", (0.62, 0.43, 0.24), 0.0, 0.5)
GRIP = material("Grip", (0.08, 0.07, 0.07), 0.0, 0.8)

parts = []


def finish(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    for poly in obj.data.polygons:
        poly.use_smooth = True
    parts.append(obj)
    return obj


def cube(size, location, mat, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location, rotation=rotation)
    obj = bpy.context.active_object
    obj.scale = size
    bpy.ops.object.transform_apply(scale=True)
    return finish(obj, mat)


def tube(a, b, radius, mat, vertices=10):
    a, b = Vector(a), Vector(b)
    d = b - a
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=d.length, location=(a + b) / 2)
    obj = bpy.context.active_object
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
    bpy.ops.object.transform_apply(rotation=True)
    return finish(obj, mat)


def ring(major, minor, location, mat, segments=40):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=segments, minor_segments=8, location=location, rotation=(0, math.pi / 2, 0))
    return finish(bpy.context.active_object, mat)


def join(objs, name):
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    obj = bpy.context.active_object
    obj.name = name
    return obj


frame = []
frame.append(cube((0.46, 0.44, 0.05), (0, -0.02, SEAT_Z), VINYL))
frame.append(cube((0.44, 0.035, 0.40), (0, 0.22, SEAT_Z + 0.26), VINYL, rotation=(math.radians(-8), 0, 0)))
for sx in (1, -1):
    x = sx * 0.235
    frame.append(tube((x, 0.24, SEAT_Z - 0.06), (x, 0.27, SEAT_Z + 0.50), 0.013, FRAME))
    frame.append(tube((x, 0.27, SEAT_Z + 0.50), (x, 0.37, SEAT_Z + 0.52), 0.013, FRAME))
    frame.append(tube((x, 0.34, SEAT_Z + 0.52), (x, 0.41, SEAT_Z + 0.525), 0.019, GRIP))
    frame.append(tube((x, 0.24, SEAT_Z - 0.03), (x, -0.25, SEAT_Z - 0.03), 0.013, FRAME))
    frame.append(tube((x, -0.25, SEAT_Z - 0.03), (x * 0.8, -0.40, 0.14), 0.012, FRAME))
    frame.append(tube((x, 0.18, 0.17), (x, -0.30, 0.17), 0.012, FRAME))
    frame.append(tube((x, -0.30, 0.17), (x, -0.25, SEAT_Z - 0.03), 0.012, FRAME))
    frame.append(tube((x, 0.18, 0.17), (x, 0.24, SEAT_Z - 0.06), 0.012, FRAME))
    frame.append(cube((0.15, 0.11, 0.012), (x * 0.62, -0.44, 0.12), FRAME, rotation=(math.radians(10), 0, 0)))
    frame.append(tube((x, -0.30, 0.17), (x, -0.30, 0.10), 0.01, FRAME))
    frame.append(ring(0.065, 0.016, (x, -0.31, 0.07), TIRE, 20))
    frame.append(tube((x - 0.015, -0.31, 0.07), (x + 0.015, -0.31, 0.07), 0.025, RIM, 12))
    frame.append(tube((x, WHEEL_Y, WHEEL_R), (x * 1.18, WHEEL_Y, WHEEL_R), 0.014, FRAME))
frame.append(tube((-0.235, 0.0, SEAT_Z - 0.10), (0.235, 0.0, SEAT_Z - 0.10), 0.011, FRAME))

for p in frame:
    parts.remove(p)
chair = join(frame, "Chair")
body = join([body, chair], "Body")

wheels = []
for side, sx in (("L", 1), ("R", -1)):
    x = sx * WHEEL_X
    pieces = [
        ring(WHEEL_R - 0.022, 0.022, (x, WHEEL_Y, WHEEL_R), TIRE, 48),
        ring(WHEEL_R - 0.05, 0.009, (x, WHEEL_Y, WHEEL_R), RIM, 48),
        ring(WHEEL_R - 0.06, 0.007, (x + sx * 0.035, WHEEL_Y, WHEEL_R), RIM, 48),
        tube((x - 0.03, WHEEL_Y, WHEEL_R), (x + 0.03, WHEEL_Y, WHEEL_R), 0.035, FRAME, 16),
    ]
    for k in range(6):
        angle = k * math.pi / 3
        pieces.append(tube(
            (x + sx * 0.035, WHEEL_Y, WHEEL_R),
            (x + sx * 0.035, WHEEL_Y + math.cos(angle) * 0.06, WHEEL_R + math.sin(angle) * 0.06), 0.011, FRAME, 6))
    for k in range(12):
        angle = k * math.pi / 6
        reach = WHEEL_R - 0.05
        pieces.append(tube((x, WHEEL_Y, WHEEL_R), (x, WHEEL_Y + math.cos(angle) * reach, WHEEL_R + math.sin(angle) * reach), 0.0028, RIM, 4))
    for p in pieces:
        parts.remove(p)
    wheel = join(pieces, f"Wheel_{side}")
    bpy.context.scene.cursor.location = (x, WHEEL_Y, WHEEL_R)
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    wheels.append(wheel)

grip_dir = Vector((0.0, 0.42, 1.0)).normalized()
bat_base = hand_head + hand_dir * 0.07 - grip_dir * 0.12
bat_tip = bat_base + grip_dir * 0.86
bpy.ops.mesh.primitive_cone_add(vertices=14, radius1=0.016, radius2=0.034, depth=0.62, location=bat_base + grip_dir * (0.24 + 0.31))
barrel = bpy.context.active_object
barrel.rotation_mode = "QUATERNION"
barrel.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(grip_dir)
bpy.ops.object.transform_apply(rotation=True)
finish(barrel, WOOD)
handle = tube(bat_base, bat_base + grip_dir * 0.25, 0.0155, GRIP, 12)
knob = tube(bat_base - grip_dir * 0.012, bat_base + grip_dir * 0.006, 0.024, WOOD, 12)
cap = tube(bat_tip - grip_dir * 0.01, bat_tip, 0.033, WOOD, 14)
for p in (barrel, handle, knob, cap):
    parts.remove(p)
arm = join([arm_mesh, barrel, handle, knob, cap], "Prop_Arm")

root = bpy.data.objects.new("Raider", None)
scene.collection.objects.link(root)
shoulder = bpy.data.objects.new("Prop_Shoulder", None)
scene.collection.objects.link(shoulder)
shoulder.location = shoulder_head
shoulder.parent = root
for obj in (body, *wheels):
    obj.parent = root
for o in bpy.context.selected_objects:
    o.select_set(False)
arm.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.context.scene.cursor.location = shoulder_head
bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
arm.parent = shoulder
arm.location = (0, 0, 0)
bpy.context.view_layer.update()

print("RAIDER", "tris", sum(len(o.data.polygons) for o in (body, arm, *wheels)), "shoulder", tuple(round(v, 3) for v in shoulder_head), "hand", tuple(round(v, 3) for v in hand_head))

if PREVIEW:
    cam_data = bpy.data.cameras.new("cam")
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    cam.location = (-1.9, -2.4, 1.35)
    direction = Vector((0, 0, 0.75)) - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.rotation_euler = (0.8, 0.2, -0.6)
    sun.data.energy = 3
    scene.collection.objects.link(sun)
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.6, 0.65, 0.72, 1)
    scene.world = world
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.color_type = "TEXTURE"
    scene.display.shading.light = "STUDIO"
    scene.render.resolution_x = 640
    scene.render.resolution_y = 640
    shots = [((-1.9, -2.4, 1.35), ""), ((2.6, -0.4, 0.9), "-side")]
    for location, suffix in shots:
        cam.location = location
        cam.rotation_euler = (Vector((0, 0, 0.75)) - cam.location).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = PREVIEW.replace(".png", f"{suffix}.png")
        bpy.ops.render.render(write_still=True)

for o in bpy.context.selected_objects:
    o.select_set(False)
for o in (root, shoulder, body, arm, *wheels):
    o.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=True, export_yup=True, export_apply=True, export_animations=False, export_skins=False, export_image_format="AUTO")
print("RAIDER exported", OUT)
