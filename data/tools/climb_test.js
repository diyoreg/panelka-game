// QA: put the player under a ground floor balcony of the panelka, climb up a few floors, take screenshots.
// Usage: node data/tools/climb_test.js [outDir]
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { launch, freePort, sleep } from './cdp.js';

const out = process.argv[2] || 'data/shots';
mkdirSync(out, { recursive: true });
const port = await freePort();
const server = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
await sleep(400);
const b = await launch({ width: 1280, height: 720, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] });
const shot = (n) => b.shot(path.join(out, 'climb-' + n + '.png'));
try {
  await b.goto(`http://127.0.0.1:${port}/`);
  for (let i = 0; i < 150; i++) { if ((await b.eval('window.__game && __game.mode')) === 'splash') break; await sleep(200); }
  await b.key('Enter', 'Enter');
  await sleep(500);
  await b.eval('__game.start()');
  await sleep(1500);
  // an open ground floor balcony: slab 0.16 m thick, top at 1.0 m, next to a building body
  const found = await b.eval(`(() => {
    const W = __game.world, pl = __game.player;
    for (const B of W.activeBlocks) {
      const bodies = B.cols.filter((c) => c.max.y - c.min.y > 12);
      for (const c of B.cols) {
        if (Math.abs(c.max.y - 1.0) > 0.02 || Math.abs(c.max.y - c.min.y - 0.16) > 0.02) continue;
        const body = bodies.find((k) => c.min.x < k.max.x + 0.05 && c.max.x > k.min.x - 0.05 && c.min.z < k.max.z + 0.05 && c.max.z > k.min.z - 0.05);
        if (!body) continue;
        // skip glazed balconies: they are closed boxes
        if (B.cols.some((k) => k !== body && k.max.y - k.min.y > 2 && Math.abs(k.min.y - c.max.y) < 0.02 && k.min.x < c.max.x && k.max.x > c.min.x && k.min.z < c.max.z && k.max.z > c.min.z)) continue;
        const cx = (c.min.x + c.max.x) / 2, cz = (c.min.z + c.max.z) / 2;
        const bx = (body.min.x + body.max.x) / 2, bz = (body.min.z + body.max.z) / 2;
        let ox = 0, oz = 0;
        if (c.min.z >= body.max.z - 0.05) oz = 1; else if (c.max.z <= body.min.z + 0.05) oz = -1;
        else if (c.min.x >= body.max.x - 0.05) ox = 1; else ox = -1;
        const ex = ox ? (ox > 0 ? c.max.x : c.min.x) : cx, ez = oz ? (oz > 0 ? c.max.z : c.min.z) : cz;
        pl.spawn({ x: ex + ox * 0.55, y: 0, z: ez + oz * 0.55, yaw: Math.atan2(-ox, -oz), camYaw: Math.atan2(ox, oz) });
        pl.camPitch = -0.15;
        return { slab: [c.min.x, c.min.y, c.min.z, c.max.x, c.max.y, c.max.z], o: [ox, oz] };
      }
    }
    return null;
  })()`);
  console.log('balcony', JSON.stringify(found));
  await sleep(800);
  await shot('0-below');
  for (let k = 1; k <= 4; k++) {
    const ok = await b.eval(`__game.player.startClimb()`);
    for (let i = 0; i < 40 && await b.eval("!!__game.player.climb"); i++) await sleep(100);
    await sleep(300);
    const st = await b.eval(`JSON.stringify({ ok: ${'${'}0}, y: __game.player.pos.y.toFixed(2), ground: __game.player.onGround, crouch: __game.player.crouch })`.replace('${0}', String(ok)));
    console.log('climb', k, st);
    await b.eval(`__game.player.camPitch = -0.35`);
    await sleep(500);
    await shot(k + '-floor');
  }
  // turn around and look over the yard from the balcony
  await b.eval(`__game.player.camYaw += Math.PI; __game.player.camPitch = -0.1`);
  await sleep(600);
  await shot('5-view');
} finally {
  console.log('errors:', b.errors.filter((e) => !/pointer lock/.test(e)).slice(0, 10));
  await b.close();
  server.kill();
}
