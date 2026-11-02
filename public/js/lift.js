// The lift of a nine-storey section (k9i_plan.py ELEVATOR), the way the old 320 kg KMZ lifts worked: a call button
// with a red lamp on every landing, a column of buttons in the cab (floors, STOP, the dispatcher's bell), doors
// that open in the middle, the cab and the landing doors moving together, 1 m/s between the floors. It answers one
// request at a time, the oldest first; a pressed button keeps its lamp lit until the cab gets there. Doors that
// close on somebody open again. The cab carries whoever stands in it.
//
// Plan heights are world heights (the sections stand on the ground), so the cab floor z is used as it is.

import * as THREE from 'three';
import { hkey } from './interiors.js';

const ACCEL = 0.55;        // m/s2
const DOOR_TIME = 1.4;     // seconds the doors take to open or close
const HOLD = 4.5;          // seconds they stay open
const HOLD_SHORT = 1.2;    // after a floor button inside
const RELAY = 0.45;        // the click of the relays before the cab moves and after it stops
const LEAF = 0.4;          // width of a door leaf; the doorway is two leaves wide
const SLIDE = 0.37;        // how far each leaf slides away
const V3 = THREE.Vector3;

export const LIFT_ASSETS = ['k9i_cab', 'k9i_cabdoor', 'k9i_shaftdoor', 'k9i_lamp', 'k9i_lamp_y', 'k9i_cable'];
export const isLiftAsset = (name) => LIFT_ASSETS.includes(name);

export class Lift {
  constructor(interiors, sec) {
    this.I = interiors;
    this.sec = sec;
    this.si = 0;
    this.P = sec.P;
    this.E = sec.P.elevator;
    this.floors = sec.P.FLOORS;
    // somewhere in the building, doors closed
    const f0 = hkey(sec.bid[0], sec.bid[1], sec.index, 0, 300) % this.floors;
    this.floor = f0;
    this.z = this.level(f0);
    this.v = 0;
    this.target = -1;
    this.queue = [];             // floors asked for, oldest first
    this.cabLit = new Set();     // lamps of the buttons in the cab
    this.callLit = new Set();    // lamps of the call buttons on the landings
    this.door = 0;               // 0 closed .. 1 open (the cab doors and the landing doors at the cab)
    this.state = 'idle';         // idle, opening, open, closing, start, moving, arrive, halted
    this.timer = 0;
    this.hold = HOLD;
    this.cols = [];
    this.flash = 0;              // the STOP and bell lamps light while pressed
    this.flashBtn = null;
    this.makeCols();
  }

  level(f) { return this.P.PL + f * this.P.FH; }

  // ---------------------------------------------------------------- buttons

  // what E can press: the call button of every landing, the buttons in the cab
  buttons() {
    const E = this.E, out = [];
    const [cx, cz] = E.call;
    for (let f = 0; f < this.floors; f++) {
      out.push({ kind: 'call', floor: f, size: 0.05, p: this.I.planToWorld(this.sec, cx, this.level(f) + cz, E.wall[0] - 0.02) });
    }
    for (const b of this.panel()) out.push({ ...b, size: 0.025, p: this.I.planToWorld(this.sec, b.x, this.z + b.h, b.y) });
    return out;
  }

  // the column of buttons on the right wall of the cab, by the door (the same places as in k9i.py)
  panel() {
    const [, y0, x1] = this.E.cab;
    const x = x1 - 0.02, y = y0 + 0.13;
    const out = [{ kind: 'bell', x, y, h: 0.88 }, { kind: 'stop', x, y, h: 0.95 }];
    for (let f = 0; f < this.floors; f++) out.push({ kind: 'floor', floor: f, x, y, h: 1.02 + f * 0.06 });
    return out;
  }

  label(b) {
    if (b.kind === 'call') return 'CALL LIFT';
    if (b.kind === 'stop') return 'STOP';
    if (b.kind === 'bell') return 'DISPATCHER';
    return 'FLOOR ' + (b.floor + 1);
  }

