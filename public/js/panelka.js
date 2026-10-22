// Lost in Panelka: an endless Soviet microdistrict on a snowy night. It is built
// block by block from hash(seed, block), so the same seed always gives the same yards.
//
// Grid: blocks of 128 m. Streets 9 m wide run along the block edges, every block owns the street east and
// south of it. A block is a courtyard closed by panel buildings, rows of five-storeys with yards in between,
// or tower blocks. Lamps are not on a grid here: every block lists its street lamps, entrance bulbs and shop
// windows, and each frame the nearest PK_LIGHTS of them go to all shaders (uPL, uPC in materials.js).

import * as THREE from 'three';
import { namedMaterial, U, PK_LIGHTS } from './materials.js';
import { hashInts, mulberry32, valueNoise2 } from './rng.js';
import { blenderToThree, rotBounds } from './assets.js';

export const PB = 128;            // block period
const STREET = 4.5;               // half width of the streets on the block edges
const EDGE = 54;                  // buildings stand with their backs this far from the block center
const DRIVE = 3.0;                // half width of the yard driveways
const PRINTS = 160;               // footprints left in the snow
const CAR_LOD = 42;               // cars farther than this use their low polygon twin (<name>_lod)
const CELL = 8;                   // collider grid cell
const HALF_PI = Math.PI / 2;
// rotation that turns the front of an asset (its entrances) toward a side
const ROT = { S: 0, W: -HALF_PI, N: Math.PI, E: HALF_PI };

const LIGHTS = {
  w: { col: [0.78, 0.87, 1.0], k: 1.8, cone: 1 },
  o: { col: [1.0, 0.58, 0.26], k: 1.9, cone: 1 },
  bulb: { col: [1.0, 0.8, 0.52], k: 1.7, cone: 0 },
  win: { col: [1.0, 0.72, 0.42], k: 1.1, cone: 0 },
};

const NORTH = ['p9_4', 'p9_3a', 'p9_3b', 'p12_2', 'p9_3a', 'k5_4b', 'p9_4'];
const SOUTH = ['p9_2s', 'p9_3b', 'k5_3p', 'p9_3a', 'k5_4b', 'p12_2'];
const SIDE = ['t16_a', 't16_b', 'p12_2', 'k5_2b', 't16_a', 'p9_2s'];
const FIVE = ['k5_4b', 'k5_3p', 'k5_2b', 'k5_4b', 'k5_3p', 'p9_3a'];
// light (_a) and heavy (_b) snow; the paint is picked per car from the model's factory colors (materials.js)
const CARS = ['car2_2107_a', 'car2_2107_b', 'car2_2101_a', 'car2_2101_b', 'car2_2109_a', 'car2_2109_b',
  'car2_niva_a', 'car2_niva_b', 'car2_2141_a', 'car2_2141_b', 'car2_2107_a', 'car2_2101_b', 'car2_buried_a', 'car2_buried_b'];
const TREES = ['birch_a', 'birch_b', 'birch_a', 'poplar', 'poplar_cut', 'maple', 'spruce_a', 'spruce_b', 'lilac', 'birch_b', 'poplar_cut'];

const V3 = THREE.Vector3;
const UP = new V3(0, 1, 0);
const ONE = new V3(1, 1, 1);

export class PanelkaWorld {
  constructor(scene, assets, seed) {
    this.kind = 'panelka';
    this.scene = scene;
    this.assets = assets;
    this.seed = seed >>> 0;
    this.blocks = new Map();
    this.active = new Set();
    this.activeBlocks = [];
    this.radius = 1;
    this.centerKey = null;
    this.pools = new Map();
    this.query = 0;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.buildStatic();
  }

  setSeed(seed) {
    this.seed = seed >>> 0;
    this.blocks.clear();
    this.centerKey = null;
    this.prints.count = 0;
    this.printN = 0;
  }

