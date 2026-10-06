// Scaredy Cat: runs as far (by BFS) from the opponent as it safely can. Panics sometimes.
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
  name: 'Scaredy Cat',
  tagline: 'If you can see me, I\'m already leaving.',
  color: '#ffe14d',
  style: 'Evasive',
  bio: 'Treats every opponent like a vacuum cleaner and bolts for the far corner. Every so often the nerves win and she dives into the nearest closet.',
  factory: () => ({
    move(s) {
      const opts = options(s);
      if (!opts.length) return s.me.dir;
      const b = best(opts);
      const dm = distMap(s.grid, s.W, s.H, s.opp.x, s.opp.y);
      const dOf = o => { const v = dm[o.y * s.W + o.x]; return v < 0 ? 999 : v; };
      const near = Math.min(...opts.map(dOf)) <= 5;
      if (near && opts.length > 1 && s.rng() < 0.06) {
        // PANIC: hide in the smallest hole available.
        return opts.reduce((a, o) => (o.space < a.space ? o : a), opts[0]).d;
      }
      let pick = null, ps = -Infinity;
      for (const o of opts) {
        if (o.space < b.space * 0.75) continue;
        const sc = Math.min(dOf(o), 60) * 1000 + o.space;
        if (sc > ps) { ps = sc; pick = o; }
      }
      return pick.d;
    },
  }),
};
