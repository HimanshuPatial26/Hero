"""
Builds and renders the photoreal DNA background loop for the hero with Blender (Cycles).

Usage (Blender as a Python module, `pip install bpy`):

    python blender/dna_scene.py --out /path/to/frames --res 1600 1000 --samples 96
    python blender/dna_scene.py --out /path/to/frames --frames 0 0      # single test frame
    python blender/dna_scene.py --save-blend /path/to/dna.blend          # just write the .blend

or from the Blender CLI:

    blender -b -P blender/dna_scene.py -- --out /path/to/frames

The helix is built so that it is exactly symmetric under a 180° rotation about its axis
(strand B and the second half of every rung are a rotated copy of strand A / the first half).
The camera stays fixed while the helix spins 180° over LOOP_FRAMES, so the rendered sequence
loops seamlessly.

Coordinates: the web build (three.js) uses Y-up; here everything is authored in the same
"three space" and converted to Blender's Z-up with THREE_TO_BLENDER.
"""

import argparse
import math
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector

# ----------------------------------------------------------------------------- config

FPS = 24
LOOP_SECONDS = 8
LOOP_FRAMES = FPS * LOOP_SECONDS  # 180° of rotation

RADIUS = 1.95
PITCH = 8.4
LENGTH = 34.0
TUBE = 0.3
RUNGS_PER_TURN = 10
STRAND_POINTS = 60000  # per strand (strand B is a rotated copy)

FOV_Y = 30.0  # degrees, matches the web camera
FOCUS = 24.0
# DNA placement in three space (camera at origin looking down -Z)
DNA_POS = (2.85, -0.75, -FOCUS)
DNA_TILT_X = -0.42
DNA_TILT_Z = -0.56
# The helix is authored in web units (radius ~2, 24 units from camera). Blender's depth of
# field is physical, so the world is scaled down to get a macro-lens amount of bokeh.
WORLD_SCALE = 0.1
HELIX_SCALE = 1.35  # helix size relative to the web units above
F_STOP = 0.27

THREE_TO_BLENDER = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))


def parse_args():
    argv = sys.argv
    argv = argv[argv.index("--") + 1 :] if "--" in argv else argv[1:]
    p = argparse.ArgumentParser()
    p.add_argument("--out", default="")
    p.add_argument("--res", nargs=2, type=int, default=[1600, 1000])
    p.add_argument("--samples", type=int, default=96)
    p.add_argument("--frames", nargs=2, type=int, default=[0, LOOP_FRAMES - 1])
    p.add_argument("--step", type=int, default=1)
    p.add_argument("--threads", type=int, default=0)
    p.add_argument("--save-blend", default="")
    return p.parse_args(argv)


# --------------------------------------------------------------------------- geometry


def helix_frame(y, phase):
    k = 2 * math.pi / PITCH
    a = y * k + phase
    p = np.array([RADIUS * math.cos(a), y, RADIUS * math.sin(a)])
    t = np.array([-RADIUS * k * math.sin(a), 1.0, RADIUS * k * math.cos(a)])
    t /= np.linalg.norm(t)
    n = np.array([math.cos(a), 0.0, math.sin(a)])
    b = np.cross(t, n)
    b /= np.linalg.norm(b)
    return p, n, b


