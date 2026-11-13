// Vérifie le branchement Supabase: node scripts/check-supabase.js
// Variables: SUPABASE_URL, SUPABASE_SERVICE_KEY (clé service_role, à ne jamais publier). Crée puis supprime une partie "selftest".
'use strict';
const { SupabaseStore } = require('../lib/store');
const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) { console.error('Définis SUPABASE_URL et SUPABASE_SERVICE_KEY.'); process.exit(1); }
(async () => {
  const s = new SupabaseStore(url, key), id = 'selftest', ok = (n, c) => { console.log((c ? 'OK   ' : 'ÉCHEC ') + n); if (!c) process.exitCode = 1; };
  try {
    await s.putGame({ id, turn: 1, state: { hello: 'monde' }, report: [], deadline: null });
    const g = await s.getGame(id); ok('games: écriture + lecture', g && g.state.hello === 'monde');
    await s.putSeats(id, { A: { token_hash: 'abc', name: null } }); const se = await s.getSeats(id); ok('seats: écriture + lecture', se.A && se.A.token_hash === 'abc');
    await s.putOrders(id, 1, 'A', [{ op: 'move' }]); await s.putOrders(id, 1, 'A', [{ op: 'move' }, { op: 'claim' }]);
    const o = await s.getOrders(id, 1); ok('orders: écriture, remplacement, lecture', o.A && o.A.length === 2);
    const m = await s.getGameMeta(id); ok('getGameMeta (clés extraites du jsonb)', m && m.turn === 1 && typeof m.keys === 'string');
    const sw1 = await s.updateGameIfTurn(id, 1, { turn: 2, state: { led: { players: { A: {}, B: {} } } }, report: [], deadline: null }), sw2 = await s.updateGameIfTurn(id, 1, { turn: 2, state: {}, report: [], deadline: null });
    ok('updateGameIfTurn: un seul résolveur gagne', sw1 === true && sw2 === false);
    const m2 = await s.getGameMeta(id); ok('getGameMeta après mise à jour', m2 && m2.turn === 2 && m2.keys === 'AB');
    const big = { pad: 'x'.repeat(250e3) }; await s.putGame({ id, turn: 3, state: big, report: [], deadline: null }); const g2 = await s.getGame(id); ok('games: état de 250 Ko', g2 && g2.turn === 3 && g2.state.pad.length === 250e3);
  } catch (e) { console.error('Erreur:', e.message); process.exitCode = 1; }
  try { await fetch(url.replace(/\/$/, '') + '/rest/v1/games?id=eq.' + id, { method: 'DELETE', headers: Object.assign({ apikey: key }, key.startsWith('eyJ') ? { Authorization: 'Bearer ' + key } : {}) }); console.log('nettoyage fait (seats et orders suivent par cascade)'); } catch (e) {}
})();
