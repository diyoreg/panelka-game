// Insides of the khrushchyovka (data/blender/k5i.py, plan in k5i_plan.py, shipped as models/k5i_plan.json).
// The walls, stairs and floors of every section always collide (they are colliders of the building), but only
// the sections near the camera get their insides drawn: the shell, the furniture of every apartment in its
// style, the doors. Their windows on the facade turn into real openings and the shaders light every room with
// its own lamp (probeInterior in materials.js). Doors, the roof hatch and light switches react to E.

import * as THREE from 'three';
import { U, SEC_MAX, OV_MAX, ROOM_BOXES, ROOM_N, PORTAL_N, FLOORS_MAX } from './materials.js';

const LOAD_R = 30;        // sections this close to the camera get their insides
const REACH = 2.1;        // how far you can reach a door or a switch from your eyes
const DOOR_SPEED = 2.4;   // share of the swing per second
const HATCH_OPEN = 1.75;  // radians the roof hatch lifts
const APTS = ['', 'L', 'R', 'B'];
// light a closed door lets through (its glass) and how high its glass starts
const DOOR_GLASS = { kit: [0.5, 0.12], room: [0.35, 0.98], bath: [0.12, 1.6], apt: [0, 0] };
const FRAME = 0.03;
const V3 = THREE.Vector3;
// assets drawn by this module, not by the blocks: the shell, furniture (k5i_L_sov ...), door leaves, the hatch
export const isInteriorAsset = (name) => /^k5i_(shell|hatch|dr_|[LRB]_)/.test(name);
const isDoorAsset = (name) => name.startsWith('k5i_dr_') || name === 'k5i_hatch';

// Integer hash, the same as hkey() in materials.js: whatever the facade shows, the rooms show too
function hmix(x) {
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15; x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}
export function hkey(bx, bz, sec, fl, salt) {
  const h = hmix((Math.imul(bx >>> 0, 0x9e3779b1) ^ hmix((bz + 0x632be5ab) >>> 0)) >>> 0);
  return hmix((h ^ ((sec * 131 + fl * 17 + salt * 7919 + 1) >>> 0)) >>> 0);
}
const hfrac = (b, sec, fl, salt) => (hkey(b[0], b[1], sec, fl, salt) % 1000) / 1000;

export class Interiors {
  constructor(world, plan) {
    this.world = world;
    this.plan = plan;
    this.loaded = [];
    this.loadedKey = '';
    this.doors = [];              // door objects of the loaded sections
    this.doorState = new Map();   // key -> open, remembered while you walk around
    this.overrides = new Map();   // switched lights: 'bx,bz,code' -> on, newest last
    this.switches = [];
    this.dynCols = [];
    this.target = null;
    this.onSound = null;          // (kind) => void
    this.toPlanTmp = new V3();
    this.setupUniforms();
  }

  setupUniforms() {
    const P = this.plan;
    U.uPlan.value.set(P.W, P.D, P.PL, P.FH);
    U.uPlanTop.value.set(P.ROOF, P.VEST_Z);
    let k = 0;
    for (const r of P.rooms) {
      for (const [x0, y0, x1, y1] of r.boxes) {
        if (k >= ROOM_BOXES) break;
        U.uRoomBox.value[k].set(x0, y0, x1, y1);
        U.uRoomBoxId.value[k] = r.id;
        k++;
      }
      if (r.id < ROOM_N) {
        U.uRoomLamp.value[r.id].set(...r.lamp);
        U.uRoomInfo.value[r.id].set(r.apt, r.kind, 0, 0);
      }
    }
    this.boxes = P.rooms.flatMap((r) => r.boxes.map((b) => ({ id: r.id, b })));
    // doorways between two rooms pass light (the balcony doors lead outside)
    this.portals = [];
    P.doors.forEach((d, i) => {
      const v = U.uPortal.value[i], info = U.uPortalInfo.value[i];
      if (i >= PORTAL_N) return;
      const across = d.axis === 'X' ? d.hinge[0] : d.hinge[1];
      // the middle of the wall: the hinge lies on the face the door opens toward
      const c = across - (d.axis === 'X' ? d.opened[0] : d.opened[1]) * 0.04;
      const mid = (d.span[0] + d.span[1]) / 2;
      const side = (s) => (d.axis === 'X' ? this.roomAt(c + s * 0.3, mid) : this.roomAt(mid, c + s * 0.3));
      const ra = side(-1), rb = side(1);
      const glass = DOOR_GLASS[d.kind];
      if (ra < 0 || rb < 0 || !glass) { v.set(0, 0, 0, 2); info.set(-1, -1, 0, 0); return; }
      v.set(c, d.span[0] + FRAME, d.span[1] - FRAME, d.axis === 'X' ? 0 : 1);
      info.set(ra, rb, glass[0], glass[1]);
    });
    for (let i = P.doors.length; i < PORTAL_N; i++) U.uPortal.value[i].set(0, 0, 0, -1);
  }

