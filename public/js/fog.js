// Volumetric fog: a ray march through the depth buffer.
// Density comes from a tiling 3D noise that drifts with the wind, so the fog rolls in clumps
// and lies thicker near the ground. Street lamps and entrance bulbs scatter in it.
// Past FOG_RANGE the cheaper per-material haze (applyFog in materials.js) takes over.

import * as THREE from 'three';
import { U, COMMON } from './materials.js';

export const FOG_RANGE = 70;   // meters marched per pixel
const STEPS = 22;

const QUAD_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const MARCH_FRAG = /* glsl */`
precision highp sampler3D;
${COMMON}
uniform sampler2D tDepth;
uniform sampler3D tNoise;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uDrift;     // wind offset accumulated over time
uniform float uVolDensity;
uniform float uRange;
uniform float uFrame;
varying vec2 vUv;

float density(vec3 p) {
  vec3 q = (p - uDrift) * 0.022;
  float n = texture(tNoise, q).r * 0.62 + texture(tNoise, q * 2.9 + vec3(0.37, 0.11, 0.71) - vec3(0.0, uTime * 0.004, 0.0)).r * 0.38;
  float h = max(p.y, 0.0);
  float ground = exp(-h / 8.0);
  float layer = 0.3 + 0.7 * ground + 0.25 * smoothstep(15.0, 60.0, h);
  float clumps = smoothstep(0.3, 0.75, n);
  return uVolDensity * layer * (0.12 + 2.3 * clumps * clumps);
}

void main() {
  float depth = texture2D(tDepth, vUv).r;
  vec4 v = uInvProj * vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  v /= v.w;
  vec3 wp = (uCamWorld * v).xyz;
  vec3 ray = wp - uCamPos;
  float dist = depth >= 0.99999 ? 1e6 : length(ray);
  vec3 dir = normalize(ray);
  float len = min(dist, uRange);
  float stepLen = len / float(${STEPS});
  // interleaved gradient noise, moving every frame: hides the step banding
  float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy + uFrame * 5.588238, vec2(0.06711056, 0.00583715))));
  float T = 1.0;
  vec3 S = vec3(0.0);
  // sky light inside the fog
  vec3 ambientFog = mix(uSkyHor, uMist, 0.35) * 0.72;
  for (int i = 0; i < ${STEPS}; i++) {
    float t = (float(i) + jitter) * stepLen;
    vec3 p = uCamPos + dir * t;
    float d = density(p);
    if (d < 1e-4) continue;
    // light reaching this bit of fog: sky light plus nearby street lamps, brighter toward the light
    // lamp light is squared so it stays a halo around each lamp instead of tinting the whole street
    vec3 lamp = lampLight(p, dir);
    // whiter mist low over the street
    vec3 sky = mix(uMist * 0.8, ambientFog, smoothstep(0.0, 12.0, p.y));
    vec3 light = sky * (0.8 + 0.3 * smoothstep(0.0, 25.0, p.y)) + lamp * lamp * 0.55;
    float a = 1.0 - exp(-d * stepLen);
    S += T * a * light;
    T *= 1.0 - a;
    if (T < 0.01) break;
  }
  gl_FragColor = vec4(S, T);
}`;

// Composite fog over the scene. The snow is drawn on top of it afterwards (post.js).
const COMPOSITE_FRAG = /* glsl */`
${COMMON}
uniform sampler2D tScene;
uniform sampler2D tFog;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tScene, vUv).rgb;
  vec4 f = texture2D(tFog, vUv);
  c = c * f.a + f.rgb;
  gl_FragColor = vec4(c, 1.0);
}`;

