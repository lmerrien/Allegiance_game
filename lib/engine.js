// Charge le moteur du Sandbox 2 (vendor/sandbox2.html) tel quel dans un contexte vm isolé, avec un faux DOM.
// Le moteur n'est pas modifié sur le disque: on adapte son texte à la volée (taille du plateau, 52 clés, hooks).
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const { D } = require('./world');

function stub(over) {
  const store = {}, f = function () { return stub(); };
  return new Proxy(f, {
    get(_, k) { if (over && k in over) return over[k]; if (k === Symbol.toPrimitive) return () => 0; if (k in store) return store[k];
      if (k === 'children' || k === 'length' || k === 'childNodes') return []; if (k === 'then') return undefined; if (k === 'data') return new Uint8ClampedArray(4); return stub(); },
    set(_, k, v) { store[k] = v; return true; }, apply() { return stub(); },
  });
}
const ctx2d = () => stub({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }), measureText: () => ({ width: 10 }), getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) });
const el = () => stub({ getContext: () => ctx2d(), clientWidth: 1000, clientHeight: 800, parentElement: stub({ clientWidth: 1000, clientHeight: 800 }), style: stub(), classList: stub(), appendChild() {}, addEventListener() {} });

function adaptSource(html, { keys, BW, BH }) {
  html = html.replace(/\r\n/g, '\n'); // checkout Windows (CRLF): les motifs ci-dessous supposent des fins de ligne LF
  let src = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
  const rep = (a, b) => { if (!src.includes(a)) throw new Error('motif introuvable dans le moteur: ' + a.slice(0, 50)); src = src.replace(a, () => b); };
  rep('var W=53*D, H=50*D;', `var W=${BW}*D, H=${BH}*D;`);
  if (!/var PLAYERS=\[[\s\S]*?\n\];/.test(src)) throw new Error('liste PLAYERS introuvable dans le moteur');
  src = src.replace(/var PLAYERS=\[[\s\S]*?\n\];/, 'var PLAYERS=' + JSON.stringify(keys.split('').map(k => ({ key: k, name: k, cssVar: '--p' + k }))) + ';');
  rep("KEYS='ABCDEF'", "KEYS='" + keys + "'");
  rep('/^[A-L](\\d+)$/', '/^[A-Za-z](\\d+)$/');
  const before = src.length;
  src = src.replace(/var INIT=\{[\s\S]*?\};\nvar MAP=.*\n/, 'var INIT=__INIT;\nvar MAP={coast:[],waves:[],ripples:[],deco:[]};\n');
  if (src.length === before || !src.includes('var INIT=__INIT;')) throw new Error('remplacement de INIT échoué dans le moteur');
  src = src.replace(/\}\)\(\);\s*$/, `
window.__E={
  load:function(s){ loadGame(s); },
  dump:function(){ return dumpGame(); },
  turn:function(){ runTurn(); var g=0, dt; while(playing && g++<4000){ dt=1/110; if(t+dt>=1) dt=1-t; lastClusters=simulate(dt); t+=dt; if(t>=0.9999){ endTurn(); break; } } return turnNo; },
  apply:function(seat,o){
    function army(n){ var d=armyByName(n); if(!d) return [null,'no such army '+n]; if(d.owner!==seat) return [null,'not your army']; return [d,null]; }
    var r,d;
    switch(o.op){
      case 'move': r=army(o.army); if(r[1]) return r[1]; d=r[0]; d.goto=null; return orderMove(d,+o.x*D,+o.y*D)?'ok':'refused';
      case 'claim': r=army(o.army); if(r[1]) return r[1]; return SB.claim(o.army,+o.r||2)?'ok':'refused';
      case 'build': r=army(o.army); if(r[1]) return r[1]; return issueBuild(r[0],o.kind)?'ok':'refused';
      case 'disband': r=army(o.army); if(r[1]) return r[1]; r[0].disband=o.on!==false; return 'ok';
      case 'flag': r=army(o.army); if(r[1]) return r[1]; r[0].flagOrder=o.color||null; return 'ok';
      case 'raise': var st=bldById(+o.building); if(!st) return 'no such building'; if(st.owner!==seat) return 'not your building'; return issueRaise(st)?'ok':'refused';
      default: return 'unknown op';
    } },
  report:function(){ return REPORTS.length?REPORTS[0].lines:[]; }
};
})();`);
  return src;
}

function createEngine({ keys, BW, BH, state }) {
  const html = fs.readFileSync(path.join(__dirname, '..', 'vendor', 'sandbox2.html'), 'utf8');
  const sandbox = { __INIT: state, console, Math, JSON, Set, Map, Array, Object, Uint8Array, Int8Array, Int16Array, Int32Array, Float32Array, Uint8ClampedArray,
    document: stub({ getElementById: () => el(), createElement: () => el(), documentElement: stub(), addEventListener() {}, createTextNode: () => stub() }),
    getComputedStyle: () => ({ getPropertyValue: () => '#888' }), requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, devicePixelRatio: 1, addEventListener() {} };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(adaptSource(html, { keys, BW, BH }), sandbox, { filename: 'sandbox2-engine.js' });
  return sandbox.__E;
}
module.exports = { createEngine };
