// QA: measures block rebuild time and draw calls, then checks jump, crouch and wall collisions.
// Usage: node data/tools/perf.js
import { spawn } from 'node:child_process';
import { launch, freePort, sleep } from './cdp.js';

const port = await freePort();
const server = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
await sleep(400);
const b = await launch({ width: 1280, height: 720, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const key = (type, k, code) => b.send('Input.dispatchKeyEvent', { type, key: k, code });
try {
  await b.goto(`http://127.0.0.1:${port}/`);
  for (let i = 0; i < 100; i++) { if ((await b.eval('window.__game && __game.mode')) === 'splash') break; await sleep(200); }
  await b.eval('__game.start()');
  await sleep(1500);
  console.log(await b.eval(`(() => {
    const w = __game.world;
    const out = {};
    let t = performance.now();
    w.centerKey = null; w.update({ x: 0, z: 0 });
    out.rebuildCached = (performance.now() - t).toFixed(1) + 'ms';
    t = performance.now();
    w.update({ x: 128 * 20, z: 128 * 20 });
    out.generateAllNew = (performance.now() - t).toFixed(1) + 'ms';
    t = performance.now();
    w.update({ x: 128 * 21, z: 128 * 20 });
    out.stepOneBlock = (performance.now() - t).toFixed(1) + 'ms';
    let inst = 0, meshes = 0;
    w.group.children.forEach(m => { if (m.isInstancedMesh && m.count) { meshes++; inst += m.count; } });
    out.meshesWithInstances = meshes; out.instances = inst;
    out.blocks = w.activeBlocks.length;
    out.colliders = w.activeBlocks.reduce((s, b) => s + b.cols.length, 0);
    w.update(__game.player.pos);
    return out;
  })()`));
  await b.eval(`(() => { const r = __game.renderer; r.info.autoReset = false; r.info.reset(); })()`);
  await sleep(1000);
  console.log(await b.eval(`(() => { const i = __game.renderer.info.render; const f = i.frame || 1; const res = { callsPerFrame: Math.round(i.calls / f), trisPerFrame: Math.round(i.triangles / f), frames: f }; __game.renderer.info.autoReset = true; return res; })()`));

  console.log('start', await b.eval(`({ y: __game.player.pos.y, ground: __game.player.onGround })`));
  await key('keyDown', ' ', 'Space');
  await sleep(150);
  await key('keyUp', ' ', 'Space');
  await sleep(150);
  console.log('mid-jump', await b.eval(`({ y: __game.player.pos.y.toFixed(2), gait: __game.player.gait })`));
  await sleep(1200);
  console.log('landed', await b.eval(`({ y: __game.player.pos.y.toFixed(2), gait: __game.player.gait })`));
  await b.key('c', 'KeyC');
  await sleep(400);
  console.log('crouch', await b.eval(`({ crouch: __game.player.crouch, h: __game.player.height.toFixed(2) })`));
  await b.key('c', 'KeyC');
  await sleep(400);
  console.log('stand', await b.eval(`({ crouch: __game.player.crouch, h: __game.player.height.toFixed(2) })`));

  // walk toward the buildings (north, -Z) for 3 s: must stop at the wall
  const before = await b.eval(`(() => { const p = __game.player; p.camYaw = 0; return { x: +p.pos.x.toFixed(2), z: +p.pos.z.toFixed(2) }; })()`);
  await key('keyDown', 'w', 'KeyW');
  await sleep(3000);
  await key('keyUp', 'w', 'KeyW');
  const after = await b.eval(`(() => {
    const p = __game.player;
    const inside = __game.world.collidersNear(p.pos.x, p.pos.z, 1).some(c => p.pos.x > c.min.x && p.pos.x < c.max.x && p.pos.z > c.min.z && p.pos.z < c.max.z && p.pos.y < c.max.y - 0.05 && p.pos.y + 1 > c.min.y);
    return { x: +p.pos.x.toFixed(2), z: +p.pos.z.toFixed(2), y: +p.pos.y.toFixed(2), inside };
  })()`);
  console.log('wall test', before, after);
} finally {
  console.log('errors:', b.errors.filter((e) => !e.includes('pointer lock')).slice(0, 10));
  await b.close();
  server.kill();
}
