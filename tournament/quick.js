// Quick head-to-head: node quick.js <botA> <botB> [games]
// Plays every map from both sides and prints W/L/D plus average ms per move.
'use strict';
const { MAPS, playGame } = require('./engine');
const load = n => require('./bots/' + n + '.js');
const [a, b, n = 2] = process.argv.slice(2);
const A = load(a), B = load(b);
let res = { A: 0, B: 0, D: 0 }, ms = [0, 0], mv = 0, maxTick = 0;
for (const map of Object.keys(MAPS)) for (let g = 0; g < n; g++) for (const swap of [0, 1]) {
  const f = swap ? [B.factory, A.factory] : [A.factory, B.factory];
  const r = playGame(f, map, 1000 + g);
  const winA = r.winner === -1 ? null : (r.winner === 0) !== !!swap;
  if (winA === null) res.D++; else if (winA) res.A++; else res.B++;
  ms[swap] += r.timeUsed[0]; ms[1 - swap] += r.timeUsed[1]; mv += r.ticks; maxTick = Math.max(maxTick, r.ticks);
  console.log(`${map.padEnd(11)} ${swap ? b + ' first' : a + ' first'}  ticks=${r.ticks} ${r.reason} -> ${winA === null ? 'draw' : winA ? a : b}`);
}
console.log(`${a} ${res.A} - ${res.B} ${b}  (draws ${res.D})  avg ms/move: ${a}=${(ms[0] / mv).toFixed(2)} ${b}=${(ms[1] / mv).toFixed(2)}  longest=${maxTick}`);
