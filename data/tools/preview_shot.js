// Makes the picture on the main menu card (public/img/preview.jpg) and the cover for diyoreg.com/games
// (public/img/cover.jpg). Starts the server, opens the game in headless Chrome, hides the menus and
// shoots the yard in a snowfall. Usage: node data/tools/preview_shot.js
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { launch, freePort, sleep } from './cdp.js';

const OUT = 'public/img';

mkdirSync(OUT, { recursive: true });
const port = await freePort();
const server = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
await sleep(400);
const b = await launch({ width: 960, height: 540, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] });
try {
  await b.goto(`http://127.0.0.1:${port}/`);
  for (let i = 0; i < 150; i++) { if ((await b.eval('window.__game && __game.mode')) === 'splash') break; await sleep(200); }
  await b.key('Enter', 'Enter');
  await sleep(800);
  await b.eval(`__game.setSnowMode('snow'); __game.start()`);
  await sleep(1500);
  await b.eval(`document.querySelectorAll('.screen, #modal').forEach((e) => e.classList.add('hidden'))`);
  await b.eval(`__game.player.camPitch = 0.18`);
  await sleep(3500);
  const { data } = await b.send('Page.captureScreenshot', { format: 'jpeg', quality: 86 });
  for (const name of ['preview.jpg', 'cover.jpg']) {
    writeFileSync(path.join(OUT, name), Buffer.from(data, 'base64'));
    console.log('wrote', name);
  }
} finally {
  console.log('errors:', b.errors.length ? b.errors.slice(0, 10) : 'none');
  await b.close();
  server.kill();
}
