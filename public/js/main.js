// Entry point: loading, main loop, game modes (splash, title, play, pause), autosave.

import * as THREE from 'three';
import { U, makeSky, setSignAtlas, setRuntimeTexture } from './materials.js';
import { makeSignAtlas, makeLiftPanel, makeFloorNumbers } from './textures.js';
import { Assets } from './assets.js';
import { PanelkaWorld } from './panelka.js';
import { Snow } from './snow.js';
import { FlashShadow } from './flash.js';
import { Player, Input } from './player.js';
import { Character } from './character.js';
import { Effects } from './fx.js';
import { Snowfall } from './weather.js';
import { Post } from './post.js';
import { Audio } from './audio.js';
import { Menu, Modal, fitPixels, CONTROLS_HTML, ABOUT_HTML, settingsPanel } from './ui.js';
import { load, save, loadSettings, loadSnowMode, DEFAULT_SETTINGS, DEFAULT_SEED } from './storage.js';
import { hashString } from './rng.js';

const $ = (s) => document.querySelector(s);
// radius: blocks built around you (3 x 3 or 5 x 5 of 128 m), fog: far haze, vol: volumetric fog near the camera
const VIEW = {
  near: { radius: 1, fog: 0.032, vol: 0.0375 },
  normal: { radius: 1, fog: 0.0224, vol: 0.03 },
  far: { radius: 2, fog: 0.0144, vol: 0.0195 },
};

const GAME_NAME = 'Lost in Panelka';
const SKY_BG = 0x2e1d14;
// the snowfall picker on the main screen
const SNOW_CHOICES = [['auto', 'AUTO'], ['snow', 'SNOW'], ['blizzard', 'BLIZZARD'], ['clear', 'CLEAR']];

const settings = loadSettings();
const audio = new Audio();
const input = new Input();
const modal = new Modal();
let mode = 'loading';
let walk = load('walk', null);
let seedText = walk?.seed ?? load('seed', DEFAULT_SEED);
let snowMode = loadSnowMode();

// ------------------------------------------------------------------ renderer and scene

const canvas = $('#gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.autoClear = true;
const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY_BG);
const camera = new THREE.PerspectiveCamera(settings.fov, 16 / 9, 0.1, 1100);
const sky = makeSky();
sky.material.depthTest = false;
scene.add(sky);
const post = new Post(renderer);
const flashShadow = new FlashShadow(renderer);

let world, player, rig, fx, snow;
// auto keeps a light snowfall and brings a blizzard now and then
const snowfall = new Snowfall(() => snowMode);
let baseVol = 0.03;

function resize() {
  fitPixels();
  // 0x renders at the screen's own resolution (retina included), no pixelation at all
  const px = settings.pixel || 1 / (devicePixelRatio || 1);
  const w = Math.max(160, Math.ceil(innerWidth / px));
  const h = Math.max(90, Math.ceil(innerHeight / px));
  renderer.setSize(w, h, false);
  post.setSize(w, h);
  camera.aspect = innerWidth / innerHeight;
  camera.fov = settings.fov;
  camera.updateProjectionMatrix();
  fx?.setPixelScale(h, settings.fov);
  snow?.setPixelScale(h, settings.fov);
}
addEventListener('resize', resize);

function applySettings() {
  const v = VIEW[settings.view] || VIEW.normal;
  U.uFogDensity.value = v.fog;
  baseVol = v.vol;
  post.fog.uDensity.value = baseVol;
  if (world && world.radius !== v.radius) world.radius = v.radius;
  $('#crt').classList.toggle('off', !settings.crt);
  $('#fps').classList.toggle('hidden', !settings.fps);
  post.final.uniforms.uGrain.value = settings.grain ? 1 : 0;
  audio.setVolumes(settings);
  resize();
}

// ------------------------------------------------------------------ loading

