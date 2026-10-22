import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const PORT = Number(process.env.PORT) || 3001;

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
    const type = MIME[path.extname(file)] || 'application/octet-stream';
    // Serve music with Range support so the browser can stream and seek
    if (path.extname(file) === '.m4a') {
      const { size } = await stat(file);
      const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
      if (range) {
        const start = range[1] ? Number(range[1]) : 0;
        const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
        res.writeHead(206, {
          'Content-Type': type, 'Accept-Ranges': 'bytes',
          'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1,
        });
        createReadStream(file, { start, end }).pipe(res);
      } else {
        res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': size });
        createReadStream(file).pipe(res);
      }
      return;
    }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`\n  LOST IN PANELKA\n  Open in your browser: http://localhost:${PORT}\n`);
});
