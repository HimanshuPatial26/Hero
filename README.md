# web3.ia — DNA hero section

A recreation of the "The Core DNA of Web3 Infrastructure" hero: a photoreal 3D DNA helix
(path-traced in Blender) that slowly rotates behind the copy, a WebGL fluid simulation that
follows the cursor (glowing green/lime/cyan light trails that also **warp the DNA**), and the
staggered intro: helix fades in from black → nav drops in → headline types in character by
character → copy, CTA, logos and the floating "Entity Graph" card pop in.

Built with Vite + React + TypeScript + three.js.

```bash
npm install
npm run dev
```

```bash
npm run build && npm run preview
```

## How it's put together

| Layer | Where | What |
| --- | --- | --- |
| DNA render | `public/media/dna-loop-*.{webm,mp4}` | 8 s seamless loop rendered with Blender Cycles: a pebbled grain shell around a dark core tube, metallic cream glints from a warm rim light, emissive neon beads, physical depth of field, bloom. Built by `blender/dna_scene.py`. |
| Atmosphere | `public/media/dna-haze.png` | Blurred average of the render, added as a soft green haze around the helix (`blender/haze_map.py`). |
| WebGL compositor | `src/webgl/HeroScene.ts` | Plays the video as a texture, adds a real-time dust/star field and distant haze, runs the fluid sim, warps everything with the fluid velocity, adds the dye trails, bloom, vignette. Holds the intro until the first video frame decodes. |
| Fluid sim | `src/webgl/fluid.ts` | GPU stable-fluids solver (advection, vorticity, pressure solve) on half-float targets. |
| Procedural fallback | `src/webgl/dna.ts` | Particle helix with a thin-lens depth-of-field shader. Used if the video can't autoplay or load, and crossfades to the video when it arrives. |
| UI | `src/components/*` | Nav, per-character headline reveal, badge, CTA, trusted-by logos, Entity Graph card. Intro timings live at the top of `Hero.tsx`. |

The page respects `prefers-reduced-motion` (no typing/fly-in, no fluid, slowed loop) and
pauses rendering when the hero is off-screen or the tab is hidden. Without WebGL it falls
back to a static poster frame.

## Re-rendering the DNA in Blender

The scene is generated entirely from code, so it can be tweaked and re-rendered:

```bash
pip install bpy            # Blender as a Python module (or use `blender -b -P ... --`)
```

```bash
python blender/dna_scene.py --out /tmp/dna-frames --res 1440 900 --samples 80
```

```bash
./blender/encode.sh /tmp/dna-frames public/media
```

```bash
python blender/haze_map.py /tmp/dna-frames public/media/dna-haze.png
```

The Entity Graph card thumbnail is rendered the same way:

```bash
python blender/entity_thumb.py --out /tmp/entity.png
```

Add `--save-blend dna.blend` to open the scene in the Blender UI, or `--frames 0 0` to render
a single test frame. On a 4-core CPU a frame takes ~20 s at 1440×900 / 80 samples.

The helix is exactly symmetric under a 180° rotation about its axis, and the camera is
fixed while the helix spins 180° over the 192 frames, so the loop has no seam. Placement,
tilt and lens match the web camera (30° vertical FOV), so the procedural fallback lines up
with the render.
