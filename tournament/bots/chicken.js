// Chicken: drives straight at the opponent's head and swerves at the last moment
// (gap <= 2, sometimes later). Once walled off from the opponent, fills space.
'use strict';
const { DX, DY, free, safeDirs, floodCount, distMap } = require('../lib');

// Safe options this tick: each {d, x, y, space, danger}. danger = the opponent
// could step into that cell this same tick (head-on). Danger moves are dropped
// when a non-danger move with comparable room exists.
function options(s) {
  const all = [];
  for (const d of safeDirs(s)) {
    const x = s.me.x + DX[d], y = s.me.y + DY[d];
    const danger = Math.abs(x - s.opp.x) + Math.abs(y - s.opp.y) === 1;
    all.push({ d, x, y, space: floodCount(s.grid, s.W, s.H, x, y), danger });
  }
  if (!all.length) return all;
  const top = Math.max(...all.map(o => o.space));
  const calm = all.filter(o => !o.danger && o.space >= top * 0.5);
  return calm.length ? calm : all;
}
function best(opts) { return opts.reduce((a, o) => (o.space > a.space ? o : a), opts[0]); }
function filled(s, x, y) {
  let n = 0;
  for (let d = 0; d < 4; d++) if (!free(s, x + DX[d], y + DY[d])) n++;
  return n;
}

module.exports = {
  name: 'Chicken',
  tagline: 'Bawk bawk... BAWK! (swerves)',
  color: '#ffffff',
  style: 'Daredevil',
  bio: 'Aims straight for the other rider\'s headlights and dares them to blink first. Usually swerves in time. Usually.',
  factory: () => {
    let nerve = 2; // swerve threshold, re-rolled each approach
    let approaching = false;
    return {
      move(s) {
        const all = [];
        for (const d of safeDirs(s)) {
          const x = s.me.x + DX[d], y = s.me.y + DY[d];
          all.push({ d, x, y, space: floodCount(s.grid, s.W, s.H, x, y),
            danger: Math.abs(x - s.opp.x) + Math.abs(y - s.opp.y) === 1 });
        }
        if (!all.length) return s.me.dir;
        const dm = distMap(s.grid, s.W, s.H, s.opp.x, s.opp.y);
        const dOf = o => dm[o.y * s.W + o.x];
        const connected = all.some(o => dOf(o) >= 0);
        const b = best(all);
        if (!connected) {
          // Opponent is walled off: fill sensibly (hug walls, keep space).
          let pick = null, ps = -1;
          for (const o of all) {
            if (o.space < b.space * 0.92 && o.space < b.space - 3) continue;
            const sc = filled(s, o.x, o.y) * 10000 + o.space * 2 + (o.d === s.me.dir ? 1 : 0);
            if (sc > ps) { ps = sc; pick = o; }
          }
          return pick.d;
        }
        const gap = Math.abs(s.me.x - s.opp.x) + Math.abs(s.me.y - s.opp.y);
        if (gap > 3) { approaching = false; }
        else if (!approaching) { approaching = true; nerve = s.rng() < 0.25 ? 1 : 2; }
        if (gap <= nerve) {
          // SWERVE to the safer side.
          const calm = all.filter(o => !o.danger);
          return best(calm.length ? calm : all).d;
        }
        // Charge: minimise BFS distance to the opponent's head, without suicide.
        let pick = null, ps = Infinity;
        for (const o of all) {
          if (o.space < b.space * 0.4) continue;
          const sc = dOf(o) * 10 - (o.d === s.me.dir ? 1 : 0);
          if (sc < ps) { ps = sc; pick = o; }
        }
        return (pick || b).d;
      },
    };
  },
};
