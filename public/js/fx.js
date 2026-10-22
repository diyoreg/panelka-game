// Ambient effects: the wind (it drives the fog, the snow and the wind sound) and steam.
// Steam rises from the emitters a block lists in block.emitters ({ p: Vector3, type: 'stack' | 'roof' | 'vent' });
// the panelka has none yet.

import * as THREE from 'three';
import { U, COMMON } from './materials.js';

const POINT_VERT = /* glsl */`
${COMMON}
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
attribute float aSeed;
uniform float uPxScale;
varying float vSeed;
varying float vAlpha;
varying vec3 vCol;
varying vec3 vWP;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vWP = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(1.0, aSize * uPxScale / -mv.z);
  vAlpha = aAlpha;
  vSeed = aSeed;
  #ifdef SOFT
  // fade puffs that come too close to the camera
  vAlpha *= smoothstep(1.2, 6.0, -mv.z);
  #endif
  vCol = aColor;
  #ifdef LIT
  vCol *= ambient(vec3(0.0, 1.0, 0.0)) * 1.6 + lampLight(vWP, vec3(0.0, 1.0, 0.0)) * 0.9;
  #endif
}`;

const POINT_FRAG = /* glsl */`
${COMMON}
varying float vSeed;
varying float vAlpha;
varying vec3 vCol;
varying vec3 vWP;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  #ifdef SOFT
  // soft billow: round falloff broken up by noise that churns as the puff rises
  float d = length(q) * 2.0;
  vec2 nq = q * 3.2 + vec2(vSeed * 1.7, vSeed * 0.9);
  float n = vnoise(nq) * 0.6 + vnoise(nq * 2.3 + 7.0) * 0.4;
  float a = smoothstep(1.0, 0.25, d) * smoothstep(0.25, 0.75, n * (1.25 - d * 0.6)) * vAlpha;
  if (a < 0.01) discard;
  #else
  float a = vAlpha;
  if (a < 0.5) discard;
  #endif
  vec3 c = applyFog(vCol, vWP, 1.0);
  #ifdef SOFT
  c *= 0.85 + 0.3 * n;
  #endif
  gl_FragColor = vec4(c, a);
}`;

class PointPool {
  constructor(n, { soft, lit, blending }) {
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.color = new Float32Array(n * 3);
    this.seedAttr = new Float32Array(n);
    this.vel = new Float32Array(n * 3);
    this.age = new Float32Array(n);
    this.life = new Float32Array(n).fill(-1);
    this.base = new Float32Array(n);
    this.seed = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSeed', new THREE.BufferAttribute(this.seedAttr, 1).setUsage(THREE.DynamicDrawUsage));
    this.uPx = { value: 400 };
    const defines = {};
    if (soft) defines.SOFT = '';
    if (lit) defines.LIT = '';
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...U, uPxScale: this.uPx },
      vertexShader: POINT_VERT,
      fragmentShader: POINT_FRAG,
      defines,
      transparent: !!soft,
      depthWrite: !soft,
      blending: blending || THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.next = 0;
  }
  spawn() {
    for (let k = 0; k < this.n; k++) {
      const i = (this.next + k) % this.n;
      if (this.life[i] < 0) { this.next = (i + 1) % this.n; return i; }
    }
    return -1;
  }
  flush() {
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = a.aSize.needsUpdate = a.aAlpha.needsUpdate = a.aColor.needsUpdate = a.aSeed.needsUpdate = true;
  }
}

export class Effects {
  constructor(scene, world) {
    this.world = world;
    this.wind = new THREE.Vector2(1, 0.3).normalize();
    this.windT = 0;
    this.steam = new PointPool(900, { soft: true, lit: true });
    this.steam.points.renderOrder = 5;
    scene.add(this.steam.points);
    this.acc = new Map();
    this.nearSteam = 0;
  }

  setPixelScale(h, fov) {
    this.steam.uPx.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
  }

  update(dt, camPos) {
    this.windT += dt;
    const wa = Math.sin(this.windT * 0.03) * 1.2 + Math.sin(this.windT * 0.011) * 2.0;
    this.wind.set(Math.cos(wa), Math.sin(wa));
    const gust = 0.6 + 0.4 * Math.sin(this.windT * 0.4) * Math.sin(this.windT * 0.13);
    this.gust = gust;
    this.updateSteam(dt, camPos, gust);
  }

  updateSteam(dt, cam, gust) {
    const S = this.steam;
    const blocks = this.world.activeBlocks || [];
    let near = 0;
    for (const b of blocks) {
      if (Math.abs(b.cx - cam.x) > 140 || Math.abs(b.cz - cam.z) > 140) continue;
      b.emitters.forEach((e, idx) => {
        const d = e.p.distanceTo(cam);
        if (d > 120) return;
        if (e.type !== 'roof') near = Math.max(near, 1 - d / 18);
        const key = b.bx * 7919 + b.bz * 104729 + idx;
        const rate = e.type === 'stack' ? 18 : e.type === 'roof' ? 6 : 10;
        let a = (this.acc.get(key) || Math.random()) + rate * dt * (d < 60 ? 1 : 0.5);
        while (a >= 1) {
          a -= 1;
          const i = S.spawn();
          if (i < 0) break;
          const big = e.type === 'roof' ? 2.2 : 1;
          S.pos[i * 3] = e.p.x + (Math.random() - 0.5) * 0.4 * big;
          S.pos[i * 3 + 1] = e.p.y + Math.random() * 0.2;
          S.pos[i * 3 + 2] = e.p.z + (Math.random() - 0.5) * 0.4 * big;
          S.vel[i * 3] = (Math.random() - 0.5) * 0.3;
          S.vel[i * 3 + 1] = (e.type === 'stack' ? 2.4 : 1.3) + Math.random() * 0.6;
          S.vel[i * 3 + 2] = (Math.random() - 0.5) * 0.3;
          S.age[i] = 0;
          S.life[i] = (e.type === 'roof' ? 5 : 3.2) + Math.random() * 2.5;
          S.base[i] = (0.9 + Math.random() * 0.7) * big;
          S.seed[i] = Math.random() * 100;
        }
        this.acc.set(key, a);
      });
    }
    this.nearSteam = near;
    const wx = this.wind.x * gust, wz = this.wind.y * gust;
    for (let i = 0; i < S.n; i++) {
      if (S.life[i] < 0) { S.alpha[i] = 0; S.size[i] = 0; continue; }
      S.age[i] += dt;
      const t = S.age[i] / S.life[i];
      if (t >= 1) { S.life[i] = -1; S.alpha[i] = 0; S.size[i] = 0; continue; }
      S.vel[i * 3] += (wx * 1.2 - S.vel[i * 3]) * dt * 0.6;
      S.vel[i * 3 + 2] += (wz * 1.2 - S.vel[i * 3 + 2]) * dt * 0.6;
      S.vel[i * 3 + 1] *= 1 - dt * 0.35;
      S.pos[i * 3] += S.vel[i * 3] * dt + Math.sin(S.seed[i] + S.age[i] * 1.7) * dt * 0.15;
      S.pos[i * 3 + 1] += S.vel[i * 3 + 1] * dt;
      S.pos[i * 3 + 2] += S.vel[i * 3 + 2] * dt;
      S.size[i] = S.base[i] * (0.7 + t * 3.4);
      S.alpha[i] = Math.min(1, t * 5) * (1 - t) * 0.55;
      S.seedAttr[i] = S.seed[i] + S.age[i] * 0.35;
      S.color[i * 3] = 0.6; S.color[i * 3 + 1] = 0.66; S.color[i * 3 + 2] = 0.8;
    }
    S.flush();
  }
}