  press(b) {
    this.sound('lift_button');
    if (b.kind === 'bell') {
      this.flashBtn = b.kind;
      this.flash = 1.2;
      this.sound('lift_bell');
      return true;
    }
    if (b.kind === 'stop') {
      this.flashBtn = b.kind;
      this.flash = 0.4;
      if (this.state === 'moving' || this.state === 'start') {
        this.state = 'halted';
        this.queue = [];
        this.cabLit.clear();
        this.target = -1;
        this.sound('lift_stop');
      } else if (this.state === 'closing') {
        this.open();
      }
      return true;
    }
    const f = b.floor;
    const here = this.atRest() && this.floor === f;
    if (here) {
      // the cab is right here: the doors open (again)
      if (this.state === 'idle' || this.state === 'closing') this.open();
      else if (this.state === 'open') this.timer = 0;
      return true;
    }
    if (b.kind === 'call') this.callLit.add(f);
    else this.cabLit.add(f);
    if (!this.queue.includes(f)) this.queue.push(f);
    if (this.state === 'halted') this.state = 'idle';
    // somebody inside chose a floor: the doors do not wait long
    if (b.kind === 'floor' && this.state === 'open') this.hold = Math.min(this.hold, this.timer + HOLD_SHORT);
    return true;
  }

  atRest() { return this.state !== 'moving' && this.state !== 'start' && this.state !== 'halted' && Math.abs(this.z - this.level(this.floor)) < 0.005; }

  // ---------------------------------------------------------------- the machine

  open() {
    this.state = 'opening';
    this.timer = 0;
    this.sound('lift_door_open');
  }

  update(dt, player, cam) {
    this.timer += dt;
    this.flash = Math.max(0, this.flash - dt);
    const z0 = this.z;
    switch (this.state) {
      case 'idle': {
        const f = this.queue.find((q) => q !== this.floor);
        if (this.queue.includes(this.floor)) {
          this.serve(this.floor);
          this.open();
        } else if (f !== undefined) {
          this.target = f;
          this.state = 'start';
          this.timer = 0;
          this.sound('lift_relay');
        }
        break;
      }
      case 'opening':
        this.door = Math.min(1, this.door + dt / DOOR_TIME);
        if (this.door >= 1) { this.state = 'open'; this.timer = 0; this.hold = HOLD; }
        break;
      case 'open':
        if (this.inDoorway(player)) this.timer = Math.min(this.timer, this.hold - 1.0);
        if (this.timer > this.hold) { this.state = 'closing'; this.sound('lift_door_close'); }
        break;
      case 'closing':
        if (this.inDoorway(player)) { this.open(); break; }
        this.door = Math.max(0, this.door - dt / DOOR_TIME);
        if (this.door <= 0) { this.state = 'idle'; this.sound('lift_door_shut'); }
        break;
      case 'start':
        if (this.timer > RELAY) { this.state = 'moving'; this.sound('lift_start'); }
        break;
      case 'moving': {
        const goal = this.level(this.target);
        const d = goal - this.z;
        const dir = Math.sign(d);
        const vmax = this.E.speed;
        // slow down in time to stop at the floor
        const want = dir * Math.min(vmax, Math.sqrt(2 * ACCEL * Math.abs(d)) + 0.02);
        this.v += Math.max(-ACCEL * dt, Math.min(ACCEL * dt, want - this.v));
        let nz = this.z + this.v * dt;
        if ((goal - nz) * dir <= 0) {
          nz = goal;
          this.v = 0;
          this.floor = this.target;
          this.state = 'arrive';
          this.timer = 0;
          this.sound('lift_arrive');
        }
        this.z = nz;
        this.floor = Math.round((this.z - this.P.PL) / this.P.FH);
        break;
      }
      case 'arrive':
        if (this.timer > RELAY) {
          this.floor = this.target;
          this.serve(this.floor);
          this.target = -1;
          this.open();
        }
        break;
      case 'halted':
        // stopped between the floors: the cab waits for a floor button
        this.v = 0;
        break;
    }
    const dz = this.z - z0;
    if (dz !== 0 && player && this.carries(player)) player.pos.y += dz;
    this.makeCols();
  }

  serve(f) {
    this.queue = this.queue.filter((q) => q !== f);
    this.cabLit.delete(f);
    this.callLit.delete(f);
  }

  // the player in plan coordinates
  local(player) { return this.I.toPlan(this.sec, player.pos).clone(); }

  // standing in the cab (on its floor, between its walls)
  carries(player) {
    const lp = this.local(player), [sx0, , sx1, sy1] = this.E.shaft;
    return lp.x > sx0 && lp.x < sx1 && lp.z > this.E.wall[1] - 0.1 && lp.z < sy1 && lp.y > this.z - 0.5 && lp.y < this.z + 1.2;
  }

  // somebody between the doors: the landing doors and the cab doors would close on them
  inDoorway(player) {
    if (!player) return false;
    const lp = this.local(player), [d0, d1] = this.E.door;
    return lp.x > d0 - 0.3 && lp.x < d1 + 0.3 && lp.z > this.E.wall[0] - 0.32 && lp.z < this.E.cab[1] + 0.3 &&
      lp.y > this.z - 0.5 && lp.y < this.z + 1.0;
  }

