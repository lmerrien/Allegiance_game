// Service Allégeance: HTTP + moteur en mémoire + stockage (fichier ou Supabase). Aucune dépendance npm. Node >= 18.
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), zlib = require('zlib'), crypto = require('crypto');
const { buildWorld } = require('./lib/world'), { createEngine } = require('./lib/engine'), { makeStore } = require('./lib/store');

const PORT = +process.env.PORT || 8080, GAME_ID = process.env.GAME_ID || 'main', TURN_HOURS = +process.env.TURN_HOURS || 0;
const ADMIN_KEY = process.env.ADMIN_KEY || (() => { const k = crypto.randomBytes(12).toString('hex'); console.log('ADMIN_KEY (temporaire, définis-la en variable d\'environnement):', k); return k; })();
const geo = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'world-v6.json'), 'utf8'));
const templates = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'player-templates.json'), 'utf8'));
const store = makeStore();
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');

let game = null, engine = null, resolving = false, keys = '';

async function boot() {
  game = await store.getGame(GAME_ID);
  if (game) { keys = game.keys || Object.keys(game.state.led.players).join(''); engine = createEngine({ keys, BW: geo.size[0], BH: geo.size[1], state: game.state }); engine.load(game.state); console.log(`partie ${GAME_ID} chargée, tour ${game.turn}`); }
  else console.log(`aucune partie "${GAME_ID}": POST /api/admin/new pour en créer une`);
}

async function newGame(nRealm) {
  const w = buildWorld(geo, nRealm, templates);
  keys = w.KEYS; engine = createEngine({ keys, BW: w.BW, BH: w.BH, state: w.INIT }); engine.load(w.INIT);
  const tokens = {}, seats = {};
  keys.split('').forEach(k => { tokens[k] = crypto.randomBytes(12).toString('hex'); seats[k] = { token_hash: sha(tokens[k]), name: null }; });
  game = { id: GAME_ID, turn: 1, state: engine.dump(), report: [], deadline: TURN_HOURS ? new Date(Date.now() + TURN_HOURS * 3600e3).toISOString() : null };
  await store.putGame(game); await store.putSeats(GAME_ID, seats);
  return tokens;
}

async function resolveTurn() {
  if (!game || resolving) throw new Error(resolving ? 'déjà en cours' : 'pas de partie');
  resolving = true; const t0 = Date.now();
  try {
    const turn = game.turn, all = await store.getOrders(GAME_ID, turn), log = [];
    engine.load(game.state);
    for (const seat of Object.keys(all).sort()) for (const o of (all[seat] || [])) { const r = engine.apply(seat, o); if (r !== 'ok') log.push(`${seat} ${o.op} ${o.army || o.building || ''}: ${r}`); }
    const newTurn = engine.turn();
    game = { id: GAME_ID, turn: newTurn, keys, state: engine.dump(), report: engine.report(), deadline: TURN_HOURS ? new Date(Date.now() + TURN_HOURS * 3600e3).toISOString() : null };
    await store.putGame({ id: game.id, turn: game.turn, state: game.state, report: game.report, deadline: game.deadline });
    console.log(`tour ${turn} résolu en ${Date.now() - t0} ms; ordres rejetés: ${log.length}`);
    return { turn: newTurn, rejected: log, ms: Date.now() - t0 };
  } finally { resolving = false; }
}

