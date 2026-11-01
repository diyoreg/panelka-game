import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const PORT = Number(process.env.PORT) || 3001;
const gzipAsync = promisify(gzip);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary',
  '.m4a': 'audio/mp4',
};

// Text and models shrink a lot with gzip (panelka.glb: 27 MB -> 6 MB); images, fonts and music do not
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg', '.glb']);
// Compressed bodies by file path, rebuilt when the file changes
const gzipCache = new Map();

async function gzipped(file, etag) {
  const hit = gzipCache.get(file);
  if (hit && hit.etag === etag) return hit.body;
  const body = await gzipAsync(await readFile(file), { level: 9 });
  gzipCache.set(file, { etag, body });
  return body;
}

const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');
    let rel = decodeURIComponent(pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(ROOT + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    const ext = path.extname(file);
    const type = MIME[ext] || 'application/octet-stream';
    const { size, mtimeMs } = await stat(file);
    // Revalidate on every load, but answer 304 when nothing changed, so a repeat visit downloads nothing
    const etag = `"${size.toString(36)}-${Math.floor(mtimeMs).toString(36)}"`;
    const headers = { 'Content-Type': type, 'Cache-Control': 'no-cache', ETag: etag };
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers).end();
      return;
    }
    // Serve music with Range support so the browser can stream and seek
    if (ext === '.m4a') {
      headers['Accept-Ranges'] = 'bytes';
      const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
      if (range) {
        const start = range[1] ? Number(range[1]) : 0;
        const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
        res.writeHead(206, {
          ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1,
        });
        createReadStream(file, { start, end }).pipe(res);
      } else {
        res.writeHead(200, { ...headers, 'Content-Length': size });
        createReadStream(file).pipe(res);
      }
      return;
    }
    if (COMPRESSIBLE.has(ext)) {
      headers.Vary = 'Accept-Encoding';
      if (/\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
        const body = await gzipped(file, etag);
        res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': body.length });
        res.end(body);
        return;
      }
    }
    res.writeHead(200, { ...headers, 'Content-Length': size });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`\n  LOST IN PANELKA\n  Open in your browser: http://localhost:${PORT}\n`);
});
