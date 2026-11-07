import * as THREE from 'three';

/**
 * Procedural particle DNA double helix.
 *
 * Every particle is a point sprite. Size and opacity are driven by a thin-lens
 * depth-of-field model in the vertex shader, so particles far from the focal
 * plane grow into soft bokeh discs while keeping (roughly) the same energy.
 */

const TAU = Math.PI * 2;

export interface HelixOptions {
  radius: number;
  pitch: number; // rise per full turn
  length: number;
  tube: number; // backbone thickness
  rungsPerTurn: number;
  strandDensity: number; // particles per world unit of length (per strand)
  seed: number;
}

export const HELIX_DEFAULTS: HelixOptions = {
  radius: 1.95,
  pitch: 8.4,
  length: 40,
  tube: 0.3,
  rungsPerTurn: 10,
  strandDensity: 240,
  seed: 7,
};

// Small deterministic PRNG so every load looks identical.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class ParticleBuffer {
  positions: number[] = [];
  normals: number[] = [];
  rand: number[] = [];
  colorA: number[] = [];
  colorB: number[] = [];

  push(
    p: THREE.Vector3,
    n: THREE.Vector3,
    size: number,
    brightness: number,
    phase: number,
    twinkle: number,
    a: THREE.Color,
    b: THREE.Color = a,
  ) {
    this.positions.push(p.x, p.y, p.z);
    this.normals.push(n.x, n.y, n.z);
    this.rand.push(size, brightness, phase, twinkle);
    this.colorA.push(a.r, a.g, a.b);
    this.colorB.push(b.r, b.g, b.b);
  }

  toGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute('aNormal', new THREE.Float32BufferAttribute(this.normals, 3));
    g.setAttribute('aRand', new THREE.Float32BufferAttribute(this.rand, 4));
    g.setAttribute('aColorA', new THREE.Float32BufferAttribute(this.colorA, 3));
    g.setAttribute('aColorB', new THREE.Float32BufferAttribute(this.colorB, 3));
    g.computeBoundingSphere();
    return g;
  }
}

function helixFrame(y: number, phase: number, o: HelixOptions) {
  const k = TAU / o.pitch;
  const a = y * k + phase;
  const p = new THREE.Vector3(o.radius * Math.cos(a), y, o.radius * Math.sin(a));
  const t = new THREE.Vector3(-o.radius * k * Math.sin(a), 1, o.radius * k * Math.cos(a)).normalize();
  const n = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
  const b = new THREE.Vector3().crossVectors(t, n).normalize();
  return { p, t, n, b };
}

const tmpColor = new THREE.Color();
function lerpColor(a: THREE.Color, b: THREE.Color, t: number) {
  return tmpColor.copy(a).lerp(b, t).clone();
}

