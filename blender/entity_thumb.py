"""
Renders the "Entity Graph" card thumbnail: three glassy, softly glowing cubes on a teal stage.

    python blender/entity_thumb.py --out /tmp/entity.png [--res 432 440] [--samples 160]

The web build uses a 2x WebP made from this render (public/media/entity-graph.webp).
"""

import argparse
import math
import sys

import bpy
from mathutils import Vector


def parse_args():
    argv = sys.argv
    argv = argv[argv.index("--") + 1 :] if "--" in argv else argv[1:]
    p = argparse.ArgumentParser()
    p.add_argument("--out", required=True)
    p.add_argument("--res", nargs=2, type=int, default=[432, 440])
    p.add_argument("--samples", type=int, default=160)
    return p.parse_args(argv)


def principled(name, base, emission, emit_strength, transmission=0.0, roughness=0.12, coat=0.8):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    b = mat.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*base, 1)
    b.inputs["Roughness"].default_value = roughness
    b.inputs["Transmission Weight"].default_value = transmission
    b.inputs["IOR"].default_value = 1.45
    b.inputs["Coat Weight"].default_value = coat
    b.inputs["Coat Roughness"].default_value = 0.03
    b.inputs["Emission Color"].default_value = (*emission, 1)
    b.inputs["Emission Strength"].default_value = emit_strength
    return mat


def cube(name, loc, size, mat, rot_z=0.0):
    bpy.ops.mesh.primitive_cube_add(size=size, location=loc)
    obj = bpy.context.active_object
    obj.name = name
    obj.rotation_euler = (0, 0, rot_z)
    bev = obj.modifiers.new("bevel", "BEVEL")
    bev.width = size * 0.09
    bev.segments = 4
    obj.data.materials.append(mat)
    bpy.ops.object.shade_smooth()
    return obj


def area(name, loc, target, color, power, size):
    data = bpy.data.lights.new(name, "AREA")
    data.color = color
    data.energy = power
    data.size = size
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = loc
    obj.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()


def main():
    args = parse_args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene

    # stage: teal floor with a light pool under the cubes
    floor_mat = principled("floor", (0.012, 0.07, 0.07), (0, 0, 0), 0, roughness=0.85, coat=0.0)
    bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, 0))
    bpy.context.active_object.data.materials.append(floor_mat)

    s = 1.0
    green = principled("green", (0.03, 0.62, 0.12), (0.05, 1.0, 0.2), 0.32, transmission=0.15, roughness=0.16)
    lime = principled("lime", (0.36, 0.72, 0.05), (0.5, 1.0, 0.05), 0.26, transmission=0.15, roughness=0.16)
    teal = principled("teal", (0.03, 0.56, 0.44), (0.05, 1.0, 0.75), 0.26, transmission=0.15, roughness=0.16)
    # axis-aligned cubes seen along the diagonal: a vertex faces the camera (isometric look)
    g = 0.56
    cube("left", (-g, g, s / 2), s, lime)
    cube("right", (g, -g, s / 2), s, teal)
    cube("back", (g, g, s / 2), s, green)
    cube("top", (0.0, 0.0, s * 1.5), s, green)

    # camera: three-quarter view from above, like an isometric product shot
    cam_data = bpy.data.cameras.new("cam")
    cam_data.lens = 85
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    target = Vector((0, 0, 0.75))
    cam.location = target + Vector((-11.5, -11.5, 14.5))
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam

    area("key", (-2.5, -3.5, 6.5), (0, 0, 0.7), (0.9, 1.0, 0.92), 260, 1.2)
    area("pool", (0.5, 0.5, 6), (0, 0, 0), (0.25, 0.9, 0.85), 110, 5)
    area("rim", (4, 5, 3), (0, 0, 0.8), (0.3, 1.0, 0.75), 140, 2)

    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.002, 0.018, 0.02, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.0
    scene.world = world

    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = args.samples
    scene.cycles.use_denoising = True
    scene.cycles.transmission_bounces = 6
    scene.cycles.max_bounces = 8
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "Medium High Contrast"
    scene.render.resolution_x, scene.render.resolution_y = args.res
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = args.out
    bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    main()
