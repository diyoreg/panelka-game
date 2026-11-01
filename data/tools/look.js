// Quick looks inside a five-storey from first person: node data/tools/look.js <outDir> <script.js>
// The script is evaluated in node with { b, S, sh, P, sleep } and drives the page through __qa (see interior_test.js).
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { launch, freePort, sleep } from './cdp.js';

const out = process.argv[2] || 'data/shots';
const body = readFileSync(process.argv[3], 'utf8');
mkdirSync(out, { recursive: true });
const src = readFileSync(new URL('./interior_test.js', import.meta.url), 'utf8');
const HELPERS = src.slice(src.indexOf('window.__qa'), src.indexOf('})();`;') + 5);
const port = await freePort();
const server = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
await sleep(400);
const b = await launch({ width: 1280, height: 720, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] });
try {
  await b.goto(`http://127.0.0.1:${port}/`);
  for (let i = 0; i < 150; i++) { if ((await b.eval('window.__game && __game.mode')) === 'splash') break; await sleep(200); }
  await b.eval('__game.start()');
  await sleep(2500);
  await b.eval(`__game.settings.camera = 'first'`);
  await b.eval(HELPERS);
  const secKey = await b.eval('__qa.sec().key');
  const S = `__game.world.interiors.loaded.find((s) => s.key === '${secKey}')`;
  const P = await b.eval('JSON.stringify(__game.world.interiors.plan)').then(JSON.parse);
  const sh = (n) => b.shot(path.join(out, n + '.png'));
  await new Function('ctx', `return (async ({ b, S, sh, P, sleep }) => { ${body} })(ctx)`)({ b, S, sh, P, sleep });
} finally {
  const errs = b.errors.filter((e) => !/pointer lock/i.test(e));
  if (errs.length) console.log('errors:', errs.slice(0, 10));
  await b.close();
  server.kill();
}