  buildStatic() {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600).rotateX(-HALF_PI), namedMaterial('pk_ground'));
    ground.frustumCulled = false;
    this.ground = ground;
    this.group.add(ground);
    // your own footprints, oldest ones are reused
    const pg = new THREE.PlaneGeometry(0.15, 0.32).rotateX(-HALF_PI);
    this.prints = this.instanced(pg, namedMaterial('pk_print'), PRINTS);
    this.printN = 0;
    this.printSide = 1;
    this.pads = {};
    for (const kind of ['road', 'drive', 'path']) {
      const m = new THREE.Mesh(new THREE.BufferGeometry(), namedMaterial('pk_' + kind));
      m.frustumCulled = false;
      // driveways under the streets, footpaths on top: a fixed order for the see-through edges
      m.renderOrder = { drive: 1, road: 2, path: 3 }[kind];
      this.pads[kind] = m;
      this.group.add(m);
    }
  }

  instanced(geo, mat, cap) {
    const m = new THREE.InstancedMesh(geo, mat, cap);
    m.count = 0;
    m.frustumCulled = false;
    m.matrixAutoUpdate = false;
    this.group.add(m);
    return m;
  }

  // ---------------------------------------------------------------- districts

  district(bx, bz) {
    const n = valueNoise2(this.seed ^ 0x5151, bx / 3.1, bz / 3.1) * 0.8 + valueNoise2(this.seed ^ 0x2323, bx / 1.3, bz / 1.3) * 0.2;
    const r = mulberry32(hashInts(this.seed, bx, bz, 3));
    if (n < 0.4) return 'rows';
    if (r() < 0.28) return 'towers';
    return 'yard';
  }

  // a power line runs along some rows of blocks, through the south part of every block in the row
  powerLine(bz) {
    return hashInts(this.seed, bz, 991) % 100 < 16;
  }

  block(bx, bz) {
    const key = bx + ',' + bz;
    let b = this.blocks.get(key);
    if (!b) {
      b = this.genBlock(bx, bz);
      this.blocks.set(key, b);
      if (this.blocks.size > 80) {
        for (const k of this.blocks.keys()) {
          if (!this.active.has(k)) { this.blocks.delete(k); if (this.blocks.size <= 50) break; }
        }
      }
    }
    return b;
  }

  genBlock(bx, bz) {
    const r = mulberry32(hashInts(this.seed, bx, bz, 77));
    const B = {
      bx, bz, cx: bx * PB, cz: bz * PB, type: this.district(bx, bz),
      inst: new Map(), cars: [], cols: [], grid: new Map(), lights: [], pads: [], rects: [], doors: [],
      emitters: [], trees: [], view: null,
    };
    this.streets(B, r);
    if (B.type === 'rows') this.genRows(B, r);
    else this.genYard(B, r);
    this.indexCols(B);
    return B;
  }

  // ---------------------------------------------------------------- placing things

  place(B, name, lx, lz, rot = 0, { collide = true, rect = true, pad = 0.2, car = false } = {}) {
    const it = this.assets.get(name);
    const m = new THREE.Matrix4().compose(new V3(B.cx + lx, 0, B.cz + lz), new THREE.Quaternion().setFromAxisAngle(UP, rot), ONE);
    if (car) {
      // cars switch between two levels of detail by distance (updateCars)
      B.cars.push({ name, m, x: B.cx + lx, z: B.cz + lz });
    } else {
      if (!B.inst.has(name)) B.inst.set(name, []);
      B.inst.get(name).push(m);
    }
    if (collide) for (const c of it.cols) B.cols.push(c.clone().applyMatrix4(m));
    if (it.lights) {
      for (const [x, y, z, range, kind] of it.lights) this.light(B, new V3(...blenderToThree([x, y, z])).applyMatrix4(m), range, kind);
    }
    if (it.doors) for (const d of it.doors) B.doors.push({ p: new V3(...blenderToThree(d)).applyMatrix4(m), rot });
    const rb = rotBounds(it.bounds, rot);
    const rc = [lx + rb.minX - pad, lz + rb.minZ - pad, lx + rb.maxX + pad, lz + rb.maxZ + pad];
    if (rect) B.rects.push(rc);
    return { m, rb, rc, lx, lz, rot, name };
  }

  // is there room for this asset here: inside the block, off the roads and paths, not on anything else
  fits(B, name, lx, lz, rot = 0, pad = 0.3) {
    const rb = rotBounds(this.assets.get(name).bounds, rot);
    const x0 = lx + rb.minX - pad, z0 = lz + rb.minZ - pad, x1 = lx + rb.maxX + pad, z1 = lz + rb.maxZ + pad;
    const lim = PB / 2 - STREET - 0.6;
    if (x0 < -lim || x1 > lim || z0 < -lim || z1 > lim) return false;
    for (const [a0, b0, a1, b1] of B.rects) if (x0 < a1 && x1 > a0 && z0 < b1 && z1 > b0) return false;
    for (const p of B.pads) if (rectNearSegment(x0, z0, x1, z1, p)) return false;
    return true;
  }

  tryPlace(B, name, lx, lz, rot = 0, opts = {}) {
    if (!this.fits(B, name, lx, lz, rot, opts.fitPad ?? 0.3)) return null;
    return this.place(B, name, lx, lz, rot, opts);
  }

  light(B, p, range, kind, flicker = false) {
    const L = LIGHTS[kind] || LIGHTS.bulb;
    B.lights.push({ p, range, col: L.col.map((c) => c * L.k), kind: L.cone + (flicker ? 2 : 0) });
  }

  // flat strip of packed snow (local coordinates of the centerline), for roads, driveways and footpaths
  pad(B, kind, x0, z0, x1, z1, hw, y) {
    B.pads.push({ kind, x0, z0, x1, z1, hw, y });
  }

  // ---------------------------------------------------------------- streets

  streets(B, r) {
    this.pad(B, 'road', PB / 2, -PB / 2, PB / 2, PB / 2, STREET, 0.03);
    this.pad(B, 'road', -PB / 2, PB / 2, PB / 2, PB / 2, STREET, 0.045);
    // concrete lamp posts on all four sides of the block, staggered with the lamps across the street
    const o = PB / 2 - STREET - 0.9;
    const streetKind = (axis, i) => (hashInts(this.seed, axis, i, 404) % 100 < 40 ? 'lamp_o' : 'lamp_w');
    for (const side of ['E', 'W', 'S', 'N']) {
      const ts = side === 'E' || side === 'S' ? [-48, -16, 16, 48] : [-32, 0, 32];
      const kind = side === 'E' ? streetKind(1, B.bx) : side === 'W' ? streetKind(1, B.bx - 1) : side === 'S' ? streetKind(2, B.bz) : streetKind(2, B.bz - 1);
      for (const t of ts) {
        const [x, z] = side === 'E' ? [o, t] : side === 'W' ? [-o, t] : side === 'S' ? [t, o] : [t, -o];
        this.place(B, r.chance(0.07) ? 'lamp_off' : kind, x, z, ROT[side], { pad: 0.6 });
      }
      // banks of snow the plough left along the street
      for (let i = 0; i < 5; i++) {
        if (!r.chance(0.55)) continue;
        const t = -52 + i * 26 + r.range(-4, 4);
        const oo = o - 0.9;
        const [x, z] = side === 'E' ? [oo, t] : side === 'W' ? [-oo, t] : side === 'S' ? [t, oo] : [t, -oo];
        this.tryPlace(B, r.chance(0.7) ? 'drift_long' : 'drift_pile', x, z, side === 'E' || side === 'W' ? HALF_PI : 0, { fitPad: 0.1 });
      }
    }
  }

  // ---------------------------------------------------------------- buildings

  // A building along one edge of the block, back to the street, entrances and a driveway toward the yard.
  edgeBuilding(B, r, names, side, shift) {
    const rot = ROT[{ N: 'S', S: 'N', E: 'W', W: 'E' }[side]];
    for (let k = 0; k < 4; k++) {
      const name = typeof names === 'string' ? names : r.pick(names);
      const rb = rotBounds(this.assets.get(name).bounds, rot);
      let lx, lz;
      if (side === 'N') { lz = -EDGE - rb.minZ; lx = shift - (rb.minX + rb.maxX) / 2; }
      if (side === 'S') { lz = EDGE - rb.maxZ; lx = shift - (rb.minX + rb.maxX) / 2; }
      if (side === 'E') { lx = EDGE - rb.maxX; lz = shift - (rb.minZ + rb.maxZ) / 2; }
      if (side === 'W') { lx = -EDGE - rb.minX; lz = shift - (rb.minZ + rb.maxZ) / 2; }
      if (!this.fits(B, name, lx, lz, rot, 0.5)) continue;
      const doorsBefore = B.doors.length;
      const pl = this.place(B, name, lx, lz, rot, { pad: 0.6 });
      // the driveway runs a few meters in front of the canopies
      const front = side === 'N' ? lz + rb.maxZ : side === 'S' ? lz + rb.minZ : side === 'E' ? lx + rb.minX : lx + rb.maxX;
      const dir = side === 'N' || side === 'W' ? 1 : -1;
      pl.side = side;
      pl.drive = front + dir * (DRIVE + 3.2);
      pl.front = front;
      pl.span = side === 'N' || side === 'S' ? [lx + rb.minX, lx + rb.maxX] : [lz + rb.minZ, lz + rb.maxZ];
      this.entrances(B, r, B.doors.slice(doorsBefore), pl);
      if (!B.view && this.assets.get(name).h > 12) B.view = this.windowView(B, pl, 13.6, 3.5);
      return pl;
    }
    return null;
  }

  // Bulbs over the doors, benches, footpaths to the driveway
  entrances(B, r, doors, pl) {
    const f = new V3(Math.sin(pl.rot), 0, Math.cos(pl.rot));
    const a = new V3(Math.cos(pl.rot), 0, -Math.sin(pl.rot));
    for (const d of doors) {
      const h = r();
      const kind = h < 0.12 ? 'bulb_off' : h < 0.2 ? 'bulb_flk' : 'bulb_on';
      const lx = d.p.x - B.cx, lz = d.p.z - B.cz;
      this.place(B, kind, lx, lz, d.rot, { collide: false, rect: false });
      if (kind !== 'bulb_off') this.light(B, d.p.clone().add(new V3(0, -0.2, 0)).addScaledVector(f, 0.15), 9, 'bulb', kind === 'bulb_flk');
      // benches just past the canopy, where the grannies sit in summer
      for (const s of [-1, 1]) {
        if (!r.chance(0.45)) continue;
        const bp = d.p.clone().addScaledVector(a, s * 2.4).addScaledVector(f, 2.1);
        this.place(B, r.chance(0.8) ? 'bench' : 'bench_flat', bp.x - B.cx, bp.z - B.cz, d.rot, { pad: 0.05 });
        if (r.chance(0.6)) {
          const up = bp.clone().addScaledVector(a, s * 1.35);
          this.place(B, 'urn', up.x - B.cx, up.z - B.cz, 0, { pad: 0.05 });
        }
      }
      // footpath from the steps to the driveway
      const fromF = (lx * f.x + lz * f.z) + 1.4;
      const toF = pl.drive * (pl.side === 'N' || pl.side === 'S' ? f.z : f.x) - DRIVE + 0.6;
      const len = toF - fromF;
      if (len > 0.5) {
        const s0 = new V3(lx, 0, lz).addScaledVector(f, 1.4);
        const s1 = s0.clone().addScaledVector(f, len);
        this.pad(B, 'path', s0.x, s0.z, s1.x, s1.z, 1.0, 0.06);
      }
    }
    // little front gardens between the entrances: lilac, a birch, a low fence
    for (let i = 0; i < 6; i++) {
      const t = r.range(pl.span[0] + 2, pl.span[1] - 2);
      const o = pl.front + (pl.drive - pl.front) * 0.27;
      const [x, z] = pl.side === 'N' || pl.side === 'S' ? [t, o] : [o, t];
      this.tryPlace(B, r.pick(['lilac', 'lilac', 'birch_b', 'spruce_b', 'fence', 'fence_y']), x, z, pl.side === 'N' || pl.side === 'S' ? 0 : HALF_PI, { fitPad: 0.1 });
    }
  }

  // Driveway with lamps on the yard side and cars parked along it.
  // axis 'x': runs along X at z = c from a to b; 'z': along Z at x = c. yardSide: +1 or -1.
  driveway(B, r, axis, c, a, b, yardSide) {
    const [x0, z0, x1, z1] = axis === 'x' ? [a, c, b, c] : [c, a, c, b];
    this.pad(B, 'drive', x0, z0, x1, z1, DRIVE, 0.055);
    const L = b - a;
    const lampO = c + yardSide * (DRIVE + 0.7);
    for (let t = a + 10; t < b - 6; t += 24) {
      const [x, z] = axis === 'x' ? [t, lampO] : [lampO, t];
      this.tryPlace(B, r.chance(0.1) ? 'ylamp_off' : 'ylamp_w', x, z, axis === 'x' ? (yardSide > 0 ? ROT.N : ROT.S) : (yardSide > 0 ? ROT.W : ROT.E), { fitPad: 0.05 });
    }
    // parking along the yard side
    const carO = c + yardSide * (DRIVE + 1.25);
    let t = a + r.range(2, 6);
    while (t < b - 3) {
      if (r.chance(0.68)) {
        const name = r.pick(CARS);
        const rot = (axis === 'x' ? 0 : HALF_PI) + (r.chance(0.5) ? Math.PI : 0) + r.range(-0.05, 0.05);
        const [x, z] = axis === 'x' ? [t, carO] : [carO, t];
        if (this.fits(B, name, x, z, Math.round(rot / HALF_PI) * HALF_PI, 0.15)) this.place(B, name, x, z, rot, { pad: 0.3, car: true });
      }
      t += r.range(4.8, 6.5);
    }
    // the plough pushed the snow into piles at the ends
    for (const e of [a + 6, b - 6]) {
      if (!r.chance(0.6)) continue;
      const [x, z] = axis === 'x' ? [e, c + yardSide * (DRIVE + 1.8)] : [c + yardSide * (DRIVE + 1.8), e];
      this.tryPlace(B, 'drift_pile', x, z, r.range(0, 3), { fitPad: 0.05 });
    }
    return L;
  }

  genYard(B, r) {
    const lep = this.powerLine(B.bz);
    const towers = B.type === 'towers';
    const N = [];
    if (towers) {
      for (const s of [-26, 22]) { const b = this.edgeBuilding(B, r, ['t16_a', 't16_b'], 'N', s + r.range(-3, 3)); if (b) N.push(b); }
    } else {
      const b = this.edgeBuilding(B, r, NORTH, 'N', r.range(-14, 14));
      if (b) N.push(b);
    }
    let S = null;
    if (lep) this.pylons(B, r);
    else S = this.edgeBuilding(B, r, towers ? ['p12_2', 't16_b', 'p9_3a'] : SOUTH, 'S', r.range(-14, 14));
    const E = r.chance(0.75) ? this.edgeBuilding(B, r, SIDE, 'E', r.range(-8, 8)) : null;
    const Wb = r.chance(0.75) ? this.edgeBuilding(B, r, SIDE, 'W', r.range(-8, 8)) : null;

    const lim = PB / 2 - STREET - 0.2;
    const end = PB / 2 - 1;
    const nz = N.length ? Math.max(...N.map((b) => b.drive)) : -40;
    const sz = S ? S.drive : lim;
    this.driveway(B, r, 'x', nz, -end, end, 1);
    if (S) this.driveway(B, r, 'x', sz, -end, end, -1);
    if (E) this.driveway(B, r, 'z', E.drive, nz, sz, -1);
    if (Wb) this.driveway(B, r, 'z', Wb.drive, nz, sz, 1);

    const yard = {
      x0: Wb ? Wb.drive + DRIVE + 3.0 : -lim + 2, x1: E ? E.drive - DRIVE - 3.0 : lim - 2,
      z0: nz + DRIVE + 3.0, z1: S ? sz - DRIVE - 3.0 : (lep ? 34 : lim - 2),
    };
    this.fillYard(B, r, yard);
    // trees in the strips behind the buildings, between the balconies and the street
    for (let i = 0; i < 26; i++) {
      const side = r.int(0, 3);
      const t = r.range(-52, 52);
      const o = r.range(EDGE + 0.5, PB / 2 - STREET - 2.5);
      const [x, z] = side === 0 ? [t, -o] : side === 1 ? [t, o] : side === 2 ? [o, t] : [-o, t];
      this.tryPlace(B, r.pick(TREES), x, z, r.range(0, 6.28), { fitPad: 0.2 });
    }
  }

  // Five-storeys one behind the other, each with a driveway on its entrance side
  genRows(B, r) {
    const lep = this.powerLine(B.bz);
    const backs = lep ? [-54, -18] : [-54, -18, 18];
    const lim = PB / 2 - STREET - 0.2;
    let prev = -lim;
    const yards = [];
    for (const z of backs) {
      const name = r.pick(FIVE);
      const rb = rotBounds(this.assets.get(name).bounds, 0);
      const lz = z - rb.minZ;
      const lx = r.range(-12, 12) - (rb.minX + rb.maxX) / 2;
      if (!this.fits(B, name, lx, lz, 0, 0.5)) continue;
      const doorsBefore = B.doors.length;
      const pl = this.place(B, name, lx, lz, 0, { pad: 0.6 });
      pl.side = 'N';
      pl.front = lz + rb.maxZ;
      pl.drive = pl.front + DRIVE + 3.2;
      pl.span = [lx + rb.minX, lx + rb.maxX];
      this.entrances(B, r, B.doors.slice(doorsBefore), pl);
      if (!B.view) B.view = this.windowView(B, pl, 11.0, 2.0);
      if (prev > -lim) yards.push({ z0: prev, z1: z - 2.5 });
      this.driveway(B, r, 'x', pl.drive, -(PB / 2 - 1), PB / 2 - 1, 1);
      prev = pl.drive + DRIVE + 3.0;
      // the ends of the rows: room for garages and trees
      for (const s of [-1, 1]) {
        const xEnd = s > 0 ? lx + rb.maxX + 2 : lx + rb.minX - 2;
        yards.push({ x0: s > 0 ? xEnd : -lim + 2, x1: s > 0 ? lim - 2 : xEnd, z0: z, z1: pl.front, ends: true });
      }
    }
    if (lep) this.pylons(B, r);
    else yards.push({ z0: prev, z1: lim - 2 });
    for (const y of yards) {
      if (y.ends) {
        if (y.x1 - y.x0 < 6) continue;
        this.fillZone(B, r, { x0: y.x0, x1: y.x1, z0: y.z0, z1: y.z1 }, r.pick(['util', 'green', 'garages']));
      } else if (y.z1 - y.z0 > 6) {
        const zone = { x0: -lim + 3, x1: lim - 3, z0: y.z0, z1: y.z1 };
        // split each yard strip into three zones
        const w = (zone.x1 - zone.x0) / 3;
        const kinds = shuffle(r, ['play', 'green', r.pick(['util', 'garages', 'green', 'sport'])]);
        kinds.forEach((k, i) => this.fillZone(B, r, { x0: zone.x0 + i * w, x1: zone.x0 + (i + 1) * w, z0: zone.z0, z1: zone.z1 }, k));
      }
    }
  }

  pylons(B, r) {
    for (const x of [-PB / 4, PB / 4]) this.place(B, 'lep', x, 44, 0, { pad: 1.0 });
    for (let i = 0; i < 6; i++) this.tryPlace(B, r.pick(['drift_low', 'drift_pile', 'drift_low']), r.range(-50, 50), r.range(36, 52), r.range(0, 3));
  }

  // ---------------------------------------------------------------- yard contents

  fillYard(B, r, y) {
    // two trampled footpaths cut across the yard
    const mx = (y.x0 + y.x1) / 2, mz = (y.z0 + y.z1) / 2;
    this.pad(B, 'path', y.x0 - 3, mz + r.range(-10, 10), y.x1 + 3, mz + r.range(-10, 10), 1.0, 0.065);
    this.pad(B, 'path', mx + r.range(-10, 10), y.z0 - 3, mx + r.range(-10, 10), y.z1 + 3, 1.0, 0.07);
    const kinds = shuffle(r, ['play', 'sport', 'green', r.pick(['util', 'green', 'garages'])]);
    const q = [[y.x0, mx, y.z0, mz], [mx, y.x1, y.z0, mz], [y.x0, mx, mz, y.z1], [mx, y.x1, mz, y.z1]];
    q.forEach(([x0, x1, z0, z1], i) => this.fillZone(B, r, { x0, x1, z0, z1 }, kinds[i]));
  }

  // try a few random spots inside a zone
  scatter(B, r, z, name, n = 1, rotFn = () => r.int(0, 3) * HALF_PI, tries = 10) {
    let placed = 0;
    for (let i = 0; i < tries && placed < n; i++) {
      const x = r.range(z.x0, z.x1), zz = r.range(z.z0, z.z1);
      if (this.tryPlace(B, name, x, zz, rotFn())) placed++;
    }
    return placed;
  }

  fillZone(B, r, z, kind) {
    const w = z.x1 - z.x0, d = z.z1 - z.z0;
    if (w < 3 || d < 3) return;
    const cx = (z.x0 + z.x1) / 2, cz = (z.z0 + z.z1) / 2;
    if (kind === 'play') {
      for (const n of ['swings', 'slide', 'sandbox', 'carousel', 'balance', 'bars', 'swings']) this.scatter(B, r, z, n, 1);
      this.scatter(B, r, z, 'bench_flat', 2);
      if (r.chance(0.35)) this.scatter(B, r, z, 'snowman', 1, () => r.range(0, 6.28));
      this.scatter(B, r, z, 'ylamp_w', 1);
    } else if (kind === 'sport') {
      const rot = w > d ? 0 : HALF_PI;
      if (!this.tryPlace(B, 'hockey', cx, cz, rot)) {
        // football in the snow: two goals facing each other
        const half = Math.min(9, (w > d ? w : d) / 2 - 2);
        const [ax, az] = w > d ? [half, 0] : [0, half];
        this.tryPlace(B, 'goal', cx - ax, cz - az, w > d ? HALF_PI : 0);
        this.tryPlace(B, 'goal', cx + ax, cz + az, w > d ? -HALF_PI : Math.PI);
        this.scatter(B, r, z, 'bars', 1);
      }
    } else if (kind === 'green') {
      this.scatter(B, r, z, r.chance(0.5) ? 'laundry' : 'beater', 1);
      if (r.chance(0.5)) this.scatter(B, r, z, 'beater', 1);
      this.scatter(B, r, z, 'tires', r.int(0, 2));
      this.scatter(B, r, z, 'bench_flat', r.int(0, 2));
      this.scatter(B, r, z, 'drift_low', 2, () => r.range(0, 3));
      if (r.chance(0.2)) this.scatter(B, r, z, 'snowman', 1, () => r.range(0, 6.28));
    } else if (kind === 'util') {
      this.scatter(B, r, z, 'containers', 1);
      this.scatter(B, r, z, 'tp', 1);
      if (r.chance(0.4)) this.scatter(B, r, z, 'kiosk', 1);
      this.scatter(B, r, z, 'drift_pile', 1, () => r.range(0, 3));
    } else if (kind === 'garages') {
      const rot = w > d ? r.pick([0, Math.PI]) : r.pick([HALF_PI, -HALF_PI]);
      if (!this.tryPlace(B, r.pick(['garages6', 'garages4']), cx, cz, rot)) this.scatter(B, r, z, 'garages4', 1, () => rot);
      for (let i = 0; i < 4; i++) this.scatter(B, r, z, r.pick(['shell_green', 'shell_white']), 1, () => rot + (r.chance(0.5) ? 0 : Math.PI));
    }
    // trees fill what is left
    const n = Math.round(w * d / 70);
    for (let i = 0; i < n; i++) this.scatter(B, r, z, r.pick(TREES), 1, () => r.range(0, 6.28), 3);
  }

  // ---------------------------------------------------------------- colliders

  indexCols(B) {
    for (const c of B.cols) {
      const i0 = Math.floor((c.min.x - B.cx) / CELL), i1 = Math.floor((c.max.x - B.cx) / CELL);
      const j0 = Math.floor((c.min.z - B.cz) / CELL), j1 = Math.floor((c.max.z - B.cz) / CELL);
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          const k = i * 1000 + j;
          let cell = B.grid.get(k);
          if (!cell) B.grid.set(k, (cell = []));
          cell.push(c);
        }
      }
    }
  }

  collidersNear(x, z, r) {
    const q = ++this.query;
    const out = [];
    const bx0 = Math.round((x - r) / PB), bx1 = Math.round((x + r) / PB);
    const bz0 = Math.round((z - r) / PB), bz1 = Math.round((z + r) / PB);
    for (let bx = bx0; bx <= bx1; bx++) {
      for (let bz = bz0; bz <= bz1; bz++) {
        const b = this.blocks.get(bx + ',' + bz);
        if (!b) continue;
        const i0 = Math.floor((x - r - b.cx) / CELL), i1 = Math.floor((x + r - b.cx) / CELL);
        const j0 = Math.floor((z - r - b.cz) / CELL), j1 = Math.floor((z + r - b.cz) / CELL);
        for (let i = i0; i <= i1; i++) {
          for (let j = j0; j <= j1; j++) {
            const cell = b.grid.get(i * 1000 + j);
            if (!cell) continue;
            for (const c of cell) if (c._q !== q) { c._q = q; out.push(c); }
          }
        }
      }
    }
    return out;
  }

  groundY() {
    return 0;
  }

  blockAt(x, z) {
    return this.block(Math.round(x / PB), Math.round(z / PB));
  }

  // ---------------------------------------------------------------- active blocks

  update(pos) {
    const bx = Math.round(pos.x / PB), bz = Math.round(pos.z / PB);
    const key = bx + ',' + bz + ':' + this.radius;
    this.ground.position.set(bx * PB, 0, bz * PB);
    this.ground.updateMatrixWorld();
    if (key === this.centerKey) return false;
    this.centerKey = key;
    this.active.clear();
    const list = [];
    const R = this.radius;
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dz * dz > (R + 0.5) * (R + 0.5)) continue;
        list.push(this.block(bx + dx, bz + dz));
        this.active.add((bx + dx) + ',' + (bz + dz));
      }
    }
    this.activeBlocks = list;
    this.rebuild(list);
    return true;
  }

  rebuild(list) {
    const all = new Map();
    for (const b of list) {
      for (const [name, ms] of b.inst) {
        if (!all.has(name)) all.set(name, []);
        all.get(name).push(...ms);
      }
    }
    for (const [name, pool] of this.pools) if (!all.has(name) && !name.startsWith('car')) pool.forEach((m) => { m.count = 0; });
    for (const [name, ms] of all) this.fillPool(name, ms);
    this.updateCars(this.carCam || new V3(list[0].cx, 0, list[0].cz), true);
    // snow strips: one merged mesh per kind
    for (const kind of Object.keys(this.pads)) {
      const pos = [], uv = [], nor = [], idx = [];
      for (const b of list) {
        for (const p of b.pads) {
          if (p.kind !== kind) continue;
          const dx = p.x1 - p.x0, dz = p.z1 - p.z0;
          const L = Math.hypot(dx, dz);
          const nx = -dz / L * p.hw, nz = dx / L * p.hw;
          const ax = b.cx + p.x0, az = b.cz + p.z0, bx = b.cx + p.x1, bz = b.cz + p.z1;
          const v = pos.length / 3;
          pos.push(ax - nx, p.y, az - nz, ax + nx, p.y, az + nz, bx + nx, p.y, bz + nz, bx - nx, p.y, bz - nz);
          // the shader reads the length of the strip from the integer part of u
          const n = 4 * Math.round(L);
          uv.push(n - 1, 0, n + 1, 0, n + 1, L, n - 1, L);
          nor.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
          // both windings would be fine for the eye, keep the one that faces up
          if (nx * dz - nz * dx > 0) idx.push(v, v + 2, v + 1, v, v + 3, v + 2);
          else idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      this.pads[kind].geometry.dispose();
      this.pads[kind].geometry = g;
    }
  }

  // instanced meshes of one asset (one per material), grown when needed
  fillPool(name, ms) {
    let pool = this.pools.get(name);
    const need = ms.length;
    if (!pool || pool[0].instanceMatrix.count < need) {
      if (pool) pool.forEach((m) => { this.group.remove(m); m.dispose(); });
      const cap = Math.max(8, Math.ceil(need * 1.5));
      pool = this.assets.get(name).parts.map((p) => this.instanced(p.geometry, p.material, cap));
      this.pools.set(name, pool);
    }
    for (const m of pool) {
      for (let i = 0; i < need; i++) m.setMatrixAt(i, ms[i]);
      m.count = need;
      m.instanceMatrix.needsUpdate = true;
    }
  }

  // Detailed cars near the camera, their low polygon twins farther away. Redone after every 4 m of movement.
  updateCars(cam, force = false) {
    if (!force && this.carCam && this.carCam.distanceToSquared(cam) < 16) return;
    this.carCam = (this.carCam || new V3()).copy(cam);
    const lists = new Map();
    for (const b of this.activeBlocks) {
      for (const c of b.cars) {
        const near = (c.x - cam.x) ** 2 + (c.z - cam.z) ** 2 < CAR_LOD * CAR_LOD;
        const n = near ? c.name : c.name + '_lod';
        if (!lists.has(n)) lists.set(n, []);
        lists.get(n).push(c.m);
      }
    }
    for (const [name, pool] of this.pools) if (name.startsWith('car') && !lists.has(name)) pool.forEach((m) => { m.count = 0; });
    for (const [name, ms] of lists) this.fillPool(name, ms);
  }

  // ---------------------------------------------------------------- lights

  // The nearest lights go to the shaders; the last few fade out instead of popping
  updateLights(cam) {
    this.updateCars(cam);
    const cand = [];
    for (const b of this.activeBlocks) {
      if (Math.abs(b.cx - cam.x) > PB + 60 || Math.abs(b.cz - cam.z) > PB + 60) continue;
      for (const L of b.lights) {
        const d = L.p.distanceTo(cam);
        if (d > 85) continue;
        cand.push({ L, s: d - L.range * 0.5 });
      }
    }
    cand.sort((a, b) => a.s - b.s);
    const n = Math.min(PK_LIGHTS, cand.length);
    const cut = cand.length > PK_LIGHTS ? cand[PK_LIGHTS].s : 80;
    for (let i = 0; i < PK_LIGHTS; i++) {
      const P = U.uPL.value[i], C = U.uPC.value[i];
      if (i >= n) { P.set(0, -1000, 0, 0); continue; }
      const { L, s } = cand[i];
      const fade = THREE.MathUtils.smoothstep(cut - s, 0, 10);
      P.set(L.p.x, L.p.y, L.p.z, L.range);
      C.set(L.col[0] * fade, L.col[1] * fade, L.col[2] * fade, L.kind);
    }
  }

  // A step on the snow: left and right prints a little apart, turned the way you walk
  footstep(pos, facing) {
    this.printSide = -this.printSide;
    const a = new V3(Math.cos(facing), 0, -Math.sin(facing)).multiplyScalar(0.11 * this.printSide);
    const m = new THREE.Matrix4().compose(new V3(pos.x + a.x, 0.075, pos.z + a.z),
      new THREE.Quaternion().setFromAxisAngle(UP, facing + (Math.random() - 0.5) * 0.2), ONE);
    const i = this.printN++ % PRINTS;
    this.prints.setMatrixAt(i, m);
    this.prints.count = Math.min(PRINTS, this.printN);
    this.prints.instanceMatrix.needsUpdate = true;
  }

  // ---------------------------------------------------------------- spawn and title view

  // Title screen camera: just inside a window of this building, looking across the yard
  windowView(B, pl, y, lookY) {
    const it = this.assets.get(pl.name);
    // the body of the building is its biggest collider
    let body = it.cols[0];
    for (const c of it.cols) if (vol(c) > vol(body)) body = c;
    const f = new V3(Math.sin(pl.rot), 0, Math.cos(pl.rot));
    const half = (body.max.z - body.min.z) / 2;
    const c = new V3(B.cx + pl.lx, y, B.cz + pl.lz).addScaledVector(f, half - 0.35);
    return { pos: c, look: c.clone().addScaledVector(f, 40).setY(lookY) };
  }

  spawnPoint() {
    for (let ring = 0; ring < 4; ring++) {
      for (let dz = -ring; dz <= ring; dz++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
          const b = this.block(dx, dz);
          if (!b.doors.length) continue;
          const d = b.doors[Math.min(1, b.doors.length - 1)];
          const f = new V3(Math.sin(d.rot), 0, Math.cos(d.rot));
          const p = d.p.clone().addScaledVector(f, 6.5);
          return { x: p.x, y: 0, z: p.z, yaw: d.rot };
        }
      }
    }
    return { x: 0, y: 0, z: 0, yaw: 0 };
  }

  titleSpot(pos) {
    const b = this.blockAt(pos.x, pos.z);
    return b.view || { pos: new V3(b.cx, 12, b.cz + 30), look: new V3(b.cx, 3, b.cz) };
  }
}

// distance check between a rectangle and a pad strip, in block-local coordinates
function rectNearSegment(x0, z0, x1, z1, p) {
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const hx = (x1 - x0) / 2, hz = (z1 - z0) / 2;
  const dx = p.x1 - p.x0, dz = p.z1 - p.z0;
  const L2 = dx * dx + dz * dz;
  let t = L2 > 0 ? ((cx - p.x0) * dx + (cz - p.z0) * dz) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = p.x0 + dx * t, qz = p.z0 + dz * t;
  // closest point of the rectangle to that point of the centerline
  const ex = Math.max(Math.abs(qx - cx) - hx, 0), ez = Math.max(Math.abs(qz - cz) - hz, 0);
  return ex * ex + ez * ez < p.hw * p.hw;
}

function vol(b) {
  return (b.max.x - b.min.x) * (b.max.y - b.min.y) * (b.max.z - b.min.z);
}

function shuffle(r, a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
