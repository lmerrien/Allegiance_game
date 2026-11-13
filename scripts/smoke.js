const fs=require('fs'); const {buildWorld}=require('../lib/world'); const {createEngine}=require('../lib/engine');
const geo=JSON.parse(fs.readFileSync(__dirname+'/../data/world-v6.json')), tp=JSON.parse(fs.readFileSync(__dirname+'/../data/player-templates.json'));
let t=Date.now(); const w=buildWorld(geo,52,tp); console.log('world',Date.now()-t,'ms');
t=Date.now(); const E=createEngine({keys:w.KEYS,BW:w.BW,BH:w.BH,state:w.INIT}); console.log('engine',Date.now()-t,'ms');
console.log(E.apply('A',{op:'move',army:'A1',x:66,y:97}), E.apply('B',{op:'move',army:'A1',x:1,y:1}), E.apply('A',{op:'claim',army:'A2',r:2}));
t=Date.now(); const n=E.turn(); console.log('turn ->',n,Date.now()-t,'ms'); const s=E.dump(); console.log('dump KB',Math.round(JSON.stringify(s).length/1024), s.discs.find(d=>d.name==='A1').x/34, E.report().slice(0,3));
