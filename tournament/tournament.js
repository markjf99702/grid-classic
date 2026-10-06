// Runs the full event: round robin (every pair, every map, both sides) then a
// seeded 16-bot knockout (first to 3 wins per tie). Writes results.json.
'use strict';
const { Worker, isMainThread, parentPort } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const os = require('os');

const BOT_DIR = path.join(__dirname, 'bots');
const enc = moves => moves.map(([a, b]) => String.fromCharCode(97 + a * 4 + b)).join('');

if (!isMainThread) {
  const { playGame } = require('./engine');
  const cache = {};
  const load = s => cache[s] || (cache[s] = require(path.join(BOT_DIR, s + '.js')));
  parentPort.on('message', job => {
    const r = playGame([load(job.p0).factory, load(job.p1).factory], job.map, job.seed);
    parentPort.postMessage({ id: job.id, winner: r.winner, ticks: r.ticks, reason: r.reason, moves: enc(r.moves), ms: r.timeUsed, s: [r.start[0].x, r.start[0].y, r.start[0].dir] });
  });
  return;
}

const { MAPS } = require('./engine');
const MAP_NAMES = Object.keys(MAPS);
const only = process.argv[2] ? process.argv[2].split(',') : null;
const slugs = fs.readdirSync(BOT_DIR).filter(f => f.endsWith('.js')).map(f => f.slice(0, -3))
  .filter(s => !only || only.includes(s)).sort();
const bots = slugs.map(s => {
  const m = require(path.join(BOT_DIR, s + '.js'));
  return { slug: s, name: m.name, tagline: m.tagline, color: m.color, style: m.style, bio: m.bio };
});

const nWorkers = Math.max(1, os.cpus().length);
const workers = Array.from({ length: nWorkers }, () => new Worker(__filename));
let nextId = 0; const pending = new Map(); const queue = []; const idle = [...workers];
workers.forEach(w => w.on('message', m => {
  const { resolve } = pending.get(m.id); pending.delete(m.id);
  resolve(m); idle.push(w); pump();
}));
function pump() {
  while (idle.length && queue.length) { const job = queue.shift(); idle.pop().postMessage(job); }
}
function run(p0, p1, map, seed) {
  return new Promise(resolve => {
    const id = nextId++; pending.set(id, { resolve });
    queue.push({ id, p0, p1, map, seed }); pump();
  });
}

const games = [];
function record(stage, p0, p1, map, seed, r, extra = {}) {
  const g = { i: games.length, stage, p: [p0, p1], map, seed, winner: r.winner === -1 ? null : [p0, p1][r.winner],
    ticks: r.ticks, reason: r.reason, s: r.s, moves: r.moves, ms: r.ms.map(x => +x.toFixed(1)), ...extra };
  games.push(g); return g;
}