  // a new seed: the old blocks and their sections are gone
  reset() {
    this.loaded = [];
    this.loadedKey = '';
    this.doors = [];
    this.switches = [];
    this.dynCols = [];
    this.doorState.clear();
    this.overrides.clear();
    U.uSecN.value = 0;
    this.uploadOverrides();
  }

  // ---------------------------------------------------------------- buildings

  // Called by the world when it places a building that has insides. Adds the furniture colliders to the block.
  addBuilding(B, m, it) {
    const P = this.plan;
    const pos = new V3().setFromMatrixPosition(m);
    const bid = [Math.round(pos.x * 2), Math.round(pos.z * 2)];
    const { sections, x0 } = it.interior;
    const out = [];
    for (let s = 0; s < sections; s++) {
      const matrix = m.clone().multiply(new THREE.Matrix4().makeTranslation(x0 + s * P.W, 0, 0));
      // world -> plan: x along the section, y up, z from the entrance facade (three z = D/2 - plan y)
      const toPlan = new THREE.Matrix4().set(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, P.D / 2, 0, 0, 0, 1)
        .multiply(matrix.clone().invert());
      const box = [Infinity, Infinity, -Infinity, -Infinity];
      for (const [px, py] of [[-P.END, -0.5], [P.W + P.END, -0.5], [-P.END, P.D + 0.5], [P.W + P.END, P.D + 0.5]]) {
        const w = this.planToWorld({ matrix }, px, 0, py);
        box[0] = Math.min(box[0], w.x); box[1] = Math.min(box[1], w.z);
        box[2] = Math.max(box[2], w.x); box[3] = Math.max(box[3], w.z);
      }
      const sec = { key: `${bid[0]},${bid[1]},${s}`, B, bid, index: s, matrix, toPlan, box,
        center: new V3((box[0] + box[2]) / 2, 0, (box[1] + box[3]) / 2) };
      B.sections.push(sec);
      out.push(sec);
      // furniture collides wherever it stands, drawn or not
      for (let fl = 0; fl < P.FLOORS; fl++) {
        const fm = this.floorMatrix(sec, fl);
        for (let apt = 1; apt <= 3; apt++) {
          for (const c of this.world.assets.get(this.furnitureName(sec, fl, apt)).cols) B.cols.push(c.clone().applyMatrix4(fm));
        }
      }
    }
    return out;
  }

  floorMatrix(sec, fl) {
    return sec.matrix.clone().multiply(new THREE.Matrix4().makeTranslation(0, this.plan.PL + fl * this.plan.FH, 0));
  }

  style(sec, fl, apt) {
    return hkey(sec.bid[0], sec.bid[1], sec.index, fl, 50 + apt) % 100 < 58 ? 'sov' : 'xp';
  }

  furnitureName(sec, fl, apt) {
    return `k5i_${APTS[apt]}_${this.style(sec, fl, apt)}`;
  }

