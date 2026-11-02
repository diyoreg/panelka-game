// QA for the nine-storey with the lift (k9i): finds one near the start, then
//   1. reachability: a flood fill over every floor with the player's rules, all doors open: every room of every
//      flat and both kinds of balcony must be reached from the street, up the stairs
//   2. the lift with the real game loop: call it on the second floor, wait for the doors, walk in, press 7, ride,
//      walk out on the seventh floor; the doors must stay shut while the cab is away and must open again on
//      somebody standing in them; STOP between the floors
//   3. screenshots
// Usage: node data/tools/lift_test.js [outDir]
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { launch, freePort, sleep } from './cdp.js';

const out = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'data/shots';
mkdirSync(out, { recursive: true });
const port = await freePort();
const server = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
await sleep(400);
const b = await launch({ width: 1280, height: 720, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] });
const shot = (n) => b.shot(path.join(out, 'lift-' + n + '.png'));
let failed = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failed++; };

const HELPERS = `
window.__q = (() => {
  const G = __game, W = G.world, I = W.interiors, P = I.plans.k9i, T = G.THREE;
  const q = { P };
  q.sec = () => I.loaded.find((s) => s.key === q.key) || I.loaded.filter((s) => s.P === P)[0];
  q.lift = () => I.lifts.find((L) => L.sec.key === q.sec().key);
  q.level = (f) => P.PL + f * P.FH;
  q.plan = () => I.toPlan(q.sec(), G.player.pos).clone();
  q.put = (x, y, h, lx, ly, lh = h + 1.5) => {
    const s = q.sec(), p = I.planToWorld(s, x, h, y), l = I.planToWorld(s, lx, lh, ly);
    G.player.spawn({ x: p.x, y: p.y, z: p.z, camYaw: Math.atan2(-(l.x - p.x), -(l.z - p.z)) });
    G.player.camPitch = Math.atan2(l.y - (p.y + G.player.eye), Math.hypot(l.x - p.x, l.z - p.z));
    G.player.vel.set(0, 0, 0);
  };
  // walk to a plan point with W held, through the real game loop; resolves when there or stuck
  q.walkTo = (x, y, maxT = 8) => new Promise((resolve) => {
    const pl = G.player, inp = G.input;
    const t0 = performance.now();
    const step = () => {
      const s = q.sec(), h = pl.pos.y;
      const w = I.planToWorld(s, x, h, y);
      const dx = w.x - pl.pos.x, dz = w.z - pl.pos.z;
      if (Math.hypot(dx, dz) < 0.15 || performance.now() - t0 > maxT * 1000) {
        inp.keys.delete('KeyW');
        resolve(Math.hypot(dx, dz));
        return;
      }
      pl.camYaw = Math.atan2(-dx, -dz);
      inp.keys.add('KeyW');
      requestAnimationFrame(step);
    };
    step();
  });
  q.press = (kind, floor) => {
    const L = q.lift();
    const btn = L.buttons().find((b) => b.kind === kind && (floor === undefined || b.floor === floor));
    return L.press(btn);
  };
  q.state = () => { const L = q.lift(); return JSON.stringify({ state: L.state, z: +L.z.toFixed(3), floor: L.floor, door: +L.door.toFixed(2), queue: L.queue, cab: [...L.cabLit], call: [...L.callLit] }); };
  q.waitFor = (cond, maxT = 40) => new Promise((resolve) => {
    const t0 = performance.now();
    const step = () => {
      if (cond() || performance.now() - t0 > maxT * 1000) { resolve(cond()); return; }
      requestAnimationFrame(step);
    };
    step();
  });
  return q;
})();`;

