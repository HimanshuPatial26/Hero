import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { buildHazeGeometry, buildHelixGeometry, buildStarGeometry, createParticleMaterial } from './dna';
import { FluidSimulation } from './fluid';

const FOV = 30;
const FOCUS = 24;
const BG = new THREE.Color(7 / 255, 12 / 255, 6 / 255);
/** How long the intro waits for the first decoded video frame before using the procedural helix. */
const VIDEO_WAIT_MS = 1800;
/** Where the helix sits inside the rendered video (uv), used to frame it on narrow screens. */
const VIDEO_FOCUS = new THREE.Vector2(0.66, 0.5);

/**
 * Fluid → scene compositor.
 * Warps the DNA (Blender video and/or procedural particles) with the fluid velocity
 * and adds the glowing light trails.
 */
const CompositeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uVelocity: { value: null as THREE.Texture | null },
    uDye: { value: null as THREE.Texture | null },
    uVideo: { value: null as THREE.Texture | null },
    uVideoMix: { value: 0 },
    uVideoXf: { value: new THREE.Vector4(1, 1, 0, 0) },
    // grade the render to the reference: darker body, contrasty highlights
    uVideoGain: { value: 0.78 },
    uVideoGamma: { value: 1.2 },
    // soft green atmosphere around the helix (blurred average of the Blender render)
    uHaze: { value: null as THREE.Texture | null },
    uHazeColor: { value: new THREE.Color(0.07, 0.25, 0.11) },
    uHazeStrength: { value: 0 },
    uSimTexel: { value: new THREE.Vector2(1 / 128, 1 / 128) },
    uDistortion: { value: 0.035 },
    uReveal: { value: 0 },
    uDyeStrength: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D uVelocity;
    uniform sampler2D uDye;
    uniform sampler2D uVideo;
    uniform float uVideoMix;
    uniform vec4 uVideoXf;
    uniform float uVideoGain;
    uniform float uVideoGamma;
    uniform sampler2D uHaze;
    uniform vec3 uHazeColor;
    uniform float uHazeStrength;
    uniform vec2 uSimTexel;
    uniform float uDistortion;
    uniform float uReveal;
    uniform float uDyeStrength;
    varying vec2 vUv;

    void main() {
      vec2 vel = texture2D(uVelocity, vUv).xy;
      vec2 disp = vel * uSimTexel * uDistortion;
      float l = length(disp);
      if (l > 0.09) disp *= 0.09 / l;
      vec2 suv = vUv - disp;

      vec3 scene = texture2D(tDiffuse, suv).rgb;

      vec2 vuv = suv * uVideoXf.xy + uVideoXf.zw;
      if (uHazeStrength > 0.001) {
        float h = texture2D(uHaze, clamp(vuv, 0.0, 1.0)).r;
        scene += uHazeColor * (h * h * h) * uHazeStrength;
      }
      if (uVideoMix > 0.001) {
        vec2 inside = step(vec2(0.0), vuv) * step(vuv, vec2(1.0));
        vec3 video = texture2D(uVideo, clamp(vuv, 0.0, 1.0)).rgb * inside.x * inside.y;
        video = pow(video, vec3(uVideoGamma)) * uVideoGain;
        scene += video * uVideoMix;
      }
      scene *= uReveal;

      vec3 dye = texture2D(uDye, vUv).rgb * uDyeStrength;
      float m = max(dye.r, max(dye.g, dye.b));
      // hot white core where the dye is dense
      vec3 glow = dye + vec3(smoothstep(0.45, 1.6, m)) * 0.75;

      gl_FragColor = vec4(scene + glow, 1.0);
    }
  `,
};

/** Background, soft highlight roll-off, vignette and dithering. */
const FinalShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uBg: { value: BG.clone() },
    uTime: { value: 0 },
  },
  vertexShader: CompositeShader.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec3 uBg;
    uniform float uTime;
    varying vec2 vUv;

    vec3 softClip(vec3 x) {
      vec3 k = vec3(0.82);
      vec3 over = max(x - k, 0.0);
      return min(x, k) + (1.0 - k) * (1.0 - exp(-over / (1.0 - k)));
    }

    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      c = softClip(c);
      vec2 q = vUv - 0.5;
      float vig = smoothstep(1.05, 0.2, length(q * vec2(1.0, 1.25)));
      c = uBg + c * mix(0.7, 1.0, vig);
      float n = fract(sin(dot(gl_FragCoord.xy + fract(uTime) * 61.0, vec2(12.9898, 78.233))) * 43758.5453);
      c += (n - 0.5) / 255.0;
      gl_FragColor = vec4(c, 1.0);
    }
  `,
};

