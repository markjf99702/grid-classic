// The Challenger: chamber-aware Voronoi minimax. Like The Professor it assumes
// the cruellest reply, but it scores territory by how much of it can actually
// be driven (articulation points / dead-end pockets), and once walled off it
// fills its chamber with a much deeper search.
'use strict';
const C = require('../bots/_shared/cycle-core');

module.exports = {
  name: 'The Challenger',
  tagline: 'Your territory has holes in it. I counted them.',
  color: '#ff6b35',
  style: 'Chamber Minimax',
  bio: 'Studied under The Professor, then noticed the Voronoi diagram counts space you can never actually drive through. Plays for usable room, not paper territory.',
  factory: () => ({
    move(s) {
      const g = C.geo(s.W, s.H), grid = s.grid;
      const me = C.cellOf(s, s.me), opp = C.cellOf(s, s.opp);
      if (C.separated(g, grid, me, opp)) return C.fillerMove(g, grid, me, s.me.dir, { leafBudget: 160, maxDepth: 12 });
      const ev = (a, b) => {
        const e = C.voronoiChamber(g, grid, a, b);
        if (g.sep) return e > 0 ? 5000 + e : e < 0 ? -5000 + e : -50;
        return e;
      };
      return C.voronoiMinimax(g, grid, me, opp, s.me.dir, s.opp.dir, ev).move;
    },
  }),
};