def build_half(rng):
    """Strand A plus the A-side half of every rung. Returns dict of arrays (three space)."""
    pos, rad, col, emit, kind = [], [], [], [], []
    half = LENGTH / 2

    deep = np.array([0.008, 0.05, 0.02])
    mid = np.array([0.03, 0.2, 0.07])
    cream = np.array([0.98, 0.88, 0.66])
    gold = np.array([0.95, 0.68, 0.36])
    neon = np.array([0.04, 1.0, 0.12])
    mint = np.array([0.12, 1.0, 0.25])

    # --- backbone: sparkly glossy grains filling a tube around the helix curve
    for _ in range(STRAND_POINTS):
        y = -half + rng.random() * LENGTH
        p, n, b = helix_frame(y, 0.0)
        phi = rng.random() * 2 * math.pi
        dust = rng.random() < 0.06
        r = TUBE * (1.05 + rng.random() * 0.6) if dust else TUBE * (0.6 + 0.4 * math.sqrt(rng.random()))
        d = n * math.cos(phi) + b * math.sin(phi)
        pos.append(p + d * r)
        s = rng.random() ** 3
        rad.append((0.009 if dust else 0.012) + s * 0.02)
        u = rng.random()
        if u < 0.55:
            c = deep + (mid - deep) * rng.random()  # dark green glassy grains
            e = 0.0
        elif u < 0.86:
            c = cream + (gold - cream) * rng.random() * 0.6  # warm metallic grains
            e = 0.0
        else:
            c = mid + (mint - mid) * (0.3 + 0.7 * rng.random())  # faintly glowing green grains
            e = 0.3 + rng.random() ** 2 * 1.6
        col.append(c)
        emit.append(e)
        kind.append(0)

    # glowing studs on the backbone surface
    for _ in range(int(LENGTH * 6)):
        y = -half + rng.random() * LENGTH
        p, n, b = helix_frame(y, 0.0)
        phi = rng.random() * 2 * math.pi
        d = n * math.cos(phi) + b * math.sin(phi)
        pos.append(p + d * TUBE * (0.9 + rng.random() * 0.2))
        rad.append(0.02 + rng.random() ** 2 * 0.04)
        col.append(neon)
        emit.append(1.8 + rng.random() * 3)
        kind.append(2)

    # --- rungs: A-side half only (centre is at the helix axis)
    step = PITCH / RUNGS_PER_TURN
    count = int(LENGTH / step)
    for j in range(count + 1):
        y = -half + j * step
        a, _, _ = helix_frame(y, 0.0)
        centre = np.array([0.0, y, 0.0])
        axis = centre - a
        L = np.linalg.norm(axis)
        axis /= L
        side = np.cross(np.array([0.0, 1.0, 0.0]), axis)
        side /= np.linalg.norm(side)
        up = np.cross(axis, side)
        t0 = TUBE * 0.7 / L
        for _ in range(110):
            t = t0 + rng.random() * (1 - t0)
            phi = rng.random() * 2 * math.pi
            rr = 0.04 * math.sqrt(rng.random())
            pos.append(a + axis * t * L + side * math.cos(phi) * rr + up * math.sin(phi) * rr)
            rad.append(0.01 + rng.random() ** 3 * 0.016)
            if rng.random() < 0.5:
                col.append(mid + (mint - mid) * rng.random())
                emit.append(0.5 + rng.random() * 1.2)
            else:
                col.append(cream * (0.8 + 0.2 * rng.random()))
                emit.append(0.15 + rng.random() * 0.5)
            kind.append(1)
        # glowing beads, biased toward the strand end
        for _ in range(2 + int(rng.random() * 3)):
            t = rng.random()
            t = t * 0.45 if rng.random() < 0.6 else t
            t = t0 + t * (1 - t0) * 0.98
            pos.append(a + axis * t * L + side * (rng.random() - 0.5) * 0.05 + up * (rng.random() - 0.5) * 0.05)
            rad.append(0.03 + rng.random() ** 1.6 * 0.065)
            col.append(neon)
            emit.append(2.2 + rng.random() * 3.5)
            kind.append(2)

    return {
        "pos": np.array(pos, dtype=np.float32),
        "rad": np.array(rad, dtype=np.float32),
        "col": np.array(col, dtype=np.float32),
        "emit": np.array(emit, dtype=np.float32),
        "kind": np.array(kind, dtype=np.float32),
    }


def symmetric(g):
    """Union of the half and its 180° rotation about the helix axis (three-space Y)."""
    rot = g["pos"].copy()
    rot[:, 0] *= -1
    rot[:, 2] *= -1
    out = {k: np.concatenate([v, v]) for k, v in g.items()}
    out["pos"] = np.concatenate([g["pos"], rot])
    return out


# ----------------------------------------------------------------------------- scene


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def make_point_object(name, g, material):
    # three local space -> blender local space
    p = g["pos"] @ np.array(THREE_TO_BLENDER).T
    mesh = bpy.data.meshes.new(name)
    mesh.vertices.add(len(p))
    mesh.vertices.foreach_set("co", p.astype(np.float32).ravel())

    def attr(n, typ, data, dom="POINT"):
        a = mesh.attributes.new(n, typ, dom)
        a.data.foreach_set("value" if typ == "FLOAT" else "vector", data.ravel())

    attr("p_radius", "FLOAT", g["rad"])
    attr("p_emit", "FLOAT", g["emit"])
    attr("p_kind", "FLOAT", g["kind"])
    attr("p_col", "FLOAT_VECTOR", g["col"])
    mesh.update()

    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)

    # Geometry nodes: vertices -> point cloud (rendered as true spheres by Cycles)
    ng = bpy.data.node_groups.new(name + "_points", "GeometryNodeTree")
    ng.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    ng.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    n_in = ng.nodes.new("NodeGroupInput")
    n_out = ng.nodes.new("NodeGroupOutput")
    m2p = ng.nodes.new("GeometryNodeMeshToPoints")
    rad = ng.nodes.new("GeometryNodeInputNamedAttribute")
    rad.data_type = "FLOAT"
    rad.inputs["Name"].default_value = "p_radius"
    setmat = ng.nodes.new("GeometryNodeSetMaterial")
    setmat.inputs["Material"].default_value = material
    ng.links.new(n_in.outputs[0], m2p.inputs["Mesh"])
    ng.links.new(rad.outputs["Attribute"], m2p.inputs["Radius"])
    ng.links.new(m2p.outputs["Points"], setmat.inputs["Geometry"])
    ng.links.new(setmat.outputs["Geometry"], n_out.inputs[0])
    mod = obj.modifiers.new("points", "NODES")
    mod.node_group = ng
    return obj


