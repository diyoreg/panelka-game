// Standalone preview of the animated player model, before it goes into the game.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { fitPixels } from './ui.js';

const canvas = document.querySelector('#gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(1);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1a5c);
scene.fog = new THREE.FogExp2(0x22379a, 0.06);
const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 200);
camera.position.set(2.6, 1.6, 3.6);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.95, 0);
controls.enableDamping = true;
controls.minDistance = 1.2;
controls.maxDistance = 12;

// pre-dawn light: blue sky fill, cold moon, orange sodium lamp overhead
scene.add(new THREE.HemisphereLight(0x5a6fd0, 0x101428, 1.4));
const moon = new THREE.DirectionalLight(0x8090ff, 0.5);
moon.position.set(-3, 6, -4);
scene.add(moon);
const lamp = new THREE.PointLight(0xffa050, 30, 14, 1.6);
lamp.position.set(1.4, 4.2, 1.2);
scene.add(lamp);

// a patch of packed snow
const tl = new THREE.TextureLoader();
const ground = tl.load('tex/snow_packed.png');
ground.wrapS = ground.wrapT = THREE.RepeatWrapping;
ground.repeat.set(6, 6);
ground.magFilter = THREE.NearestFilter;
ground.colorSpace = THREE.SRGBColorSpace;
const floor = new THREE.Mesh(new THREE.CircleGeometry(9, 48).rotateX(-Math.PI / 2),
  new THREE.MeshLambertMaterial({ map: ground, color: 0x8890a8 }));
scene.add(floor);
// lamp pole for context
const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 4.4, 8), new THREE.MeshLambertMaterial({ color: 0x15171c }));
pole.position.set(2.2, 2.2, 1.2);
scene.add(pole);
const head = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 0.3), new THREE.MeshBasicMaterial({ color: 0xffc070 }));
head.position.set(1.6, 4.35, 1.2);
scene.add(head);

let mixer, actions = {}, current = null, root;
const CLIP_ORDER = ['idle', 'walk', 'run', 'crouch_idle', 'crouch_walk', 'jump', 'fly', 'idle_look', 'idle_scratch', 'idle_tired'];
const LABEL = {
  idle: 'Idle', walk: 'Walk', run: 'Run', crouch_idle: 'Crouch', crouch_walk: 'Crouch walk', jump: 'Jump (air)',
  fly: 'Fly', idle_look: 'Look around', idle_scratch: 'Scratch', idle_tired: 'Tired',
};
const opts = { pixel: 1, speed: 1, spin: 0 };

// camera presets: the character faces +Z
const VIEWS = { front: [0, 1.1, 4.2], side: [4.2, 1.1, 0], three: [2.6, 1.6, 3.6] };
function setView(name) {
  camera.position.set(...VIEWS[name]);
  controls.target.set(0, 0.9, 0);
  controls.update();
}

new GLTFLoader().load('models/player.glb', (gltf) => {
  root = gltf.scene;
  // normalize to 1.8 m and stand on the floor
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const h = box.max.y - box.min.y;
  root.scale.setScalar(1.8 / h);
  root.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(root);
  root.position.y -= box2.min.y;
  root.traverse((o) => {
    if (o.isMesh) {
      o.frustumCulled = false;
      const m = o.material;
      if (m.map) { m.map.magFilter = THREE.NearestFilter; m.map.minFilter = THREE.NearestMipmapLinearFilter; m.map.needsUpdate = true; }
      o.material = new THREE.MeshLambertMaterial({ map: m.map, color: 0xffffff });
    }
  });
  scene.add(root);

  mixer = new THREE.AnimationMixer(root);
  for (const clip of gltf.animations) {
    // The exporter does not start every track at the same time (constant bones get 2 keys
    // at their own offset), so align each track to t = 0 on its own. Every track spans one loop.
    clip.tracks.forEach((tr) => {
      const t0 = tr.times[0];
      for (let i = 0; i < tr.times.length; i++) tr.times[i] -= t0;
    });
    clip.resetDuration();
    actions[clip.name] = mixer.clipAction(clip);
  }
  buildMenu();
  play('idle');
  window.__preview = { actions, play, setView, freeze: false, ready: true };
});

function buildMenu() {
  const nav = document.querySelector('#clips');
  CLIP_ORDER.filter((n) => actions[n]).forEach((n, i) => {
    const b = document.createElement('button');
    b.textContent = `${i + 1}  ${LABEL[n]}`;
    b.dataset.clip = n;
    b.addEventListener('click', () => play(n));
    nav.appendChild(b);
  });
}

function play(name) {
  const next = actions[name];
  if (!next || next === current) return;
  next.reset().setEffectiveWeight(1).play();
  if (current) current.crossFadeTo(next, 0.3, true);
  current = next;
  document.querySelectorAll('#clips button').forEach((b) => b.classList.toggle('on', b.dataset.clip === name));
}

document.querySelectorAll('.choice').forEach((group) => {
  group.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    group.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    if (group.dataset.opt === 'view') { setView(b.dataset.v); return; }
    opts[group.dataset.opt] = Number(b.dataset.v);
    resize();
  });
});

addEventListener('keydown', (e) => {
  const n = Number(e.key);
  if (e.key === '0') play(CLIP_ORDER[9]);
  else if (n >= 1 && n <= CLIP_ORDER.length) play(CLIP_ORDER[n - 1]);
});

function resize() {
  fitPixels();
  const k = opts.pixel ? 3 : 1;
  renderer.setSize(Math.ceil(innerWidth / k), Math.ceil(innerHeight / k), false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(0.05, clock.getDelta());
  if (mixer && !window.__preview?.freeze) mixer.update(dt * opts.speed);
  if (root && opts.spin) root.rotation.y += dt * 0.6;
  controls.update();
  renderer.render(scene, camera);
});