  planToWorld(sec, x, h, y, out = new V3()) {
    return out.set(x, h, this.plan.D / 2 - y).applyMatrix4(sec.matrix);
  }

  // A point in the plan of a section (x, height, plan y), or null
  toPlan(sec, p) {
    return this.toPlanTmp.copy(p).applyMatrix4(sec.toPlan);
  }

  roomAt(x, y) {
    for (const { id, b } of this.boxes) if (x > b[0] && x < b[2] && y > b[1] && y < b[3]) return id;
    return -1;
  }

  // Inside one of the drawn sections: { sec, lp (x, height, plan y), room, fl }
  insideAt(p) {
    const P = this.plan;
    for (const sec of this.loaded) {
      const lp = this.toPlan(sec, p);
      if (lp.x >= 0 && lp.x <= P.W && lp.z > 0.17 && lp.z < P.D - 0.17 && lp.y > 0.05 && lp.y < P.ROOF - 0.17) {
        const fl = Math.max(0, Math.min(P.FLOORS - 1, Math.floor((lp.y - P.PL + 0.15) / P.FH)));
        return { sec, lp: lp.clone(), room: this.roomAt(lp.x, lp.z), fl };
      }
    }
    return null;
  }

  // footstep sound under you indoors: concrete on the stairs, the floor of the flat elsewhere
  surfaceAt(p) {
    const at = this.insideAt(p);
    if (!at) return null;
    return at.room === 0 || at.room < 0 ? 'stair' : 'floor';
  }

  // ---------------------------------------------------------------- lights

  roomLit(sec, fl, room) {
    const b = sec.bid;
    const code = sec.index * 100 + fl * 16 + room;
    const o = this.overrides.get(`${b[0]},${b[1]},${code}`);
    if (o !== undefined) return o;
    if (room === 0) return hkey(b[0], b[1], sec.index, fl, 1) % 100 < 85;
    const r = this.plan.rooms[room];
    if (hkey(b[0], b[1], sec.index, fl, 10 + r.apt) % 100 >= 62) return false;
    const p = r.kind === 1 ? 70 : r.kind === 3 ? 45 : r.kind === 2 ? 22 : 58;
    return hkey(b[0], b[1], sec.index, fl, 30 + room) % 100 < p;
  }

  toggleLight(sec, fl, room) {
    const b = sec.bid;
    const key = `${b[0]},${b[1]},${sec.index * 100 + fl * 16 + room}`;
    const on = !this.roomLit(sec, fl, room);
    this.overrides.delete(key);
    this.overrides.set(key, on);
    // the shaders know only the newest OV_MAX switches: older ones go back to how they were, here too
    while (this.overrides.size > OV_MAX) this.overrides.delete(this.overrides.keys().next().value);
    this.uploadOverrides();
    return on;
  }

  uploadOverrides() {
    const all = [...this.overrides.entries()];
    for (let i = 0; i < OV_MAX; i++) {
      const v = U.uOv.value[i];
      if (i >= all.length) { v.set(0, 0, 0, -1); continue; }
      const [bx, bz, code] = all[i][0].split(',').map(Number);
      v.set(bx, bz, code, all[i][1] ? 1 : 0);
    }
  }

  // ---------------------------------------------------------------- what is drawn

  update(cam, dt, activeBlocks) {
    const cand = [];
    for (const B of activeBlocks) {
      for (const sec of B.sections || []) {
        const [x0, z0, x1, z1] = sec.box;
        const dx = Math.max(x0 - cam.x, 0, cam.x - x1), dz = Math.max(z0 - cam.z, 0, cam.z - z1);
        const d = Math.hypot(dx, dz);
        if (d < LOAD_R) cand.push({ sec, d });
      }
    }
    cand.sort((a, b) => a.d - b.d);
    const list = cand.slice(0, SEC_MAX).map((c) => c.sec);
    const key = list.map((s) => s.key).sort().join('|');
    if (key !== this.loadedKey) {
      this.loadedKey = key;
      this.load(list);
    }
    this.animateDoors(dt);
  }

