import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

/**
 * Stable-fluids style GPU simulation (advection → curl/vorticity → divergence →
 * pressure solve → gradient subtraction) running on half-float render targets.
 *
 * The simulation exposes two textures that the hero compositor consumes:
 *  - `velocity` (RG): used to displace / warp the DNA render
 *  - `dye`      (RGB): the glowing light trails drawn on top
 */

export interface FluidConfig {
  simResolution: number;
  dyeResolution: number;
  densityDissipation: number;
  velocityDissipation: number;
  pressure: number;
  pressureIterations: number;
  curl: number;
  splatRadius: number;
  splatForce: number;
}

export const DEFAULT_FLUID_CONFIG: FluidConfig = {
  simResolution: 128,
  dyeResolution: 768,
  densityDissipation: 2.6,
  velocityDissipation: 1.6,
  pressure: 0.12,
  pressureIterations: 20,
  curl: 4,
  splatRadius: 0.24,
  splatForce: 6000,
};

const baseVertex = /* glsl */ `
  precision highp float;
  uniform vec2 texelSize;
  varying vec2 vUv;
  varying vec2 vL;
  varying vec2 vR;
  varying vec2 vT;
  varying vec2 vB;
  void main () {
    vUv = uv;
    vL = vUv - vec2(texelSize.x, 0.0);
    vR = vUv + vec2(texelSize.x, 0.0);
    vT = vUv + vec2(0.0, texelSize.y);
    vB = vUv - vec2(0.0, texelSize.y);
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const splatFrag = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uTarget;
  uniform float aspectRatio;
  uniform vec3 color;
  uniform vec2 point;
  uniform float radius;
  void main () {
    vec2 p = vUv - point;
    p.x *= aspectRatio;
    vec3 splat = exp(-dot(p, p) / radius) * color;
    vec3 base = texture2D(uTarget, vUv).xyz;
    gl_FragColor = vec4(base + splat, 1.0);
  }
`;

const advectionFrag = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uVelocity;
  uniform sampler2D uSource;
  uniform vec2 velTexelSize;
  uniform float dt;
  uniform float dissipation;
  void main () {
    vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * velTexelSize;
    vec4 result = texture2D(uSource, coord);
    float decay = 1.0 + dissipation * dt;
    gl_FragColor = result / decay;
  }
`;

const divergenceFrag = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  varying vec2 vL;
  varying vec2 vR;
  varying vec2 vT;
  varying vec2 vB;
  uniform sampler2D uVelocity;
  void main () {
    float L = texture2D(uVelocity, vL).x;
    float R = texture2D(uVelocity, vR).x;
    float T = texture2D(uVelocity, vT).y;
    float B = texture2D(uVelocity, vB).y;
    vec2 C = texture2D(uVelocity, vUv).xy;
    if (vL.x < 0.0) { L = -C.x; }
    if (vR.x > 1.0) { R = -C.x; }
    if (vT.y > 1.0) { T = -C.y; }
    if (vB.y < 0.0) { B = -C.y; }
    float div = 0.5 * (R - L + T - B);
    gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
  }
`;

const curlFrag = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  varying vec2 vL;
  varying vec2 vR;
  varying vec2 vT;
  varying vec2 vB;
  uniform sampler2D uVelocity;
  void main () {
    float L = texture2D(uVelocity, vL).y;
    float R = texture2D(uVelocity, vR).y;
    float T = texture2D(uVelocity, vT).x;
    float B = texture2D(uVelocity, vB).x;
    float vorticity = R - L - T + B;
    gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
  }
`;

const vorticityFrag = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  varying vec2 vL;
  varying vec2 vR;
  varying vec2 vT;
  varying vec2 vB;
  uniform sampler2D uVelocity;
  uniform sampler2D uCurl;
  uniform float curl;
  uniform float dt;
  void main () {
    float L = texture2D(uCurl, vL).x;
    float R = texture2D(uCurl, vR).x;
    float T = texture2D(uCurl, vT).x;
    float B = texture2D(uCurl, vB).x;
    float C = texture2D(uCurl, vUv).x;
    vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
    force /= length(force) + 0.0001;
    force *= curl * C;
    force.y *= -1.0;
    vec2 velocity = texture2D(uVelocity, vUv).xy;
    velocity += force * dt;
    velocity = min(max(velocity, -1000.0), 1000.0);
    gl_FragColor = vec4(velocity, 0.0, 1.0);
  }
`;

const pressureFrag = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  varying vec2 vL;
  varying vec2 vR;
  varying vec2 vT;
  varying vec2 vB;
  uniform sampler2D uPressure;
  uniform sampler2D uDivergence;
  void main () {
    float L = texture2D(uPressure, vL).x;
    float R = texture2D(uPressure, vR).x;
    float T = texture2D(uPressure, vT).x;
    float B = texture2D(uPressure, vB).x;
    float divergence = texture2D(uDivergence, vUv).x;
    float pressure = (L + R + B + T - divergence) * 0.25;
    gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
  }