/** Main, in-focus helix: sparkly backbones, rungs and glowing green beads. */
export function buildHelixGeometry(opts: Partial<HelixOptions> = {}) {
  const o = { ...HELIX_DEFAULTS, ...opts };
  const rnd = mulberry32(o.seed);
  const buf = new ParticleBuffer();
  const half = o.length / 2;

  // Palette
  const deepGreen = new THREE.Color(0.035, 0.2, 0.09);
  const midGreen = new THREE.Color(0.09, 0.42, 0.2);
  const cream = new THREE.Color(1.0, 0.86, 0.6);
  const warmGold = new THREE.Color(1.0, 0.7, 0.36);
  const neon = new THREE.Color(0.22, 1.0, 0.38);
  const neonSoft = new THREE.Color(0.35, 1.0, 0.5);
  const rungCream = new THREE.Color(0.85, 0.82, 0.66);

  // ---------- Backbone strands ----------
  const perStrand = Math.round(o.length * o.strandDensity);
  for (let s = 0; s < 2; s++) {
    const phase = s * Math.PI;
    for (let i = 0; i < perStrand; i++) {
      const y = -half + rnd() * o.length;
      const f = helixFrame(y, phase, o);
      const phi = rnd() * TAU;
      const outer = rnd() < 0.07; // loose dust floating around the strand
      const r = outer ? o.tube * (1.05 + rnd() * 0.7) : o.tube * (0.55 + 0.45 * Math.sqrt(rnd()));
      const dir = f.n.clone().multiplyScalar(Math.cos(phi)).addScaledVector(f.b, Math.sin(phi));
      const p = f.p.clone().addScaledVector(dir, r);

      const sparkle = Math.pow(rnd(), 3.2);
      const size = (outer ? 0.022 : 0.03) + sparkle * 0.05;
      const brightness = (outer ? 0.35 : 0.55) + sparkle * 1.4;
      const shadow = lerpColor(deepGreen, midGreen, rnd());
      let lit = lerpColor(cream, warmGold, rnd() * 0.6);

      // A share of sparkles pick up the green glow of the beads.
      if (rnd() < 0.24) {
        lit = lerpColor(midGreen, neonSoft, 0.4 + rnd() * 0.6);
        shadow.lerp(neonSoft, 0.35);
      }
      buf.push(p, dir, size, brightness, rnd() * TAU, 0.25 + rnd() * 0.5, shadow, lit);
    }

    // Glowing green studs sitting on the backbone surface.
    const studs = Math.round(o.length * 9);
    for (let i = 0; i < studs; i++) {
      const y = -half + rnd() * o.length;
      const f = helixFrame(y, phase, o);
      const phi = rnd() * TAU;
      const dir = f.n.clone().multiplyScalar(Math.cos(phi)).addScaledVector(f.b, Math.sin(phi));
      const p = f.p.clone().addScaledVector(dir, o.tube * (0.85 + rnd() * 0.25));
      const size = 0.05 + Math.pow(rnd(), 2) * 0.1;
      buf.push(p, dir, size, 0.9 + rnd() * 1.1, rnd() * TAU, 0.3, neon, neonSoft);
    }
  }

  // ---------- Rungs (base pairs) ----------
  const rungStep = o.pitch / o.rungsPerTurn;
  const rungCount = Math.floor(o.length / rungStep);
  const zero = new THREE.Vector3(0, 0, 0);
  for (let j = 0; j <= rungCount; j++) {
    const y = -half + j * rungStep + (rnd() - 0.5) * 0.06;
    const a = helixFrame(y, 0, o).p;
    const b = helixFrame(y, Math.PI, o).p;
    const axis = new THREE.Vector3().subVectors(b, a);
    const len = axis.length();
    axis.normalize();
    const side = new THREE.Vector3(0, 1, 0).cross(axis).normalize();
    const up = new THREE.Vector3().crossVectors(axis, side).normalize();
    const t0 = (o.tube * 0.6) / len;

    // fine particle rod
    const rodCount = 150;
    for (let i = 0; i < rodCount; i++) {
      const t = t0 + rnd() * (1 - 2 * t0);
      const phi = rnd() * TAU;
      const rr = 0.05 * Math.sqrt(rnd());
      const p = a
        .clone()
        .addScaledVector(axis, t * len)
        .addScaledVector(side, Math.cos(phi) * rr)
        .addScaledVector(up, Math.sin(phi) * rr);
      const sparkle = Math.pow(rnd(), 3);
      const greenish = rnd() < 0.45;
      const c = greenish ? lerpColor(midGreen, neonSoft, rnd()) : lerpColor(rungCream, cream, rnd());
      buf.push(p, zero, 0.022 + sparkle * 0.04, 0.45 + sparkle * 1.2, rnd() * TAU, 0.4, c);
    }

    // glowing beads along the rung
    const beads = 2 + Math.floor(rnd() * 5);
    for (let i = 0; i < beads; i++) {
      // bias towards the rung ends, like the reference
      let t = rnd();
      t = rnd() < 0.55 ? (t < 0.5 ? t * 0.4 : 1 - (1 - t) * 0.4) : t;
      t = t0 + t * (1 - 2 * t0);
      const p = a
        .clone()
        .addScaledVector(axis, t * len)
        .addScaledVector(side, (rnd() - 0.5) * 0.06)
        .addScaledVector(up, (rnd() - 0.5) * 0.06);
      const size = 0.06 + Math.pow(rnd(), 1.6) * 0.13;
      buf.push(p, zero, size, 1.1 + rnd() * 1.2, rnd() * TAU, 0.25, neon);
    }
  }

  return buf.toGeometry();
}

/** Distant, heavily defocused helix that gives the dark green haze behind the hero DNA. */
export function buildHazeGeometry(seed = 21) {
  const o: HelixOptions = { ...HELIX_DEFAULTS, radius: 2.6, pitch: 11, length: 46, tube: 0.5, seed };
  const rnd = mulberry32(seed);
  const buf = new ParticleBuffer();
  const half = o.length / 2;
  const green = new THREE.Color(0.06, 0.36, 0.16);
  const green2 = new THREE.Color(0.12, 0.5, 0.24);
  const zero = new THREE.Vector3();
  for (let s = 0; s < 2; s++) {
    for (let i = 0; i < 260; i++) {
      const y = -half + rnd() * o.length;
      const f = helixFrame(y, s * Math.PI, o);
      const p = f.p.clone().add(new THREE.Vector3((rnd() - 0.5) * 0.6, (rnd() - 0.5) * 0.6, (rnd() - 0.5) * 0.6));
      buf.push(p, zero, 0.25 + rnd() * 0.25, 0.45 + rnd() * 0.5, rnd() * TAU, 0.1, lerpColor(green, green2, rnd()));
    }
  }
  // a few rungs worth of blobs
  for (let y = -half; y < half; y += o.pitch / 6) {
    const a = helixFrame(y, 0, o).p;
    const b = helixFrame(y, Math.PI, o).p;
    for (let i = 0; i < 6; i++) {
      const p = a.clone().lerp(b, rnd());
      buf.push(p, zero, 0.18 + rnd() * 0.2, 0.35 + rnd() * 0.4, rnd() * TAU, 0.1, green2);
    }
  }
  return buf.toGeometry();
}