def make_material():
    mat = bpy.data.materials.new("dna_particles")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    col = nt.nodes.new("ShaderNodeAttribute")
    col.attribute_name = "p_col"
    emit = nt.nodes.new("ShaderNodeAttribute")
    emit.attribute_name = "p_emit"
    kind = nt.nodes.new("ShaderNodeAttribute")
    kind.attribute_name = "p_kind"

    # beads (kind 2) are smooth glassy emitters, grains are rough-ish metal
    rough = nt.nodes.new("ShaderNodeMapRange")
    rough.inputs["From Min"].default_value = 0
    rough.inputs["From Max"].default_value = 2
    rough.inputs["To Min"].default_value = 0.32
    rough.inputs["To Max"].default_value = 0.15
    nt.links.new(kind.outputs["Fac"], rough.inputs["Value"])

    nt.links.new(col.outputs["Vector"], bsdf.inputs["Base Color"])
    nt.links.new(col.outputs["Vector"], bsdf.inputs["Emission Color"])
    nt.links.new(emit.outputs["Fac"], bsdf.inputs["Emission Strength"])
    nt.links.new(rough.outputs["Result"], bsdf.inputs["Roughness"])
    bsdf.inputs["Metallic"].default_value = 0.75
    bsdf.inputs["Coat Weight"].default_value = 0.4
    bsdf.inputs["Coat Roughness"].default_value = 0.08
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    # thousands of tiny emitters: don't treat them as lights (huge noise win)
    for holder in (mat, getattr(mat, "cycles", None)):
        try:
            holder.emission_sampling = "NONE"
            break
        except Exception:
            pass
    return mat


def add_area_light(name, loc, target, color, power, size):
    data = bpy.data.lights.new(name, "AREA")
    data.color = color
    data.energy = power
    data.size = size
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = loc
    direction = Vector(target) - Vector(loc)
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    return obj


