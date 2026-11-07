# web3.ia — DNA hero section

A recreation of the "The Core DNA of Web3 Infrastructure" hero: a photoreal 3D DNA helix
(path-traced in Blender) that slowly rotates behind the copy, a WebGL fluid simulation that
follows the cursor (glowing green/lime/cyan light trails that also **warp the DNA**), and the
staggered intro: helix fades in from black → nav drops in → headline types in character by
character → copy, CTA, logos and the floating "Entity Graph" card pop in.

Built with Vite + React + TypeScript + three.js.

## Run it locally

You need **Node.js 18 or newer** (20/22 LTS recommended) and **Git**. Check with
`node -v`. Nothing else is required: the Blender renders are already in `public/media`.

```bash
git clone https://github.com/HimanshuPatial26/Hero.git
```

```bash
cd Hero
```

```bash
git checkout claude/festive-wright-e3itr1
```

```bash
npm install
```

```bash
npm run dev
```

Open the URL Vite prints (normally http://localhost:5173) in Chrome, Edge, Firefox or
Safari. Move the mouse over the hero to see the fluid trails warp the DNA; reload to replay
the intro.

Production build, served locally (http://localhost:4173):

```bash
npm run build
```

```bash
npm run preview
```

The `dist/` folder is a static site, so it can be deployed to any static host as-is.

**Troubleshooting**

- *Port already in use*: `npm run dev -- --port 3000`.
- *Shows the poster image, no animation*: WebGL is off. In Chrome check
  `chrome://gpu` and enable "Use graphics acceleration when available".
- *Particle helix instead of the photoreal one*: the video couldn't autoplay (e.g. battery
  saver / Low Power Mode) or failed to load; the page falls back automatically.
- *No fluid / no typing animation*: your OS has "reduce motion" turned on; the page honours it.

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

Only needed if you change the DNA look. The scene is generated entirely from code.

You need [Blender 4.2+](https://www.blender.org/download/) (or `pip install bpy`, Blender as a
Python module), [ffmpeg](https://ffmpeg.org/download.html) for encoding, and
`pip install numpy pillow` for the helper scripts. On Windows run the `.sh` script from Git
Bash or WSL.

With the Blender app installed (add `--gpu` to render on your graphics card: OptiX, CUDA,
HIP, Metal or oneAPI, whichever is available; it falls back to the CPU otherwise):

```bash
blender -b -P blender/dna_scene.py -- --out ./render/frames --res 1440 900 --samples 80 --gpu
```

or with the `bpy` module:

```bash
python blender/dna_scene.py --out ./render/frames --res 1440 900 --samples 80 --gpu
```

Then encode the loop and rebuild the haze map:

```bash
./blender/encode.sh ./render/frames public/media
```

```bash
python blender/haze_map.py ./render/frames public/media/dna-haze.png
```

The Entity Graph card thumbnail is rendered the same way:

```bash
blender -b -P blender/entity_thumb.py -- --out ./render/entity.png
```

```bash
python -c "from PIL import Image; Image.open('render/entity.png').convert('RGB').resize((216,220), Image.LANCZOS).save('public/media/entity-graph.webp', quality=88)"
```

Add `--save-blend dna.blend` to open the scene in the Blender UI, or `--frames 0 0` to render
a single test frame first. On a 4-core CPU a frame takes ~25 s at 1440×900 / 64–80 samples,
so the full 192-frame loop is about 75 minutes; a recent GPU is typically many times faster.
To resume an interrupted render, pass `--frames <first-missing> 191`.

The helix is exactly symmetric under a 180° rotation about its axis, and the camera is
fixed while the helix spins 180° over the 192 frames, so the loop has no seam. Placement,
tilt and lens match the web camera (30° vertical FOV), so the procedural fallback lines up
with the render.
