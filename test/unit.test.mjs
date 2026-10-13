// Checks the stored tournament against the engine and the bots:  node --test test/unit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { DATA, COPY } from '../js/data.js';
import { BOTS } from '../js/bots.js';

const require = createRequire(import.meta.url);
const E = require('../tournament/engine.js');
const { W, H, DX, DY } = E;

test('every stored game replays to its recorded length and result', () => {
  assert.equal(DATA.games.length, 1023);
  for (const g of DATA.games) {
    assert.equal(g.moves.length, g.ticks, `game ${g.i}: one move pair per tick`);
    const grid = E.makeGrid(g.map);
    let pos = [{ x: g.s[0], y: g.s[1] }, { x: W - 1 - g.s[0], y: H - 1 - g.s[1] }];
    pos.forEach((p, i) => { grid[p.y * W + p.x] = i + 1; });
    let dead = [false, false], t = 0;
    while (t < g.moves.length && !dead[0] && !dead[1]) {
      const c = g.moves.charCodeAt(t++) - 97, d = [c >> 2, c & 3];
      const nx = pos.map((p, i) => ({ x: p.x + DX[d[i]], y: p.y + DY[d[i]] }));
      dead = nx.map(n => n.x < 0 || n.y < 0 || n.x >= W || n.y >= H || grid[n.y * W + n.x] !== 0);
      if (nx[0].x === nx[1].x && nx[0].y === nx[1].y) dead = [true, true];
      nx.forEach((n, i) => { if (!dead[i]) grid[n.y * W + n.x] = i + 1; });
      pos = nx;
    }
    assert.equal(t, g.ticks, `game ${g.i}: ends on its last move`);
    assert.ok(dead[0] || dead[1], `game ${g.i}: ends in a crash`);
    assert.equal(dead[0] && dead[1] ? null : g.p[dead[0] ? 1 : 0], g.winner, `game ${g.i}: winner`);
  }
});

test('the round-robin table adds up from its games', () => {
  const t = Object.fromEntries(DATA.standings.map(r => [r.slug, { W: 0, D: 0, L: 0 }]));
  for (const g of DATA.games.filter(g => g.stage === 'Round robin')) {
    if (!g.winner) g.p.forEach(s => t[s].D++);
    else { t[g.winner].W++; t[g.p.find(s => s !== g.winner)].L++; }
  }
  DATA.standings.forEach((r, k) => {
    assert.deepEqual(t[r.slug], { W: r.W, D: r.D, L: r.L }, r.slug);
    assert.equal(r.P, 120, r.slug);
    assert.equal(r.pts, 3 * r.W + r.D, r.slug);
    assert.equal(r.rank, k + 1, r.slug);
    if (k) assert.ok(DATA.standings[k - 1].pts >= r.pts, `${r.slug} is ranked below a lower score`);
  });
});

test('the bracket and the challenge follow from their games', () => {
  const series = DATA.bracket.flatMap(r => r.ties).concat([DATA.challenge]);
  for (const t of series) {
    const score = [0, 0];
    for (const gi of t.games) {
      const g = DATA.games[gi];
      assert.ok(g.p.includes(t.a) && g.p.includes(t.b), `game ${gi} belongs to ${t.a} v ${t.b}`);
      if (g.winner === t.a) score[0]++; else if (g.winner === t.b) score[1]++;
    }
    assert.deepEqual(score, t.score, `${t.a} v ${t.b}`);
    const need = t === DATA.challenge ? 4 : 3;
    assert.equal(Math.max(...score), need, `${t.a} v ${t.b} is first to ${need}`);
    assert.equal(t.winner, score[0] > score[1] ? t.a : t.b);
  }
  // Each round is made of the previous round's winners, and the last one crowns the champion.
  for (let r = 1; r < DATA.bracket.length; r++) {
    const winners = DATA.bracket[r - 1].ties.map(t => t.winner);
    assert.deepEqual(DATA.bracket[r].ties.flatMap(t => [t.a, t.b]).sort(), winners.sort(), DATA.bracket[r].round);
  }
  assert.equal(DATA.bracket.at(-1).ties[0].winner, DATA.champion);
  assert.equal(DATA.challenge.b, DATA.champion);
});