async function boot() {
  resize();
  try { await document.fonts.load('16px PressStart'); } catch { /* fallback font */ }
  setSignAtlas(makeSignAtlas());
  setRuntimeTexture('liftPanel', makeLiftPanel());
  setRuntimeTexture('floorNum', makeFloorNumbers());
  U.uSeedOff.value = (hashString(seedText) % 1000) * 0.137;
  const assets = new Assets();
  const [plan] = await Promise.all([
    fetch('models/plans.json').then((r) => r.json()).catch(() => null),
    assets.load('models/panelka.glb'),
  ]);
  world = new PanelkaWorld(scene, assets, hashString(seedText), plan);
  if (world.interiors) {
    world.interiors.onSound = (kind, vol) => audio.sfx(kind, vol);
    world.interiors.onHum = (level) => audio.liftHum(level);
  }
  player = new Player(world, settings);
  player.ladders = () => world.interiors?.ladders() ?? [];
  rig = await new Character().load('models/player.glb');
  scene.add(rig.root, rig.shadow);
  rig.onStep = (state) => {
    if (mode !== 'play') return;
    const surface = surfaceAt(player.pos);
    audio.step(surface, (state === 'crouch_walk' ? 0.5 : state === 'run' ? 1.2 : 0.8) * (surface === 'floor' ? 0.8 : 1));
    if (surface === 'snow') world.footstep(player.pos, player.facing);
  };
  fx = new Effects(scene, world);
  snow = new Snow(scene);
  applySettings();
  startPosition(walk);
  placeTitleCam();
  // warm up shaders so the first frame does not stutter
  renderer.compile(scene, camera);
  mode = 'splash';
  $('#splash-load').classList.add('hidden');
  $('#splash-press').classList.remove('hidden');
  requestAnimationFrame(frame);
}

function startPosition(w) {
  if (w && w.seed === seedText) {
    player.spawn({ x: w.x, y: w.y, z: w.z, yaw: w.facing, camYaw: w.camYaw, camPitch: w.camPitch });
    player.walked = w.walked || 0;
  } else {
    world.blocks.clear();
    world.centerKey = null;
    const s = world.spawnPoint();
    player.spawn({ x: s.x, y: s.y, z: s.z, yaw: s.yaw + Math.PI, camYaw: s.yaw });
    player.walked = 0;
  }
  world.update(player.pos);
}

function saveWalk() {
  if (!player) return;
  walk = {
    seed: seedText,
    x: +player.pos.x.toFixed(2), y: +player.pos.y.toFixed(2), z: +player.pos.z.toFixed(2),
    facing: +player.facing.toFixed(3), camYaw: +player.camYaw.toFixed(3), camPitch: +player.camPitch.toFixed(3),
    walked: Math.round(player.walked || 0),
  };
  save('walk', walk);
  save('seed', seedText);
}
addEventListener('beforeunload', saveWalk);
setInterval(() => { if (mode === 'play') saveWalk(); }, 3000);

// ------------------------------------------------------------------ seed

// A new seed builds new yards, so the saved position no longer means anything
function setSeed(newSeed) {
  seedText = String(newSeed).trim().slice(0, 32) || DEFAULT_SEED;
  world.setSeed(hashString(seedText));
  U.uSeedOff.value = (hashString(seedText) % 1000) * 0.137;
  startPosition(null);
  saveWalk();
  if (mode === 'title') { placeTitleCam(); renderTitle(); }
}

function randomSeed() {
  const words = ['snow', 'yard', 'frost', 'birch', 'kitchen', 'balcony', 'tram', 'kiosk', 'stairwell', 'quiet', 'night', 'drift', 'spruce', 'garage', 'echo', 'lamp'];
  return words[Math.floor(Math.random() * words.length)] + '-' + Math.floor(Math.random() * 9000 + 1000);
}

