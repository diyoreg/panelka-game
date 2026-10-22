// Player controller: walk, run, jump, crouch, climb onto ledges, collisions, third/first person camera.

import * as THREE from 'three';

const RADIUS = 0.3;
const STAND_H = 1.8;
const CROUCH_H = 1.15;
const STEP = 0.42;          // max ledge height you can just walk onto
const GRAVITY = 16;
const JUMP_V = 6.1;
// close to the speeds the San Andreas clips were made for (models/player_anims.json),
// so the feet do not slide: walk 1.56, run 5.71, crouch walk 3.74 m/s at 1x
const SPEED = { walk: 1.5, run: 5.2, crouch: 2.0 };
// creative flight, like Minecraft: double Space toggles it
const FLY = { speed: 9, fast: 20, vertical: 7, ceiling: 320 };
const DOUBLE_TAP = 300;   // ms
// Space in front of a ledge (a balcony, a canopy, a car roof, a garage) climbs onto it instead of jumping.
// From a balcony you reach the floor of the one above: out over the rail, up, and back in.
const CLIMB = { reach: 3.05, probe: [0.45, 0.8, 1.15, 0], speed: 4.2 };

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
    this.camDist = 4.2;
    this.bob = 0;
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
    this.climb = null;         // { path, t, len } while climbing
  }

  spawn(p) {
    this.pos.set(p.x, p.y, p.z);
    this.vel.set(0, 0, 0);
    this.camYaw = p.camYaw ?? p.yaw ?? 0;
    this.facing = p.yaw ?? this.camYaw;
    this.camPitch = p.camPitch ?? -0.08;
    this.climb = null;
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

    if (this.climb) {
      this.updateClimb(dt);
      this.updateCamera(dt);
      return;
    }

    // double tap W: sprint while W stays held
    if (input.double('KeyW', 'ArrowUp')) this.sprint = true;
    // double tap Space: flight on and off, a single tap is a jump
    let jumpPressed = input.hit('Space') && !input.double('Space');
    if (jumpPressed && this.onGround && !this.flying && this.startClimb()) {
      this.updateCamera(dt);
      return;
    }
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

    this.speed = Math.hypot(this.vel.x, this.vel.z);
    this.distance += this.speed * dt;
    this.gait = !this.onGround ? 'air' : this.speed < 0.25 ? 'idle' : this.crouch ? 'crouch' : this.speed > 3.2 ? 'run' : 'walk';
    this.updateCamera(dt);
  }

  // ---------------------------------------------------------------- climbing

  // Look for a surface to climb onto in front of the camera (or right above, under a balcony)
  startClimb() {
    const p = this.pos;
    const fx = -Math.sin(this.camYaw), fz = -Math.cos(this.camYaw);
    const cols = this.world.collidersNear(p.x, p.z, 3.2);
    for (const d of CLIMB.probe) {
      const tx = p.x + fx * d, tz = p.z + fz * d;
      const tops = [];
      for (const b of cols) {
        if (tx < b.min.x || tx > b.max.x || tz < b.min.z || tz > b.max.z) continue;
        if (b.max.y > p.y + STEP && b.max.y <= p.y + CLIMB.reach) tops.push(b.max.y);
      }
      tops.sort((a, b) => a - b);
      for (const ty of tops) {
        const target = new THREE.Vector3(tx, ty, tz);
        const stand = !cols.some((b) => this.overlaps(b, target, STAND_H));
        const crouch = stand || !cols.some((b) => this.overlaps(b, target, CROUCH_H));
        if (!crouch) continue;
        const path = this.climbPath(target, fx, fz, cols);
        if (!path) continue;
        let len = 0;
        for (let i = 1; i < path.length; i++) len += path[i].distanceTo(path[i - 1]);
        this.climb = { path, t: 0, len, crouch: !stand };
        this.vel.set(0, 0, 0);
        this.onGround = false;
        this.sprint = false;
        this.facing = Math.atan2(fx, fz);
        return true;
      }
    }
    return false;
  }

  // Way up that does not cut through rails and slabs: step out from under a ceiling first,
  // then rise above whatever is between us and the target, move over and settle down on it.
  climbPath(target, fx, fz, cols) {
    const p = this.pos.clone();
    const pts = [p];
    const top = target.y + STAND_H * 0.6;
    let a = p;
    if (!columnFree(cols, p.x, p.z, p.y + 0.2, top)) {
      // ahead, back, then to the sides: from a balcony that is out over the rail
      let out = null;
      for (let o = 0.3; o <= 2.0 && !out; o += 0.15) {
        for (const [dx, dz] of [[fx, fz], [-fx, -fz], [-fz, fx], [fz, -fx]]) {
          const q = new THREE.Vector3(p.x + dx * o, p.y, p.z + dz * o);
          if (columnFree(cols, q.x, q.z, p.y + 0.5, top)) { out = q; break; }
        }
      }
      if (!out) return null;
      const h0 = Math.min(highest(cols, p, out, p.y, p.y + 1.3), p.y + 1.3) + 0.05;
      pts.push(new THREE.Vector3(p.x, h0, p.z), new THREE.Vector3(out.x, h0, out.z));
      a = new THREE.Vector3(out.x, h0, out.z);
    }
    const h = highest(cols, a, target, target.y - 0.01, target.y + 1.3) + 0.05;
    if (h > this.pos.y + CLIMB.reach + 1.4) return null;
    pts.push(new THREE.Vector3(a.x, h, a.z), new THREE.Vector3(target.x, h, target.z), target);
    return pts;
  }

  updateClimb(dt) {
    const c = this.climb;
    c.t += dt * CLIMB.speed;
    let d = Math.min(c.t, c.len);
    let i = 1;
    while (i < c.path.length - 1 && d > c.path[i].distanceTo(c.path[i - 1])) {
      d -= c.path[i].distanceTo(c.path[i - 1]);
      i++;
    }
    const a = c.path[i - 1], b = c.path[i];
    const seg = a.distanceTo(b);
    this.pos.lerpVectors(a, b, seg > 1e-5 ? Math.min(1, d / seg) : 1);
    this.speed = 0;
    this.gait = 'air';
    if (c.t >= c.len) {
      this.pos.copy(c.path[c.path.length - 1]);
      this.climb = null;
      this.onGround = true;
      this.vel.set(0, 0, 0);
      if (c.crouch) { this.crouch = true; this.wantCrouch = true; }
      this.landed = 0.25;
    }
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
      const eye = this.height - 0.12;
      let bobY = 0, bobX = 0;
      if (s.headBob && this.onGround && this.speed > 0.3) {
        const ph = this.distance * (this.speed > 4 ? 1.35 : 1.75);
        bobY = Math.abs(Math.sin(ph)) * 0.05 * Math.min(1, this.speed / 3);
        bobX = Math.cos(ph) * 0.025 * Math.min(1, this.speed / 3);
      }
      const right = new THREE.Vector3(Math.cos(this.camYaw), 0, -Math.sin(this.camYaw));
      this.camPos.set(p.x, p.y + eye + bobY, p.z).addScaledVector(right, bobX);
      const dir = new THREE.Vector3(-Math.sin(this.camYaw) * Math.cos(this.camPitch), Math.sin(this.camPitch), -Math.cos(this.camYaw) * Math.cos(this.camPitch));
      this.camLook.copy(this.camPos).add(dir);
      return;
    }
    const pivot = new THREE.Vector3(p.x, p.y + this.height - 0.15, p.z);
    const dir = new THREE.Vector3(Math.sin(this.camYaw) * Math.cos(this.camPitch), -Math.sin(this.camPitch), Math.cos(this.camYaw) * Math.cos(this.camPitch));
    const want = (this.crouch ? 3.4 : 4.3) + (this.gait === 'run' ? 0.5 : 0);
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

// no collider in a thin vertical column between y0 and y1
function columnFree(cols, x, z, y0, y1) {
  const r = RADIUS * 0.8;
  return !cols.some((b) => x + r > b.min.x && x - r < b.max.x && z + r > b.min.z && z - r < b.max.z && b.max.y > y0 && b.min.y < y1);
}

// highest top of the colliders along a segment, counting only tops between lo and hi
function highest(cols, a, b, lo, hi) {
  let h = lo;
  const n = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.1));
  for (let i = 0; i <= n; i++) {
    const x = a.x + (b.x - a.x) * i / n, z = a.z + (b.z - a.z) * i / n;
    for (const c of cols) {
      if (x + RADIUS * 0.6 < c.min.x || x - RADIUS * 0.6 > c.max.x || z + RADIUS * 0.6 < c.min.z || z - RADIUS * 0.6 > c.max.z) continue;
      if (c.max.y > h && c.max.y <= hi) h = c.max.y;
    }
  }
  return h;
}