export interface VideoSource {
  src: string;
  type: string;
}

export interface HeroSceneOptions {
  /** Element that receives pointer events (usually the whole hero section). */
  eventTarget?: HTMLElement;
  onReady?: () => void;
  reducedMotion?: boolean;
  /** Pre-rendered (Blender) DNA loop. Without it the procedural particle helix is used. */
  video?: { sources: VideoSource[]; aspect: number; haze?: string };
}

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

function hsv(h: number, s: number, v: number) {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const m = [
    [v, t, p],
    [q, v, p],
    [p, v, t],
    [p, q, v],
    [t, p, v],
    [v, p, q],
  ][((i % 6) + 6) % 6];
  return new THREE.Color(m[0], m[1], m[2]);
}

export class HeroScene {
  private container: HTMLElement;
  private eventTarget: HTMLElement;
  private opts: HeroSceneOptions;

  private renderer: THREE.WebGLRenderer;
  private camera: THREE.PerspectiveCamera;
  private scene = new THREE.Scene();
  private composer: EffectComposer;
  private compositePass: ShaderPass;
  private finalPass: ShaderPass;
  private bloomPass: UnrealBloomPass;
  private fluid: FluidSimulation;

  private dnaRoot = new THREE.Group();
  private dnaTilt = new THREE.Group();
  private dnaSpin = new THREE.Group();
  private hazeRoot = new THREE.Group();
  private hazeSpin = new THREE.Group();
  private helix: THREE.Points;
  private stars: THREE.Points;

  private materials: THREE.ShaderMaterial[] = [];
  private helixMat: THREE.ShaderMaterial;
  private hazeMat: THREE.ShaderMaterial;
  private starMat: THREE.ShaderMaterial;

  private video: HTMLVideoElement | null = null;
  private videoTexture: THREE.VideoTexture | null = null;
  private hazeTexture: THREE.Texture | null = null;
  private videoAspect = 1.6;
  private videoReady = false;
  private videoFailed = false;
  private videoMix = 0;

  private width = 1;
  private height = 1;
  private dpr = 1;
  private maxPointSize = 64;

  private raf = 0;
  private running = false;
  private visible = true;
  private createdAt = performance.now();
  private introStart = -1;
  private lastTime = 0;
  private elapsed = 0;
  private realDt = 0;
  private disposed = false;

  private pointer = {
    x: 0.5,
    y: 0.5,
    prevX: 0.5,
    prevY: 0.5,
    dx: 0,
    dy: 0,
    moved: false,
    initialized: false,
  };

  private resizeObserver: ResizeObserver;
  private intersectionObserver: IntersectionObserver;