// The seed block at the bottom of Settings: type or roll a seed, then confirm the reset
function seedBlock() {
  return {
    html: `
    <div class="seed-box">
      <h3>WORLD SEED</h3>
      <p>The seed builds the yards of the microdistrict. The same seed always gives the same world, so you can share it or come back to a place you liked.</p>
      <div class="btn-row">
        <input class="seed-input" id="seed-in" maxlength="32" spellcheck="false" value="${escapeHtml(seedText)}">
        <button class="btn" id="seed-random">Random</button>
        <button class="btn" id="seed-apply">Build this world</button>
      </div>
      <p class="warn" id="seed-msg">Changing the seed builds a new microdistrict. Your position will be reset to the starting corner: it is the only progress in the game.</p>
    </div>`,
    mount(body) {
      const inp = body.querySelector('#seed-in');
      const apply = body.querySelector('#seed-apply');
      const msg = body.querySelector('#seed-msg');
      let armed = false;
      const disarm = () => { armed = false; apply.textContent = 'Build this world'; apply.classList.remove('danger'); };
      inp.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.code === 'Enter') apply.click();
        if (e.code === 'Escape') modal.close();
      });
      inp.addEventListener('input', disarm);
      body.querySelector('#seed-random').addEventListener('click', () => { inp.value = randomSeed(); disarm(); });
      apply.addEventListener('click', () => {
        const v = inp.value.trim().slice(0, 32) || DEFAULT_SEED;
        if (v === seedText) { msg.textContent = 'This is already the current seed. Nothing changed.'; return; }
        if (!armed) {
          armed = true;
          apply.textContent = 'Yes, reset my position';
          apply.classList.add('danger');
          msg.textContent = `Sure? The world "${v}" replaces "${seedText}" and you start again from the starting corner.`;
          return;
        }
        setSeed(v);
        disarm();
        inp.value = seedText;
        msg.textContent = `Done. You are in the world "${seedText}", at the starting corner.`;
      });
    },
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ------------------------------------------------------------------ menus

function openSettings(back) {
  settingsPanel(modal, settings, (key) => {
    save('settings', settings);
    applySettings();
    if (key === 'camera') player.camDist = 0.5;
  }, [
    { label: 'Next music piece', run: () => audio.playNext() },
    { label: 'Reset to defaults', run: () => { Object.assign(settings, DEFAULT_SETTINGS); save('settings', settings); applySettings(); openSettings(back); } },
  ], seedBlock());
  modal.onClose = back;
}

// ------------------------------------------------------------------ title: the walk card

// focus: zone is card, snow (the picker under it) or menu (the row at the bottom)
const tfocus = { zone: 'card' };

function renderTitle() {
  const w = walk && walk.seed === seedText ? walk : null;
  const walkText = w ? `Continue · ${((w.walked || 0) / 1000).toFixed(2)} km walked` : 'New walk · from the starting corner';
  const chips = SNOW_CHOICES.map(([v, l]) => `<button data-w="${v}" class="${snowMode === v ? 'on' : ''}">${l}</button>`).join('');
  $('#maps').innerHTML = `
    <div class="map-card">
      <div class="map-shot" style="background-image:url(img/preview.jpg)">
        <div class="play">${w ? 'CONTINUE' : 'START'}</div>
      </div>
      <div class="map-about">Soviet panel blocks on a winter night: lit kitchens, open stairwells, snowed-in cars and yards.</div>
      <div class="map-walk">${walkText}</div>
      <div class="weather"><span class="wlabel">SNOW</span><div class="choice">${chips}</div></div>
    </div>`;
  const card = $('#maps').querySelector('.map-card');
  card.addEventListener('mouseenter', () => { if (tfocus.zone === 'menu') tfocus.zone = 'card'; focusTitle(); });
  card.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-w]');
    if (chip) { setSnowMode(chip.dataset.w); return; }
    if (e.target.closest('.weather')) return;
    startGame();
  });
  focusTitle();
}

function focusTitle() {
  const card = $('#maps').querySelector('.map-card');
  card.classList.toggle('focus', tfocus.zone !== 'menu');
  card.querySelector('.weather').classList.toggle('focus', tfocus.zone === 'snow');
  if (tfocus.zone === 'menu') titleMenu.focus(titleMenu.i);
  else titleMenu.buttons().forEach((b) => b.classList.remove('focus'));
}

function setSnowMode(v) {
  snowMode = v;
  save('snow', v);
  $('#maps').querySelectorAll('[data-w]').forEach((b) => b.classList.toggle('on', b.dataset.w === v));
}

