// Falling snow, all on the GPU and all in 3D: flakes in boxes that wrap
// around the camera, positions computed from time and a per-flake seed. Pixel flakes in the spirit
// of Minecraft: crisp squares far away, little pixel-art crystals close to the camera. The snow is
// meant to stay in the background: the flakes are see-through, fall almost straight down with a
// slow gentle sway, drift a little with a breeze that turns over tens of seconds, and only glint
// softly in the lamps. Three layers (near, middle, far) give depth and parallax when you walk or turn.

import * as THREE from 'three';
import { U, COMMON, WEATHER_GLSL, WEATHER_LAYER } from './materials.js';

const LAYERS = [
  { count: 14000, box: [26, 22, 26], fade: [1.2, 2.6, 9.0, 12.5] },
  { count: 16000, box: [60, 40, 60], fade: [9.0, 12.5, 21.0, 28.0] },
  { count: 18000, box: [120, 60, 120], fade: [21.0, 28.0, 44.0, 58.0] },
];
// the breeze: a slow drift whose direction follows the wind of fx.js over about 20 s
const BREEZE = 0.3;   // m/s

const VERT = /* glsl */`
${COMMON}
attribute vec4 aSeed;
uniform vec2 uWindOff;   // integrated wind drift, m (the CPU adds wind * dt every frame)
uniform float uPxScale;
uniform vec3 uBox;
uniform vec4 uFade;
varying float vA;
varying vec3 vWP;
varying float vPx;
varying vec2 vUv;
varying float vKind;
void main() {
  float fall = 0.7 + aSeed.w * 0.8;
  vec3 drift = vec3(uWindOff.x, 0.0, uWindOff.y) * (0.8 + aSeed.w * 0.6);
  vec3 p = aSeed.xyz * uBox + drift - vec3(0.0, fall * uTime, 0.0);
  // sway: every flake drifts slowly on its own small circle
  float ph = aSeed.x * 61.0 + aSeed.z * 17.0;
  p.x += sin(uTime * (0.25 + aSeed.y * 0.3) + ph) * 0.12;
  p.z += cos(uTime * (0.2 + aSeed.x * 0.3) + ph * 1.3) * 0.12;
  vec3 rel = mod(p - uCamPos + uBox * 0.5, uBox) - uBox * 0.5;
  vec3 wp = uCamPos + rel;
  float shown = step(fract(aSeed.w * 7.31 + aSeed.x * 3.7), uSnow);
  float d = length(rel);
  vA = shown * smoothstep(uFade.x, uFade.y, d) * (1.0 - smoothstep(uFade.z, uFade.w, d));
  if (wp.y < 0.0 || insideLoaded(wp)) vA = 0.0;
  vWP = wp;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  float depth = max(0.05, -mv.z);
  float size = 0.035 + aSeed.y * 0.045;
  // size in game pixels, whole pixels only so the flakes stay crisp; at least one pixel
  float px = clamp(floor(size * uPxScale / depth + 0.5), 1.0, 6.0);
  vPx = px;
  vKind = floor(aSeed.z * 3.0);
  vUv = position.xy + 0.5;
  vec4 clip = projectionMatrix * mv;
  if (clip.w < 0.05) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
  // a square of exactly px game pixels, snapped to the pixel grid
  vec2 res = vec2(projectionMatrix[1][1] / projectionMatrix[0][0], 1.0) * (2.0 * uPxScale / projectionMatrix[1][1]);
  vec2 pc = (clip.xy / clip.w * 0.5 + 0.5) * res;
  pc = floor(pc - px * 0.5 + 0.5) + px * 0.5 + position.xy * px;
  clip.xy = ((pc / res) * 2.0 - 1.0) * clip.w;
  gl_Position = clip;
}`;

const FRAG = /* glsl */`
${COMMON}
${WEATHER_GLSL}
varying float vA;
varying vec3 vWP;
varying float vPx;
varying vec2 vUv;
varying float vKind;
// 5 x 5 pixel crystals, one row per 5 bits
const int STAR[5] = int[5](4, 10, 21, 10, 4);
const int CROSS[5] = int[5](0, 4, 14, 4, 0);
const int DIAG[5] = int[5](17, 10, 4, 10, 17);
void main() {
  if (vA < 0.01 || hiddenByScene()) discard;
  float a = fogKeep(vWP);
  if (vPx >= 6.0) {
    ivec2 c = ivec2(clamp(floor(vUv * 5.0), 0.0, 4.0));
    int row = vKind < 1.0 ? STAR[c.y] : vKind < 2.0 ? CROSS[c.y] : DIAG[c.y];
    if (((row >> c.x) & 1) == 0) discard;
  } else if (vPx >= 3.0) {
    // small plus: the corners are empty
    vec2 q = abs(vUv - 0.5) * 2.0;
    if (q.x > 0.4 && q.y > 0.4) discard;
  }
  vec3 lamp = lampLight(vWP, normalize(uCamPos - vWP));
  // pale flakes in the color of the air, a soft glint in the lamp light
  vec3 c = uSnowCol * 0.45 + uMist * 0.55 + lamp * 0.9;
  c = applyFog(c, vWP, 1.0);
  gl_FragColor = vec4(c, vA * a * 0.5);
}`;

export class Snow {
  constructor(scene) {
    this.uWindVel = new THREE.Vector2();
    this.uWindOff = { value: new THREE.Vector2() };
    this.uPx = { value: 400 };
    this.meshes = LAYERS.map((L) => {
      const g = new THREE.InstancedBufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
      g.setIndex([0, 1, 2, 0, 2, 3]);
      const seed = new Float32Array(L.count * 4);
      for (let i = 0; i < seed.length; i++) seed[i] = Math.random();
      g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
      g.instanceCount = L.count;
      const m = new THREE.Mesh(g, new THREE.ShaderMaterial({
        uniforms: {
          ...U, uWindOff: this.uWindOff, uPxScale: this.uPx,
          uBox: { value: new THREE.Vector3(...L.box) }, uFade: { value: new THREE.Vector4(...L.fade) },
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        depthTest: false,
      }));
      m.frustumCulled = false;
      m.renderOrder = 6;
      m.visible = false;
      m.layers.set(WEATHER_LAYER);
      scene.add(m);
      return m;
    });
  }

  setPixelScale(h, fov) {
    this.uPx.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
  }

  // intensity itself comes from the shared uSnow uniform (set in main.js)
  update(intensity, wind, gust, dt) {
    // the same gentle breeze in any snowfall, gusts ignored; eased over ~20 s and integrated, so
    // the flakes never lean sideways or swing back and forth when the wind turns
    const w = this.uWindVel;
    const k = Math.min(1, dt / 20);
    w.x += (wind.x * BREEZE - w.x) * k;
    w.y += (wind.y * BREEZE - w.y) * k;
    const o = this.uWindOff.value;
    o.x = (o.x + w.x * dt) % 1e4;
    o.y = (o.y + w.y * dt) % 1e4;
    for (const m of this.meshes) m.visible = intensity > 0.001;
  }
}
