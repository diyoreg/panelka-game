// Tiny headless Chrome (DevTools Protocol) wrapper for QA: screenshots, JS evaluation, error collection.
// Usage: import { launch } from './cdp.js'; const b = await launch(); await b.goto(url);

import { spawn } from 'node:child_process';
import net from 'node:net';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CHROME = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((p) => p && existsSync(p));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Free TCP port: bind port 0, read the number, release it.
export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}

export async function launch({ width = 1280, height = 720, port = null, args = [] } = {}) {
  port ??= await freePort();
  if (!CHROME) throw new Error('Chrome not found, set its path in the CHROME variable');
  const profile = mkdtempSync(path.join(tmpdir(), 'vn-chrome-'));
  const proc = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`, '--autoplay-policy=no-user-gesture-required',
    '--hide-scrollbars', '--mute-audio', ...args, 'about:blank',
  ], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 300; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.some((t) => t.type === 'page')) break; } catch { /* not up yet */ }
    await sleep(100);
  }
  const pageTarget = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const waiters = new Map();
  const errors = [];
  const listeners = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && waiters.has(msg.id)) {
      const { resolve, reject } = waiters.get(msg.id);
      waiters.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
    }
    listeners.forEach((l) => l(msg));
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id;
    waiters.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });

  const api = {
    errors,
    send,
    async goto(url) {
      const loaded = new Promise((r) => { const l = (m) => { if (m.method === 'Page.loadEventFired') { listeners.splice(listeners.indexOf(l), 1); r(); } }; listeners.push(l); });
      await send('Page.navigate', { url });
      await loaded;
    },
    async eval(expr) {
      const res = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
      return res.result.value;
    },
    async shot(file) {
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(file, Buffer.from(data, 'base64'));
    },
    async click(x, y) {
      for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
    },
    async key(key, code = key) {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code });
    },
    async close() {
      try { await send('Browser.close'); } catch { /* already closed */ }
      proc.kill();
      await sleep(200);
      try { rmSync(profile, { recursive: true, force: true }); } catch { /* nothing */ }
    },
  };
  return api;
}

export { sleep };
