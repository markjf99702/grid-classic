// Describe a game for commentary writers: node inspect.js <gameIndex> [extraTick ...]
// Prints the matchup, territory momentum every 20 ticks, and ASCII boards at
// tick 30, the moment the riders were sealed apart, any extra ticks, and the end.
'use strict';
const fs = require('fs');
const path = require('path');
const { W, H, DX, DY, startFor, makeGrid } = require('./engine');
const { voronoi } = require('./lib');

const R = JSON.parse(fs.readFileSync(path.join(__dirname, 'results.json'), 'utf8'));
const name = Object.fromEntries(R.bots.map(b => [b.slug, b.name]));
const rank = Object.fromEntries(R.standings.map(t => [t.slug, t.rank]));
const gi = +process.argv[2];
const extra = process.argv.slice(3).map(Number);
const g = R.games[gi];

const grid = makeGrid(g.map);
let pos = startFor(g.map, g.seed);
pos.forEach((p, i) => grid[p.y * W + p.x] = i + 1);
const boards = [];
const snap = (label, t) => {
  let s = `--- ${label} (tick ${t}) ---\n`;
  for (let y = 0; y < H; y++) {
    let line = '';
    for (let x = 0; x < W; x++) {
      const v = grid[y * W + x];
      const head = pos.findIndex(p => p.x === x && p.y === y);
      line += head >= 0 ? 'AB'[head] : v === 0 ? '.' : v === 3 ? '#' : v === 1 ? 'a' : 'b';
    }
    s += line + '\n';
  }
  boards.push(s);
};
const mom = [];
let sep = null, end = null;
const DIRS = '^>v<';
const turns = [[], []];
for (let t = 0; t < g.moves.length; t++) {
  const c = g.moves.charCodeAt(t) - 97, d = [c >> 2, c & 3];
  d.forEach((dd, i) => { if (dd !== pos[i].dir) turns[i].push(t + 1); });
  const nx = pos.map((p, i) => ({ x: p.x + DX[d[i]], y: p.y + DY[d[i]], dir: d[i] }));
  const hit = nx.map(n => n.x < 0 || n.y < 0 || n.x >= W || n.y >= H ? 'arena edge' : ['empty', 'A trail', 'B trail', 'barrier'][grid[n.y * W + n.x]]);
  const same = nx[0].x === nx[1].x && nx[0].y === nx[1].y;
  const alive = hit.map(h => h === 'empty' && !same);
  nx.forEach((n, i) => { if (alive[i]) grid[n.y * W + n.x] = i + 1; });
  pos = nx;
  if (!alive[0] || !alive[1]) { end = { tick: t + 1, hit, same, alive }; break; }
  const v = voronoi(grid, W, H, pos[0].x, pos[0].y, pos[1].x, pos[1].y);
  mom.push(Math.round(100 * v.a / Math.max(1, v.a + v.b)));
  if (t + 1 === 30) snap('early', t + 1);
  if (!sep && v.separated) { sep = { tick: t + 1, a: v.a, b: v.b }; snap('sealed apart', t + 1); }
  if (extra.includes(t + 1)) snap('requested', t + 1);
}
snap('final position', end ? end.tick : g.ticks);

console.log(`Game #${gi} · ${g.stage}${g.gameNo ? ' game ' + g.gameNo : ''} · ${g.map}`);
console.log(`A = ${name[g.p[0]]} (seed ${rank[g.p[0]]}), B = ${name[g.p[1]]} (seed ${rank[g.p[1]]})`);
console.log(`Result: ${g.winner ? name[g.winner] + ' won' : 'draw'} at tick ${g.ticks} (${g.reason})`);
if (end) console.log(`Ending: A ${end.alive[0] ? 'survived' : 'hit ' + end.hit[0]}, B ${end.alive[1] ? 'survived' : 'hit ' + end.hit[1]}${end.same ? ' (same cell: head-on)' : ''}`);
console.log(sep ? `Sealed apart at tick ${sep.tick}: A has ${sep.a} cells, B has ${sep.b}` : 'Never sealed apart.');
console.log(`A's territory share every 20 ticks: ${mom.filter((_, i) => i % 20 === 0).join(' ')}`);
console.log(`Turn counts: A ${turns[0].length}, B ${turns[1].length}`);
console.log(boards.join('\n'));