def build_scene(args):
    reset_scene()
    scene = bpy.context.scene
    rng = np.random.default_rng(7)

    geo = symmetric(build_half(rng))
    mat = make_material()

    # hierarchy: root (placement + tilt) -> spin (animated) -> particles
    root = bpy.data.objects.new("dna_root", None)
    scene.collection.objects.link(root)
    spin = bpy.data.objects.new("dna_spin", None)
    scene.collection.objects.link(spin)
    spin.parent = root

    C = THREE_TO_BLENDER
    tilt_three = Matrix.Rotation(DNA_TILT_Z, 3, "Z") @ Matrix.Rotation(DNA_TILT_X, 3, "X")
    tilt_blender = C @ tilt_three @ C.inverted()
    root.matrix_world = (
        Matrix.Translation(C @ Vector(DNA_POS) * WORLD_SCALE)
        @ tilt_blender.to_4x4()
        @ Matrix.Scale(WORLD_SCALE * HELIX_SCALE, 4)
    )

    dna = make_point_object("dna", geo, mat)
    dna.parent = spin

    # 180° spin over the loop (local Z == helix axis). Linear, loops seamlessly.
    spin.rotation_mode = "XYZ"
    spin.rotation_euler = (0, 0, 0)
    spin.keyframe_insert("rotation_euler", index=2, frame=0)
    spin.rotation_euler = (0, 0, math.pi)
    spin.keyframe_insert("rotation_euler", index=2, frame=LOOP_FRAMES)
    try:
        for fc in spin.animation_data.action.fcurves:
            for kp in fc.keyframe_points:
                kp.interpolation = "LINEAR"
    except Exception:
        # Blender 5 layered actions
        for layer in spin.animation_data.action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    for fc in bag.fcurves:
                        for kp in fc.keyframe_points:
                            kp.interpolation = "LINEAR"

    # camera: origin, looking down three -Z (blender +Y), vertical FOV like the web camera
    cam_data = bpy.data.cameras.new("cam")
    cam_data.sensor_fit = "VERTICAL"
    cam_data.sensor_height = 24
    cam_data.lens = 12 / math.tan(math.radians(FOV_Y / 2))
    cam_data.clip_start = 0.01
    cam_data.clip_end = 50
    cam_data.dof.use_dof = True
    cam_data.dof.focus_distance = FOCUS * WORLD_SCALE
    cam_data.dof.aperture_fstop = F_STOP
    cam_data.dof.aperture_blades = 0
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    cam.location = (0, 0, 0)
    cam.rotation_euler = (math.radians(90), 0, 0)
    scene.camera = cam

    centre = C @ Vector(DNA_POS) * WORLD_SCALE
    k = WORLD_SCALE
    # warm key from lower right / front, green rim from upper left / behind, soft top fill
    add_area_light("key", centre + Vector((6, -12, -7)) * k, centre, (1.0, 0.84, 0.62), 3400 * k * k, 6 * k)
    add_area_light("rim", centre + Vector((-7, 8, 6)) * k, centre, (0.2, 1.0, 0.3), 700 * k * k, 8 * k)
    add_area_light("fill", centre + Vector((-3, -10, 9)) * k, centre, (0.55, 0.85, 0.7), 450 * k * k, 10 * k)

    world = bpy.data.worlds.new("world")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0, 0, 0, 1)
    scene.world = world

    # render settings
    scene.render.engine = "CYCLES"
    cy = scene.cycles
    cy.device = "CPU"
    cy.samples = args.samples
    cy.use_adaptive_sampling = True
    cy.adaptive_threshold = 0.02
    cy.use_denoising = True
    try:
        cy.denoiser = "OPENIMAGEDENOISE"
    except Exception:
        pass
    cy.max_bounces = 3
    cy.diffuse_bounces = 1
    cy.glossy_bounces = 2
    cy.transmission_bounces = 0
    cy.volume_bounces = 0
    cy.transparent_max_bounces = 0
    cy.caustics_reflective = False
    cy.caustics_refractive = False
    cy.seed = 11
    cy.use_animated_seed = False
    cy.sample_clamp_indirect = 4
    if args.threads:
        scene.render.threads_mode = "FIXED"
        scene.render.threads = args.threads

    scene.render.resolution_x, scene.render.resolution_y = args.res
    scene.render.resolution_percentage = 100
    scene.render.fps = FPS
    scene.frame_start, scene.frame_end = 0, LOOP_FRAMES - 1
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0.0
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_depth = "8"

    setup_compositor(scene)
    return scene


def setup_compositor(scene):
    """Soft photographic bloom on the HDR render (beads and glints)."""
    if hasattr(scene, "compositing_node_group"):  # Blender 5.x
        tree = bpy.data.node_groups.new("comp", "CompositorNodeTree")
        scene.compositing_node_group = tree
        tree.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
        out = tree.nodes.new("NodeGroupOutput")
        out_socket = out.inputs[0]
    else:  # Blender 4.x
        scene.use_nodes = True
        tree = scene.node_tree
        tree.nodes.clear()
        out = tree.nodes.new("CompositorNodeComposite")
        out_socket = out.inputs["Image"]
    rl = tree.nodes.new("CompositorNodeRLayers")
    glare = tree.nodes.new("CompositorNodeGlare")
    settings = {"Type": "Bloom", "Quality": "High", "Threshold": 0.9, "Strength": 0.55, "Size": 0.62, "Saturation": 1.15}
    for key, value in settings.items():
        if key in glare.inputs:
            glare.inputs[key].default_value = value
    if "Type" not in glare.inputs:
        glare.glare_type = "BLOOM" if hasattr(glare, "glare_type") else None
        glare.threshold = 0.9
        glare.mix = -0.45
        glare.size = 8
    tree.links.new(rl.outputs["Image"], glare.inputs["Image"])
    tree.links.new(glare.outputs["Image"], out_socket)


def main():
    args = parse_args()
    scene = build_scene(args)
    if args.save_blend:
        bpy.ops.wm.save_as_mainfile(filepath=args.save_blend)
    if not args.out:
        return
    for f in range(args.frames[0], args.frames[1] + 1, args.step):
        scene.frame_set(f)
        # set explicitly as well, so the loop is exact regardless of animation API changes
        bpy.data.objects["dna_spin"].rotation_euler.z = math.pi * f / LOOP_FRAMES
        scene.render.filepath = f"{args.out.rstrip('/')}/frame_{f:04d}.png"
        bpy.ops.render.render(write_still=True)
        print(f"rendered frame {f}", flush=True)


if __name__ == "__main__":
    main()