function titleKey(e) {
  const c = e.code;
  const left = c === 'ArrowLeft' || c === 'KeyA', right = c === 'ArrowRight' || c === 'KeyD';
  const up = c === 'ArrowUp' || c === 'KeyW', down = c === 'ArrowDown' || c === 'KeyS';
  const go = c === 'Enter' || c === 'Space';
  if (tfocus.zone === 'menu') {
    if (up) { tfocus.zone = 'snow'; focusTitle(); return true; }
    if (left || right) { titleMenu.focus(titleMenu.i + (right ? 1 : -1)); return true; }
    if (go) { titleMenu.key({ code: 'Enter' }); return true; }
    return false;
  }
  if (tfocus.zone === 'card') {
    if (down) { tfocus.zone = 'snow'; focusTitle(); return true; }
  } else {
    if (left || right) {
      const k = SNOW_CHOICES.findIndex(([v]) => v === snowMode);
      setSnowMode(SNOW_CHOICES[(k + (right ? 1 : -1) + SNOW_CHOICES.length) % SNOW_CHOICES.length][0]);
      return true;
    }
    if (up) { tfocus.zone = 'card'; focusTitle(); return true; }
    if (down) { tfocus.zone = 'menu'; titleMenu.i = 0; focusTitle(); return true; }
  }
  if (go) { startGame(); return true; }
  return false;
}

const titleMenu = new Menu($('#title-menu'), (act) => {
  if (act === 'controls') modal.show('CONTROLS', CONTROLS_HTML);
  if (act === 'settings') openSettings(() => { if (mode === 'title') renderTitle(); });
  if (act === 'about') modal.show('ABOUT', ABOUT_HTML);
});
$('#title-menu').addEventListener('mousemove', () => { tfocus.zone = 'menu'; focusTitle(); });

const pauseMenu = new Menu($('#pause-menu'), (act) => {
  if (act === 'resume') resume();
  if (act === 'title') toTitle();
  if (act === 'controls') modal.show('CONTROLS', CONTROLS_HTML);
  if (act === 'settings') openSettings();
  if (act === 'about') modal.show('ABOUT', ABOUT_HTML);
});

function showTitle() {
  mode = 'title';
  $('#splash').classList.add('hidden');
  $('#pause').classList.add('hidden');
  $('#title').classList.remove('hidden');
  tfocus.zone = 'card';
  renderTitle();
  placeTitleCam();
}

function fadeThrough(fn) {
  const f = $('#fade');
  f.classList.add('on');
  setTimeout(() => { fn(); f.classList.remove('on'); }, 650);
}

// Start or continue the walk
let starting = false;
function startGame() {
  if (starting || mode !== 'title') return;
  starting = true;
  // arrive in the middle of the snowfall, not before it starts
  snowfall.settle();
  fadeThrough(() => {
    $('#title').classList.add('hidden');
    mode = 'play';
    starting = false;
    lockPointer();
  });
}

function resume() {
  modal.close();
  $('#pause').classList.add('hidden');
  mode = 'play';
  lockPointer();
}

function pause() {
  if (mode !== 'play') return;
  mode = 'pause';
  saveWalk();
  $('#pause-map').textContent = `${((player.walked || 0) / 1000).toFixed(2)} KM WALKED`;
  $('#pause').classList.remove('hidden');
  pauseMenu.focus(0);
  if (document.pointerLockElement) document.exitPointerLock();
}

function toTitle() {
  saveWalk();
  fadeThrough(() => {
    $('#pause').classList.add('hidden');
    showTitle();
  });
}

function lockPointer() {
  input.enabled = true;
  try {
    const p = canvas.requestPointerLock({ unadjustedMovement: true });
    if (p && p.catch) p.catch(() => { try { canvas.requestPointerLock(); } catch { /* not available */ } });
  } catch { /* not available */ }
}

document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && mode === 'play') pause();
});
canvas.addEventListener('click', () => { if (mode === 'play' && !document.pointerLockElement) lockPointer(); });

// now playing label
function updateNowPlaying(np) {
  const html = np ? `MUSIC <span class="eq"></span> PART ${String(np.n).padStart(2, '0')} OF ${np.total}` : '';
  $('#now-playing').innerHTML = html;
  $('#now-playing-pause').innerHTML = html;
}
audio.onTrack(updateNowPlaying);

