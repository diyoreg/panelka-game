// Animated player character: models/player.glb with GTA San Andreas clips converted by
// tools/sa_anims_to_glb.py. models/player_anims.json holds, per clip, the ground speed it was
// authored for (to match playback to movement) and the heel contacts (for footstep sounds).
// The model faces +Z.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { makeSkinnedMaterial } from './materials.js';

const HEIGHT = 1.8;

const FADE = {
  idle: 0.35, walk: 0.25, run: 0.2, crouch_idle: 0.25, crouch_walk: 0.25, jump: 0.15, fly: 0.3,
  idle_look: 0.4, idle_scratch: 0.4, idle_tired: 0.4,
};
// one-shot idle variations while standing still, like San Andreas pedestrians
const IDLE_EXTRAS = ['idle_look', 'idle_scratch'];

export class Character {
  async load(url) {
    const [gltf, meta] = await Promise.all([
      new GLTFLoader().loadAsync(url),
      fetch(url.replace(/\.glb$/, '_anims.json')).then((r) => r.json()).catch(() => ({})),
    ]);
    this.meta = meta;
    const model = gltf.scene;
    model.updateMatrixWorld(true);
    // normalize to HEIGHT and stand on y = 0
    const box = new THREE.Box3().setFromObject(model);
    model.scale.multiplyScalar(HEIGHT / (box.max.y - box.min.y));
    model.updateMatrixWorld(true);
    const box2 = new THREE.Box3().setFromObject(model);
    model.position.y -= box2.min.y;
    model.position.x -= (box2.min.x + box2.max.x) / 2;
    model.position.z -= (box2.min.z + box2.max.z) / 2;

    model.traverse((o) => {
      if (o.isMesh) {
        o.material = makeSkinnedMaterial(o.material.map || null);
        o.frustumCulled = false;
      }
    });
    this.root = new THREE.Group();
    this.root.add(model);

    this.mixer = new THREE.AnimationMixer(model);
    this.actions = {};
    for (const clip of gltf.animations) {
      // the exporter does not start every track at t = 0: align each one, every track spans one loop
      clip.tracks.forEach((tr) => {
        const t0 = tr.times[0];
        for (let i = 0; i < tr.times.length; i++) tr.times[i] -= t0;
      });
      clip.resetDuration();
      const action = this.mixer.clipAction(clip);
      if (meta[clip.name] && meta[clip.name].loop === false) {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      this.actions[clip.name] = action;
    }
    this.idleTime = 0;
    this.nextExtra = 8 + Math.random() * 8;
    this.tired = 0;

    // The San Andreas stance carries the pelvis a little lower than the model's bind pose:
    // lift the model so the feet stand on the ground in idle exactly as they do in the bind pose.
    const feet = [];
    model.traverse((o) => { if (o.isBone && /toes|ankle/.test(o.name)) feet.push(o); });
    const v = new THREE.Vector3();
    const lowestFoot = () => {
      model.updateMatrixWorld(true);
      let m = Infinity;
      for (const f of feet) m = Math.min(m, f.getWorldPosition(v).y);
      return m;
    };
    const bindFoot = lowestFoot();
    if (this.actions.idle) {
      this.actions.idle.play();
      this.mixer.update(0);
      model.position.y += bindFoot - lowestFoot();
      this.actions.idle.stop();
    }
    this.state = null;
    this.onStep = null;
    this.lastPhase = 0;
    this.airTime = 0;
    this.play('idle', 0);

    this.shadow = makeBlobShadow();
    return this;
  }

  play(name, fade = FADE[name]) {
    const next = this.actions[name];
    if (!next || name === this.state) return;
    const prev = this.state ? this.actions[this.state] : null;
    next.enabled = true;
    next.setEffectiveTimeScale(1);
    next.setEffectiveWeight(1);
    next.reset();
    // keep the step rhythm when switching between moving clips
    if (prev && this.contacts(name).length && this.contacts(this.state).length) {
      next.time = (prev.time / prev.getClip().duration) * next.getClip().duration;
    }
    next.play();
    if (prev) prev.crossFadeTo(next, fade, false);
    this.state = name;
    this.lastPhase = next.time / next.getClip().duration;
  }

  update(dt, pl, visible) {
    this.root.visible = visible;
    this.shadow.visible = visible;
    this.root.position.copy(pl.pos);
    this.root.rotation.y = pl.facing;
    this.shadow.position.set(pl.pos.x, (pl.onGround ? pl.pos.y : pl.world.groundY(pl.pos.x, pl.pos.z)) + 0.02, pl.pos.z);

    // short hops off a curb should not flash the jump pose
    this.airTime = pl.onGround ? 0 : this.airTime + dt;
    const moving = pl.speed > 0.25;
    // catching breath after a long run
    if (pl.gait === 'run') this.tired = Math.min(12, this.tired + dt);
    else if (!moving) this.tired = Math.max(0, this.tired - dt * 1.5);
    let want;
    if (pl.flying) want = 'fly';
    else if (this.airTime > 0.12 || (!pl.onGround && pl.vel.y > 0.5)) want = 'jump';
    else if (pl.crouch) want = moving ? 'crouch_walk' : 'crouch_idle';
    else if (moving) want = pl.speed > 3.2 ? 'run' : 'walk';
    else want = this.pickIdle(dt);
    if (want !== 'idle' && !IDLE_EXTRAS.includes(want)) this.idleTime = 0;
    this.play(want);

    const a = this.actions[this.state];
    const natural = this.meta[this.state]?.speed;
    if (natural) {
      a.setEffectiveTimeScale(THREE.MathUtils.clamp(pl.speed / natural, 0.5, 1.7));
    }
    this.mixer.update(dt);

    // footstep events at heel contacts
    const contacts = this.contacts(this.state);
    if (contacts.length && this.onStep) {
      const ph = a.time / a.getClip().duration;
      for (const c of contacts) {
        const crossed = this.lastPhase <= ph ? (this.lastPhase < c && ph >= c) : (this.lastPhase < c || ph >= c);
        if (crossed) this.onStep(this.state);
      }
      this.lastPhase = ph;
    }
  }
}

Character.prototype.contacts = function (name) {
  return (this.meta[name] && this.meta[name].contacts) || [];
};

// Standing still: tired breathing after running, otherwise idle with an occasional look around or scratch
Character.prototype.pickIdle = function (dt) {
  if (this.tired > 4) return 'idle_tired';
  this.idleTime += dt;
  if (IDLE_EXTRAS.includes(this.state)) {
    const a = this.actions[this.state];
    // one-shot clip: go back to idle when it is done
    if (a.time < a.getClip().duration - 0.05 && a.isRunning()) return this.state;
    this.nextExtra = this.idleTime + 10 + Math.random() * 14;
    return 'idle';
  }
  if (this.idleTime > this.nextExtra && this.actions.idle_look) return IDLE_EXTRAS[Math.floor(Math.random() * IDLE_EXTRAS.length)];
  return 'idle';
};

function makeBlobShadow() {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const g = c.getContext('2d');
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const d = Math.hypot(x - 7.5, y - 7.5) / 8;
    if (d < 1) { g.fillStyle = `rgba(0,0,8,${(0.6 * (1 - d * d)).toFixed(3)})`; g.fillRect(x, y, 1, 1); }
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
  m.renderOrder = 1;
  return m;
}