test('a new run numbers the knockout games in bracket order, whichever order they finish in', () => {
  const { numberKnockout } = require('../tournament/tournament.js');
  const ko = DATA.bracket.flatMap(r => r.ties.flatMap(t => t.games)), first = DATA.games.length - DATA.challenge.games.length - ko.length;
  const run = () => ({ games: structuredClone(DATA.games.slice(0, first + ko.length)), bracket: structuredClone(DATA.bracket) });
  // The stored run numbered them as they finished: Deep Cycle v Random Randy, the first tie, is games 965, 984 and 985.
  const stored = run();
  assert.deepEqual(stored.bracket[0].ties[0].games, [965, 984, 985]);
  numberKnockout(stored.games, stored.bracket);
  let n = first;
  for (const r of stored.bracket) for (const t of r.ties) t.games.forEach((gi, k) => {
    const g = stored.games[gi];
    assert.equal(gi, n++, `${r.round}, ${t.a} v ${t.b}, game ${k + 1}`);
    assert.ok(g.i === gi && g.gameNo === k + 1 && g.stage === r.round && g.p.includes(t.a) && g.p.includes(t.b), `game ${gi}`);
  });
  assert.equal(n, first + ko.length);
  assert.deepEqual(stored.games.slice(0, first), DATA.games.slice(0, first), 'the round robin keeps its numbers');
  const same = gs => gs.map(g => g.stage + g.p + g.moves).sort();
  assert.deepEqual(same(stored.games), same(DATA.games.slice(0, first + ko.length)), 'every game is still there once');
  // Finishing the other way round gives every game the same number.
  const other = run(), moved = new Map();
  other.games.slice(first).reverse().forEach((g, k) => { moved.set(g.i, first + k); g.i = first + k; other.games[first + k] = g; });
  for (const r of other.bracket) for (const t of r.ties) t.games = t.games.map(gi => moved.get(gi));
  numberKnockout(other.games, other.bracket);
  assert.deepEqual(other, stored);
});

test('records in the written copy read win-draw-loss, like the table and the rider cards', () => {
  const wdl = r => `${r.W}-${r.D}-${r.L}`, row = Object.fromEntries(DATA.standings.map(r => [r.slug, r]));
  const ko = { W: 0, D: 0, L: 0 };
  for (const gi of DATA.bracket.flatMap(r => r.ties.flatMap(t => t.games))) {
    const g = DATA.games[gi];
    if (g.p.includes('the-professor')) ko[g.winner === 'the-professor' ? 'W' : g.winner ? 'L' : 'D']++;
  }
  const copy = [COPY.dek, ...COPY.story, ...COPY.ticker].join('\n');
  for (const [claim, record] of [
    ['The Professor, No. 4 seed, % in the knockout', ko],
    ['DEEP CYCLE: % in the round robin', row['deep-cycle']],
    ['DEEP CYCLE: % at Crossroads', row['deep-cycle'].byMap.Crossroads],
    ['Random Randy: %', row['random-randy']],
    ['The Professor had gone % against Deep Cycle', DATA.h2h['the-professor']['deep-cycle']],
    ['The Guillotine had a % round-robin record against The Architect', DATA.h2h['the-guillotine']['the-architect']],
  ]) assert.ok(copy.includes(claim.replace('%', wdl(record))), claim.replace('%', wdl(record)));
});

test('every bot in the bundle loads and makes a legal first move', () => {
  const cache = {};
  const req = (from, name) => {
    const parts = from.includes('/') ? from.slice(0, from.lastIndexOf('/')).split('/') : [];
    for (const seg of name.split('/')) { if (seg === '.' || seg === '') continue; if (seg === '..') parts.pop(); else parts.push(seg); }
    const id = parts.join('/').replace(/\.js$/, '');
    if (cache[id]) return cache[id].exports;
    assert.ok(BOTS[id], `missing module ${id}`);
    const module = { exports: {} }; cache[id] = module;
    BOTS[id](module, module.exports, n => req(id, n), process);
    return module.exports;
  };
  const engine = req('', 'engine');
  for (const b of DATA.bots) {
    const id = b.slug === DATA.challenge.a ? 'challenger/' + b.slug : 'bots/' + b.slug;
    const mod = req('', id);
    assert.equal(mod.name, b.name, id);
    const grid = engine.makeGrid('Open Grid'), [me, opp] = engine.startFor('Open Grid', 42);
    grid[me.y * W + me.x] = 1; grid[opp.y * W + opp.x] = 2;
    const rng = engine.mulberry32(42);
    const d = mod.factory({ W, H, me: 0, rng }).move({ grid: grid.slice(), W, H, tick: 0, me, opp, meId: 1, oppId: 2, rng });
    assert.ok([0, 1, 2, 3].includes(d) && d !== (me.dir + 2) % 4, `${b.slug} answered ${d}`);
  }
});
