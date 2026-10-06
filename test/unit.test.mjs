// Checks the stored tournament against the engine and the bots:  node --test test/unit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { DATA } from '../js/data.js';
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
