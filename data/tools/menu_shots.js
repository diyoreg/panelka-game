// QA: the main menu with the snowfall picker, the settings with the seed, a blizzard, light snow in first person.
// Usage: node data/tools/menu_shots.js [outDir]
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
const shot = (n) => b.shot(path.join(out, 'menu-' + n + '.png'));
const waitMode = async (m) => { for (let i = 0; i < 150; i++) { if ((await b.eval('__game.mode')) === m) return; await sleep(200); } };
try {
  await b.goto(`http://127.0.0.1:${port}/`);
  for (let i = 0; i < 150; i++) { if ((await b.eval('window.__game && __game.mode')) === 'splash') break; await sleep(200); }
  await b.key('Enter', 'Enter');
  await sleep(1500);
  await shot('01-title');
  // down to the snowfall picker, two steps right: auto -> snow -> blizzard
  await b.key('ArrowDown', 'ArrowDown');
  await b.key('ArrowRight', 'ArrowRight');
  await b.key('ArrowRight', 'ArrowRight');
  await sleep(300);
  await shot('02-title-snow');
  console.log('snow mode', await b.eval('__game.snowMode'));
  // down to the menu row, right to Settings
  await b.key('ArrowDown', 'ArrowDown');
  await b.key('ArrowRight', 'ArrowRight');
  await b.key('Enter', 'Enter');
  await sleep(500);
  await b.eval(`document.querySelector('#modal-body').scrollTop = 99999`);
  await sleep(200);
  await shot('03-settings-seed');
  await b.eval(`document.querySelector('#seed-in').value = 'test-seed'; document.querySelector('#seed-apply').click()`);
  await sleep(200);
  await shot('04-seed-confirm');
  await b.key('Escape', 'Escape');
  await sleep(300);
  await b.key('ArrowUp', 'ArrowUp');
  await b.key('ArrowUp', 'ArrowUp');
  await b.key('Enter', 'Enter');
  await waitMode('play');
  await sleep(6000);
  console.log('snow', await b.eval('__game.U.uSnow.value.toFixed(2)'));
  await shot('05-blizzard');
  await b.eval(`__game.player.camPitch = -0.6`);
  await sleep(500);
  await shot('06-blizzard-up');
  await b.eval(`__game.setSnowMode('snow'); __game.settings.camera = 'first'; __game.player.camPitch = 0.0`);
  await sleep(6000);
  await shot('07-snow-first');
  await b.eval(`__game.settings.camera = 'third'; __game.toTitle()`);
  await waitMode('title');
  await sleep(900);
  await shot('08-title-back');
} finally {
  console.log('errors:', b.errors.filter((e) => !/pointer lock/i.test(e)).slice(0, 10));
  await b.close();
  server.kill();
}
