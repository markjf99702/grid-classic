// Bloodhound: predicts where the opponent is heading, races to a cell on that
// path it can reach first, and cuts across their bows. Space filler once alone.
'use strict';
const C = require('./_shared/cycle-core');

// Predict the opponent's next `k` cells: straight until blocked, then turn
// toward the side with more room (a common habit of most bots).
function predictPath(g, grid, opp, dir, k) {
  const path = [], placed = [];
  let c = opp, d = dir;
  for (let t = 0; t < k; t++) {
    let n = g.NB[c * 4 + d];
    if (n < 0 || grid[n] !== 0) {
      let best = -1, bv = -1;
      for (const nd of [(d + 1) % 4, (d + 3) % 4]) {
        const m = g.NB[c * 4 + nd];
        if (m < 0 || grid[m] !== 0) continue;
        grid[m] = 9; const v = C.flood(g, grid, m, 300); grid[m] = 0;
        if (v > bv) { bv = v; best = nd; }
      }
      if (best < 0) break;
      d = best; n = g.NB[c * 4 + d];
    }
    path.push(n); grid[n] = 9; placed.push(n); c = n;
  }
  for (const p of placed) grid[p] = 0;
  return path;
}

module.exports = {
  name: 'Bloodhound',
  tagline: 'I can smell where you are going.',
  color: '#ff4d6d',
  style: 'Interceptor',
  bio: 'Never looks at where you are, only at where you will be. Sprints for the cell in front of your nose and slams the door, then sniffs out every last corner of what is left.',
  factory: () => {
    let myDist = null, tgtDist = null;
    return {
      move(s) {
        const g = C.geo(s.W, s.H), grid = s.grid;
        const me = C.cellOf(s, s.me), opp = C.cellOf(s, s.opp);
        if (!myDist) { myDist = new Int32Array(g.N); tgtDist = new Int32Array(g.N); }
        if (C.separated(g, grid, me, opp)) return C.fillerMove(g, grid, me, s.me.dir, { leafBudget: 30, maxDepth: 8 });
        const moves = C.freeMoves(g, grid, me, s.me.dir);
        if (moves.length <= 1) return moves.length ? moves[0] : s.me.dir;

        // room check: never take a move that leaves far less space than the best
        const room = {}; let maxRoom = 0;
        const oppNext = new Set();
        for (let d = 0; d < 4; d++) { const n = g.NB[opp * 4 + d]; if (n >= 0 && grid[n] === 0) oppNext.add(n); }
        for (const d of moves) {
          const n = g.NB[me * 4 + d];
          grid[n] = 9; room[d] = C.flood(g, grid, n); grid[n] = 0;
          if (room[d] > maxRoom) maxRoom = room[d];
        }
        let cand = moves.filter(d => room[d] >= maxRoom * 0.75 && !oppNext.has(g.NB[me * 4 + d]));
        if (!cand.length) cand = moves.filter(d => room[d] === maxRoom);

        // find the earliest point on their predicted path that we reach first
        const path = predictPath(g, grid, opp, s.opp.dir, 25);
        C.distMap(g, grid, me, myDist);
        let target = -1;
        for (let t = 1; t < path.length; t++) {
          const md = myDist[path[t]];
          if (md > 0 && md < t + 1) { target = path[t]; break; }
        }
        if (target < 0) target = path.length ? path[Math.min(path.length - 1, 2)] : opp;
        C.distMap(g, grid, target, tgtDist);
        // tgtDist from the target: the cell we step to should be closer to it
        let best = cand[0], bv = Infinity;
        for (const d of cand) {
          const n = g.NB[me * 4 + d];
          let v = n === target ? 0 : tgtDist[n] < 0 ? 999 : tgtDist[n];
          v -= room[d] / 10000; // tiny tie-break toward space
          if (v < bv || (v === bv && d === s.me.dir)) { bv = v; best = d; }
        }
        return best;
      },
    };
  },
};