`;

const gradientSubtractFrag = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  varying vec2 vL;
  varying vec2 vR;
  varying vec2 vT;
  varying vec2 vB;
  uniform sampler2D uPressure;
  uniform sampler2D uVelocity;
  void main () {
    float L = texture2D(uPressure, vL).x;
    float R = texture2D(uPressure, vR).x;
    float T = texture2D(uPressure, vT).x;
    float B = texture2D(uPressure, vB).x;
    vec2 velocity = texture2D(uVelocity, vUv).xy;
    velocity.xy -= vec2(R - L, T - B);
    gl_FragColor = vec4(velocity, 0.0, 1.0);
  }
`;

const clearFrag = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uTexture;
  uniform float value;
  void main () {
    gl_FragColor = value * texture2D(uTexture, vUv);
  }
`;

class DoubleTarget {
  read: THREE.WebGLRenderTarget;
  write: THREE.WebGLRenderTarget;

  constructor(w: number, h: number, opts: THREE.RenderTargetOptions) {
    this.read = new THREE.WebGLRenderTarget(w, h, opts);
    this.write = new THREE.WebGLRenderTarget(w, h, opts);
  }

  swap() {
    const t = this.read;
    this.read = this.write;
    this.write = t;
  }

  setSize(w: number, h: number) {
    this.read.setSize(w, h);
    this.write.setSize(w, h);
  }

  dispose() {
    this.read.dispose();
    this.write.dispose();
  }
}

function makeMaterial(fragmentShader: string, uniforms: Record<string, THREE.IUniform>) {
  return new THREE.ShaderMaterial({
    vertexShader: baseVertex,
    fragmentShader,
    uniforms: { texelSize: { value: new THREE.Vector2() }, ...uniforms },
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
  });
}

export class FluidSimulation {
  readonly config: FluidConfig;
  private renderer: THREE.WebGLRenderer;
  private quad = new FullScreenQuad();

  private velocity: DoubleTarget;
  private dye: DoubleTarget;
  private pressure: DoubleTarget;
  private divergence: THREE.WebGLRenderTarget;
  private curlTarget: THREE.WebGLRenderTarget;

  private simSize = new THREE.Vector2();
  private dyeSize = new THREE.Vector2();
  private aspect = 1;

  private splatMat = makeMaterial(splatFrag, {
    uTarget: { value: null },
    aspectRatio: { value: 1 },
    color: { value: new THREE.Vector3() },
    point: { value: new THREE.Vector2() },
    radius: { value: 0.01 },
  });
  private advectionMat = makeMaterial(advectionFrag, {
    uVelocity: { value: null },
    uSource: { value: null },
    velTexelSize: { value: new THREE.Vector2() },
    dt: { value: 0 },
    dissipation: { value: 0 },
  });
  private divergenceMat = makeMaterial(divergenceFrag, { uVelocity: { value: null } });
  private curlMat = makeMaterial(curlFrag, { uVelocity: { value: null } });
  private vorticityMat = makeMaterial(vorticityFrag, {
    uVelocity: { value: null },
    uCurl: { value: null },
    curl: { value: 0 },
    dt: { value: 0 },
  });
  private pressureMat = makeMaterial(pressureFrag, {
    uPressure: { value: null },
    uDivergence: { value: null },
  });
  private gradientMat = makeMaterial(gradientSubtractFrag, {
    uPressure: { value: null },
    uVelocity: { value: null },
  });
  private clearMat = makeMaterial(clearFrag, { uTexture: { value: null }, value: { value: 0 } });

  constructor(renderer: THREE.WebGLRenderer, width: number, height: number, config: Partial<FluidConfig> = {}) {
    this.renderer = renderer;
    this.config = { ...DEFAULT_FLUID_CONFIG, ...config };

    const opts: THREE.RenderTargetOptions = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
    };
    const nearest: THREE.RenderTargetOptions = { ...opts, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter };

    this.computeSizes(width, height);
    this.velocity = new DoubleTarget(this.simSize.x, this.simSize.y, opts);
    this.dye = new DoubleTarget(this.dyeSize.x, this.dyeSize.y, opts);
    this.pressure = new DoubleTarget(this.simSize.x, this.simSize.y, nearest);
    this.divergence = new THREE.WebGLRenderTarget(this.simSize.x, this.simSize.y, nearest);
    this.curlTarget = new THREE.WebGLRenderTarget(this.simSize.x, this.simSize.y, nearest);
  }

  get velocityTexture() {
    return this.velocity.read.texture;
  }

  get dyeTexture() {
    return this.dye.read.texture;
  }

  get simTexelSize() {
    return new THREE.Vector2(1 / this.simSize.x, 1 / this.simSize.y);
  }

  private computeSizes(width: number, height: number) {
    this.aspect = width / Math.max(height, 1);
    const res = (r: number) => {
      const ar = this.aspect < 1 ? 1 / this.aspect : this.aspect;
      const min = Math.round(r);
      const max = Math.round(r * ar);
      return width > height ? new THREE.Vector2(max, min) : new THREE.Vector2(min, max);
    };
    this.simSize.copy(res(this.config.simResolution));
    this.dyeSize.copy(res(this.config.dyeResolution));
  }

  resize(width: number, height: number) {
    this.computeSizes(width, height);
    // Resizing clears the content, which is fine for a transient effect.
    this.velocity.setSize(this.simSize.x, this.simSize.y);
    this.dye.setSize(this.dyeSize.x, this.dyeSize.y);
    this.pressure.setSize(this.simSize.x, this.simSize.y);
    this.divergence.setSize(this.simSize.x, this.simSize.y);
    this.curlTarget.setSize(this.simSize.x, this.simSize.y);
  }

  private blit(material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget, texel: THREE.Vector2) {
    (material.uniforms.texelSize.value as THREE.Vector2).copy(texel);
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.quad.render(this.renderer);
  }

  /** Inject velocity + dye. `x`/`y` are UV coords (0..1, y up), `dx`/`dy` are forces. */
  splat(x: number, y: number, dx: number, dy: number, color: THREE.Color | THREE.Vector3) {
    const simTexel = new THREE.Vector2(1 / this.simSize.x, 1 / this.simSize.y);
    const dyeTexel = new THREE.Vector2(1 / this.dyeSize.x, 1 / this.dyeSize.y);
    const u = this.splatMat.uniforms;
    u.aspectRatio.value = this.aspect;
    (u.point.value as THREE.Vector2).set(x, y);
    let radius = this.config.splatRadius / 100;
    if (this.aspect > 1) radius *= this.aspect;
    u.radius.value = radius;

    u.uTarget.value = this.velocity.read.texture;
    (u.color.value as THREE.Vector3).set(dx, dy, 0);
    this.blit(this.splatMat, this.velocity.write, simTexel);
    this.velocity.swap();

    u.uTarget.value = this.dye.read.texture;
    if (color instanceof THREE.Color) (u.color.value as THREE.Vector3).set(color.r, color.g, color.b);
    else (u.color.value as THREE.Vector3).copy(color);
    this.blit(this.splatMat, this.dye.write, dyeTexel);
    this.dye.swap();
  }

  step(dt: number) {
    const c = this.config;
    const simTexel = new THREE.Vector2(1 / this.simSize.x, 1 / this.simSize.y);
    const dyeTexel = new THREE.Vector2(1 / this.dyeSize.x, 1 / this.dyeSize.y);

    // curl
    this.curlMat.uniforms.uVelocity.value = this.velocity.read.texture;
    this.blit(this.curlMat, this.curlTarget, simTexel);

    // vorticity confinement
    const vu = this.vorticityMat.uniforms;
    vu.uVelocity.value = this.velocity.read.texture;
    vu.uCurl.value = this.curlTarget.texture;
    vu.curl.value = c.curl;
    vu.dt.value = dt;
    this.blit(this.vorticityMat, this.velocity.write, simTexel);
    this.velocity.swap();

    // divergence
    this.divergenceMat.uniforms.uVelocity.value = this.velocity.read.texture;
    this.blit(this.divergenceMat, this.divergence, simTexel);

    // fade previous pressure
    this.clearMat.uniforms.uTexture.value = this.pressure.read.texture;
    this.clearMat.uniforms.value.value = c.pressure;
    this.blit(this.clearMat, this.pressure.write, simTexel);
    this.pressure.swap();

    // jacobi pressure solve
    this.pressureMat.uniforms.uDivergence.value = this.divergence.texture;
    for (let i = 0; i < c.pressureIterations; i++) {
      this.pressureMat.uniforms.uPressure.value = this.pressure.read.texture;
      this.blit(this.pressureMat, this.pressure.write, simTexel);
      this.pressure.swap();
    }

    // subtract gradient
    this.gradientMat.uniforms.uPressure.value = this.pressure.read.texture;
    this.gradientMat.uniforms.uVelocity.value = this.velocity.read.texture;
    this.blit(this.gradientMat, this.velocity.write, simTexel);
    this.velocity.swap();

    // advect velocity
    const au = this.advectionMat.uniforms;
    (au.velTexelSize.value as THREE.Vector2).copy(simTexel);
    au.dt.value = dt;
    au.uVelocity.value = this.velocity.read.texture;
    au.uSource.value = this.velocity.read.texture;
    au.dissipation.value = c.velocityDissipation;
    this.blit(this.advectionMat, this.velocity.write, simTexel);
    this.velocity.swap();

    // advect dye
    au.uVelocity.value = this.velocity.read.texture;
    au.uSource.value = this.dye.read.texture;
    au.dissipation.value = c.densityDissipation;
    this.blit(this.advectionMat, this.dye.write, dyeTexel);
    this.dye.swap();

    this.renderer.setRenderTarget(null);
  }

  dispose() {
    this.velocity.dispose();
    this.dye.dispose();
    this.pressure.dispose();
    this.divergence.dispose();
    this.curlTarget.dispose();
    this.quad.dispose();
    [
      this.splatMat,
      this.advectionMat,
      this.divergenceMat,
      this.curlMat,
      this.vorticityMat,
      this.pressureMat,
      this.gradientMat,
      this.clearMat,
    ].forEach((m) => m.dispose());
  }
}
