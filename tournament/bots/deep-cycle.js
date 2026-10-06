// Deep Cycle: iterative-deepening alpha-beta over simultaneous moves (modelled
// as me-then-opponent, where the opponent sees my move; same-cell = draw),
// Voronoi territory evaluation, chamber/articulation-aware separated endgame.
'use strict';
const C = require('./_shared/cycle-core');
const { WIN, LOSS } = C;
const DRAW = -300;
const CHAMBER = true;
const BUDGET = 100; // leaf evaluations per move (deterministic)

function makeSearcher(g, grid, opts) {
  const NB = g.NB;
  let evals = 0, budget = 0, aborted = false, t0 = 0;
  const hardMs = opts.hardMs || 18; // safety net only

  function evaluate(a, b) {
    evals++;
    if ((evals & 7) === 0 && Number(process.hrtime.bigint() - t0) / 1e6 > hardMs) aborted = true;
    const v = opts.chamber ? C.voronoiChamber(g, grid, a, b) : C.voronoi(g, grid, a, b);
    if (g.sep) {
      const fa = C.fillEstimate(g, grid, a), fb = C.fillEstimate(g, grid, b);
      if (fa > fb) return 20000 + (fa - fb) * 10;
      if (fa < fb) return -20000 + (fa - fb) * 10;
      return DRAW;
    }
    // territory, plus a small bonus for having more exits (mobility)
    return v * 10 + (C.freeNeighbours(g, grid, a) - C.freeNeighbours(g, grid, b));
  }

  // Value for me at state (a my head, b opp head), my turn, `depth` rounds left.
  function search(a, b, depth, ply, alpha, beta) {
    if (depth === 0) return evaluate(a, b);
    if (evals >= budget || aborted) { aborted = true; return 0; }
    const myN = [], opN = [];
    for (let d = 0; d < 4; d++) {
      const n = NB[a * 4 + d]; if (n >= 0 && grid[n] === 0) myN.push(n);
      const m = NB[b * 4 + d]; if (m >= 0 && grid[m] === 0) opN.push(m);
    }
    if (!myN.length) return opN.length ? LOSS + ply : DRAW;
    if (!opN.length) return WIN - ply;
    let best = -Infinity;
    for (const mc of myN) {
      let worst = Infinity;
      for (const oc of opN) {
        let v;
        if (oc === mc) v = DRAW;
        else {
          grid[mc] = 7; grid[oc] = 8;
          v = search(mc, oc, depth - 1, ply + 1, Math.max(alpha, best), Math.min(beta, worst));
          grid[mc] = 0; grid[oc] = 0;
        }
        if (v < worst) worst = v;
        if (worst <= alpha || worst <= best) break; // this move can't beat what we have
        if (aborted) break;
      }
      if (worst > best) best = worst;
      if (best >= beta || aborted) break;
    }
    return best;
  }

  function root(me, opp, meDir, leafBudget, maxDepth) {
    t0 = process.hrtime.bigint();
    const moves = C.freeMoves(g, grid, me, meDir);
    if (!moves.length) return meDir;
    if (moves.length === 1) return moves[0];
    let order = moves.slice(), bestMove = moves[0];
    evals = 0; budget = leafBudget; aborted = false;
    for (let depth = 1; depth <= maxDepth; depth++) {
      const scores = new Map();
      let best = -Infinity, bm = order[0];
      const opN = [];
      for (let d = 0; d < 4; d++) { const m = NB[opp * 4 + d]; if (m >= 0 && grid[m] === 0) opN.push(m); }
      for (const md of order) {
        const mc = NB[me * 4 + md];
        let worst = Infinity;
        if (!opN.length) worst = WIN;
        for (const oc of opN) {
          let v;
          if (oc === mc) v = DRAW;
          else {
            grid[mc] = 7; grid[oc] = 8;
            v = search(mc, oc, depth - 1, 1, best, worst);
            grid[mc] = 0; grid[oc] = 0;
          }
          if (v < worst) worst = v;
          if (worst <= best || aborted) break;
        }
        if (aborted) break;
        scores.set(md, worst);
        if (worst > best || (worst === best && md === meDir)) { best = worst; bm = md; }
      }
      if (aborted) break;
      bestMove = bm;
      order = order.slice().sort((x, y) => (scores.get(y) ?? -Infinity) - (scores.get(x) ?? -Infinity));
      if (best >= WIN - 100 || best <= LOSS + 100) break; // decided
    }
    return bestMove;
  }
  return { root };
}

module.exports = {
  name: 'Deep Cycle',
  tagline: 'I have already seen how this ends.',
  color: '#00f5d4',
  style: 'Alpha-Beta Search',
  bio: 'The cold-blooded favourite: iterative-deepening alpha-beta, Voronoi territory and an articulation-point map of every room it enters. Speaks only in principal variations.',
  factory: () => ({
    move(s) {
      const g = C.geo(s.W, s.H), grid = s.grid;
      const me = C.cellOf(s, s.me), opp = C.cellOf(s, s.opp);
      if (C.separated(g, grid, me, opp)) return C.fillerMove(g, grid, me, s.me.dir, { leafBudget: 50, maxDepth: 30 });
      return makeSearcher(g, grid, { chamber: CHAMBER }).root(me, opp, s.me.dir, BUDGET, 12);
    },
  }),
};