function body(req, max = 200e3) { return new Promise((res, rej) => { let b = '', n = 0; req.on('data', c => { n += c.length; if (n > max) { rej(new Error('trop gros')); req.destroy(); } else b += c; }); req.on('end', () => { try { res(b ? JSON.parse(b) : {}); } catch (e) { rej(new Error('JSON invalide')); } }); }); }
function send(req, res, code, obj, type = 'application/json') {
  const buf = Buffer.from(typeof obj === 'string' || Buffer.isBuffer(obj) ? obj : JSON.stringify(obj)), h = { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-cache' };
  if (/gzip/.test(req.headers['accept-encoding'] || '') && buf.length > 1024) { h['Content-Encoding'] = 'gzip'; res.writeHead(code, h); res.end(zlib.gzipSync(buf)); } else { res.writeHead(code, h); res.end(buf); }
}
async function seatOk(seat, token) { if (!seat || !token) return false; const seats = await store.getSeats(GAME_ID); return !!(seats[seat] && seats[seat].token_hash === sha(token)); }
const isAdmin = req => (req.headers['x-admin-key'] || '') === ADMIN_KEY;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x'), p = u.pathname;
    if (p === '/api/meta') return send(req, res, 200, { game: GAME_ID, exists: !!game, turn: game && game.turn, deadline: game && game.deadline, resolving, realms: keys });
    if (p === '/api/world') return send(req, res, 200, geo);
    if (p === '/api/state') { if (!game) return send(req, res, 404, { error: 'pas de partie' }); return send(req, res, 200, { turn: game.turn, deadline: game.deadline, report: game.report, state: game.state }); }
    if (p === '/api/orders' && req.method === 'GET') {
      const seat = u.searchParams.get('seat'), token = u.searchParams.get('token'); if (!(await seatOk(seat, token))) return send(req, res, 403, { error: 'jeton invalide' });
      const all = await store.getOrders(GAME_ID, game.turn); return send(req, res, 200, { turn: game.turn, orders: all[seat] || [] });
    }
    if (p === '/api/orders' && req.method === 'POST') {
      const b = await body(req); if (!game) return send(req, res, 404, { error: 'pas de partie' });
      if (!(await seatOk(b.seat, b.token))) return send(req, res, 403, { error: 'jeton invalide' });
      if (resolving) return send(req, res, 503, { error: 'tour en cours de résolution, réessaie dans quelques secondes' });
      if (b.turn != null && b.turn !== game.turn) return send(req, res, 409, { error: 'tour périmé', turn: game.turn });
      if (!Array.isArray(b.orders) || b.orders.length > 300) return send(req, res, 400, { error: 'orders: tableau de 300 max' });
      const clean = b.orders.map(o => ({ op: String(o.op), army: o.army && String(o.army), building: o.building, x: o.x, y: o.y, r: o.r, kind: o.kind && String(o.kind), color: o.color, on: o.on }));
      await store.putOrders(GAME_ID, game.turn, b.seat, clean); return send(req, res, 200, { ok: true, turn: game.turn, count: clean.length });
    }
    if (p === '/api/admin/new' && req.method === 'POST') {
      if (!isAdmin(req)) return send(req, res, 403, { error: 'admin' });
      const b = await body(req);
      if (game && !b.force) return send(req, res, 409, { error: 'une partie existe déjà (force:true pour écraser)' });
      const tokens = await newGame(Math.min(52, +b.realms || 52)); return send(req, res, 200, { game: GAME_ID, turn: 1, tokens });
    }
    if (p === '/api/admin/token' && req.method === 'POST') {          // nouveau jeton pour un siège (jeton perdu ou à renouveler)
      if (!isAdmin(req)) return send(req, res, 403, { error: 'admin' });
      const b = await body(req), seats = await store.getSeats(GAME_ID);
      if (!seats[b.seat]) return send(req, res, 404, { error: 'siège inconnu' });
      const t = crypto.randomBytes(12).toString('hex'); await store.putSeats(GAME_ID, { [b.seat]: { token_hash: sha(t), name: seats[b.seat].name } });
      return send(req, res, 200, { seat: b.seat, token: t });
    }
    if (p === '/api/admin/resolve' && req.method === 'POST') { if (!isAdmin(req)) return send(req, res, 403, { error: 'admin' }); return send(req, res, 200, await resolveTurn()); }
    // fichiers statiques
    let f = path.normalize(path.join(__dirname, 'public', p === '/' ? 'index.html' : p)); if (!f.startsWith(path.join(__dirname, 'public'))) return send(req, res, 403, 'no', 'text/plain');
    if (fs.existsSync(f) && fs.statSync(f).isFile()) return send(req, res, 200, fs.readFileSync(f), MIME[path.extname(f)] || 'application/octet-stream');
    send(req, res, 404, { error: 'introuvable' });
  } catch (e) { console.error(e); send(req, res, 500, { error: String(e.message || e) }); }
});

boot().then(() => {
  server.listen(PORT, () => console.log('écoute sur :' + PORT + (process.env.SUPABASE_URL ? ' (stockage Supabase)' : ' (stockage fichier)')));
  if (TURN_HOURS) setInterval(() => { if (game && !resolving && game.deadline && Date.now() > Date.parse(game.deadline)) resolveTurn().catch(e => console.error('résolution auto:', e.message)); }, 30e3);
}).catch(e => { console.error('échec au démarrage:', e); process.exit(1); });
