// QA for the khrushchyovka with interiors: can you get everywhere without getting stuck?
//   1. reachability: a flood fill over every floor of every drawn section with the player's own rules
//      (radius 0.3 m, 1.8 m tall, steps up to 0.42 m), all doors open; every room and balcony must be reached
//   2. a walk with the real player physics: street, entrance door (E), stairs up every floor, into every
//      apartment of one floor through all its rooms and out on the balconies, light switches, roof hatch, roof
//   3. screenshots inside
// Usage: node data/tools/interior_test.js [outDir] [--fast]
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { launch, freePort, sleep } from './cdp.js';

const out = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'data/shots';
const fast = process.argv.includes('--fast');
mkdirSync(out, { recursive: true });
const port = await freePort();
const server = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
await sleep(400);
const b = await launch({ width: 1280, height: 720, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] });
const shot = (n) => b.shot(path.join(out, 'in-' + n + '.png'));
let failed = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failed++; };

// helpers that live in the page
const HELPERS = `
window.__qa = (() => {
  const G = __game, W = G.world, I = W.interiors, P = I.plan, T = G.THREE;
  const qa = {};
  qa.sec = () => I.loaded.slice().sort((a, b) => a.center.distanceTo(G.player.pos) - b.center.distanceTo(G.player.pos))[0];
  qa.world = (sec, x, h, y) => I.planToWorld(sec, x, h, y);
  qa.plan = (sec, p) => I.toPlan(sec, p).clone();
  qa.fz = (f) => P.PL + f * P.FH;
  // put the player somewhere in the plan, looking toward a plan point
  qa.put = (sec, x, y, h, lx, ly, pitch = -0.1) => {
    const p = qa.world(sec, x, h, y), l = qa.world(sec, lx, h, ly);
    G.player.spawn({ x: p.x, y: p.y, z: p.z, camYaw: Math.atan2(-(l.x - p.x), -(l.z - p.z)) });
    G.player.camPitch = pitch;
    G.player.vel.set(0, 0, 0);
  };
  // E on whatever you look at, aiming at a plan point
  qa.press = (sec, lx, lh, ly, onlyOpen) => {
    const pl = G.player;
    const l = qa.world(sec, lx, lh, ly);
    const eye = new T.Vector3(pl.pos.x, pl.pos.y + pl.eye, pl.pos.z);
    pl.camYaw = Math.atan2(-(l.x - eye.x), -(l.z - eye.z));
    const dir = l.clone().sub(eye).normalize();
    const t = I.pick(eye, dir, eye);
    const label = I.label(t);
    // a door that is already open stays open
    if (onlyOpen && t && t.door && t.door.open) return { label: 'already open', used: true };
    const used = I.use(t, pl);
    return { label, used };
  };
  // E on a door: find it in the plan, look at the middle of its leaf, press. Open doors stay open.
  qa.openDoor = (sec, fl, x, y) => {
    let d = null, best = Infinity;
    for (const o of I.doors) {
      if (o.sec !== sec || o.fl !== fl || o.hatch) continue;
      const dist = Math.hypot(o.px - x, o.py - y);
      if (dist < best) { best = dist; d = o; }
    }
    if (!d) return { label: 'no door', used: false };
    if (d.open) return { label: 'already open', used: true };
    const pl = G.player;
    const c = I.doorCenter(d);
    const eye = new T.Vector3(pl.pos.x, pl.pos.y + pl.eye, pl.pos.z);
    pl.camYaw = Math.atan2(-(c.x - eye.x), -(c.z - eye.z));
    const t = I.pick(eye, c.clone().sub(eye).normalize(), eye);
    if (!t || t.door !== d) return { label: 'aimed at ' + (t ? (t.sw ? 'a switch' : 'another door') : 'nothing'), used: false };
    const label = I.label(t);
    return { label, used: I.use(t, pl) };
  };
  // walk through plan waypoints with the real physics; returns how far it got
  qa.walk = (sec, pts, opts = {}) => new Promise((resolve) => {
    const pl = G.player, inp = G.input;
    let i = 0, t = 0, best = Infinity, still = 0;
    const sub = opts.sub || 5;
    const step = () => {
      for (let k = 0; k < sub; k++) {
        const [x, y, h] = pts[i];
        const w = qa.world(sec, x, h ?? pl.pos.y, y);
        const dx = w.x - pl.pos.x, dz = w.z - pl.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.22) {
          i++; t = 0; best = Infinity; still = 0;
          if (i >= pts.length) { inp.keys.delete('KeyW'); resolve({ ok: true, at: i, pos: pl.pos.clone() }); return; }
          continue;
        }
        pl.camYaw = Math.atan2(-dx, -dz);
        inp.keys.add('KeyW');
        pl.update(1 / 60, inp);
        t += 1 / 60;
        if (d < best - 0.01) { best = d; still = 0; } else still += 1 / 60;
        if (still > 4 || t > 30) {
          inp.keys.delete('KeyW');
          resolve({ ok: false, at: i, pos: pl.pos.clone(), plan: qa.plan(sec, pl.pos), want: pts[i] });
          return;
        }
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  // open every door of the drawn sections
  qa.openAll = () => { for (const d of I.doors) { d.open = true; d.angle = 1; } I.updateDoorCols(); };
  // flood fill one floor (or the whole stairwell) of a section in its plan, with the player's rules
  qa.flood = (sec, startX, startY, startH) => {
    const R = 0.3, H = 1.8, STEP = 0.42, cs = 0.1;
    const cols = W.collidersNear(sec.center.x, sec.center.z, 22).map((c) => {
      const a = I.toPlan(sec, c.min).clone(), b2 = I.toPlan(sec, c.max).clone();
      return { x0: Math.min(a.x, b2.x), x1: Math.max(a.x, b2.x), y0: Math.min(a.z, b2.z), y1: Math.max(a.z, b2.z), z0: Math.min(a.y, b2.y), z1: Math.max(a.y, b2.y) };
    });
    // bucket the boxes by 1 m cells of the plan
    const grid = new Map();
    for (const c of cols) {
      for (let i = Math.floor(c.x0) - 1; i <= Math.floor(c.x1) + 1; i++) for (let j = Math.floor(c.y0) - 1; j <= Math.floor(c.y1) + 1; j++) {
        const k = i * 1000 + j; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(c);
      }
    }
    const near = (x, y) => grid.get(Math.floor(x) * 1000 + Math.floor(y)) || [];
    const floorAt = (x, y, h) => {
      let f = 0;
      for (const c of near(x, y)) {
        if (x + R * 0.7 <= c.x0 || x - R * 0.7 >= c.x1 || y + R * 0.7 <= c.y0 || y - R * 0.7 >= c.y1) continue;
        if (c.z1 <= h + STEP + 0.001) f = Math.max(f, c.z1);
      }
      return f;
    };
    const blocked = (x, y, h) => {
      for (const c of near(x, y)) {
        if (h + H <= c.z0 + 0.01 || h + STEP >= c.z1) continue;
        const cx = Math.max(c.x0, Math.min(x, c.x1)), cy = Math.max(c.y0, Math.min(y, c.y1));
        if ((x - cx) ** 2 + (y - cy) ** 2 < R * R - 1e-4) return true;
      }
      return false;
    };
    const seen = new Map();
    const key = (i, j, h) => i + ',' + j + ',' + Math.round(h / 0.9);
    const q = [];
    const si = Math.round(startX / cs), sj = Math.round(startY / cs);
    q.push([si, sj, startH]); seen.set(key(si, sj, startH), startH);
    const reached = [];
    while (q.length) {
      const [i, j, h] = q.shift();
      reached.push([i * cs, j * cs, h]);
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di, nj = j + dj, x = ni * cs, y = nj * cs;
        if (x < -1.5 || x > P.W + 1.5 || y < -3 || y > P.D + 1.4) continue;
        let nh = floorAt(x, y, h);
        if (blocked(x, y, h)) continue;
        // falling off an edge: you land on what is below
        if (nh < h - 0.6) nh = floorAt(x, y, nh);
        if (blocked(x, y, nh)) continue;
        const k = key(ni, nj, nh);
        if (seen.has(k)) continue;
        seen.set(k, nh);
        q.push([ni, nj, nh]);
      }
    }
    return reached;
  };
  return qa;
})();`;

