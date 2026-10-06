// The Professor: Voronoi territory, 2-ply. For each of my moves, assume the
// opponent picks the reply that hurts me most, and maximise (mine - theirs).
'use strict';
const C = require('./_shared/cycle-core');

module.exports = {
  name: 'The Professor',
  tagline: 'Territory is a theorem. I have proof.',
  color: '#b388ff',
  style: 'Voronoi Minimax',
  bio: 'Tweed jacket, chalk on the sleeves, and a Voronoi diagram for every occasion. Assumes you will always find the cruellest reply, and is rarely disappointed.',
  factory: () => ({
    move(s) {
      const g = C.geo(s.W, s.H), grid = s.grid;
      const me = C.cellOf(s, s.me), opp = C.cellOf(s, s.opp);
      if (C.separated(g, grid, me, opp)) return C.fillerMove(g, grid, me, s.me.dir, { leafBudget: 24, maxDepth: 6 });
      return C.voronoiMinimax(g, grid, me, opp, s.me.dir, s.opp.dir).move;
    },
  }),
};
