import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const out = path.join(root, 'dist'); fs.mkdirSync(path.join(out, 'server'), { recursive: true });
fs.cpSync(path.join(root, 'public'), path.join(out, 'client'), { recursive: true });
// GitHub Pages serves this generated, tracked directory without a build service.
fs.cpSync(path.join(root, 'public'), path.join(root, 'docs'), { recursive: true });
fs.writeFileSync(path.join(root, 'docs/.nojekyll'), '');
const assets = {}, types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };
function walk(folder) { for (const item of fs.readdirSync(folder, { withFileTypes: true })) { const file = path.join(folder, item.name); if (item.isDirectory()) walk(file); else assets['/' + path.relative(path.join(root, 'public'), file)] = { type: types[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file).toString('base64') }; } }
walk(path.join(root, 'public'));
const worker = `${read('server/game.mjs')}\nconst questions=${JSON.stringify(JSON.parse(read('server/questions.json')))};\nconst assets=${JSON.stringify(assets)};\nconst api=createGameHandler({questions});\nexport default {async fetch(request,env){const url=new URL(request.url);if(url.pathname.startsWith('/api/'))return api(request,env);if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});const asset=assets[url.pathname==='/'?'/index.html':url.pathname];if(!asset)return new Response('Not found',{status:404});return new Response(request.method==='HEAD'?null:Uint8Array.from(atob(asset.body),c=>c.charCodeAt(0)),{headers:{'Content-Type':asset.type,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'}})}};`;
fs.writeFileSync(path.join(out, 'server/index.js'), worker);
fs.mkdirSync(path.join(out, '.openai'), { recursive: true });
fs.copyFileSync(path.join(root, '.openai/hosting.json'), path.join(out, '.openai/hosting.json'));
fs.cpSync(path.join(root, 'drizzle'), path.join(out, '.openai/drizzle'), { recursive: true });
console.log(`Built Worker (${Buffer.byteLength(worker)} bytes), public frontend and D1 migrations.`);
