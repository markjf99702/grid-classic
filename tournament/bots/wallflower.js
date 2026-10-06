// Wallflower: hugs walls and trails, but never gives up much reachable space.
'use strict';
const { DX, DY, free, safeDirs, floodCount } = require('../lib');

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
  name: 'Wallflower',
  tagline: 'Personal space is a myth. Walls are forever.',
  color: '#7bff6b',
  style: 'Hugger',
  bio: 'Shy in the open, she presses herself against every wall and trail she can find. The result is a tidy, wasteless fill that bores opponents to death.',
  factory: () => ({
    move(s) {
      const opts = options(s);
      if (!opts.length) return s.me.dir;
      const b = best(opts);
      let pick = null, ps = -1;
      for (const o of opts) {
        if (o.space < b.space * 0.92 && o.space < b.space - 3) continue;
        // more filled neighbours better; tiebreak: space, then straight
        const sc = filled(s, o.x, o.y) * 10000 + o.space * 2 + (o.d === s.me.dir ? 1 : 0);
        if (sc > ps) { ps = sc; pick = o; }
      }
      return pick.d;
    },
  }),
};