try {
  await b.goto(`http://127.0.0.1:${port}/`);
  for (let i = 0; i < 150; i++) { if ((await b.eval('window.__game && __game.mode')) === 'splash') break; await sleep(200); }
  await b.eval('__game.start()');
  await sleep(2500);
  await b.eval(`__game.settings.camera = 'first'`);
  await b.eval(HELPERS);
  console.log('sections drawn:', await b.eval('__game.world.interiors.loaded.length'));
  const P = await b.eval('JSON.stringify(__game.world.interiors.plan)').then(JSON.parse);

  // ------------------------------------------------------------ 1. reachability
  const flood = await b.eval(`(() => {
    const I = __game.world.interiors, P = I.plan, out = [];
    __qa.openAll();
    for (const sec of I.loaded) {
      // from the street in front of the entrance: through the hall, up all the stairs, into every flat
      const r = __qa.flood(sec, 8.0, -1.2, 0.0);
      const rooms = {};
      for (const [x, y, h] of r) {
        const fl = Math.floor((h - P.PL + 0.15) / P.FH);
        const room = I.roomAt(x, y);
        if (room >= 0 && h > P.PL - 0.2) rooms[fl + ':' + room] = (rooms[fl + ':' + room] || 0) + 1;
        if (y > P.D + 0.2 && h > P.PL - 0.2) rooms[fl + ':balcony' + (x < 8 ? 'L' : 'B')] = (rooms[fl + ':balcony' + (x < 8 ? 'L' : 'B')] || 0) + 1;
      }
      const missing = [];
      for (let fl = 0; fl < P.FLOORS; fl++) {
        // a combined bath has a spot of floor between the tub, the toilet and the sink, rooms have plenty
        for (const room of P.rooms) if (room.id > 0 && !(rooms[fl + ':' + room.id] > (room.kind === 2 ? 6 : 30))) missing.push(fl + ':' + room.name + ' (' + (rooms[fl + ':' + room.id] || 0) + ')');
        for (const side of ['L', 'B']) if (!(rooms[fl + ':balcony' + side] > 10)) missing.push(fl + ':balcony ' + side);
      }
      const top = Math.max(...r.map((c) => c[2]));
      out.push({ sec: sec.key, cells: r.length, top: +top.toFixed(2), missing });
    }
    return JSON.stringify(out);
  })()`).then(JSON.parse);
  for (const f of flood) {
    check(f.missing.length === 0, `flood fill ${f.sec}: ${f.cells} cells, highest floor ${f.top} m` + (f.missing.length ? ', not reached: ' + f.missing.join(', ') : ', every room and balcony on every floor'));
  }
  await b.eval(`(() => { const I = __game.world.interiors; for (const d of I.doors) { d.open = false; d.angle = 0; } I.updateDoorCols(); })()`);

  // ------------------------------------------------------------ 2. the walk
  const secKey = await b.eval('__qa.sec().key');
  const S = `__game.world.interiors.loaded.find((s) => s.key === '${secKey}')`;
  const walk = async (name, pts) => {
    const r = await b.eval(`__qa.walk(${S}, ${JSON.stringify(pts)}).then((r) => JSON.stringify(r))`).then(JSON.parse);
    check(r.ok, `${name}` + (r.ok ? '' : ` stuck before waypoint ${r.at} ${JSON.stringify(r.want)} at plan ${JSON.stringify(r.plan)}`));
    return r.ok;
  };
  // E on a switch (aiming at a plan point) or a door (found in the plan, aiming at its leaf)
  const press = async (what, x, h, y, door = true) => {
    const r = await b.eval(`JSON.stringify(__qa.press(${S}, ${x}, ${h}, ${y}, ${door}))`).then(JSON.parse);
    const good = r.used && (door ? /OPEN|already/.test(r.label) : /LIGHT/.test(r.label));
    check(good, `E: ${what} (${r.label || 'nothing in sight'})`);
    await sleep(450);
  };
  const door = async (what, fl, x, y) => {
    const r = await b.eval(`JSON.stringify(__qa.openDoor(${S}, ${fl}, ${x}, ${y}))`).then(JSON.parse);
    check(r.used, `E: ${what} (${r.label})`);
    await sleep(450);
  };
  const fz = (f) => P.PL + f * P.FH;
  await b.eval(`__qa.put(${S}, 8.0, -2.2, 0.0, 8.0, 0.0, -0.05)`);
  await sleep(300);
  await shot('00-entrance');
  await press('entrance door', 8.0, 1.2, 0.0);
  await shot('01-entrance-open');
  let ok = await walk('street into the entrance hall', [[8.0, -0.6], [8.0, 0.9], [8.8, 2.2]]);
  await shot('02-hall');
  // up the stairs: five steps, then two flights per floor
  const flights = [[8.8, 2.4], [8.8, 4.4], [7.2, 4.2], [7.2, 1.2], [8.0, 1.0], [8.8, 1.3], [8.8, 4.3]];
  ok = ok && await walk('five steps up to the first floor', [[8.8, 2.4], [8.8, 4.5]]);
  for (let f = 0; f < P.FLOORS - 1 && ok; f++) {
    ok = await walk(`stairs from floor ${f + 1} to ${f + 2}`, flights.slice(2));
    if (f === 1) await shot('03-stairs');
  }
  const top = await b.eval(`__qa.plan(${S}, __game.player.pos).y.toFixed(2)`);
  check(Math.abs(top - fz(P.FLOORS - 1)) < 0.1, `on the top landing (${top} m)`);
  await shot('04-top-landing');

  // the flats of the second floor
  const F = 1;
  const h = fz(F);
  await b.eval(`__qa.put(${S}, 8.0, 4.7, ${h}, 6.4, 4.8)`);
  await sleep(300);
  await shot('05-landing');
  // walk up to a door, press E on it, go through: [name, hinge x, y, approach x, y]
  const through = async (name, x, y, ax, ay) => {
    await walk(`${name}: up to the door`, [[ax, ay]]);
    await door(name, F, x, y);
  };
  await through('door of flat L', 6.33, 5.3, 7.0, 4.8);
  await walk('into L, the hall', [[6.0, 4.8], [5.6, 4.6]]);
  await press('light in the hall of L', 6.33, h + 1.5, 4.15, false);
  await through('kitchen door of L', 6.05, 2.35, 5.6, 2.9);
  await walk('L kitchen', [[5.6, 2.0], [4.3, 1.95]]);
  await b.eval(`__game.player.camYaw += Math.PI * 0.75; __game.player.camPitch = -0.15`);
  await sleep(300);
  await shot('06-L-kitchen');
  await walk('L back to the hall', [[5.6, 2.0], [5.6, 3.0]]);
  await through('bath door of L', 4.97, 4.0, 5.4, 3.6);
  await walk('into the bath of L', [[4.5, 3.6], [4.4, 3.4]]);
  await shot('07-L-bath');
  await walk('out of the bath of L', [[5.4, 3.7], [5.4, 4.8]]);
  await through('living room door of L', 5.1, 5.67, 4.65, 5.0);
  await walk('L into the living room', [[4.65, 6.2]]);
  await press('living room light of L', 4.0, h + 1.5, 5.67, false);
  await walk('L living room', [[5.4, 7.0], [5.4, 8.6]]);
  await b.eval(`__game.player.camYaw += Math.PI * 0.8; __game.player.camPitch = -0.2`);
  await sleep(300);
  await shot('08-L-living');
  await walk('L across the living room', [[5.4, 9.2], [4.55, 9.35], [4.4, 10.0]]);
  await through('balcony door of L', 3.65, 11.05, 4.1, 10.2);
  await walk('L onto the balcony', [[4.1, 10.6], [4.05, 11.75]]);
  await b.eval(`__game.player.camYaw += Math.PI; __game.player.camPitch = -0.1`);
  await sleep(300);
  await shot('09-L-balcony');
  await walk('L back in', [[4.1, 10.6], [4.55, 9.35], [5.4, 9.2], [5.4, 7.0], [4.6, 6.4], [3.6, 6.3]]);
  await through('bedroom door of L', 3.13, 5.8, 3.6, 6.3);
  await walk('L bedroom', [[2.6, 6.4], [2.5, 7.0], [2.4, 9.8]]);
  await shot('10-L-bedroom');
  await walk('L bedroom back to the hall', [[2.5, 7.0], [2.6, 6.4], [3.6, 6.3], [4.6, 6.4], [4.65, 5.9], [4.65, 4.8], [3.6, 4.7]]);
  await through('door of the small room of L', 3.13, 5.15, 3.6, 4.7);
  await walk('L small room', [[2.6, 4.7], [2.0, 4.0], [1.8, 2.4]]);
  await shot('11-L-small-room');
  await walk('out of L onto the landing', [[2.0, 4.0], [2.6, 4.7], [3.8, 4.8], [5.6, 4.6], [6.0, 4.8], [7.0, 4.8]]);

  await through('door of flat B', 7.6, 5.67, 8.07, 4.9);
  await walk('into B, its hall', [[8.07, 5.9], [8.07, 6.4], [8.9, 6.6]]);
  await through('room door of B', 9.67, 5.8, 9.0, 6.25);
  await walk('B room', [[9.9, 6.25], [10.4, 6.6], [11.0, 9.4]]);
  await shot('12-B-room');
  await walk('B to the balcony door', [[10.45, 9.6]]);
  await through('balcony door of B', 10.05, 11.05, 10.45, 10.1);
  await walk('B onto the balcony', [[10.45, 10.6], [10.45, 11.75]]);
  await walk('B back in, to its kitchen', [[10.45, 10.0], [11.0, 9.4], [10.4, 6.6], [9.9, 6.25], [9.0, 6.25], [8.9, 7.8]]);
  await through('kitchen door of B', 9.4, 9.05, 8.9, 8.5);
  await walk('B kitchen', [[8.9, 9.5], [7.8, 9.9]]);
  await b.eval(`__game.player.camYaw += Math.PI * 0.5`);
  await sleep(300);
  await shot('13-B-kitchen');
  await walk('B to its bath door', [[8.8, 9.5], [8.8, 7.0], [7.7, 6.9]]);
  await through('bath door of B', 8.1, 7.38, 7.7, 6.9);
  await walk('into the bath of B', [[7.7, 7.6], [7.65, 7.8]]);
  await walk('out of B onto the landing', [[7.7, 6.9], [8.07, 6.2], [8.07, 4.9]]);

  await through('door of flat R', 9.67, 5.3, 9.0, 4.8);
  await walk('into R, the hall', [[10.0, 4.8], [10.4, 4.6]]);
  await through('kitchen door of R', 9.95, 2.35, 10.4, 2.9);
  await walk('R kitchen', [[10.4, 2.0], [11.7, 1.95]]);
  await shot('14-R-kitchen');
  await walk('R back to the hall', [[10.4, 2.0], [10.4, 3.0], [10.4, 4.7]]);
  await through('living room door of R', 12.87, 4.35, 12.4, 4.75);
  await walk('R living room', [[13.3, 4.8], [14.0, 4.0], [13.8, 1.8]]);
  await b.eval(`__game.player.camYaw += Math.PI * 0.6; __game.player.camPitch = -0.15`);
  await sleep(300);
  await shot('15-R-living');
  await walk('R back across the living room', [[14.0, 4.0]]);
  await through('bedroom door of R', 13.4, 5.67, 13.85, 5.0);
  await walk('R bedroom', [[13.85, 5.9], [13.6, 7.0], [13.7, 9.8]]);
  await shot('16-R-bedroom');
  await walk('out of R onto the landing', [[13.6, 7.0], [13.85, 6.0], [13.85, 5.0], [13.3, 4.8], [12.4, 4.75], [10.4, 4.7], [9.9, 4.8], [9.0, 4.8]]);

  // the roof: open the hatch, climb out
  const t = fz(P.FLOORS - 1);
  await b.eval(`__qa.put(${S}, 7.12, 4.92, ${t}, 7.12, 5.5, 0.9)`);
  await sleep(300);
  await press('roof hatch', 7.12, 14.4, 4.92);
  await sleep(700);
  await shot('17-hatch-open');
  const climbed = await b.eval(`(() => { const pl = __game.player; pl.camYaw = Math.PI; return pl.startClimb(); })()`);
  for (let i = 0; i < 40 && await b.eval('!!__game.player.climb'); i++) await sleep(100);
  const roofY = await b.eval('__game.player.pos.y.toFixed(2)');
  check(climbed && roofY > 14.5, `climbed through the hatch onto the roof (${roofY} m)`);
  await b.eval(`__game.settings.camera = 'third'; __game.player.camPitch = 0.3`);
  await sleep(500);
  await shot('18-roof');
  // and back down: walk into the hatch
  await walk('roof back into the hatch', [[7.12, 5.9, 14.6], [7.12, 4.92, 14.6]]);
  await sleep(1200);
  const down = await b.eval(`__qa.plan(${S}, __game.player.pos).y.toFixed(2)`);
  check(Math.abs(down - t) < 0.2, `dropped back onto the top landing (${down} m)`);
  await b.eval(`__game.settings.camera = 'first'`);

  // a switch must change the room it belongs to: the living room of L, from inside it
  const sw = await b.eval(`(() => { const I = __game.world.interiors, sec = ${S}; const before = I.roomLit(sec, 1, 4); __qa.put(sec, 4.3, 6.5, ${h}, 4.0, 5.67); const r = __qa.press(sec, 4.0, ${h} + 1.5, 5.67, false); return JSON.stringify({ before, after: I.roomLit(sec, 1, 4), r }); })()`).then(JSON.parse);
  check(sw.before !== sw.after, `living room switch turns the light ${sw.after ? 'on' : 'off'}`);
} finally {
  const errs = b.errors.filter((e) => !/pointer lock/i.test(e));
  console.log('errors:', errs.length ? errs.slice(0, 10) : 'none');
  console.log(failed ? `${failed} checks failed` : 'all checks passed');
  await b.close();
  server.kill();
  process.exitCode = failed ? 1 : 0;
}
