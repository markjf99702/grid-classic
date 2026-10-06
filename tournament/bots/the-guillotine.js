// The Guillotine: hunts for a straight (or one-step-then-straight) wall it can
// finish before the opponent can cross it, which seals the opponent into a
// smaller region than its own. No cut available? Plays 2-ply Voronoi.
'use strict';
const C = require('./_shared/cycle-core');

module.exports = {
  name: 'The Guillotine',
  tagline: 'One clean cut. That is all it takes.',
  color: '#e9ff70',
  style: 'Cutoff Specialist',
  bio: 'Patient, precise and slightly theatrical. Measures every possible wall twice, then drops the blade the instant the opponent is on the wrong side of it.',
  factory: () => {
    let oppDist = null;
    return {
      move(s) {
        const g = C.geo(s.W, s.H), grid = s.grid, NB = g.NB;
        const me = C.cellOf(s, s.me), opp = C.cellOf(s, s.opp);
        if (!oppDist) oppDist = new Int32Array(g.N);
        if (C.separated(g, grid, me, opp)) return C.fillerMove(g, grid, me, s.me.dir, { leafBudget: 40, maxDepth: 10 });
        const moves = C.freeMoves(g, grid, me, s.me.dir);
        if (moves.length <= 1) return moves.length ? moves[0] : s.me.dir;

        C.distMap(g, grid, opp, oppDist);
        let bestCut = null;
        const path = [];
        for (const m of moves) {
          const first = NB[me * 4 + m];
          if (!(oppDist[first] < 0 || oppDist[first] > 1)) continue;
          for (let r = 0; r < 4; r++) {
            if ((r + 2) % 4 === m) continue;
            // ray: first cell, then straight in direction r
            path.length = 0; path.push(first); grid[first] = 9;
            let c = first, ok = true;
            for (let i = 2; i <= 30 && ok; i++) {
              // test a closed cut at the current length (end touches an obstacle)
              let touches = false;
              for (let d = 0; d < 4; d++) {
                if (d === (r + 2) % 4) continue;
                const n = NB[c * 4 + d];
                if (n < 0 || (grid[n] !== 0 && grid[n] !== 9)) { touches = true; break; }
              }
              if (touches && C.separated(g, grid, c, opp)) {
                const mine = C.flood(g, grid, c), theirs = C.flood(g, grid, opp);
                const margin = mine - theirs;
                // shorter cuts are surer cuts
                const score = margin - path.length * 2;
                if (margin > 4 && (!bestCut || score > bestCut.score)) bestCut = { score, move: m, len: path.length };
                break;
              }
              const n = NB[c * 4 + r];
              if (n < 0 || grid[n] !== 0) break;
              // we must arrive strictly before the opponent could
              if (oppDist[n] >= 0 && oppDist[n] <= i) { ok = false; break; }
              path.push(n); grid[n] = 9; c = n;
            }
            for (const p of path) grid[p] = 0;
          }
        }
        if (bestCut) return bestCut.move;
        return C.voronoiMinimax(g, grid, me, opp, s.me.dir, s.opp.dir).move;
      },
    };
  },
};
