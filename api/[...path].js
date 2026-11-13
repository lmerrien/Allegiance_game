// Point d'entrée Vercel: toutes les routes /api/* arrivent ici (voir vercel.json). Même logique que server.js.
'use strict';
const { route } = require('../lib/router');
module.exports = async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x'), p = u.pathname;
    let body = req.body;                                             // Vercel pré-analyse le JSON
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    const r = await route({ method: req.method, pathname: p, query: Object.fromEntries(u.searchParams), body: body || {}, headers: req.headers });
    res.setHeader('Cache-Control', 'no-cache');
    if (!r) return res.status(404).json({ error: 'introuvable' });
    res.status(r.code).json(r.body);
  } catch (e) { console.error(e); res.status(500).json({ error: String(e.message || e) }); }
};
