// Deux implémentations de la même interface: fichier local (dev, gratuit) et Supabase via PostgREST (fetch, aucune dépendance).
'use strict';
const fs = require('fs'), path = require('path');

class FileStore {
  constructor(dir) { this.dir = dir; fs.mkdirSync(dir, { recursive: true }); }
  _p(id, name) { return path.join(this.dir, id + '.' + name + '.json'); }
  _r(f, d) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } }
  _w(f, v) { fs.writeFileSync(f + '.tmp', JSON.stringify(v)); fs.renameSync(f + '.tmp', f); }
  async getGame(id) { return this._r(this._p(id, 'game'), null); }
  async putGame(g) { this._w(this._p(g.id, 'game'), g); }
  async getGameMeta(id) { const g = await this.getGame(id); return g && { id: g.id, turn: g.turn, deadline: g.deadline, keys: Object.keys(g.state.led.players).join('') }; }
  async updateGameIfTurn(id, oldTurn, patch) { const g = await this.getGame(id); if (!g || g.turn !== oldTurn) return false; await this.putGame(Object.assign({}, g, patch)); return true; }
  async getSeats(id) { return this._r(this._p(id, 'seats'), {}); }
  async putSeats(id, seats) { this._w(this._p(id, 'seats'), seats); }
  async getOrders(id, turn) { return this._r(this._p(id, 'orders'), {})[turn] || {}; }
  async putOrders(id, turn, seat, orders) { const all = this._r(this._p(id, 'orders'), {}); (all[turn] = all[turn] || {})[seat] = orders; this._w(this._p(id, 'orders'), all); }
}

class SupabaseStore {
  constructor(url, key) { this.url = url.replace(/\/$/, '') + '/rest/v1'; this.h = { apikey: key, 'Content-Type': 'application/json' };
    // clé legacy service_role (JWT) -> aussi en Bearer; les nouvelles clés sb_secret_… ne vont que dans apikey
    if (key.startsWith('eyJ')) this.h.Authorization = 'Bearer ' + key; }
  async _q(method, p, body, extra) {
    const r = await fetch(this.url + p, { method, headers: Object.assign({}, this.h, extra), body: body === undefined ? undefined : JSON.stringify(body) });
    if (!r.ok) throw new Error('Supabase ' + method + ' ' + p + ' -> ' + r.status + ' ' + (await r.text()).slice(0, 300));
    const t = await r.text(); return t ? JSON.parse(t) : null;
  }
  async getGame(id) { const r = await this._q('GET', `/games?id=eq.${encodeURIComponent(id)}&select=*`); return r && r[0] ? r[0] : null; }
  async putGame(g) { await this._q('POST', '/games', Object.assign({}, g, { updated_at: new Date().toISOString() }), { Prefer: 'resolution=merge-duplicates' }); }
  async getGameMeta(id) {
    const r = await this._q('GET', `/games?id=eq.${encodeURIComponent(id)}&select=id,turn,deadline,keys:state->led->players`); if (!r || !r[0]) return null;
    return { id: r[0].id, turn: r[0].turn, deadline: r[0].deadline, keys: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'.split('').filter(k => k in r[0].keys).join('') };
  }
  async updateGameIfTurn(id, oldTurn, patch) {   // mise à jour conditionnelle: un seul résolveur gagne
    const r = await this._q('PATCH', `/games?id=eq.${encodeURIComponent(id)}&turn=eq.${oldTurn}`, Object.assign({}, patch, { updated_at: new Date().toISOString() }), { Prefer: 'return=representation' });
    return !!(r && r.length);
  }
  async getSeats(id) { const r = await this._q('GET', `/seats?game_id=eq.${encodeURIComponent(id)}&select=seat,token_hash,name`); const o = {}; (r || []).forEach(s => { o[s.seat] = { token_hash: s.token_hash, name: s.name }; }); return o; }
  async putSeats(id, seats) { await this._q('POST', '/seats', Object.entries(seats).map(([seat, v]) => ({ game_id: id, seat, token_hash: v.token_hash, name: v.name || null })), { Prefer: 'resolution=merge-duplicates' }); }
  async getOrders(id, turn) { const r = await this._q('GET', `/orders?game_id=eq.${encodeURIComponent(id)}&turn=eq.${turn}&select=seat,orders`); const o = {}; (r || []).forEach(x => { o[x.seat] = x.orders; }); return o; }
  async putOrders(id, turn, seat, orders) { await this._q('POST', '/orders', { game_id: id, turn, seat, orders, updated_at: new Date().toISOString() }, { Prefer: 'resolution=merge-duplicates' }); }
}

function makeStore() {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) return new SupabaseStore(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  return new FileStore(process.env.DATA_DIR || path.join(__dirname, '..', 'var'));
}
module.exports = { makeStore, FileStore, SupabaseStore };
