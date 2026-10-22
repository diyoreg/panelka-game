// QA: starts the server, opens the game in headless Chrome, takes screenshots of the title view and a walk,
// prints FPS, draw calls and errors. Usage: node data/tools/shots.js [outDir] [--swiftshader]
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { launch, freePort, sleep } from './cdp.js';

const out = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'data/shots';
const swift = process.argv.includes('--swiftshader');
mkdirSync(out, { recursive: true });
const port = await freePort();
const server = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
await sleep(400);
const b = await launch({ width: 1280, height: 720, args: swift ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] });
const shot = (n) => b.shot(path.join(out, 'pk-' + n + '.png'));
const fps = () => b.eval(`new Promise(r => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else r(n / ((performance.now() - t0) / 1000)); }; requestAnimationFrame(f); })`);
try {
  await b.goto(`http://127.0.0.1:${port}/`);
  for (let i = 0; i < 150; i++) { if ((await b.eval('window.__game && __game.mode')) === 'splash') break; await sleep(200); }
  await b.key('Enter', 'Enter');
  await sleep(800);
  await sleep(2500);
  await shot('01-title');
  console.log('title fps', (await fps()).toFixed(1));
  await b.eval('__game.start()');
  await sleep(2000);
  await shot('02-start');
  console.log('play fps', (await fps()).toFixed(1));
  console.log('state', await b.eval(`JSON.stringify({p: __game.player.pos, calls: __game.renderer.info.render.calls, tris: __game.renderer.info.render.triangles, blocks: __game.world.activeBlocks.map(b => b.type)})`));
  await b.eval(`__game.player.camYaw += Math.PI; __game.player.camPitch = 0.25`);
  await sleep(600);
  await shot('03-yard');
  await b.eval(`__game.player.camYaw += Math.PI / 2; __game.player.camPitch = 0.1`);
  await sleep(600);
  await shot('04-side');
  // fly up for an overview
  await b.eval(`__game.freeCam = null; const p = __game.player.pos; window.__game.freeCam = { p: [p.x + 40, 35, p.z + 40], l: [p.x, 5, p.z] }`);
  await sleep(800);
  await shot('05-overview');
  await b.eval(`delete window.__game.freeCam; window.__game.freeCam = null`);
  await b.eval(`__game.settings.camera = 'first'; __game.player.camPitch = 0.05`);
  await sleep(600);
  await shot('06-first');
} finally {
  console.log('errors:', b.errors.length ? b.errors.slice(0, 10) : 'none');
  await b.close();
  server.kill();
}