(async () => {
  const t0 = Date.now();
  // ---- Round robin
  const jobs = [];
  for (let i = 0; i < slugs.length; i++) for (let j = i + 1; j < slugs.length; j++)
    MAP_NAMES.forEach((map, mi) => [0, 1].forEach(sw => {
      const [a, b] = sw ? [slugs[j], slugs[i]] : [slugs[i], slugs[j]];
      const seed = 7919 * (i * 31 + j) + mi; // both sides of a pairing get the same (mirrored) start
      jobs.push(run(a, b, map, seed).then(r => record('Round robin', a, b, map, seed, r)));
    }));
  await Promise.all(jobs);
  games.sort((x, y) => x.seed - y.seed || x.p[0].localeCompare(y.p[0])); games.forEach((g, i) => g.i = i);
  console.error(`round robin: ${games.length} games in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const table = {};
  slugs.forEach(s => table[s] = { slug: s, P: 0, W: 0, D: 0, L: 0, pts: 0, ticks: 0, headOn: 0, byMap: {}, ms: 0 });
  const h2h = {};
  slugs.forEach(a => { h2h[a] = {}; slugs.forEach(b => h2h[a][b] = { W: 0, D: 0, L: 0 }); });
  for (const g of games) g.p.forEach((s, k) => {
    const t = table[s], o = g.p[1 - k];
    t.P++; t.ticks += g.ticks; t.ms += g.ms[k];
    t.byMap[g.map] = t.byMap[g.map] || { W: 0, D: 0, L: 0 };
    if (g.reason === 'head-on') t.headOn++;
    const res = g.winner === null ? 'D' : g.winner === s ? 'W' : 'L';
    t[res]++; t.byMap[g.map][res]++; h2h[s][o][res]++;
    t.pts += res === 'W' ? 3 : res === 'D' ? 1 : 0;
  });
  // Tiebreak: points, then wins, then head-to-head-free random-free name order.
  const standings = Object.values(table).sort((a, b) => b.pts - a.pts || b.W - a.W || a.L - b.L || a.slug.localeCompare(b.slug));
  standings.forEach((t, i) => { t.rank = i + 1; t.avgTicks = +(t.ticks / t.P).toFixed(1); t.msPerMove = +(t.ms / t.ticks).toFixed(3); delete t.ticks; delete t.ms; });

  // ---- Knockout: standard seeding 1v16, 8v9, ... first to 3 wins.
  const seeds = standings.map(t => t.slug);
  const size = 1 << Math.floor(Math.log2(seeds.length));
  const order = size === 16 ? [1, 16, 8, 9, 5, 12, 4, 13, 3, 14, 6, 11, 7, 10, 2, 15]
    : size === 8 ? [1, 8, 4, 5, 3, 6, 2, 7] : size === 4 ? [1, 4, 2, 3] : [1, 2];
  let field = order.map(n => seeds[n - 1]);
  const roundNames = { 16: 'Round of 16', 8: 'Quarterfinal', 4: 'Semifinal', 2: 'Final' };
  const bracket = [];
  let tieSeed = 900000;
  while (field.length > 1) {
    const rname = roundNames[field.length];
    const ties = [];
    for (let k = 0; k < field.length; k += 2) ties.push(playTie(rname, field[k], field[k + 1]));
    const done = await Promise.all(ties);
    bracket.push({ round: rname, ties: done });
    field = done.map(t => t.winner);
  }
  async function playTie(rname, a, b) {
    const tie = { a, b, score: [0, 0], games: [] };
    const base = (tieSeed += 1000);
    // Games are sequential within a tie (series stops at 3) but ties run in parallel.
    for (let n = 0; n < 15 && tie.score[0] < 3 && tie.score[1] < 3; n++) {
      const map = MAP_NAMES[n % MAP_NAMES.length];
      const [p0, p1] = n % 2 ? [b, a] : [a, b];
      const seed = base + n;
      const r = await run(p0, p1, map, seed);
      const g = record(rname, p0, p1, map, seed, r, { gameNo: n + 1 });
      if (g.winner === a) tie.score[0]++; else if (g.winner === b) tie.score[1]++;
      tie.games.push(g.i);
    }
    // If 15 games can't separate them (endless draws), the higher seed advances.
    tie.winner = tie.score[0] >= tie.score[1] ? a : b;
    return tie;
  }
  const champion = bracket[bracket.length - 1].ties[0].winner;

  const out = { generated: new Date().toISOString(), W: 40, H: 30, maps: MAP_NAMES, bots, standings, h2h, bracket, champion, games };
  fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify(out));
  console.error(`done: ${games.length} games total in ${((Date.now() - t0) / 1000).toFixed(1)}s, champion ${champion}`);
  console.log(standings.map(t => `${String(t.rank).padStart(2)} ${t.slug.padEnd(16)} ${t.pts} pts  ${t.W}-${t.D}-${t.L}  ${t.msPerMove}ms/mv`).join('\n'));
  for (const r of bracket) console.log(r.round + ': ' + r.ties.map(t => `${t.a} ${t.score[0]}-${t.score[1]} ${t.b}`).join(' | '));
  workers.forEach(w => w.terminate());
})();