  load(list) {
    const P = this.plan;
    this.loaded = list;
    U.uSecN.value = list.length;
    list.forEach((sec, i) => {
      U.uSecInv.value[i].copy(sec.toPlan);
      U.uSecData.value[i].set(sec.bid[0], sec.bid[1], sec.index, 0);
      U.uSecBox.value[i].set(sec.box[0] - 0.4, sec.box[1] - 0.4, sec.box[2] + 0.4, sec.box[3] + 0.4);
    });
    const inst = new Map();
    const add = (name, m) => { if (!inst.has(name)) inst.set(name, []); inst.get(name).push(m); };
    for (const sec of list) {
      add('k5i_shell', sec.matrix);
      for (let fl = 0; fl < P.FLOORS; fl++) {
        const fm = this.floorMatrix(sec, fl);
        for (let apt = 1; apt <= 3; apt++) add(this.furnitureName(sec, fl, apt), fm);
      }
    }
    for (const [name, pool] of this.world.pools) {
      if (isInteriorAsset(name) && !isDoorAsset(name) && !inst.has(name)) pool.forEach((m) => { m.count = 0; });
    }
    for (const [name, ms] of inst) this.world.fillPool(name, ms);
    // doors and switches of these sections
    this.doors = [];
    this.switches = [];
    for (const sec of list) {
      for (let fl = 0; fl < P.FLOORS; fl++) {
        P.doors.forEach((d, i) => {
          const door = this.makeDoor(sec, d, fl, i);
          door.si = list.indexOf(sec);
          if (i < PORTAL_N) door.portal = i;
          this.doors.push(door);
        });
        for (const s of P.switches) {
          const zf = P.PL + fl * P.FH;
          this.switches.push({ sec, fl, room: s.room, p: this.planToWorld(sec, s.x + s.n[0] * 0.035, zf + s.z, s.y + s.n[1] * 0.035) });
        }
      }
      this.doors.push(this.makeDoor(sec, P.entrance, -1, 'entr'));
      this.doors.push(this.makeHatch(sec));
    }
    this.updateDoorCols();
    this.uploadOverrides();
  }

  // ---------------------------------------------------------------- doors

  makeDoor(sec, d, fl, i) {
    const P = this.plan;
    const key = `${sec.key}:${fl}:${i}`;
    if (!this.doorState.has(key)) this.doorState.set(key, d.open ? hfrac(sec.bid, sec.index, fl, 200 + (typeof i === 'number' ? i : 99)) < d.open : false);
    const open = this.doorState.get(key);
    const z = fl < 0 ? d.z : P.PL + fl * P.FH + (d.z0 || 0);
    // the leaf sits in its frame flush with the face it opens toward and turns about the hinge corner on that face
    const phiC = Math.atan2(d.closed[1], d.closed[0]);
    let delta = Math.atan2(d.opened[1], d.opened[0]) - phiC;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    const door = { key, kind: d.kind, asset: 'k5i_dr_' + d.kind, sec, fl, room: d.room, px: d.hinge[0], py: d.hinge[1],
      ox: d.opened[0], oy: d.opened[1], z, phiC, delta, w: d.width, t: d.thick, h: d.height, open, angle: open ? 1 : 0 };
    door.colClosed = this.leafBox(door, 0);
    door.colOpen = this.leafBox(door, 1);
    return door;
  }

