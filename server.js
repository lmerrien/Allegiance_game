// Serveur Node classique (local ou hébergeur à processus permanent). Sur Vercel, voir api/index.js (même logique: lib/router.js).
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), zlib = require('zlib');
const { route, resolveTurn, store, GAME_ID, TURN_HOURS } = require('./lib/router');
const PORT = +process.env.PORT || 8080, PUB = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

function readBody(req, max = 200e3) { return new Promise((res, rej) => { let b = '', n = 0; req.on('data', c => { n += c.length; if (n > max) { rej(new Error('trop gros')); req.destroy(); } else b += c; }); req.on('end', () => { try { res(b ? JSON.parse(b) : {}); } catch (e) { rej(new Error('JSON invalide')); } }); }); }
function send(req, res, code, obj, type = 'application/json') {
  const buf = Buffer.from(typeof obj === 'string' || Buffer.isBuffer(obj) ? obj : JSON.stringify(obj)), h = { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-cache' };
  if (/gzip/.test(req.headers['accept-encoding'] || '') && buf.length > 1024) { h['Content-Encoding'] = 'gzip'; res.writeHead(code, h); res.end(zlib.gzipSync(buf)); } else { res.writeHead(code, h); res.end(buf); }
}

http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x'), p = u.pathname;
    if (p.startsWith('/api/')) {
      const body = req.method === 'POST' ? await readBody(req) : {};
      const r = await route({ method: req.method, pathname: p, query: Object.fromEntries(u.searchParams), body, headers: req.headers });
      return r ? send(req, res, r.code, r.body) : send(req, res, 404, { error: 'introuvable' });
    }
    const f = path.normalize(path.join(PUB, p === '/' ? 'index.html' : p)); if (!f.startsWith(PUB)) return send(req, res, 403, 'no', 'text/plain');
    if (fs.existsSync(f) && fs.statSync(f).isFile()) return send(req, res, 200, fs.readFileSync(f), MIME[path.extname(f)] || 'application/octet-stream');
    send(req, res, 404, { error: 'introuvable' });
  } catch (e) { console.error(e); send(req, res, 500, { error: String(e.message || e) }); }
}).listen(PORT, () => console.log('écoute sur :' + PORT + (process.env.SUPABASE_URL ? ' (stockage Supabase)' : ' (stockage fichier)')));

if (TURN_HOURS) setInterval(async () => {          // clôture automatique à l'échéance
  try { const g = await store.getGameMeta(GAME_ID); if (g && g.deadline && Date.now() > Date.parse(g.deadline)) await resolveTurn(); } catch (e) { console.error('résolution auto:', e.message); }
}, 30e3);
