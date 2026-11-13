// Logique de l'API, indépendante du transport (utilisée par server.js en local et par api/index.js sur Vercel).
// route({method, pathname, query, body, headers}) -> {code, body}. Sans état entre requêtes (sauf le drapeau `resolving`, par instance).
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { buildWorld } = require('./world'), { makeStore } = require('./store');

const ROOT = path.join(__dirname, '..');
const GAME_ID = process.env.GAME_ID || 'main', TURN_HOURS = +process.env.TURN_HOURS || 0;
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
let ADMIN_KEY = process.env.ADMIN_KEY;
if (!ADMIN_KEY) { ADMIN_KEY = crypto.randomBytes(12).toString('hex'); console.log("ADMIN_KEY (temporaire, définis-la en variable d'environnement):", ADMIN_KEY); }
const geo = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'world-v6.json'), 'utf8'));
const templates = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'player-templates.json'), 'utf8'));
const store = makeStore();
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const keysOf = state => ALPHA.split('').filter(k => k in state.led.players).join('');   // jsonb ne conserve pas l'ordre des clés
const deadlineFromNow = () => TURN_HOURS ? new Date(Date.now() + TURN_HOURS * 3600e3).toISOString() : null;
let resolving = false;

const ok = (body, code = 200) => ({ code, body });
const err = (code, error, extra) => ({ code, body: Object.assign({ error }, extra) });

async function seatOk(seat, token) { if (!seat || !token) return false; const seats = await store.getSeats(GAME_ID); return !!(seats[seat] && seats[seat].token_hash === sha(token)); }

async function newGame(nRealm) {
  const { createEngine } = require('./engine');                       // chargé à la demande: les routes légères n'y touchent pas
  const w = buildWorld(geo, nRealm, templates), E = createEngine({ keys: w.KEYS, BW: w.BW, BH: w.BH, state: w.INIT });
  const tokens = {}, seats = {};
  w.KEYS.split('').forEach(k => { tokens[k] = crypto.randomBytes(12).toString('hex'); seats[k] = { token_hash: sha(tokens[k]), name: null }; });
  await store.putGame({ id: GAME_ID, turn: 1, state: E.dump(), report: [], deadline: deadlineFromNow() });
  await store.putSeats(GAME_ID, seats);
  return tokens;
}

async function resolveTurn() {
  if (resolving) throw new Error('déjà en cours');
  resolving = true; const t0 = Date.now();
  try {
    const game = await store.getGame(GAME_ID); if (!game) throw new Error('pas de partie');
    const { createEngine } = require('./engine'), turn = game.turn, all = await store.getOrders(GAME_ID, turn), log = [];
    const E = createEngine({ keys: keysOf(game.state), BW: geo.size[0], BH: geo.size[1], state: game.state }); E.load(game.state);
    for (const seat of Object.keys(all).sort()) for (const o of (all[seat] || [])) { const r = E.apply(seat, o); if (r !== 'ok') log.push(`${seat} ${o.op} ${o.army || o.building || ''}: ${r}`); }
    const newTurn = E.turn();
    const swapped = await store.updateGameIfTurn(GAME_ID, turn, { turn: newTurn, state: E.dump(), report: E.report(), deadline: deadlineFromNow() });
    if (!swapped) throw new Error('le tour a déjà été résolu par une autre requête');
    console.log(`tour ${turn} résolu en ${Date.now() - t0} ms; ordres rejetés: ${log.length}`);
    return { turn: newTurn, rejected: log, ms: Date.now() - t0 };
  } finally { resolving = false; }
}

async function route({ method, pathname: p, query = {}, body = {}, headers = {} }) {
  const isAdmin = (headers['x-admin-key'] || '') === ADMIN_KEY;
  if (p === '/api/meta') { const g = await store.getGameMeta(GAME_ID); return ok({ game: GAME_ID, exists: !!g, turn: g && g.turn, deadline: g && g.deadline, resolving, realms: g ? g.keys : '' }); }
  if (p === '/api/world') return ok(geo);
  if (p === '/api/state') { const g = await store.getGame(GAME_ID); if (!g) return err(404, 'pas de partie'); return ok({ turn: g.turn, deadline: g.deadline, report: g.report, state: g.state }); }
  if (p === '/api/orders' && method === 'GET') {
    if (!(await seatOk(query.seat, query.token))) return err(403, 'jeton invalide');
    const g = await store.getGameMeta(GAME_ID); if (!g) return err(404, 'pas de partie');
    const all = await store.getOrders(GAME_ID, g.turn); return ok({ turn: g.turn, orders: all[query.seat] || [] });
  }
  if (p === '/api/orders' && method === 'POST') {
    const g = await store.getGameMeta(GAME_ID); if (!g) return err(404, 'pas de partie');
    if (!(await seatOk(body.seat, body.token))) return err(403, 'jeton invalide');
    if (resolving) return err(503, 'tour en cours de résolution, réessaie dans quelques secondes');
    if (body.turn != null && body.turn !== g.turn) return err(409, 'tour périmé', { turn: g.turn });
    if (!Array.isArray(body.orders) || body.orders.length > 300) return err(400, 'orders: tableau de 300 max');
    const clean = body.orders.map(o => ({ op: String(o.op), army: o.army && String(o.army), building: o.building, x: o.x, y: o.y, r: o.r, kind: o.kind && String(o.kind), color: o.color, on: o.on }));
    await store.putOrders(GAME_ID, g.turn, body.seat, clean); return ok({ ok: true, turn: g.turn, count: clean.length });
  }
  if (p === '/api/admin/new' && method === 'POST') {
    if (!isAdmin) return err(403, 'admin');
    if ((await store.getGameMeta(GAME_ID)) && !body.force) return err(409, 'une partie existe déjà (force:true pour écraser)');
    return ok({ game: GAME_ID, turn: 1, tokens: await newGame(Math.min(52, +body.realms || 52)) });
  }
  if (p === '/api/admin/token' && method === 'POST') {                  // nouveau jeton pour un siège (jeton perdu ou à renouveler)
    if (!isAdmin) return err(403, 'admin');
    const seats = await store.getSeats(GAME_ID); if (!seats[body.seat]) return err(404, 'siège inconnu');
    const t = crypto.randomBytes(12).toString('hex'); await store.putSeats(GAME_ID, { [body.seat]: { token_hash: sha(t), name: seats[body.seat].name } });
    return ok({ seat: body.seat, token: t });
  }
  if (p === '/api/admin/resolve' && method === 'POST') { if (!isAdmin) return err(403, 'admin'); try { return ok(await resolveTurn()); } catch (e) { return err(409, e.message); } }
  if (p === '/api/cron') {                                              // Vercel Cron: clôt le tour si l'échéance est passée (Authorization: Bearer CRON_SECRET)
    if (!process.env.CRON_SECRET || headers['authorization'] !== 'Bearer ' + process.env.CRON_SECRET) return err(403, 'cron');
    const g = await store.getGameMeta(GAME_ID); if (!g || !g.deadline || Date.now() < Date.parse(g.deadline)) return ok({ resolved: false });
    try { return ok(Object.assign({ resolved: true }, await resolveTurn())); } catch (e) { return err(409, e.message); }
  }
  return null;   // pas une route d'API
}
module.exports = { route, resolveTurn, store, GAME_ID, TURN_HOURS };
