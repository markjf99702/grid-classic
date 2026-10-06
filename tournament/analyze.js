// Replays every game in results.json to compute momentum (Voronoi share per
// tick), the moment the bots got walled apart, and picks highlight candidates.
// node analyze.js writes analysis.json, for whoever writes the commentary.
// build.js uses analyze() directly for the awards.
'use strict';
const fs = require('fs');
const path = require('path');
const { W, H, DX, DY, startFor, makeGrid } = require('./engine');
const { voronoi } = require('./lib');

function analyze(g) {
  const grid = makeGrid(g.map);
  const pos = startFor(g.map, g.seed);
  pos.forEach((p, i) => grid[p.y * W + p.x] = i + 1);
  const mom = []; // p0 share of contested territory, 0..100
  let sep = null, minGap = 99, minGapTick = 0;
  for (let t = 0; t < g.moves.length; t++) {
    const c = g.moves.charCodeAt(t) - 97, d = [c >> 2, c & 3];
    const nx = pos.map((p, i) => ({ x: p.x + DX[d[i]], y: p.y + DY[d[i]], dir: d[i] }));
    const alive = nx.map(n => n.x >= 0 && n.y >= 0 && n.x < W && n.y < H && grid[n.y * W + n.x] === 0);
    if (nx[0].x === nx[1].x && nx[0].y === nx[1].y) alive[0] = alive[1] = false;
    nx.forEach((n, i) => { if (alive[i]) grid[n.y * W + n.x] = i + 1; });
    pos[0] = nx[0]; pos[1] = nx[1];
    if (!alive[0] || !alive[1]) break;
    const v = voronoi(grid, W, H, pos[0].x, pos[0].y, pos[1].x, pos[1].y);
    mom.push(v.a + v.b ? Math.round(100 * v.a / (v.a + v.b)) : 50);
    const gap = Math.abs(pos[0].x - pos[1].x) + Math.abs(pos[0].y - pos[1].y);
    if (gap < minGap) { minGap = gap; minGapTick = t + 1; }
    if (sep === null && v.separated) {
      sep = { tick: t + 1, cells: [v.a, v.b] };
    }
  }
  return { mom, sep, minGap, minGapTick };
}

module.exports = { analyze };
if (require.main !== module) return;

const R = JSON.parse(fs.readFileSync(path.join(__dirname, 'results.json'), 'utf8'));
const rank = Object.fromEntries(R.standings.map(t => [t.slug, t.rank]));
const name = Object.fromEntries(R.bots.map(b => [b.slug, b.name]));
const out = {};
for (const g of R.games) out[g.i] = analyze(g);

// Highlight candidates.
const rr = R.games.filter(g => g.stage === 'Round robin');
const cand = {};
const pick = (key, arr, n) => cand[key] = arr.slice(0, n).map(g => summary(g));
function summary(g) {
  const a = out[g.i];
  return { i: g.i, stage: g.stage, map: g.map, p: g.p.map(s => `${name[s]} (#${rank[s]})`), winner: g.winner ? name[g.winner] : 'draw',
    ticks: g.ticks, reason: g.reason, sep: a.sep, minGap: a.minGap, minGapTick: a.minGapTick,
    swings: swings(a.mom), finalMargin: a.sep ? Math.abs(a.sep.cells[0] - a.sep.cells[1]) : null };
}
function swings(m) { let n = 0, s = 0; for (const v of m) { const side = v > 55 ? 1 : v < 45 ? -1 : 0; if (side && side !== s) { if (s) n++; s = side; } } return n; }
pick('longest', [...rr].sort((x, y) => y.ticks - x.ticks), 6);
pick('upsets', rr.filter(g => g.winner && rank[g.winner] - rank[g.p[0] === g.winner ? g.p[1] : g.p[0]] >= 8)
  .sort((x, y) => (rank[y.winner] - rank[y.p[0] === y.winner ? y.p[1] : y.p[0]]) - (rank[x.winner] - rank[x.p[0] === x.winner ? x.p[1] : x.p[0]])), 8);
pick('closest', rr.filter(g => g.winner && out[g.i].sep && g.ticks > 150).sort((x, y) => Math.abs(out[x.i].sep.cells[0] - out[x.i].sep.cells[1]) - Math.abs(out[y.i].sep.cells[0] - out[y.i].sep.cells[1])), 6);
pick('swingiest', [...rr].sort((x, y) => swings(out[y.i].mom) - swings(out[x.i].mom)), 6);
pick('headOn', rr.filter(g => g.reason === 'head-on').sort((x, y) => y.ticks - x.ticks), 4);
pick('topClashes', rr.filter(g => rank[g.p[0]] <= 4 && rank[g.p[1]] <= 4).sort((x, y) => y.ticks - x.ticks), 8);
pick('knockout', R.games.filter(g => g.stage !== 'Round robin').sort((x, y) => x.i - y.i), 200);

fs.writeFileSync(path.join(__dirname, 'analysis.json'), JSON.stringify({ games: out, candidates: cand }));
console.log(JSON.stringify(Object.fromEntries(Object.entries(cand).map(([k, v]) => [k, v.length]))));
