import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGameHandler } from '../server/game.mjs';
import { openDatabase } from './sqlite-adapter.mjs';
const root = path.resolve(fileURLToPath(new URL('../public/', import.meta.url)));
const db = openDatabase(fileURLToPath(new URL('../development.sqlite', import.meta.url)));
const questions = JSON.parse(fs.readFileSync(new URL('../server/questions.json', import.meta.url), 'utf8'));
const api = createGameHandler({ questions });
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript', '.woff2': 'font/woff2', '.txt': 'text/plain' };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1:8082');
    if (url.pathname.startsWith('/api/')) {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const request = new Request(url, { method: req.method, headers: req.headers, ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: Buffer.concat(chunks) }) });
      const response = await api(request, { DB: db }); res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
    } else {
      const filename = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
      if (!filename.startsWith(root + '/') || !fs.statSync(filename, { throwIfNoEntry: false })?.isFile()) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(fs.readFileSync(filename));
    }
  } catch (error) { console.error(error.message); res.writeHead(500); res.end('Server error'); }
});
server.listen(8082, '127.0.0.1', () => console.log('Among8 online: http://127.0.0.1:8082'));
process.on('SIGINT', () => { server.close(); db.close(); process.exit(); });