  constructor(container: HTMLElement, opts: HeroSceneOptions = {}) {
    this.container = container;
    this.eventTarget = opts.eventTarget ?? container;
    this.opts = opts;

    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: false,
    });
    this.renderer.setClearColor(0x000000, 1);
    const canvas = this.renderer.domElement;
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    container.appendChild(canvas);

    const gl = this.renderer.getContext();
    const range = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as Float32Array | number[] | null;
    if (range && range[1]) this.maxPointSize = range[1];

    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200);

    // ---- Procedural DNA (fallback / until the Blender loop is decoded) ----
    this.helixMat = createParticleMaterial({ uFocus: FOCUS, uAperture: 0.05, uIntensity: 1.0 });
    this.helix = new THREE.Points(buildHelixGeometry(), this.helixMat);
    this.helix.frustumCulled = false;
    this.dnaSpin.add(this.helix);
    this.dnaTilt.add(this.dnaSpin);
    this.dnaRoot.add(this.dnaTilt);
    // Screen tilt (top leans right) and depth tilt (bottom comes toward the camera).
    this.dnaTilt.rotation.set(-0.42, 0, -0.56, 'ZXY');
    this.scene.add(this.dnaRoot);

    // ---- Distant haze helix + dust (always real-time, layered with the video) ----
    this.hazeMat = createParticleMaterial({ uFocus: FOCUS, uAperture: 0.0, uIntensity: 0.22, uBokehBoost: 0 });
    const haze = new THREE.Points(buildHazeGeometry(), this.hazeMat);
    haze.frustumCulled = false;
    this.hazeSpin.add(haze);
    const hazeTilt = new THREE.Group();
    hazeTilt.rotation.set(-0.2, 0, -0.42, 'ZXY');
    hazeTilt.add(this.hazeSpin);
    this.hazeRoot.add(hazeTilt);
    this.scene.add(this.hazeRoot);

    this.starMat = createParticleMaterial({ uFocus: 60, uAperture: 0, uIntensity: 0.55, uMinSize: 1.0 });
    this.stars = new THREE.Points(buildStarGeometry(1100, 95, 40, -60), this.starMat);
    this.stars.frustumCulled = false;
    this.scene.add(this.stars);

    this.materials = [this.helixMat, this.hazeMat, this.starMat];

    // ---- Post processing ----
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.fluid = new FluidSimulation(this.renderer, 1, 1);
    this.compositePass = new ShaderPass(CompositeShader);
    this.compositePass.uniforms.uVelocity.value = this.fluid.velocityTexture;
    this.compositePass.uniforms.uDye.value = this.fluid.dyeTexture;
    this.composer.addPass(this.compositePass);

    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.75, 0.6, 0.18);
    this.composer.addPass(this.bloomPass);

    this.finalPass = new ShaderPass(FinalShader);
    this.composer.addPass(this.finalPass);

    if (opts.video && opts.video.sources.length) {
      this.setupVideo(opts.video.sources, opts.video.aspect);
      if (opts.video.haze) {
        new THREE.TextureLoader().load(opts.video.haze, (tex) => {
          if (this.disposed) return tex.dispose();
          tex.colorSpace = THREE.NoColorSpace;
          tex.minFilter = THREE.LinearFilter;
          tex.generateMipmaps = false;
          this.hazeTexture = tex;
          this.compositePass.uniforms.uHaze.value = tex;
        });
      }
    }

    this.resize();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);

    this.intersectionObserver = new IntersectionObserver(
      ([entry]) => {
        this.visible = entry.isIntersecting;
        this.updateRunning();
      },
      { threshold: 0 },
    );
    this.intersectionObserver.observe(container);

    document.addEventListener('visibilitychange', this.updateRunning);
    this.eventTarget.addEventListener('pointermove', this.onPointerMove, { passive: true });
    this.eventTarget.addEventListener('pointerdown', this.onPointerDown, { passive: true });

    this.updateRunning();
  }

  // ------------------------------------------------------------------- video

  private setupVideo(sources: VideoSource[], aspect: number) {
    this.videoAspect = aspect;
    const video = document.createElement('video');
    video.muted = true;
    video.defaultMuted = true;
    video.loop = true;
    video.playsInline = true;
    video.autoplay = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    video.setAttribute('aria-hidden', 'true');
    for (const s of sources) {
      const el = document.createElement('source');
      el.src = s.src;
      el.type = s.type;
      video.appendChild(el);
    }
    if (this.opts.reducedMotion) video.playbackRate = 0.35;

    const tex = new THREE.VideoTexture(video);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace;
    this.videoTexture = tex;
    this.compositePass.uniforms.uVideo.value = tex;

    const markReady = () => {
      if (this.videoReady || this.disposed) return;
      this.videoReady = true;
    };
    const rvfc = (video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number;
    }).requestVideoFrameCallback;
    if (rvfc) rvfc.call(video, markReady);
    // backup for browsers that don't fire rVFC on an off-DOM video
    video.addEventListener(
      'playing',
      () => window.setTimeout(() => video.readyState >= 2 && markReady(), 120),
      { once: true },
    );

    video.addEventListener('error', () => (this.videoFailed = true), { once: true });
    const lastSource = video.lastElementChild;
    lastSource?.addEventListener('error', () => (this.videoFailed = true));

    this.video = video;
    video.load();
    video.play().catch(() => {
      // Autoplay refused (e.g. low-power mode): stay on the procedural helix.
      this.videoFailed = true;
    });
  }

  /** Screen uv → video uv: "cover" fit, right-anchored, framed on the helix on narrow screens. */
  private videoTransform(zoom: number) {
    const sa = this.width / this.height;
    const va = this.videoAspect;
    let sx: number;
    let sy: number;
    let ox: number;
    let oy: number;
    if (sa > va) {
      sx = 1;
      sy = va / sa;
      ox = 0;
      oy = 0.5 - sy * 0.5;
    } else {
      sx = sa / va;
      sy = 1;
      const c = THREE.MathUtils.clamp(VIDEO_FOCUS.x, sx / 2, 1 - sx / 2);
      ox = c - sx / 2;
      oy = 0;
    }
    const f = VIDEO_FOCUS;
    const xf = this.compositePass.uniforms.uVideoXf.value as THREE.Vector4;
    xf.set(sx / zoom, sy / zoom, (ox - f.x) / zoom + f.x, (oy - f.y) / zoom + f.y);
  }

  // ------------------------------------------------------------------ sizing

  private resize() {
    const rect = this.container.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    this.width = w;
    this.height = h;
    // DPR is capped: the effect is soft by nature and fill-rate heavy.
    this.dpr = Math.min(window.devicePixelRatio || 1, w < 768 ? 2 : 1.5);

    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(this.dpr);
    this.composer.setSize(w, h);
    this.fluid.resize(w, h);
    this.compositePass.uniforms.uSimTexel.value = this.fluid.simTexelSize;

    const aspect = w / h;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();

    const viewportH = h * this.dpr;
    const sizeScale = this.dpr;
    for (const m of this.materials) m.uniforms.uViewportH.value = viewportH;
    this.helixMat.uniforms.uMaxSize.value = Math.min(52 * sizeScale, this.maxPointSize);
    this.helixMat.uniforms.uMinSize.value = 1.1 * sizeScale;
    this.hazeMat.uniforms.uMaxSize.value = Math.min(260 * sizeScale, this.maxPointSize);
    this.starMat.uniforms.uMaxSize.value = Math.min(6 * sizeScale, this.maxPointSize);
    this.starMat.uniforms.uMinSize.value = 1.0 * sizeScale;

    this.layout(aspect);
  }

  /** Places the procedural helix where the Blender render has it. */
  private layout(aspect: number) {
    const visH = 2 * FOCUS * Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const visW = visH * aspect;
    const va = this.videoAspect;
    // match the video framing: same world placement for wide screens, shifted for narrow ones
    let x = 2.85;
    let y = -0.75;
    let scale = 1.35;
    if (aspect > va) {
      // video is fitted to width: world units per screen width grow with the aspect
      x = 2.85 * (aspect / va);
    } else if (aspect < 0.9) {
      x = visW * 0.08;
      y = -visH * 0.04;
      scale = 1.0;
    }
    this.dnaRoot.position.set(x, y, -FOCUS);
    this.dnaRoot.scale.setScalar(scale);
    this.hazeRoot.position.set(x - 5.5, y + 3.5, -FOCUS - 26);
    this.hazeRoot.scale.setScalar(1.6);
  }

  // ----------------------------------------------------------------- pointer

  private toUv(e: PointerEvent) {
    const rect = this.container.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / Math.max(rect.width, 1),
      y: 1 - (e.clientY - rect.top) / Math.max(rect.height, 1),
    };
  }

  private onPointerMove = (e: PointerEvent) => {
    if (this.opts.reducedMotion) return;
    const { x, y } = this.toUv(e);
    const p = this.pointer;
    if (!p.initialized) {
      p.x = p.prevX = x;
      p.y = p.prevY = y;
      p.initialized = true;
      return;
    }
    p.prevX = p.x;
    p.prevY = p.y;
    p.x = x;
    p.y = y;
    const aspect = this.width / this.height;
    let dx = p.x - p.prevX;
    let dy = p.y - p.prevY;
    if (aspect < 1) dx *= aspect;
    if (aspect > 1) dy /= aspect;
    // accumulate between frames so fast moves are not lost
    p.dx += dx;
    p.dy += dy;
    p.moved = Math.abs(p.dx) > 0 || Math.abs(p.dy) > 0;
  };

  private onPointerDown = (e: PointerEvent) => {
    if (this.opts.reducedMotion) return;
    const { x, y } = this.toUv(e);
    const color = this.trailColor().multiplyScalar(6);
    const a = Math.random() * Math.PI * 2;
    this.fluid.splat(x, y, Math.cos(a) * 900, Math.sin(a) * 900, color);
  };

  private trailColor() {
    const t = this.elapsed;
    // drift between lime, green, mint and cyan like the reference trails
    const hue = 0.34 + 0.1 * Math.sin(t * 0.9) + 0.05 * Math.sin(t * 2.3 + 1.7);
    return hsv(hue, 0.92, 1).multiplyScalar(0.16);
  }

  // -------------------------------------------------------------------- loop

  private updateRunning = () => {
    const shouldRun = this.visible && document.visibilityState !== 'hidden' && !this.disposed;
    if (shouldRun && !this.running) {
      this.running = true;
      this.lastTime = performance.now();
      this.raf = requestAnimationFrame(this.tick);
      this.video?.play().catch(() => undefined);
    } else if (!shouldRun && this.running) {
      this.running = false;
      cancelAnimationFrame(this.raf);
      this.video?.pause();
    }
  };

  private tick = (now: number) => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.tick);
    const realDt = Math.min((now - this.lastTime) / 1000, 0.25);
    const dt = Math.min(realDt, 1 / 30);
    this.lastTime = now;
    this.elapsed += dt;
    this.realDt = realDt;

    // Hold the intro until the Blender loop has a decoded frame (or give up and go procedural).
    if (this.introStart < 0) {
      const waited = now - this.createdAt;
      const hasVideo = !!this.video && !this.videoFailed;
      if (!hasVideo || this.videoReady || waited > VIDEO_WAIT_MS) {
        this.introStart = now;
        this.videoMix = this.videoReady ? 1 : 0;
        this.opts.onReady?.();
      }
    }
    this.render(dt, this.introStart < 0 ? -1 : (now - this.introStart) / 1000);
  };

  private render(dt: number, sinceStart: number) {
    const t = this.elapsed;
    const reduced = !!this.opts.reducedMotion;

    // Intro: the helix fades in from black while drifting into focus.
    const reveal = sinceStart < 0 ? 0 : easeOutCubic(THREE.MathUtils.clamp((sinceStart - 0.05) / 1.35, 0, 1));
    this.compositePass.uniforms.uReveal.value = reveal;
    this.dnaRoot.position.z = -FOCUS - (1 - reveal) * 3.5;

    // Crossfade from the procedural helix to the Blender render once it's decoded.
    const videoTarget = this.videoReady && !this.videoFailed ? 1 : 0;
    this.videoMix += (videoTarget - this.videoMix) * Math.min(1, this.realDt * 2.2);
    if (Math.abs(videoTarget - this.videoMix) < 0.002) this.videoMix = videoTarget;
    this.compositePass.uniforms.uVideoMix.value = this.videoMix;
    this.compositePass.uniforms.uHazeStrength.value = this.hazeTexture
      ? 0.6 * (0.88 + 0.12 * Math.sin(t * 0.55)) * Math.max(this.videoMix, 0.6)
      : 0;
    this.helixMat.uniforms.uIntensity.value = 1 - this.videoMix;
    this.helix.visible = this.videoMix < 0.999;
    this.videoTransform(1 + 0.05 * (1 - reveal));
    // The Blender render already carries a photographic bloom: only let the hottest beads
    // (and the light trails) bloom further once it is showing.
    this.bloomPass.strength = THREE.MathUtils.lerp(0.75, 0.42, this.videoMix);
    this.bloomPass.threshold = THREE.MathUtils.lerp(0.18, 0.62, this.videoMix);

    const spinSpeed = reduced ? 0.05 : 0.39; // matches the video: 180° per 8 s
    this.dnaSpin.rotation.y = t * spinSpeed;
    this.hazeSpin.rotation.y = t * spinSpeed * 0.6;
    // a gentle breathing drift so the shot never feels static
    this.dnaTilt.rotation.x = -0.42 + Math.sin(t * 0.25) * 0.025;
    this.stars.position.x = Math.sin(t * 0.05) * 0.6;

    for (const m of this.materials) m.uniforms.uTime.value = t;
    this.finalPass.uniforms.uTime.value = t;

    // Fluid
    if (!reduced) {
      const p = this.pointer;
      if (p.moved) {
        const f = this.fluid.config.splatForce;
        this.fluid.splat(p.x, p.y, p.dx * f, p.dy * f, this.trailColor());
        p.dx = 0;
        p.dy = 0;
        p.moved = false;
      }
      this.fluid.step(dt);
      this.compositePass.uniforms.uVelocity.value = this.fluid.velocityTexture;
      this.compositePass.uniforms.uDye.value = this.fluid.dyeTexture;
    }

    this.composer.render(dt);
  }

  dispose() {
    this.disposed = true;
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.intersectionObserver.disconnect();
    document.removeEventListener('visibilitychange', this.updateRunning);
    this.eventTarget.removeEventListener('pointermove', this.onPointerMove);
    this.eventTarget.removeEventListener('pointerdown', this.onPointerDown);
    if (this.video) {
      this.video.pause();
      this.video.removeAttribute('src');
      while (this.video.firstChild) this.video.firstChild.remove();
      this.video.load();
      this.video = null;
    }
    this.videoTexture?.dispose();
    this.hazeTexture?.dispose();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Points) o.geometry.dispose();
    });
    this.materials.forEach((m) => m.dispose());
    this.fluid.dispose();
    this.bloomPass.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
