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
TUBE = 0.27
RUNGS_PER_TURN = 10
STRAND_POINTS = 120000  # per strand (strand B is a rotated copy)

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
F_STOP = 0.25

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

    # Palette (base colours; the look comes mostly from how the lights hit them)
    shadow = np.array([0.008, 0.04, 0.025])  # near-black teal-green body
    body = np.array([0.02, 0.12, 0.07])
    cream = np.array([0.96, 0.88, 0.7])  # metallic cream grains catch the warm rim
    gold = np.array([0.9, 0.62, 0.32])
    glow = np.array([0.05, 0.75, 0.16])
    neon = np.array([0.14, 1.0, 0.1])  # neon green; the red lifts hot cores toward white, never mint
    rod = np.array([0.9, 0.86, 0.72])

    def shell_dir(y):
        p, n, b = helix_frame(y, 0.0)
        phi = rng.random() * 2 * math.pi
        return p, n * math.cos(phi) + b * math.sin(phi)

    # --- backbone: a dense, pebbled shell of glossy grains with a crisp silhouette
    for _ in range(STRAND_POINTS):
        y = -half + rng.random() * LENGTH
        p, d = shell_dir(y)
        u = rng.random()
        if u < 0.012:  # a little loose dust
            r = TUBE * (1.02 + rng.random() * 0.3)
        elif u < 0.16:  # some depth inside the shell
            r = TUBE * (0.45 + 0.37 * rng.random())
        else:  # packed surface
            r = TUBE * (0.84 + 0.16 * rng.random())
        pos.append(p + d * r)
        rad.append(0.009 + rng.random() ** 2.5 * 0.011)
        v = rng.random()
        if v < 0.78:
            c = shadow + (body - shadow) * rng.random()
            e = 0.0
        elif v < 0.97:
            c = cream + (gold - cream) * rng.random() * 0.5
            e = 0.0
        else:
            c = glow * (0.6 + 0.4 * rng.random())
            e = 0.35 + rng.random() * 0.9
        col.append(c)
        emit.append(e)
        kind.append(0)

    # glowing studs sitting on the backbone surface
    for _ in range(int(LENGTH * 4)):
        y = -half + rng.random() * LENGTH
        p, d = shell_dir(y)
        pos.append(p + d * TUBE * (0.92 + rng.random() * 0.12))
        rad.append(0.018 + rng.random() ** 2 * 0.026)
        col.append(neon)
        emit.append(2.5 + rng.random() * 2.5)
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
        t0 = TUBE * 0.8 / L

        # thin cream rod of fine grains
        for _ in range(120):
            t = t0 + rng.random() * (1 - t0)
            phi = rng.random() * 2 * math.pi
            rr = 0.028 * math.sqrt(rng.random())
            pos.append(a + axis * t * L + side * math.cos(phi) * rr + up * math.sin(phi) * rr)
            rad.append(0.009 + rng.random() ** 3 * 0.012)
            if rng.random() < 0.85:
                col.append(rod * (0.75 + 0.25 * rng.random()))
                emit.append(0.22 + rng.random() * 0.45)
            else:
                col.append(glow)
                emit.append(0.6 + rng.random() * 0.8)
            kind.append(1)

        # saturated neon beads, sometimes in small clusters
        for _ in range(1 + int(rng.random() * 3)):
            t = rng.random()
            t = t * 0.5 if rng.random() < 0.55 else t
            t = t0 + t * (1 - t0) * 0.97
            centre_b = a + axis * t * L
            for c_i in range(1 if rng.random() < 0.7 else 2 + int(rng.random() * 2)):
                off = axis * (c_i * (0.07 + rng.random() * 0.05))
                pos.append(centre_b + off + side * (rng.random() - 0.5) * 0.04 + up * (rng.random() - 0.5) * 0.04)
                rad.append(0.028 + rng.random() ** 1.7 * 0.06)
                col.append(neon)
                emit.append(4.0 + rng.random() * 5.0)
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
    rough.inputs["To Min"].default_value = 0.2
    rough.inputs["To Max"].default_value = 0.12
    nt.links.new(kind.outputs["Fac"], rough.inputs["Value"])

    nt.links.new(col.outputs["Vector"], bsdf.inputs["Base Color"])
    nt.links.new(col.outputs["Vector"], bsdf.inputs["Emission Color"])
    nt.links.new(emit.outputs["Fac"], bsdf.inputs["Emission Strength"])
    nt.links.new(rough.outputs["Result"], bsdf.inputs["Roughness"])
    bsdf.inputs["Metallic"].default_value = 0.85
    bsdf.inputs["Coat Weight"].default_value = 0.6
    bsdf.inputs["Coat Roughness"].default_value = 0.04
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    # thousands of tiny emitters: don't treat them as lights (huge noise win)
    for holder in (mat, getattr(mat, "cycles", None)):
        try:
            holder.emission_sampling = "NONE"
            break
        except Exception:
            pass
    return mat


