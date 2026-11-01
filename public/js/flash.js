// Shadows of the flashlight. Before the frame the scene is drawn once more from the flashlight, depth only, into
// a small depth texture; every shader compares its own distance with it (flashShadow in materials.js), so the
// furniture, the door leaves and the trees throw shadows in the beam, on the walls and in the fog alike.
// Left out of that pass: glass, net curtains and the other see-through materials, the stand-ins on the facades
// of the drawn sections, foliage cards (a card would throw a square shadow), the ground, the sky and the player.

import * as THREE from 'three';
import { U } from './materials.js';

const SIZE = 1024;
const NEAR = 0.05, FAR = 26;
const NO_SHADOW = /MODE_(TWIGS|SPRUCE|PLANT|GLOW)\b/;
// the ground and the snow on the streets lie under everything: nothing to shade, only acne at a grazing beam
const NO_SHADOW_NAMES = new Set(['pk_ground', 'pk_road', 'pk_drive', 'pk_path', 'pk_print']);

const DEPTH_VERT = /* glsl */`
void main() {
  mat4 m = modelMatrix;
  #ifdef USE_INSTANCING
  m = m * instanceMatrix;
  #endif
  gl_Position = projectionMatrix * viewMatrix * m * vec4(position, 1.0);
}`;

export class FlashShadow {
  constructor(renderer) {
    this.renderer = renderer;
    this.target = new THREE.WebGLRenderTarget(SIZE, SIZE, {
      depthBuffer: true,
      depthTexture: new THREE.DepthTexture(SIZE, SIZE, THREE.UnsignedIntType),
    });
    this.camera = new THREE.PerspectiveCamera(50, 1, NEAR, FAR);
    this.depthMat = new THREE.ShaderMaterial({
      vertexShader: DEPTH_VERT,
      fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }',
      side: THREE.DoubleSide,
      colorWrite: false,
    });
    this.casts = new WeakMap();   // material -> throws a shadow
    this.hidden = [];
    U.tFlashDepth.value = this.target.depthTexture;
    U.uFlashNF.value.set(NEAR, FAR, 1 / SIZE);
  }

  castsShadow(mat) {
    if (Array.isArray(mat)) return mat.some((m) => this.castsShadow(m));
    let c = this.casts.get(mat);
    if (c === undefined) {
      const defs = Object.keys(mat.defines || {}).join(' ');
      c = !mat.transparent && !('HIDE_LOADED' in (mat.defines || {})) && !NO_SHADOW.test(defs) && !NO_SHADOW_NAMES.has(mat.name);
      this.casts.set(mat, c);
    }
    return c;
  }

  // world: the group with everything that can throw a shadow; the rest of the scene stays out of this pass
  render(scene, world, coneCos) {
    if (U.uFlash.value.w < 0.5) return;
    const f = U.uFlash.value, d = U.uFlashDir.value;
    const cam = this.camera;
    cam.fov = THREE.MathUtils.radToDeg(Math.acos(coneCos)) * 2 + 4;
    cam.position.set(f.x, f.y, f.z);
    cam.up.set(Math.abs(d.y) > 0.95 ? 1 : 0, Math.abs(d.y) > 0.95 ? 0 : 1, 0);
    cam.lookAt(f.x + d.x, f.y + d.y, f.z + d.z);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    U.uFlashMat.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);

    const hidden = this.hidden;
    hidden.length = 0;
    for (const o of scene.children) if (o !== world && o.visible) { o.visible = false; hidden.push(o); }
    for (const o of world.children) {
      if (o.visible && o.material && !this.castsShadow(o.material)) { o.visible = false; hidden.push(o); }
    }
    const r = this.renderer;
    const bg = scene.background;
    scene.background = null;
    scene.overrideMaterial = this.depthMat;
    r.setRenderTarget(this.target);
    r.render(scene, cam);
    r.setRenderTarget(null);
    scene.overrideMaterial = null;
    scene.background = bg;
    for (const o of hidden) o.visible = true;
  }
}