  makeHatch(sec) {
    const P = this.plan;
    const key = `${sec.key}:hatch`;
    if (!this.doorState.has(key)) this.doorState.set(key, false);
    const open = this.doorState.get(key);
    const [x0, y0, x1, y1] = P.hatch.box;
    const z = P.ROOF + 0.15;
    const door = { key, kind: 'hatch', asset: 'k5i_hatch', sec, fl: P.FLOORS - 1, room: 0, hatch: true, open, angle: open ? 1 : 0,
      x0, y0, x1, y1, z };
    door.colClosed = this.planBox(sec, x0 - 0.02, y0, x1 + 0.02, y1 + 0.04, P.ROOF - 0.05, z + 0.06);
    door.colOpen = this.planBox(sec, x0, y0 - 0.12, x1, y0, z, z + 1.1);
    return door;
  }

  // world box of a plan rectangle (sections only turn by right angles)
  planBox(sec, x0, y0, x1, y1, z0, z1) {
    const a = this.planToWorld(sec, x0, z0, y0), b = this.planToWorld(sec, x1, z1, y1);
    return new THREE.Box3(a.clone().min(b), a.clone().max(b));
  }

  // middle of the hinge edge of the leaf at the opening a (0 closed, 1 open), in the plan
  hingeEdge(d, a) {
    const r = d.delta * a, c = Math.cos(r), s = Math.sin(r);
    const bx = -d.ox * d.t / 2, by = -d.oy * d.t / 2;
    return [d.px + bx * c - by * s, d.py + bx * s + by * c];
  }

  leafBox(d, a) {
    const phi = d.phiC + d.delta * a;
    const cx = Math.cos(phi), cy = Math.sin(phi);
    const nx = -cy * d.t / 2, ny = cx * d.t / 2;
    const [hx, hy] = this.hingeEdge(d, a);
    const xs = [hx + nx, hx - nx, hx + cx * d.w + nx, hx + cx * d.w - nx];
    const ys = [hy + ny, hy - ny, hy + cy * d.w + ny, hy + cy * d.w - ny];
    const s = 0.012;
    return this.planBox(d.sec, Math.min(...xs) + s, Math.min(...ys) + s, Math.max(...xs) - s, Math.max(...ys) - s, d.z + 0.02, d.z + d.h);
  }

  doorMatrix(d) {
    const P = this.plan;
    const m = new THREE.Matrix4();
    if (d.hatch) {
      m.makeRotationX(d.angle * HATCH_OPEN).setPosition(d.x0, d.z, P.D / 2 - d.y0);
    } else {
      const [hx, hy] = this.hingeEdge(d, d.angle);
      m.makeRotationY(d.phiC + d.delta * d.angle).setPosition(hx, d.z, P.D / 2 - hy);
    }
    return d.sec.matrix.clone().multiply(m);
  }

  // where E aims at: the middle of the leaf
  doorCenter(d) {
    if (d.hatch) {
      const a = d.angle * HATCH_OPEN;
      const L = (d.y1 - d.y0) / 2;
      return this.planToWorld(d.sec, (d.x0 + d.x1) / 2, d.z + Math.sin(a) * L - 0.15, d.y0 + Math.cos(a) * L);
    }
    const phi = d.phiC + d.delta * d.angle;
    const [hx, hy] = this.hingeEdge(d, d.angle);
    return this.planToWorld(d.sec, hx + Math.cos(phi) * d.w / 2, d.z + 1.05, hy + Math.sin(phi) * d.w / 2);
  }

  animateDoors(dt) {
    const byAsset = new Map();
    const bits = U.uDoorBits.value;
    bits.fill(0);
    for (const d of this.doors) {
      const goal = d.open ? 1 : 0;
      if (d.angle !== goal) d.angle = goal > d.angle ? Math.min(goal, d.angle + dt * DOOR_SPEED) : Math.max(goal, d.angle - dt * DOOR_SPEED);
      // a doorway passes the light of the next room once its door is a third open
      if (d.portal !== undefined && d.angle > 0.3) bits[d.si * FLOORS_MAX + d.fl] += 2 ** d.portal;
      if (!byAsset.has(d.asset)) byAsset.set(d.asset, []);
      byAsset.get(d.asset).push(this.doorMatrix(d));
    }
    for (const [name, pool] of this.world.pools) {
      if (isDoorAsset(name) && !byAsset.has(name)) pool.forEach((m) => { m.count = 0; });
    }
    for (const [name, ms] of byAsset) this.world.fillPool(name, ms);
  }

