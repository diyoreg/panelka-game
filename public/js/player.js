// Player controller: walk, run, jump, crouch, ladders, collisions, third/first person camera.

import * as THREE from 'three';

const RADIUS = 0.3;
const STAND_H = 1.8;
const CROUCH_H = 1.15;
const STEP = 0.42;          // max ledge height you can just walk onto
// First person eyes: 0.2 under the top of the head (1.6 m standing). Indoors the view narrows: a wide angle shows
// a lot of floor under you in a 2.5 m room and makes you feel like a giant.
const EYE_DROP = 0.2;
const INDOOR_FOV = 0.82;
const GRAVITY = 16;
const JUMP_V = 6.1;
// close to the speeds the San Andreas clips were made for (models/player_anims.json),
// so the feet do not slide: walk 1.56, run 5.71, crouch walk 3.74 m/s at 1x
const SPEED = { walk: 1.5, run: 5.2, crouch: 2.0 };
// creative flight, like Minecraft: double Space toggles it
const FLY = { speed: 9, fast: 20, vertical: 7, ceiling: 320 };
const DOUBLE_TAP = 300;   // ms
// Ladders, as in Half-Life: walk into one and you hold on to it. W climbs where you look (up, or down while you
// look down), S the other way, Space lets go. Slow, the way you climb a steel ladder in a stairwell. At the top of
// the roof ladder you pull yourself out through the open hatch; walking into the open hatch from the roof takes
// you down onto the ladder. (Climbing onto balconies and ledges is gone: it carried you through walls into the
// flats. Street climbing comes later.)
// grab: how close in front of the ladder (along it, across it); snap: seconds to settle onto it;
// out: how far under the roof your feet are when you pull yourself out; rung: their spacing, for the head bob
const LADDER = { up: 0.8, down: 1.0, lookDown: -0.45, grab: [0.45, 0.28], snap: 0.25, out: 1.0, rung: 0.28 };