  // ---------------------------------------------------------------- colliders and drawing

  makeCols() {
    const I = this.I, sec = this.sec, E = this.E, z = this.z, H = E.cab_h;
    const [sx0, sy0, sx1, sy1] = E.shaft;
    const [cx0, cy0, cx1, cy1] = E.cab;
    const [d0, d1] = E.door;
    const front = cy0 - 0.12;
    const out = [
      I.planBox(sec, sx0, sy0, sx1, sy1, z - 0.12, z),                 // floor of the cab
      I.planBox(sec, sx0, sy0, sx1, sy1, z + H, z + H + 0.1),          // its roof
      I.planBox(sec, sx0, front, cx0, sy1, z, z + H),                  // its walls
      I.planBox(sec, cx1, front, sx1, sy1, z, z + H),
      I.planBox(sec, cx0, cy1, cx1, sy1, z, z + H),
      I.planBox(sec, cx0, front, d0, cy0, z, z + H),
      I.planBox(sec, d1, front, cx1, cy0, z, z + H),
    ];
    // the doors: until the gap between the leaves lets a person through, the doorway is shut
    const open = SLIDE * 2 * this.door > 0.62;
    if (!open) out.push(I.planBox(sec, d0, front, d1, cy0, z, z + H));
    // the landing doors: shut on every floor but the one where the cab stands with its doors open
    for (let f = 0; f < this.floors; f++) {
      const zf = this.level(f);
      if (open && Math.abs(zf - z) < 0.02) continue;
      out.push(I.planBox(sec, d0, E.wall[0], d1, E.wall[1], zf, zf + 2.05));
    }
    this.cols = out;
  }

  // matrices of the moving parts, in the section's frame (assets are modeled there, k9i.py)
  draw(add) {
    const M = this.sec.matrix, z = this.z, E = this.E;
    // the parts modeled in place move by (x along the section, height); the lamps are put at a plan point
    const t = (x, y, zz) => M.clone().multiply(new THREE.Matrix4().makeTranslation(x, zz, -y));
    const at = (x, y, zz) => M.clone().multiply(new THREE.Matrix4().makeTranslation(x, zz, this.P.D / 2 - y));
    add('k9i_cab', t(0, 0, z));
    const s = SLIDE * this.door;
    // the left leaf is modeled closed, the right one is the same leaf a leaf's width over
    add('k9i_cabdoor', t(-s, 0, z));
    add('k9i_cabdoor', t(LEAF + s, 0, z));
    for (let f = 0; f < this.floors; f++) {
      const zf = this.level(f);
      const here = Math.abs(zf - z) < 0.02 ? s : 0;
      add('k9i_shaftdoor', t(-here, 0, zf));
      add('k9i_shaftdoor', t(LEAF + here, 0, zf));
    }
    // ropes from the roof of the cab up to the machine room
    const top = this.P.ROOF - 0.16, base = z + E.cab_h + 0.1;
    add('k9i_cable', t(0, 0, base).multiply(new THREE.Matrix4().makeScale(1, Math.max(0.01, top - base), 1)));
    // lamps: the call buttons that were pressed, the buttons pressed in the cab
    const [cx, cz] = E.call;
    for (const f of this.callLit) add('k9i_lamp', at(cx, E.wall[0] - 0.012, this.level(f) + cz + 0.09));
    for (const b of this.panel()) {
      const on = b.kind === 'floor' ? this.cabLit.has(b.floor) : this.flash > 0 && this.flashBtn === b.kind;
      if (on) add(b.kind === 'bell' ? 'k9i_lamp_y' : 'k9i_lamp', at(b.x - 0.006, b.y, z + b.h));
    }
  }

  sound(kind) {
    const cam = this.I.camPos;
    const p = this.I.planToWorld(this.sec, (this.E.shaft[0] + this.E.shaft[2]) / 2, this.z + 1.2, (this.E.shaft[1] + this.E.shaft[3]) / 2);
    const d = cam ? cam.distanceTo(p) : 0;
    const vol = Math.max(0, 1 - d / 22);
    if (vol > 0.02) this.I.onSound?.(kind, vol);
  }

  // how loud the motor and the ropes are, for the hum (0..1)
  hum(cam) {
    if (this.state !== 'moving') return 0;
    const p = this.I.planToWorld(this.sec, (this.E.shaft[0] + this.E.shaft[2]) / 2, this.z + 1.2, (this.E.shaft[1] + this.E.shaft[3]) / 2);
    return Math.max(0, 1 - cam.distanceTo(p) / 18) * Math.min(1, Math.abs(this.v) / this.E.speed + 0.2);
  }
}
