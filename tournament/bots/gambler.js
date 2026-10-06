// Gambler: Monte Carlo. For each safe move, plays many quick random-ish
// playouts (both bots on a cheap "mostly straight, avoid dead ends" policy) and
// takes the move with the best win rate. Fills methodically once separated.
'use strict';
const C = require('./_shared/cycle-core');

const PLAYOUTS = 160;    // total playouts per decision (split across moves)
const CAP = 45;          // playout horizon; unresolved games are judged by Voronoi
const log = new Int32Array(4096);

function policy(g, grid, c, dir, rng) {
  const NB = g.NB;
  let opts = 0, o0 = -1, o1 = -1, o2 = -1, straightOk = false;
  for (let d = 0; d < 4; d++) {
    const n = NB[c * 4 + d];
    if (n < 0 || grid[n] !== 0) continue;
    // skip immediate dead ends when possible
    if (C.freeNeighbours(g, grid, n) === 0) continue;
    if (d === dir) straightOk = true;
    if (opts === 0) o0 = d; else if (opts === 1) o1 = d; else o2 = d;
    opts++;
  }
  if (opts === 0) { // only dead ends (or nothing): take any free cell
    for (let d = 0; d < 4; d++) { const n = NB[c * 4 + d]; if (n >= 0 && grid[n] === 0) return d; }
    return dir;
  }
  if (straightOk && rng() < 0.55) return dir;
  const k = Math.floor(rng() * opts);
  return k === 0 ? o0 : k === 1 ? o1 : o2;
}

module.exports = {
  name: 'Gambler',
  tagline: 'Feeling lucky? I always am.',
  color: '#ffd166',
  style: 'Monte Carlo',
  bio: 'Rolls the dice a few hundred times a second and bets on whatever came up most. Statistically sound, emotionally unstable.',
  factory: () => ({
    move(s) {
      const g = C.geo(s.W, s.H), grid = s.grid, NB = g.NB, rng = s.rng;
      const me = C.cellOf(s, s.me), opp = C.cellOf(s, s.opp);
      if (C.separated(g, grid, me, opp)) return C.fillerMove(g, grid, me, s.me.dir, { leafBudget: 30, maxDepth: 8 });
      let moves = C.freeMoves(g, grid, me, s.me.dir);
      if (moves.length <= 1) return moves.length ? moves[0] : s.me.dir;
      // the house never bets on a closet: drop moves with far less room
      const room = moves.map(d => { const n = NB[me * 4 + d]; grid[n] = 9; const v = C.flood(g, grid, n); grid[n] = 0; return v; });
      const mx = Math.max(...room);
      moves = moves.filter((d, i) => room[i] * 3 >= mx);
      if (moves.length === 1) return moves[0];

      const per = Math.max(8, Math.floor(PLAYOUTS / moves.length));
      let best = moves[0], bestRate = -1;
      for (const m of moves) {
        let score = 0;
        for (let p = 0; p < per; p++) {
          let L = 0, a = me, b = opp, ad = m, bd = s.opp.dir, res = -1;
          for (let t = 0; t < CAP; t++) {
            if (t > 0) ad = policy(g, grid, a, ad, rng);
            bd = policy(g, grid, b, bd, rng);
            const na = NB[a * 4 + ad], nb = NB[b * 4 + bd];
            const deadA = na < 0 || grid[na] !== 0, deadB = nb < 0 || grid[nb] !== 0;
            if (na === nb && na >= 0) { res = 0.5; break; }
            if (deadA || deadB) { res = deadA && deadB ? 0.5 : deadA ? 0 : 1; break; }
            grid[na] = 7; grid[nb] = 8; log[L++] = na; log[L++] = nb; a = na; b = nb;
          }
          if (res < 0) {
            const v = C.voronoi(g, grid, a, b);
            res = v > 0 ? 0.85 : v < 0 ? 0.15 : 0.5;
          }
          for (let i = 0; i < L; i++) grid[log[i]] = 0;
          score += res;
        }
        const rate = score / per;
        if (rate > bestRate || (rate === bestRate && m === s.me.dir)) { bestRate = rate; best = m; }
      }
      return best;
    },
  }),
};