export class Input {
  constructor() {
    this.keys = new Set();
    this.mouse = { dx: 0, dy: 0 };
    this.pressed = new Set();   // keys pressed this frame
    this.doubles = new Set();   // keys double tapped this frame
    this.lastDown = {};
    addEventListener('keydown', (e) => {
      if (!this.keys.has(e.code)) {
        this.pressed.add(e.code);
        // double tap is timed by the events themselves, so it works at any frame rate
        if (e.timeStamp - (this.lastDown[e.code] ?? -1e9) < DOUBLE_TAP) {
          this.doubles.add(e.code);
          this.lastDown[e.code] = -1e9;
        } else {
          this.lastDown[e.code] = e.timeStamp;
        }
      }
      this.keys.add(e.code);
      if (this.enabled && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('mousemove', (e) => {
      if (document.pointerLockElement) {
        this.mouse.dx += e.movementX;
        this.mouse.dy += e.movementY;
      }
    });
    this.enabled = false;
  }
  down(...codes) { return codes.some((c) => this.keys.has(c)); }
  hit(...codes) { return codes.some((c) => this.pressed.has(c)); }
  double(...codes) { return codes.some((c) => this.doubles.has(c)); }
  endFrame() { this.pressed.clear(); this.doubles.clear(); this.mouse.dx = 0; this.mouse.dy = 0; }
}

export class Player {
  constructor(world, settings) {
    this.world = world;
    this.settings = settings;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.facing = 0;           // body yaw
    this.camYaw = 0;
    this.camPitch = -0.08;
    this.onGround = true;
    this.crouch = false;
    this.height = STAND_H;
    this.speed = 0;            // horizontal speed, for animation
    this.gait = 'idle';
    this.airTime = 0;
    this.distance = 0;         // total walked distance, drives steps
    this.landed = 0;           // landing impact strength, read by audio
    this.flying = false;
    this.sprint = false;       // latched by double tapping W
    this.fovKick = 0;          // extra field of view while sprinting or flying fast
    this.fovScale = 1;         // narrower view inside buildings in first person
    this.camDist = 4.2;
    this.bob = 0;
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
    this.ladder = null;        // { L, snap, from } while holding on to a ladder
    this.climbVel = 0;         // up or down the ladder, m/s
    this.climbed = 0;          // meters climbed, for the head bob and the steps
    this.scene = null;         // { segs, i, t, done } while pulling yourself out of the hatch or climbing in
    this.ladders = () => [];   // set by main.js: the ladders near you (interiors.js)
    this.indoor = false;       // inside a building (set by main.js): the camera stays closer
    this.flash = false;        // flashlight on (F)
  }

  // eyes above the feet in first person (and where E reaches from)
  get eye() { return this.height - EYE_DROP; }

  spawn(p) {
    this.pos.set(p.x, p.y, p.z);
    this.vel.set(0, 0, 0);
    this.camYaw = p.camYaw ?? p.yaw ?? 0;
    this.facing = p.yaw ?? this.camYaw;
    this.camPitch = p.camPitch ?? -0.08;
    this.ladder = null;
    this.scene = null;
    this.climbVel = 0;
    this.unstick();
  }

  // If spawned inside geometry, push out upward or sideways
  unstick() {
    for (let i = 0; i < 40; i++) {
      const hit = this.world.collidersNear(this.pos.x, this.pos.z, 1).find((b) => this.overlaps(b, this.pos, this.height));
      if (!hit) return;
      this.pos.x += 1.0;
    }
  }

  overlaps(b, p, h) {
    return p.x + RADIUS > b.min.x && p.x - RADIUS < b.max.x && p.z + RADIUS > b.min.z && p.z - RADIUS < b.max.z
      && p.y + h > b.min.y + 0.01 && p.y < b.max.y - 0.01;
  }

  update(dt, input) {
    const s = this.settings;
    // look
    const sens = 0.0022 * s.sens;
    this.camYaw -= input.mouse.dx * sens;
    this.camPitch -= input.mouse.dy * sens * (s.invertY ? -1 : 1);
    this.camPitch = Math.max(-1.35, Math.min(1.25, this.camPitch));

    if (this.scene) {
      this.updateScene(dt);
      this.updateCamera(dt);
      return;
    }
    if (this.ladder) {
      this.updateLadder(dt, input);
      this.updateCamera(dt);
      return;
    }

    // double tap W: sprint while W stays held
    if (input.double('KeyW', 'ArrowUp')) this.sprint = true;
    // double tap Space: flight on and off, a single tap is a jump
    let jumpPressed = input.hit('Space') && !input.double('Space');
    if (input.double('Space')) {
      this.flying = !this.flying;
      if (this.flying) {
        this.crouch = this.wantCrouch = false;
        this.vel.y = Math.max(this.vel.y, 0);
        this.onGround = false;
      }
    }

    // crouch (in flight C means down)
    if (this.flying) {
      this.wantCrouch = false;
    } else if (s.crouchToggle) {
      if (input.hit('KeyC')) this.wantCrouch = !this.wantCrouch;
    } else {
      this.wantCrouch = input.down('KeyC');
    }
    if (this.wantCrouch && !this.crouch) this.crouch = true;
    if (!this.wantCrouch && this.crouch && this.canStand()) this.crouch = false;
    const targetH = this.crouch ? CROUCH_H : STAND_H;
    this.height += (targetH - this.height) * Math.min(1, dt * 12);

    // move direction relative to camera
    let fx = 0, fz = 0;
    if (input.down('KeyW', 'ArrowUp')) fz += 1;
    if (input.down('KeyS', 'ArrowDown')) fz -= 1;
    if (input.down('KeyA', 'ArrowLeft')) fx -= 1;
    if (input.down('KeyD', 'ArrowRight')) fx += 1;
    const len = Math.hypot(fx, fz);
    if (!input.down('KeyW', 'ArrowUp') || this.crouch) this.sprint = false;
    const running = (input.down('ShiftLeft', 'ShiftRight') || this.sprint) && !this.crouch;
    const maxV = this.flying ? (running ? FLY.fast : FLY.speed)
      : this.crouch ? SPEED.crouch : running ? SPEED.run : SPEED.walk;
    const fwd = new THREE.Vector3(Math.sin(this.camYaw), 0, Math.cos(this.camYaw)).multiplyScalar(-1);
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const want = new THREE.Vector3();
    if (len > 0) want.addScaledVector(fwd, fz / len).addScaledVector(right, fx / len).multiplyScalar(maxV);
    // walking into a ladder grabs it, walking into the open hatch from the roof climbs down onto it
    if (len > 0 && !this.flying && this.grabLadder(want)) {
      this.updateCamera(dt);
      return;
    }
    const accel = this.flying ? 5 : this.onGround ? (len > 0 ? 10 : 12) : 2.5;
    const hv = new THREE.Vector3(this.vel.x, 0, this.vel.z);
    hv.lerp(want, Math.min(1, accel * dt));
    this.vel.x = hv.x;
    this.vel.z = hv.z;

    // body turns toward movement (third person) or follows camera (first person)
    if (s.camera === 'first') {
      this.facing = this.camYaw + Math.PI;
    } else if (hv.lengthSq() > 0.05) {
      const target = Math.atan2(hv.x, hv.z);
      let d = target - this.facing;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.facing += d * Math.min(1, dt * 10);
    }

    // jump
    if (jumpPressed && this.onGround && !this.flying) {
      if (this.crouch && this.canStand()) { this.crouch = false; this.wantCrouch = false; }
      this.vel.y = JUMP_V;
      this.onGround = false;
      this.jumped = true;
    }

    if (this.flying) {
      // no gravity: Space up, C down, ease in and out
      const vy = (input.down('Space') ? FLY.vertical : 0) - (input.down('KeyC') ? FLY.vertical : 0);
      this.vel.y += (vy - this.vel.y) * Math.min(1, dt * 6);
      if (this.pos.y > FLY.ceiling && this.vel.y > 0) this.vel.y = 0;
    } else {
      this.vel.y -= GRAVITY * dt;
    }
    this.move(dt);
    // touching the ground while flying lands you, like in Minecraft
    if (this.flying && this.onGround && !input.down('Space')) this.flying = false;

    const kick = this.flying ? (running ? 14 : 4) : running && this.speed > 3 ? 7 : 0;
    this.fovKick += (kick - this.fovKick) * Math.min(1, dt * 5);
    const scale = this.indoor && s.camera === 'first' ? INDOOR_FOV : 1;
    this.fovScale += (scale - this.fovScale) * Math.min(1, dt * 3);

    this.speed = Math.hypot(this.vel.x, this.vel.z);
    this.distance += this.speed * dt;
    this.gait = !this.onGround ? 'air' : this.speed < 0.25 ? 'idle' : this.crouch ? 'crouch' : this.speed > 3.2 ? 'run' : 'walk';
    this.updateCamera(dt);
  }

  // ---------------------------------------------------------------- ladders

  // where you are in the terms of a ladder: along its n from the stand point, across it, feet above its foot
  ladderLocal(L) {
    const dx = this.pos.x - L.stand.x, dz = this.pos.z - L.stand.z;
    return { along: dx * L.n.x + dz * L.n.z, across: dx * -L.n.z + dz * L.n.x, up: this.pos.y - L.y0 };
  }

  grabLadder(want) {
    const w = want.clone().normalize();
    for (const L of this.ladders()) {
      const q = this.ladderLocal(L);
      // on the top landing, right in front of the rungs and walking at them
      if (this.onGround && q.up > -0.1 && q.up < L.roof - L.y0 - LADDER.out - 0.2 && Math.abs(q.across) < LADDER.grab[1]
        && q.along > -LADDER.grab[0] && q.along < 0.1 && w.x * L.n.x + w.z * L.n.z > 0.5) {
        this.holdLadder(L);
        return true;
      }
      // on the roof, stepping into the open hatch (before you drop through it)
      const [a0, a1] = L.hatchAlong;
      if (Math.abs(this.pos.y - L.roof) < 0.3 && L.open() && Math.abs(q.across) < L.hatchHalf + 0.15
        && q.along > a0 - 0.15 && q.along < a1 + 0.15) {
        const mid = (a0 + a1) / 2;
        const tx = L.stand.x + L.n.x * mid - this.pos.x, tz = L.stand.z + L.n.z * mid - this.pos.z;
        if (w.x * tx + w.z * tz > 0) {
          this.climbDown(L);
          return true;
        }
      }
    }
    return false;
  }

  holdLadder(L, snap = 0) {
    this.ladder = { L, snap, from: this.pos.clone() };
    this.vel.set(0, 0, 0);
    this.climbVel = 0;
    this.onGround = false;
    this.sprint = false;
    this.crouch = this.wantCrouch = false;
    this.flying = false;
  }

  letGo(onGround) {
    this.ladder = null;
    this.climbVel = 0;
    this.onGround = onGround;
  }

  updateLadder(dt, input) {
    const c = this.ladder, L = c.L;
    c.snap = Math.min(1, c.snap + dt / LADDER.snap);
    const k = c.snap * c.snap * (3 - 2 * c.snap);
    this.height += (STAND_H - this.height) * Math.min(1, dt * 12);
    this.facing = Math.atan2(L.n.x, L.n.z);
    this.speed = 0;
    this.gait = 'ladder';
    // Space: let go, pushing yourself back off the rungs
    if (input.hit('Space')) {
      this.letGo(false);
      this.vel.set(-L.n.x * 1.6, 2.2, -L.n.z * 1.6);
      return;
    }
    let dir = (input.down('KeyW', 'ArrowUp') ? 1 : 0) - (input.down('KeyS', 'ArrowDown') ? 1 : 0);
    if (this.camPitch < LADDER.lookDown) dir = -dir;
    const v = dir * (dir > 0 ? LADDER.up : LADDER.down);
    this.climbVel += (v - this.climbVel) * Math.min(1, dt * 8);
    let y = this.pos.y + this.climbVel * dt * k;
    const open = L.open();
    if (open && dir > 0 && y >= L.roof - LADDER.out) {
      this.climbOut(L);
      return;
    }
    // under a closed lid your head stops at the ceiling
    if (!open) y = Math.min(y, L.ceil - STAND_H - 0.02);
    if (y <= L.y0) {
      y = L.y0;
      if (dir < 0) {
        this.pos.y = y;
        this.letGo(true);
        return;
      }
    }
    this.climbed += Math.abs(y - this.pos.y);
    this.pos.set(c.from.x + (L.stand.x - c.from.x) * k, y, c.from.z + (L.stand.z - c.from.z) * k);
  }

  // Pull yourself out through the hatch: up with the hands on the edge, crouched, over the kerb, stand up on the roof
  climbOut(L) {
    const up = L.roof + 0.25;
    const at = (d, y) => new THREE.Vector3(L.stand.x + L.n.x * d, y, L.stand.z + L.n.z * d);
    const out = L.hatchAlong[1] + 0.55;
    this.letGo(false);
    this.startScene([
      { to: at(0, up), h: CROUCH_H, dur: 1.3 },
      { to: at(out, up), h: CROUCH_H, dur: 0.8 },
      { to: at(out, L.roof), h: STAND_H, dur: 0.45 },
    ], () => { this.onGround = true; this.landed = 0.2; }, Math.atan2(L.n.x, L.n.z));
  }

  // From the roof into the hatch: over it, turn around to face the rungs, down onto the ladder
  climbDown(L) {
    const above = new THREE.Vector3(L.stand.x, L.roof + 0.25, L.stand.z);
    const yaw = Math.atan2(-L.n.x, -L.n.z);
    const d = Math.hypot(above.x - this.pos.x, above.z - this.pos.z);
    this.vel.set(0, 0, 0);
    this.sprint = false;
    this.startScene([
      { to: above, h: CROUCH_H, dur: 0.5 + d * 0.6, yaw },
      { to: new THREE.Vector3(L.stand.x, L.roof - LADDER.out - 0.2, L.stand.z), h: STAND_H, dur: 1.2 },
    ], () => this.holdLadder(L, 1), Math.atan2(L.n.x, L.n.z));
  }

  startScene(segs, done, facing) {
    this.scene = { segs, i: 0, t: 0, done, from: this.pos.clone(), h0: this.height, yaw0: this.camYaw };
    this.facing = facing;
    this.onGround = false;
    this.crouch = this.wantCrouch = false;
  }

  updateScene(dt) {
    const s = this.scene, g = s.segs[s.i];
    s.t = Math.min(1, s.t + dt / g.dur);
    const e = s.t * s.t * (3 - 2 * s.t);
    const prevY = this.pos.y;
    this.pos.lerpVectors(s.from, g.to, e);
    this.height = s.h0 + (g.h - s.h0) * e;
    if (g.yaw !== undefined) {
      const d = Math.atan2(Math.sin(g.yaw - s.yaw0), Math.cos(g.yaw - s.yaw0));
      this.camYaw = s.yaw0 + d * e;
    }
    this.climbed += Math.abs(this.pos.y - prevY);
    this.speed = 0;
    this.gait = 'scene';
    if (s.t < 1) return;
    s.i++;
    s.t = 0;
    s.from = this.pos.clone();
    s.h0 = this.height;
    s.yaw0 = this.camYaw;
    if (s.i < s.segs.length) return;
    this.scene = null;
    this.vel.set(0, 0, 0);
    s.done();
  }

  canStand() {
    const p = this.pos;
    return !this.world.collidersNear(p.x, p.z, 1).some((b) => this.overlaps(b, p, STAND_H));
  }

  move(dt) {
    const p = this.pos;
    const steps = Math.max(1, Math.ceil(Math.hypot(this.vel.x, this.vel.z, this.vel.y) * dt / 0.15));
    const sdt = dt / steps;
    const wasGround = this.onGround;
    const vyBefore = this.vel.y;
    for (let i = 0; i < steps; i++) {
      const cols = this.world.collidersNear(p.x, p.z, 2);
      // horizontal
      p.x += this.vel.x * sdt;
      p.z += this.vel.z * sdt;
      for (const b of cols) {
        if (p.y + this.height <= b.min.y + 0.01 || p.y + STEP >= b.max.y) continue;
        // circle vs box in XZ
        const cx = Math.max(b.min.x, Math.min(p.x, b.max.x));
        const cz = Math.max(b.min.z, Math.min(p.z, b.max.z));
        let dx = p.x - cx, dz = p.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= RADIUS * RADIUS) continue;
        if (d2 < 1e-8) {
          // center inside box: push out along the shortest axis
          const pen = [p.x - b.min.x + RADIUS, b.max.x - p.x + RADIUS, p.z - b.min.z + RADIUS, b.max.z - p.z + RADIUS];
          const k = pen.indexOf(Math.min(...pen));
          if (k === 0) p.x = b.min.x - RADIUS; else if (k === 1) p.x = b.max.x + RADIUS;
          else if (k === 2) p.z = b.min.z - RADIUS; else p.z = b.max.z + RADIUS;
          continue;
        }
        const d = Math.sqrt(d2);
        p.x = cx + dx / d * RADIUS;
        p.z = cz + dz / d * RADIUS;
        // kill velocity into the wall
        const nx = dx / d, nz = dz / d;
        const vn = this.vel.x * nx + this.vel.z * nz;
        if (vn < 0) { this.vel.x -= vn * nx; this.vel.z -= vn * nz; }
      }
      // vertical
      p.y += this.vel.y * sdt;
      let floor = this.world.groundY(p.x, p.z);
      let ceil = Infinity;
      for (const b of cols) {
        if (p.x + RADIUS * 0.7 <= b.min.x || p.x - RADIUS * 0.7 >= b.max.x || p.z + RADIUS * 0.7 <= b.min.z || p.z - RADIUS * 0.7 >= b.max.z) continue;
        if (b.max.y <= p.y + STEP + Math.max(0, -this.vel.y * sdt)) floor = Math.max(floor, b.max.y);
        else if (b.min.y >= p.y + 0.2) ceil = Math.min(ceil, b.min.y);
      }
      if (p.y + this.height > ceil && this.vel.y > 0) { p.y = ceil - this.height; this.vel.y = 0; }
      if (p.y <= floor + 0.001) {
        // snap up small steps, land on surfaces
        if (floor - p.y < STEP + 0.05) {
          p.y = floor;
          if (this.vel.y < 0) this.vel.y = 0;
          this.onGround = true;
        }
      } else if (this.onGround && !this.flying && p.y - floor < 0.3 && this.vel.y <= 0) {
        // stick to ground when walking down curbs
        p.y = floor;
        this.vel.y = 0;
      } else {
        this.onGround = false;
      }
      if (this.flying && this.vel.y > 0) this.onGround = false;
    }
    if (!wasGround && this.onGround) this.landed = Math.min(1, Math.max(0, -vyBefore / 9));
    if (p.y < -20) { p.y = 5; this.vel.set(0, 0, 0); }
  }

  updateCamera(dt) {
    const s = this.settings;
    const p = this.pos;
    if (s.camera === 'first') {
      const eye = this.eye;
      let bobY = 0, bobX = 0;
      if (s.headBob && this.onGround && this.speed > 0.3) {
        const ph = this.distance * (this.speed > 4 ? 1.35 : 1.75);
        bobY = Math.abs(Math.sin(ph)) * 0.05 * Math.min(1, this.speed / 3);
        bobX = Math.cos(ph) * 0.025 * Math.min(1, this.speed / 3);
      } else if (s.headBob && (this.ladder || this.scene)) {
        // a hand over hand rhythm, rung by rung
        const ph = this.climbed / LADDER.rung * Math.PI;
        bobY = Math.sin(ph) * 0.02;
        bobX = Math.sin(ph * 0.5) * 0.03;
      }
      const right = new THREE.Vector3(Math.cos(this.camYaw), 0, -Math.sin(this.camYaw));
      this.camPos.set(p.x, p.y + eye + bobY, p.z).addScaledVector(right, bobX);
      const dir = new THREE.Vector3(-Math.sin(this.camYaw) * Math.cos(this.camPitch), Math.sin(this.camPitch), -Math.cos(this.camYaw) * Math.cos(this.camPitch));
      this.camLook.copy(this.camPos).add(dir);
      return;
    }
    const pivot = new THREE.Vector3(p.x, p.y + this.height - 0.15, p.z);
    const dir = new THREE.Vector3(Math.sin(this.camYaw) * Math.cos(this.camPitch), -Math.sin(this.camPitch), Math.cos(this.camYaw) * Math.cos(this.camPitch));
    const want = this.indoor ? (this.crouch ? 1.7 : 2.2) : (this.crouch ? 3.4 : 4.3) + (this.gait === 'run' ? 0.5 : 0);
    // pull camera in front of walls
    let dist = want;
    const cols = this.world.collidersNear(pivot.x, pivot.z, want + 1);
    const tmp = new THREE.Vector3();
    for (let t = 0.3; t <= want; t += 0.15) {
      tmp.copy(pivot).addScaledVector(dir, t);
      const ground = this.world.groundY(tmp.x, tmp.z) + 0.25;
      let blocked = tmp.y < ground;
      if (!blocked) {
        for (const b of cols) {
          if (tmp.x > b.min.x - 0.2 && tmp.x < b.max.x + 0.2 && tmp.z > b.min.z - 0.2 && tmp.z < b.max.z + 0.2 && tmp.y > b.min.y - 0.2 && tmp.y < b.max.y + 0.2) { blocked = true; break; }
        }
      }
      if (blocked) { dist = Math.max(0.6, t - 0.2); break; }
    }
    this.camDist += (dist - this.camDist) * Math.min(1, dt * (dist < this.camDist ? 20 : 4));
    this.camPos.copy(pivot).addScaledVector(dir, this.camDist);
    this.camLook.copy(pivot).addScaledVector(dir, -2);
    this.camLook.y += 0.1;
  }
}
