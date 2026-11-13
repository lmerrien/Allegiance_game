// Carte v6 -> grille 8 cellules/d (mer = -1) + état initial de partie (un château et 4 armées par siège).
'use strict';
const D = 34; // pixels moteur par d

function rle(a) { const o = []; let cur = a[0], n = 0; for (let i = 0; i < a.length; i++) { if (a[i] === cur) n++; else { o.push(cur, n); cur = a[i]; n = 1; } } o.push(cur, n); return o; }

function buildWorld(geo, nRealm, templates) {
  const BW = geo.size[0], BH = geo.size[1], GW = BW * 8, GH = BH * 8;
  const KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'.slice(0, nRealm);
  const land = new Int8Array(GW * GH).fill(-1);
  const ring = geo.coast[0];
  for (let gy = 0; gy < GH; gy++) {            // remplissage pair-impair par balayage
    const y = (gy + 0.5) / 8, xs = [];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y)) xs.push(xi + (y - yi) / (yj - yi) * (xj - xi));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = Math.max(0, Math.ceil(xs[k] * 8 - 0.5)), b = Math.min(GW - 1, Math.floor(xs[k + 1] * 8 - 0.5));
      for (let gx = a; gx <= b; gx++) land[gy * GW + gx] = 0;
    }
  }
  for (const rv of geo.rivers) {               // rivières = cellules infranchissables, sauf aux gués (1,25 d)
    const P = rv.pts;
    for (let s = 0; s + 1 < P.length; s++) {
      const [x0, y0] = P[s], [x1, y1] = P[s + 1], n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.04);
      for (let k = 0; k <= n; k++) {
        const x = x0 + (x1 - x0) * k / n, y = y0 + (y1 - y0) * k / n;
        if (rv.fords.some(f => Math.hypot(f[0] - x, f[1] - y) < 0.625)) continue;
        const gx = Math.floor(x * 8), gy = Math.floor(y * 8);
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const c = (gy + dy) * GW + gx + dx; if (land[c] === 0) land[c] = -1; }
      }
    }
  }
  const seats = geo.seats.slice(0, nRealm), RR = 5.9;
  const own = new Int8Array(GW * GH), prv = new Int16Array(GW * GH);
  seats.forEach(([sx, sy], i) => {             // terres de départ: disque de 5,9 d, partagé au siège le plus proche
    for (let gy = Math.max(0, Math.floor((sy - RR) * 8)); gy < Math.min(GH, Math.ceil((sy + RR) * 8)); gy++)
      for (let gx = Math.max(0, Math.floor((sx - RR) * 8)); gx < Math.min(GW, Math.ceil((sx + RR) * 8)); gx++) {
        const c = gy * GW + gx; if (land[c] !== 0) continue;
        const x = (gx + 0.5) / 8, y = (gy + 0.5) / 8; if (Math.hypot(x - sx, y - sy) > RR) continue;
        let best = i, bd = 1e9; seats.forEach((s, j) => { const d = Math.hypot(x - s[0], y - s[1]); if (d < bd) { bd = d; best = j; } });
        if (best === i) { own[c] = i + 1; prv[c] = i + 1; }
      }
  });
  const fin = new Int8Array(GW * GH); for (let c = 0; c < fin.length; c++) fin[c] = land[c] < 0 ? -1 : own[c];
  const INIT = { turnNo: 1, nextId: nRealm * 4 + 1, structSeq: nRealm + 1, claimSeq: 1, land: rle(fin), prov: rle(prv), structures: [], discs: [], claims: [], led: { provinces: {}, titles: {}, players: {}, claim_prov: {} } };
  let id = 1;
  KEYS.split('').forEach((k, i) => {
    const x = seats[i][0] * D, y = seats[i][1] * D;
    INIT.structures.push({ id: i + 1, kind: 'castle', owner: k, x, y });
    for (let a = 1; a <= 4; a++) INIT.discs.push({ id: id++, name: k + a, owner: k, flag: null, x, y });
    INIT.led.provinces[i + 1] = { owner: k, building: i + 1, name: k + '1' };
    INIT.led.titles[i + 1] = { rank: 0, kind: 'Baron', name: 'Baron of ' + k + '1', holder: k, seat: i + 1, parent: null, province: i + 1 };
    INIT.led.players[k] = Object.assign({}, templates[i % templates.length]);
  });
  return { INIT, KEYS, BW, BH };
}
module.exports = { buildWorld, D };
