// The Architect: thinks in long straight walls. It scores candidate rays
// ("drive straight this way for L cells") by the territory they would secure,
// counting the time the ray takes, commits to the best one, and only abandons
// the blueprint if the opponent can reach the planned cells first. Once sealed
// off, it fills its plot methodically.
'use strict';
const C = require('./_shared/cycle-core');

module.exports = {
  name: 'The Architect',
  tagline: 'Every wall is load-bearing.',
  color: '#3a86ff',
  style: 'Wall Builder',
  bio: 'Arrives with blueprints, a ruler and zero interest in improvisation. Lays one long straight wall to fence off the bigger half of the arena, then furnishes it row by row.',
  factory: () => {
    let oppDist, myDist, plan = null; // plan: {dir, cells[]}
    return {
      move(s) {
        const g = C.geo(s.W, s.H), grid = s.grid, NB = g.NB;
        const me = C.cellOf(s, s.me), opp = C.cellOf(s, s.opp);
        if (!oppDist) { oppDist = new Int32Array(g.N); myDist = new Int32Array(g.N); }
        if (C.separated(g, grid, me, opp)) { plan = null; return C.fillerMove(g, grid, me, s.me.dir, { leafBudget: 40, maxDepth: 10 }); }
        const moves = C.freeMoves(g, grid, me, s.me.dir);
        if (moves.length <= 1) { plan = null; return moves.length ? moves[0] : s.me.dir; }
        C.distMap(g, grid, opp, oppDist);
        const safeFrom = (cell, step) => oppDist[cell] < 0 || oppDist[cell] > step;

        // follow the blueprint while it still holds
        if (plan) {
          while (plan.cells.length && plan.cells[0] === me) plan.cells.shift();
          const ok = plan.cells.length && NB[me * 4 + plan.dir] === plan.cells[0] &&
            plan.cells.every((c, i) => grid[c] === 0 && safeFrom(c, i + 1));
          if (ok) return plan.dir;
          plan = null;
        }

        // score each ray: territory after laying it, opponent given the same time
        const evalRay = (cells, end) => {
          for (const c of cells) grid[c] = 9;
          C.distMap(g, grid, end, myDist);
          C.distMap(g, grid, opp, oppDist);
          const L = cells.length;
          let mine = 0, theirs = 0;
          for (let i = 0; i < g.N; i++) {
            if (grid[i] !== 0) continue;
            const a = myDist[i] < 0 ? 1e9 : myDist[i] + L, b = oppDist[i] < 0 ? 1e9 : oppDist[i];
            if (a < b) mine++; else if (b < a) theirs++;
          }
          for (const c of cells) grid[c] = 0;
          C.distMap(g, grid, opp, oppDist); // restore
          return mine - theirs;
        };
        let best = null;
        for (const d of moves) {
          const cells = [];
          let c = me;
          for (let i = 1; i <= 40; i++) {
            const n = NB[c * 4 + d];
            if (n < 0 || grid[n] !== 0 || !safeFrom(n, i)) break;
            cells.push(n); c = n;
          }
          if (!cells.length) continue;
          // the whole ray, and a half-length version
          const lens = [...new Set([cells.length, Math.ceil(cells.length / 2), 1])];
          for (const L of lens) {
            const part = cells.slice(0, L);
            // the Architect loves a long wall: +0.6 per cell of commitment
            const sc = evalRay(part, part[L - 1]) + 0.6 * L;
            if (!best || sc > best.score) best = { score: sc, dir: d, cells: part };
          }
        }
        if (!best) return C.voronoiMinimax(g, grid, me, opp, s.me.dir, s.opp.dir).move;
        // sanity check against the immediate tactical picture
        const tac = C.voronoiMinimax(g, grid, me, opp, s.me.dir, s.opp.dir);
        if (tac.score > -1000) {
          const n = NB[me * 4 + best.dir];
          grid[n] = 9;
          let worst = Infinity;
          for (const od of C.freeMoves(g, grid, opp, s.opp.dir)) {
            const oc = NB[opp * 4 + od];
            grid[oc] = 8;
            const v = C.freeNeighbours(g, grid, n) === 0 ? -1e5 : C.voronoi(g, grid, n, oc);
            grid[oc] = 0;
            if (v < worst) worst = v;
          }
          grid[n] = 0;
          if (worst < tac.score - 60 || worst <= -1e5) return tac.move;
        }
        if (best.cells.length >= 4) plan = { dir: best.dir, cells: best.cells };
        return best.dir;
      },
    };
  },
};