// ------------------------------------------------------------------ keyboard

addEventListener('keydown', (e) => {
  if (mode === 'loading') return;
  if (mode === 'splash') {
    audio.init(settings);
    showTitle();
    return;
  }
  if (modal.open) { if (modal.key(e)) e.preventDefault(); return; }
  if (e.code === 'F11' && !e.repeat) {
    e.preventDefault();
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  }
  if (e.code === 'KeyN' && !e.repeat) audio.playNext();
  if (mode === 'title') { if (titleKey(e)) e.preventDefault(); return; }
  if (mode === 'pause') {
    if (e.code === 'Escape') { resume(); return; }
    if (pauseMenu.key(e)) e.preventDefault();
    return;
  }
  if (mode === 'play') {
    if (e.code === 'Escape' || e.code === 'KeyP') pause();
    if (e.code === 'KeyF' && !e.repeat) {
      player.flash = !player.flash;
      audio.sfx('flash');
    }
    if (e.code === 'KeyV' && !e.repeat) {
      settings.camera = settings.camera === 'first' ? 'third' : 'first';
      save('settings', settings);
      player.camDist = 0.5;
    }
  }
});
$('#splash').addEventListener('mousedown', () => {
  if (mode !== 'splash') return;
  audio.init(settings);
  showTitle();
});

// ------------------------------------------------------------------ main loop

// The title camera looks out of a fifth floor window across the yard
const titleCam = { a: 0, spot: null };

function placeTitleCam() {
  titleCam.spot = world.titleSpot(player.pos);
  titleCam.a = 0;
}
let last = performance.now();
let fpsAcc = 0, fpsN = 0;

// footstep sound: snow in the yards, the floor or the stairs indoors, hard on steps, balconies and roofs
function surfaceAt(p) {
  const inside = world.interiors?.surfaceAt(_up.copy(p).setY(p.y + 0.5));
  if (inside) return inside;
  return p.y < 0.3 ? 'snow' : 'hard';
}
const _up = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _eye = new THREE.Vector3();
let indoor = false;

// The door or switch in front of you, its hint at the bottom of the screen, and E to use it
function interact() {
  const I = world.interiors;
  const hint = $('#hint');
  if (!I || mode !== 'play') { hint.classList.add('hidden'); return; }
  camera.getWorldDirection(_dir);
  _eye.set(player.pos.x, player.pos.y + player.eye, player.pos.z);
  const t = I.pick(camera.position, _dir, _eye);
  if (t && input.hit('KeyE')) I.use(t, player);
  const label = I.label(t);
  hint.classList.toggle('hidden', !label);
  if (label && hint.dataset.label !== label) {
    hint.dataset.label = label;
    hint.innerHTML = `<span class="key">E</span> ${label}`;
  }
}

// The flashlight is held in the right hand, a little below and in front of the eyes, and aimed at the point
// a few meters ahead where you look; in third person from the chest of the character, toward where the camera looks
const FLASH_CONE = Math.cos(0.36);
const _fwd = new THREE.Vector3(), _side = new THREE.Vector3(), _aim = new THREE.Vector3();
function aimFlash() {
  const on = player.flash && (mode === 'play' || mode === 'pause');
  U.uFlash.value.w = on ? 1 : 0;
  if (!on) return;
  camera.getWorldDirection(_fwd);
  _side.set(-_fwd.z, 0, _fwd.x).normalize();
  const o = U.uFlash.value;
  if (settings.camera === 'first') {
    o.set(camera.position.x, camera.position.y - 0.3, camera.position.z, 1).addScaledVector(_side, 0.2).addScaledVector(_fwd, 0.2);
    _aim.copy(camera.position).addScaledVector(_fwd, 4);
  } else {
    // in front of the chest along the view (the side vector turned a quarter), a little to the right
    o.set(player.pos.x + _side.z * 0.3, player.pos.y + player.height * 0.72, player.pos.z - _side.x * 0.3, 1).addScaledVector(_side, 0.25);
    _aim.copy(camera.position).addScaledVector(_fwd, player.camDist + 5);
  }
  o.w = 1;
  _aim.sub(_side.set(o.x, o.y, o.z)).normalize();
  U.uFlashDir.value.set(_aim.x, _aim.y, _aim.z, FLASH_CONE);
}