// 64^3 tiling fbm value noise, built once
function makeNoise3D(N = 64) {
  const data = new Uint8Array(N * N * N);
  let seed = 1234567;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const octaves = [[4, 0.5], [8, 0.3], [16, 0.2]].map(([L, w]) => {
    const g = new Float32Array(L * L * L);
    for (let i = 0; i < g.length; i++) g[i] = rnd();
    return { L, w, g };
  });
  const sm = (t) => t * t * (3 - 2 * t);
  let k = 0;
  for (let z = 0; z < N; z++) {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        let v = 0;
        for (const { L, w, g } of octaves) {
          const s = L / N;
          const fx = x * s, fy = y * s, fz = z * s;
          const x0 = Math.floor(fx), y0 = Math.floor(fy), z0 = Math.floor(fz);
          const tx = sm(fx - x0), ty = sm(fy - y0), tz = sm(fz - z0);
          const at = (i, j, l) => g[((i % L) + L) % L + (((j % L) + L) % L) * L + (((l % L) + L) % L) * L * L];
          const c00 = at(x0, y0, z0) + (at(x0 + 1, y0, z0) - at(x0, y0, z0)) * tx;
          const c10 = at(x0, y0 + 1, z0) + (at(x0 + 1, y0 + 1, z0) - at(x0, y0 + 1, z0)) * tx;
          const c01 = at(x0, y0, z0 + 1) + (at(x0 + 1, y0, z0 + 1) - at(x0, y0, z0 + 1)) * tx;
          const c11 = at(x0, y0 + 1, z0 + 1) + (at(x0 + 1, y0 + 1, z0 + 1) - at(x0, y0 + 1, z0 + 1)) * tx;
          const c0 = c00 + (c10 - c00) * ty, c1 = c01 + (c11 - c01) * ty;
          v += (c0 + (c1 - c0) * tz) * w;
        }
        data[k++] = Math.round(v * 255);
      }
    }
  }
  const tex = new THREE.Data3DTexture(data, N, N, N);
  tex.format = THREE.RedFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

export class VolumetricFog {
  constructor() {
    this.noise = makeNoise3D();
    const lin = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, type: THREE.HalfFloatType };
    this.rtFog = new THREE.WebGLRenderTarget(4, 4, lin);
    this.rtComp = new THREE.WebGLRenderTarget(4, 4, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, type: THREE.HalfFloatType });
    this.uDrift = { value: new THREE.Vector3() };
    this.uDensity = { value: 0.035 };
    this.frame = 0;
    this.march = new THREE.ShaderMaterial({
      uniforms: {
        ...U,
        tDepth: { value: null }, tNoise: { value: this.noise },
        uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() },
        uDrift: this.uDrift, uVolDensity: this.uDensity, uRange: { value: FOG_RANGE }, uFrame: { value: 0 },
      },
      vertexShader: QUAD_VERT,
      fragmentShader: MARCH_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.composite = new THREE.ShaderMaterial({
      uniforms: {
        ...U, tScene: { value: null }, tFog: { value: this.rtFog.texture },
      },
      vertexShader: QUAD_VERT,
      fragmentShader: COMPOSITE_FRAG,
      depthTest: false,
      depthWrite: false,
    });
  }

  // the fog drifts with the wind and slowly rises
  drift(dt, wind, gust) {
    const v = 0.9 + gust * 1.2;
    this.uDrift.value.x += wind.x * v * dt;
    this.uDrift.value.z += wind.y * v * dt;
    this.uDrift.value.y += 0.12 * dt;
  }

  setSize(w, h) {
    // fog is smooth, half resolution is plenty
    this.rtFog.setSize(Math.max(1, Math.ceil(w / 2)), Math.max(1, Math.ceil(h / 2)));
    this.rtComp.setSize(w, h);
  }

  // returns the texture with fog applied
  render(post, rtScene, camera) {
    const u = this.march.uniforms;
    u.tDepth.value = rtScene.depthTexture;
    u.uInvProj.value.copy(camera.projectionMatrixInverse);
    u.uCamWorld.value.copy(camera.matrixWorld);
    u.uFrame.value = (this.frame = (this.frame + 1) % 64);
    post.pass(this.march, this.rtFog);
    const cu = this.composite.uniforms;
    cu.tScene.value = rtScene.texture;
    post.pass(this.composite, this.rtComp);
    return this.rtComp.texture;
  }
}