def make_core_tubes(parent):
    """Solid dark tube inside each grain shell: self-shadows the far side of the strand and shows
    through the gaps between grains as dark pores, like the reference."""
    mat = bpy.data.materials.new("dna_core")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (0.004, 0.022, 0.012, 1)
    bsdf.inputs["Metallic"].default_value = 0.4
    bsdf.inputs["Roughness"].default_value = 0.42
    half = LENGTH / 2 + 0.5
    for strand in range(2):
        cu = bpy.data.curves.new(f"core_{strand}", "CURVE")
        cu.dimensions = "3D"
        cu.bevel_depth = TUBE * 0.8
        cu.bevel_resolution = 3
        cu.use_fill_caps = True
        spline = cu.splines.new("POLY")
        n = 900
        spline.points.add(n - 1)
        for i in range(n):
            y = -half + (2 * half) * i / (n - 1)
            p, _, _ = helix_frame(y, strand * math.pi)
            q = THREE_TO_BLENDER @ Vector(p)
            spline.points[i].co = (q.x, q.y, q.z, 1.0)
        obj = bpy.data.objects.new(f"core_{strand}", cu)
        obj.data.materials.append(mat)
        bpy.context.scene.collection.objects.link(obj)
        obj.parent = parent


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
    make_core_tubes(spin)

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
    # Light rig matched to the reference (blender axes: x right, y away from camera, z up):
    #  - strong warm rim from lower right, slightly behind: cream/gold glints on the lower-right edges
    #  - softer warm key from upper right: beige top strand
    #  - cool green fill from the front-left keeps the shadow side dark green, not black
    #  - green back light for rim definition on the far side
    add_area_light("rim_warm", centre + Vector((7.5, 3.0, -6.5)) * k, centre, (1.0, 0.8, 0.55), 7000 * k * k, 3 * k)
    add_area_light("key_warm", centre + Vector((6.0, -5.0, 8.0)) * k, centre, (1.0, 0.86, 0.66), 1700 * k * k, 5 * k)
    add_area_light("fill_green", centre + Vector((-6.0, -10.0, 1.0)) * k, centre, (0.35, 1.0, 0.5), 240 * k * k, 12 * k)
    add_area_light("back_green", centre + Vector((-5.0, 9.0, 5.0)) * k, centre, (0.15, 1.0, 0.3), 900 * k * k, 8 * k)
    # hard warm sun from the lower right: pin-point specular sparkle on every grain
    sun_data = bpy.data.lights.new("glint_sun", "SUN")
    sun_data.color = (1.0, 0.86, 0.64)
    sun_data.energy = 2.2
    sun_data.angle = math.radians(1.5)
    sun = bpy.data.objects.new("glint_sun", sun_data)
    scene.collection.objects.link(sun)
    sun.rotation_euler = Vector((-0.75, 0.35, 0.55)).to_track_quat("-Z", "Y").to_euler()

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
    settings = {"Type": "Bloom", "Quality": "High", "Threshold": 0.9, "Strength": 0.7, "Size": 0.72, "Saturation": 1.15}
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