/** Static dust / starfield spread across the whole hero. */
export function buildStarGeometry(count: number, width: number, height: number, z: number, seed = 3) {
  const rnd = mulberry32(seed);
  const buf = new ParticleBuffer();
  const zero = new THREE.Vector3();
  const tint = new THREE.Color(0.86, 0.95, 0.84);
  const warm = new THREE.Color(1.0, 0.92, 0.78);
  for (let i = 0; i < count; i++) {
    const p = new THREE.Vector3((rnd() - 0.5) * width, (rnd() - 0.5) * height, z + (rnd() - 0.5) * 6);
    const big = Math.pow(rnd(), 6);
    buf.push(p, zero, 0.05 + big * 0.12, 0.25 + rnd() * 0.55 + big, rnd() * TAU, 0.6, rnd() < 0.3 ? warm : tint);
  }
  return buf.toGeometry();
}

const particleVertex = /* glsl */ `
  uniform float uTime;
  uniform float uViewportH;
  uniform float uFocus;
  uniform float uAperture;
  uniform float uMaxSize;
  uniform float uMinSize;
  uniform float uIntensity;
  uniform float uBokehBoost;
  uniform vec3 uLightDir;

  attribute vec3 aNormal;
  attribute vec4 aRand;
  attribute vec3 aColorA;
  attribute vec3 aColorB;

  varying vec3 vColor;
  varying float vSoft;

  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    float depth = max(-mvPosition.z, 0.1);
    float proj = projectionMatrix[1][1] * uViewportH * 0.5;

    // Lighting: particles facing the key light pick up the warm cream colour.
    float lit = 0.5;
    float nl = length(aNormal);
    if (nl > 0.001) {
      vec3 nW = normalize(mat3(modelMatrix) * aNormal);
      lit = smoothstep(0.15, 0.95, dot(nW, uLightDir) * 0.5 + 0.5);
    }
    vec3 col = mix(aColorA, aColorB, lit);

    float tw = 1.0 + aRand.w * sin(uTime * (1.2 + aRand.z * 0.35) + aRand.z * 6.2831);

    // Thin-lens depth of field
    float sizePx = aRand.x * proj / depth;
    float coc = uAperture * abs(depth - uFocus) / depth * proj;
    float size = sqrt(sizePx * sizePx + coc * coc);
    size = clamp(size, uMinSize, uMaxSize);
    float energy = (sizePx * sizePx) / (size * size);
    energy = pow(energy, uBokehBoost);

    vSoft = clamp(coc / max(size, 0.001) * 1.4 - 0.25, 0.0, 1.0);
    vColor = col * aRand.y * tw * energy * uIntensity;

    gl_PointSize = size;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const particleFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vSoft;

  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float d2 = dot(c, c);
    if (d2 > 1.0) discard;
    float d = sqrt(d2);
    float sharp = exp(-d2 * 4.0);
    // bokeh disc with a slightly brighter rim
    float disc = smoothstep(1.0, 0.72, d) * (0.75 + 0.35 * smoothstep(0.35, 0.92, d)) * 0.45;
    float a = mix(sharp, disc, vSoft);
    gl_FragColor = vec4(vColor * a, 1.0);
  }
`;

export interface ParticleUniforms {
  [key: string]: THREE.IUniform;
  uTime: THREE.IUniform<number>;
  uViewportH: THREE.IUniform<number>;
  uFocus: THREE.IUniform<number>;
  uAperture: THREE.IUniform<number>;
  uMaxSize: THREE.IUniform<number>;
  uMinSize: THREE.IUniform<number>;
  uIntensity: THREE.IUniform<number>;
  uBokehBoost: THREE.IUniform<number>;
  uLightDir: THREE.IUniform<THREE.Vector3>;
}

export function createParticleMaterial(overrides: Partial<Record<keyof ParticleUniforms, unknown>> = {}) {
  const uniforms: ParticleUniforms = {
    uTime: { value: 0 },
    uViewportH: { value: 1000 },
    uFocus: { value: 24 },
    uAperture: { value: 0.06 },
    uMaxSize: { value: 64 },
    uMinSize: { value: 1.2 },
    uIntensity: { value: 1 },
    uBokehBoost: { value: 0.85 },
    uLightDir: { value: new THREE.Vector3(0.55, -0.65, 0.5).normalize() },
  };
  for (const [k, v] of Object.entries(overrides)) {
    if (uniforms[k]) uniforms[k].value = v;
  }
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: particleVertex,
    fragmentShader: particleFragment,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}
