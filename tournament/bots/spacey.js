// Spacey: greedy flood fill. Every tick, take the move that leaves the most
// reachable empty cells; ties go to "keep going straight".
'use strict';
const C = require('./_shared/cycle-core');

module.exports = {
  name: 'Spacey',
  tagline: 'Give me room. Lots of room.',
  color: '#4cc9f0',
  style: 'Greedy Flood',
  bio: 'A laid-back claustrophobe who only ever asks one question: which way has the most space? Never plans, never panics, never quite wins the big ones.',
  factory: () => ({
    move(s) {
      const g = C.geo(s.W, s.H), grid = s.grid;
      const me = C.cellOf(s, s.me), opp = C.cellOf(s, s.opp);
      if (C.separated(g, grid, me, opp)) return C.greedyFill(g, grid, me, s.me.dir);
      const moves = C.freeMoves(g, grid, me, s.me.dir);
      if (!moves.length) return s.me.dir;
      let best = moves[0], bv = -1;
      for (const d of moves) {
        const n = g.NB[me * 4 + d];
        grid[n] = 9;
        // small nudge away from cells the opponent could also enter (head-on risk)
        let v = C.flood(g, grid, n) * 2;
        for (let k = 0; k < 4; k++) if (g.NB[opp * 4 + k] === n) v -= 3;
        grid[n] = 0;
        if (v > bv || (v === bv && d === s.me.dir)) { bv = v; best = d; }
      }
      return best;
    },
  }),
};