function frame(now) {
  requestAnimationFrame(frame);
  // frame rate limit: skip this display refresh if it comes too early
  const cap = settings.fpsCap;
  if (cap && now - last < 1000 / cap - 2) return;
  try {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    U.uTime.value += dt;

    if (mode === 'play') {
      player.update(dt, input);
      player.walked = (player.walked || 0) + player.speed * dt;
      if (player.landed > 0.15) audio.land(player.landed, surfaceAt(player.pos));
      player.landed = 0;
    }
    world.update(player.pos);

    // wider view while sprinting or flying fast
    const fov = mode === 'play' ? settings.fov * player.fovScale + player.fovKick : settings.fov;
    if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = fov; camera.updateProjectionMatrix(); }

    if (mode === 'title' || mode === 'splash') {
      // looking out of the window: a slow turn of the head across the yard
      titleCam.a += dt;
      const { pos, look } = titleCam.spot;
      const yaw = Math.sin(titleCam.a * 0.045) * 0.32;
      const dx = look.x - pos.x, dz = look.z - pos.z;
      camera.position.copy(pos);
      camera.lookAt(pos.x + dx * Math.cos(yaw) - dz * Math.sin(yaw), look.y + Math.sin(titleCam.a * 0.03) * 2, pos.z + dx * Math.sin(yaw) + dz * Math.cos(yaw));
    } else {
      camera.position.copy(player.camPos);
      camera.lookAt(player.camLook);
    }
    if (window.__game.freeCam) {
      const fc = window.__game.freeCam;
      camera.position.set(...fc.p);
      camera.lookAt(...fc.l);
    }
    rig.update(dt, player, (mode === 'play' || mode === 'pause') && settings.camera !== 'first');
    U.uCamPos.value.copy(camera.position);
    aimFlash();
    world.updateLights(camera.position);
    if (world.interiors) {
      world.interiors.update(camera.position, dt, world.activeBlocks, player);
      indoor = !!world.interiors.insideAt(camera.position);
      player.indoor = !!world.interiors.insideAt(_up.copy(player.pos).setY(player.pos.y + 1.0));
    }
    interact();
    sky.position.copy(camera.position);
    fx.update(dt, camera.position);
    post.fog.drift(dt, fx.wind, fx.gust, camera);
    // snow: always a little in Auto, a blizzard now and then; the fog thickens with it
    snowfall.update(dt);
    U.uSnow.value = snowfall.level;
    snow.update(snowfall.level, fx.wind, fx.gust, dt);
    post.fog.uDensity.value = baseVol * (0.85 + 0.55 * snowfall.level);
    // snow is drawn over the fog and fades into it on its own (post.js)
    U.uPartFog.value = post.fog.uDensity.value * 0.75;
    audio.update(dt, { gust: fx.gust, steam: fx.nearSteam, snow: snowfall.level, indoor });
    flashShadow.render(scene, world.group, FLASH_CONE);
    post.render(scene, camera, U.uTime.value);

    if (settings.fps) {
      fpsAcc += dt; fpsN++;
      if (fpsAcc > 0.5) { $('#fps').textContent = Math.round(fpsN / fpsAcc) + ' FPS'; fpsAcc = 0; fpsN = 0; }
    }
  } catch (err) {
    console.error(err);
  }
  input.endFrame();
}

// debug / QA hooks (data/tools/*.js)
window.__game = {
  THREE,
  get mode() { return mode; },
  get player() { return player; },
  get world() { return world; },
  get rig() { return rig; },
  snowfall,
  camera, renderer, settings, U, post, flashShadow, applySettings,
  start: () => { audio.init(settings); showTitle(); startGame(); },
  setSeed,
  toTitle,
  setSnowMode,
  get snowMode() { return snowMode; },
  input,
};

boot().catch((e) => {
  console.error(e);
  $('#splash-load').textContent = 'failed to load: ' + e.message;
});