try {
  await b.goto(`http://127.0.0.1:${port}/`);
  for (let i = 0; i < 150; i++) { if ((await b.eval('window.__game && __game.mode')) === 'splash') break; await sleep(200); }
  await b.eval('__game.start()');
  await sleep(2000);
  // a nine-storey with interiors near the start
  const key = await b.eval(`(() => {
    const W = __game.world, pl = __game.player;
    const bx = Math.round(pl.pos.x / 128), bz = Math.round(pl.pos.z / 128);
    for (let r = 0; r < 6; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const s = (W.block(bx + dx, bz + dz).sections || []).find((s) => s.P.name === 'k9i');
      if (s) { const p = W.interiors.planToWorld(s, 10.5, 0, -3); pl.spawn({ x: p.x, y: 0, z: p.z }); return s.key; }
    }
    return null;
  })()`);
  check(!!key, `found a nine-storey with a lift (${key})`);
  await sleep(2500);
  await b.eval(`__game.settings.camera = 'first'`);
  await b.eval(HELPERS);
  await b.eval(`__q.key = ${JSON.stringify(key)}`);

  // ------------------------------------------------------------ 1. reachability
  const flood = await b.eval(`(() => {
    const G = __game, W = G.world, I = W.interiors, P = I.plans.k9i, sec = __q.sec();
    for (const d of I.doors) { d.open = true; d.angle = 1; }
    I.updateDoorCols();
    const R = 0.3, H = 1.8, STEP = 0.42, cs = 0.1;
    const cols = W.collidersNear(sec.center.x, sec.center.z, 26).map((c) => {
      const a = I.toPlan(sec, c.min).clone(), b2 = I.toPlan(sec, c.max).clone();
      return { x0: Math.min(a.x, b2.x), x1: Math.max(a.x, b2.x), y0: Math.min(a.z, b2.z), y1: Math.max(a.z, b2.z), z0: Math.min(a.y, b2.y), z1: Math.max(a.y, b2.y) };
    });
    const grid = new Map();
    for (const c of cols) for (let i = Math.floor(c.x0 - R); i <= Math.floor(c.x1 + R); i++) for (let j = Math.floor(c.y0 - R); j <= Math.floor(c.y1 + R); j++) {
      const k = i * 1000 + j; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(c);
    }
    const near = (x, y) => grid.get(Math.floor(x) * 1000 + Math.floor(y)) || [];
    const floorAt = (x, y, h) => { let f = 0; for (const c of near(x, y)) { if (x + R * 0.7 <= c.x0 || x - R * 0.7 >= c.x1 || y + R * 0.7 <= c.y0 || y - R * 0.7 >= c.y1) continue; if (c.z1 <= h + STEP + 0.001) f = Math.max(f, c.z1); } return f; };
    const blocked = (x, y, h) => { for (const c of near(x, y)) { if (h + H <= c.z0 + 0.01 || h + STEP >= c.z1) continue; const cx = Math.max(c.x0, Math.min(x, c.x1)), cy = Math.max(c.y0, Math.min(y, c.y1)); if ((x - cx) ** 2 + (y - cy) ** 2 < R * R - 1e-4) return true; } return false; };
    const seen = new Set(), queue = [], rooms = {};
    const key = (i, j, h) => i + ',' + j + ',' + Math.round(h / 0.9);
    const si = Math.round(10.5 / cs), sj = Math.round(-1.2 / cs);
    queue.push([si, sj, 0]); seen.add(key(si, sj, 0));
    let top = 0;
    while (queue.length) {
      const [i, j, h] = queue.shift();
      const x = i * cs, y = j * cs;
      top = Math.max(top, h);
      const fl = Math.floor((h - P.PL + 0.15) / P.FH);
      const room = I.roomAt(P, x, y);
      if (room >= 0 && h > P.PL - 0.2) rooms[fl + ':' + room] = (rooms[fl + ':' + room] || 0) + 1;
      if ((y > P.D + 0.2 || y < -0.2) && h > P.PL - 0.2) { const k2 = fl + ':balcony ' + (y < 0 ? 'front' : 'back') + (x < P.W / 2 ? ' left' : ' right'); rooms[k2] = (rooms[k2] || 0) + 1; }
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di, nj = j + dj, nx = ni * cs, ny = nj * cs;
        if (nx < -1.5 || nx > P.W + 1.5 || ny < -3 || ny > P.D + 1.5) continue;
        let nh = floorAt(nx, ny, h);
        if (blocked(nx, ny, h)) continue;
        if (nh < h - 0.6) nh = floorAt(nx, ny, nh);
        if (blocked(nx, ny, nh)) continue;
        const k = key(ni, nj, nh);
        if (seen.has(k)) continue;
        seen.add(k);
        queue.push([ni, nj, nh]);
      }
    }
    const missing = [];
    for (let fl = 0; fl < P.FLOORS; fl++) {
      for (const r of P.rooms) if (r.kind !== 0 && r.kind !== 5 && !(rooms[fl + ':' + r.id] > (r.kind === 2 ? 6 : 30))) missing.push(fl + ':' + r.name + ' ' + __game.world.interiors.style(sec, fl, r.apt) + ' (' + (rooms[fl + ':' + r.id] || 0) + ')');
      for (const k2 of ['balcony front left', 'balcony front right', 'balcony back left', 'balcony back right']) if (!(rooms[fl + ':' + k2] > 10)) missing.push(fl + ':' + k2);
    }
    for (const d of I.doors) { d.open = I.doorState.get(d.key); }
    I.updateDoorCols();
    return JSON.stringify({ cells: seen.size, top: +top.toFixed(2), missing });
  })()`).then(JSON.parse);
  check(flood.missing.length === 0, `flood fill ${flood.cells} cells, up to ${flood.top} m` + (flood.missing.length ? ', not reached: ' + flood.missing.join(', ') : ''));

  // ------------------------------------------------------------ 2. the lift
  const P = await b.eval(`JSON.stringify({ PL: __q.P.PL, FH: __q.P.FH, FLOORS: __q.P.FLOORS })`).then(JSON.parse);
  const lv = (f) => P.PL + f * P.FH;
  // on the second floor landing, in front of the lift
  await b.eval(`__q.put(10.5, 5.6, ${lv(1)}, 10.5, 6.8)`);
  await sleep(600);
  await shot('01-landing');
  const before = await b.eval('__q.state()').then(JSON.parse);
  console.log('lift was', JSON.stringify(before));
  await b.eval(`__q.press('call', 1)`);
  await sleep(300);
  const called = await b.eval('__q.state()').then(JSON.parse);
  check(called.call.includes(1) || called.state === 'opening' || called.state === 'open', 'the call lamp lights (or the cab is already here)');
  await shot('02-called');
  const arrived = await b.eval(`__q.waitFor(() => { const L = __q.lift(); return L.state === 'open' && L.floor === 1; }, 40)`);
  check(arrived, `the cab came to the second floor and opened (${await b.eval('__q.state()')})`);
  await sleep(300);
  await shot('03-open');
  // in, turn around to face the doors, press 7
  const d1 = await b.eval(`__q.walkTo(10.5, 7.8)`);
  check(d1 < 0.3, 'walked into the cab');
  await b.eval(`(() => { const s = __q.sec(), I = __game.world.interiors, p = __game.player; const l = I.planToWorld(s, 11.15, p.pos.y + 1.2, 7.25); p.camYaw = Math.atan2(-(l.x - p.pos.x), -(l.z - p.pos.z)); p.camPitch = -0.1; })()`);
  await sleep(400);
  await shot('04-panel');
  await b.eval(`__q.press('floor', 6)`);
  await sleep(1200);
  const closing = await b.eval('__q.state()').then(JSON.parse);
  check(closing.cab.includes(6), `the button lamp of 7 lights (${JSON.stringify(closing)})`);
  await b.eval(`(() => { const p = __game.player; p.camYaw += Math.PI * 0.5; })()`);
  const moving = await b.eval(`__q.waitFor(() => __q.lift().state === 'moving', 10)`);
  check(moving, 'the doors shut and the cab started');
  // the landing doors of the second floor are shut now: try to step out
  await sleep(1500);
  const ridingY = await b.eval('__game.player.pos.y');
  check(ridingY > lv(1) + 0.3, `the cab carries the player up (${ridingY.toFixed(2)} m)`);
  await shot('05-riding');
  const there = await b.eval(`__q.waitFor(() => { const L = __q.lift(); return L.state === 'open' && L.floor === 6; }, 40)`);
  const y7 = await b.eval('__game.player.pos.y');
  check(there && Math.abs(y7 - lv(6)) < 0.03, `arrived on the seventh floor, doors open, player at ${y7.toFixed(3)} m (floor ${lv(6).toFixed(2)})`);
  await shot('06-arrived');
  const d2 = await b.eval(`__q.walkTo(10.5, 5.6)`);
  const p7 = await b.eval('JSON.stringify(__q.plan())').then(JSON.parse);
  check(d2 < 0.3 && Math.abs(p7.y - lv(6)) < 0.05, `walked out onto the seventh floor landing (${p7.y.toFixed(2)} m)`);
  await b.eval(`(() => { const p = __game.player; p.camYaw += Math.PI; })()`);
  await sleep(300);
  await shot('07-out');
  // doors close behind; the doorway is shut while the cab is elsewhere
  const shut = await b.eval(`__q.waitFor(() => __q.lift().state === 'idle', 15)`);
  check(shut, 'the doors closed again after a while');
  await b.eval(`__q.press('call', 0)`);
  await b.eval(`__q.waitFor(() => __q.lift().state === 'moving', 10)`);
  await sleep(500);
  const d3 = await b.eval(`__q.walkTo(10.5, 7.8, 2)`);
  check(d3 > 0.8, 'cannot walk into the shaft while the cab is away');
  // the doors open again on somebody standing in them
  await b.eval(`__q.waitFor(() => { const L = __q.lift(); return L.state === 'open' && L.floor === 0; }, 40)`);
  await b.eval(`__q.put(10.5, 6.95, ${lv(0)}, 10.5, 8)`);
  await b.eval(`(() => { const L = __q.lift(); L.timer = L.hold + 0.1; })()`);
  await sleep(1500);
  const held = await b.eval('__q.state()').then(JSON.parse);
  check(held.state === 'open' || held.state === 'opening', `doors do not close on a person in the doorway (${held.state})`);
  // STOP between the floors
  await b.eval(`__q.put(10.5, 7.8, ${lv(0)}, 10.5, 6.5)`);
  await sleep(300);
  await b.eval(`__q.press('floor', 8)`);
  await b.eval(`__q.waitFor(() => __q.lift().state === 'moving', 10)`);
  await sleep(2500);
  await b.eval(`__q.press('stop')`);
  await sleep(600);
  const halted = await b.eval('__q.state()').then(JSON.parse);
  check(halted.state === 'halted' && halted.door === 0, `STOP halts the cab between the floors, doors shut (${JSON.stringify(halted)})`);
  await b.eval(`__q.press('floor', 3)`);
  const resumed = await b.eval(`__q.waitFor(() => { const L = __q.lift(); return L.state === 'open' && L.floor === 3; }, 40)`);
  check(resumed, 'a floor button sends it on after STOP');
  await shot('08-floor4');
} finally {
  const errs = b.errors.filter((e) => !/pointer lock/i.test(e));
  console.log('errors:', errs.length ? errs.slice(0, 10) : 'none');
  if (errs.length) failed++;
  console.log(failed ? `${failed} checks failed` : 'all checks passed');
  await b.close();
  server.kill();
  process.exitCode = failed ? 1 : 0;
}