  updateDoorCols() {
    this.dynCols = this.doors.map((d) => (d.open ? d.colOpen : d.colClosed));
  }

  // ---------------------------------------------------------------- E

  // The door or switch you look at, within reach and not behind a wall
  pick(camPos, camDir, eye) {
    let best = null, bestScore = Infinity;
    const v = new V3();
    const consider = (p, size, item) => {
      if (p.distanceTo(eye) > REACH + size * 0.5) return;
      v.subVectors(p, camPos);
      const along = v.dot(camDir);
      if (along < 0.05) return;
      const perp = v.addScaledVector(camDir, -along).length();
      const tol = size + 0.08 + 0.05 * Math.min(along, 4);
      if (perp > tol) return;
      const score = perp / tol + p.distanceTo(eye) * 0.15;
      if (score >= bestScore || !this.visible(eye, p, item)) return;
      best = item;
      bestScore = score;
    };
    for (const d of this.doors) consider(this.doorCenter(d), d.hatch ? 0.45 : 0.32, { door: d });
    for (const s of this.switches) consider(s.p, 0.06, { sw: s });
    this.target = best;
    return best;
  }

  visible(eye, p, item) {
    const dir = new V3().subVectors(p, eye);
    const len = dir.length();
    if (len < 1e-3) return true;
    dir.divideScalar(len);
    const mid = eye.clone().addScaledVector(dir, len / 2);
    const own = item.door ? (item.door.open ? item.door.colOpen : item.door.colClosed) : null;
    const ray = new THREE.Ray(eye, dir);
    const hit = new V3();
    for (const b of this.world.collidersNear(mid.x, mid.z, len / 2 + 0.6)) {
      if (b === own || b.containsPoint(p)) continue;
      if (ray.intersectBox(b, hit) && hit.distanceTo(eye) < len - 0.04) return false;
    }
    return true;
  }

  label(t) {
    if (!t) return '';
    if (t.sw) return this.roomLit(t.sw.sec, t.sw.fl, t.sw.room) ? 'LIGHT OFF' : 'LIGHT ON';
    if (t.door.hatch) return t.door.open ? 'CLOSE HATCH' : 'OPEN HATCH';
    return t.door.open ? 'CLOSE' : 'OPEN';
  }

  // E: flip the switch or swing the door. A door does not close on you.
  use(t, player) {
    if (!t) return false;
    if (t.sw) {
      this.toggleLight(t.sw.sec, t.sw.fl, t.sw.room);
      this.onSound?.('switch');
      return true;
    }
    const d = t.door;
    if (d.open && this.blocks(d.colClosed, player)) {
      this.onSound?.('bump');
      return false;
    }
    d.open = !d.open;
    this.doorState.set(d.key, d.open);
    this.updateDoorCols();
    this.onSound?.(d.open ? `open_${d.kind}` : `close_${d.kind}`);
    return true;
  }

  blocks(box, player) {
    const p = player.pos, r = 0.3;
    return p.x + r > box.min.x && p.x - r < box.max.x && p.z + r > box.min.z && p.z - r < box.max.z
      && p.y + player.height > box.min.y && p.y < box.max.y;
  }

  // ---------------------------------------------------------------- title view

  // From a window of a living room on the fourth floor, looking across the yard
  view(sections, lookY) {
    const sec = sections[Math.floor(sections.length / 2)];
    const P = this.plan;
    const zf = P.PL + 3 * P.FH;
    return { pos: this.planToWorld(sec, 14.4, zf + 1.5, 0.95), look: this.planToWorld(sec, 14.4, lookY, -40) };
  }
}
