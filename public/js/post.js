// Pixel post-processing: low-res render, volumetric fog, cheap bloom, grade, grain, ordered dither.
// The canvas itself is low-res and upscaled by CSS with image-rendering: pixelated.

import * as THREE from 'three';
import { VolumetricFog } from './fog.js';
import { U, WEATHER_LAYER } from './materials.js';

const QUAD_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const BRIGHT_FRAG = /* glsl */`
uniform sampler2D tSrc;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec3 c = vec3(0.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 s = texture2D(tSrc, vUv + vec2(float(x), float(y)) * uTexel).rgb;
    float l = max(s.r, max(s.g, s.b));
    c += s * smoothstep(0.55, 1.1, l);
  }
  gl_FragColor = vec4(c / 9.0, 1.0);
}`;

const BLUR_FRAG = /* glsl */`
uniform sampler2D tSrc;
uniform vec2 uDir;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv).rgb * 0.227;
  c += texture2D(tSrc, vUv + uDir * 1.38).rgb * 0.316;
  c += texture2D(tSrc, vUv - uDir * 1.38).rgb * 0.316;
  c += texture2D(tSrc, vUv + uDir * 3.23).rgb * 0.07;
  c += texture2D(tSrc, vUv - uDir * 3.23).rgb * 0.07;
  gl_FragColor = vec4(c, 1.0);
}`;

const FINAL_FRAG = /* glsl */`
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform vec2 uRes;
uniform float uTime;
uniform float uGrain;
uniform float uFade;
uniform vec3 uHiTint;
uniform vec3 uShTint;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
const mat4 BAYER = mat4(0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0) / 16.0;

void main() {
  vec2 uv = vUv;
  // slight chromatic shift toward the edges, like the concept frame
  vec2 off = (uv - 0.5) * vec2(1.0 / uRes.x) * 0.7;
  vec3 c;
  c.r = texture2D(tScene, uv + off).r;
  c.g = texture2D(tScene, uv).g;
  c.b = texture2D(tScene, uv - off).b;
  c += texture2D(tBloom, uv).rgb * 0.85;

  // grade: a warm winter night, highlights a touch toward warm white
  float l = dot(c, vec3(0.3, 0.55, 0.15));
  c = mix(c, c * uHiTint, smoothstep(0.35, 0.9, l));
  c += uShTint * (1.0 - smoothstep(0.0, 0.25, l));
  c = c / (1.0 + max(c - 1.0, 0.0));   // soft clip
  // vignette
  vec2 v = uv - 0.5;
  c *= 1.0 - dot(v, v) * 0.55;
  // film grain
  vec2 px = floor(uv * uRes);
  c += (hash(px + fract(uTime * 7.13) * 91.0) - 0.5) * 0.06 * uGrain;
  // ordered dither to ~6 bits per channel
  int bx = int(mod(px.x, 4.0)), by = int(mod(px.y, 4.0));
  float b = BAYER[by][bx] - 0.5;
  c = floor(c * 48.0 + 0.5 + b) / 48.0;
  c *= 1.0 - uFade;
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

export class Post {
  constructor(renderer) {
    this.renderer = renderer;
    const opts = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true, type: THREE.HalfFloatType };
    this.rtScene = new THREE.WebGLRenderTarget(4, 4, opts);
    this.rtScene.depthTexture = new THREE.DepthTexture(4, 4);
    this.rtScene.depthTexture.type = THREE.UnsignedIntType;
    this.fog = new VolumetricFog();
    const lin = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, type: THREE.HalfFloatType };
    this.rtA = new THREE.WebGLRenderTarget(4, 4, lin);
    this.rtB = new THREE.WebGLRenderTarget(4, 4, lin);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new THREE.PlaneGeometry(2, 2);
    this.bright = new THREE.ShaderMaterial({ uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } }, vertexShader: QUAD_VERT, fragmentShader: BRIGHT_FRAG });
    this.blur = new THREE.ShaderMaterial({ uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } }, vertexShader: QUAD_VERT, fragmentShader: BLUR_FRAG });
    this.final = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: this.rtScene.texture }, tBloom: { value: this.rtB.texture },
        uRes: { value: new THREE.Vector2() }, uTime: { value: 0 }, uGrain: { value: 1 }, uFade: { value: 0 },
        uHiTint: { value: new THREE.Vector3(1.03, 1.0, 0.95) }, uShTint: { value: new THREE.Vector3(0.012, 0.006, 0.0) },
      },
      vertexShader: QUAD_VERT, fragmentShader: FINAL_FRAG,
    });
    this.quad = new THREE.Mesh(quad, this.final);
    this.quad.frustumCulled = false;
    this.qscene = new THREE.Scene();
    this.qscene.add(this.quad);
  }

  setSize(w, h) {
    this.w = w;
    this.h = h;
    this.rtScene.setSize(w, h);
    this.fog.setSize(w, h);
    const bw = Math.max(1, Math.floor(w / 3)), bh = Math.max(1, Math.floor(h / 3));
    this.rtA.setSize(bw, bh);
    this.rtB.setSize(bw, bh);
    this.bw = bw;
    this.bh = bh;
    this.final.uniforms.uRes.value.set(w, h);
  }

  pass(mat, target) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.qscene, this.cam);
  }

  render(scene, camera, time) {
    const r = this.renderer;
    r.setRenderTarget(this.rtScene);
    camera.layers.set(0);
    r.render(scene, camera);
    const fogged = this.fog.render(this, this.rtScene, camera);
    // snow on top of the fog, so near flakes are not buried in the fog behind them;
    // they test the scene depth themselves (WEATHER_GLSL) and fade with their own distance
    U.tSceneDepth.value = this.rtScene.depthTexture;
    U.uViewRes.value.set(this.w, this.h);
    // (a color background would clear the target even with autoClear off)
    const bg = scene.background;
    scene.background = null;
    camera.layers.set(WEATHER_LAYER);
    r.autoClear = false;
    r.setRenderTarget(this.fog.rtComp);
    r.render(scene, camera);
    r.autoClear = true;
    camera.layers.set(0);
    scene.background = bg;
    this.final.uniforms.tScene.value = fogged;
    this.bright.uniforms.tSrc.value = fogged;
    this.bright.uniforms.uTexel.value.set(1 / this.w, 1 / this.h);
    this.pass(this.bright, this.rtA);
    this.blur.uniforms.tSrc.value = this.rtA.texture;
    this.blur.uniforms.uDir.value.set(1 / this.bw, 0);
    this.pass(this.blur, this.rtB);
    this.blur.uniforms.tSrc.value = this.rtB.texture;
    this.blur.uniforms.uDir.value.set(0, 1 / this.bh);
    this.pass(this.blur, this.rtA);
    this.blur.uniforms.tSrc.value = this.rtA.texture;
    this.blur.uniforms.uDir.value.set(1.6 / this.bw, 0);
    this.pass(this.blur, this.rtB);
    this.final.uniforms.uTime.value = time;
    this.pass(this.final, null);
  }
}
