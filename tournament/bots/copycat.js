// Copycat: mirrors the opponent's last move rotated 180 degrees (one tick behind).
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
  name: 'Copycat',
  tagline: 'Whatever you just did, I did it better. Upside down.',
  color: '#ff8c42',
  style: 'Mirror',
  bio: 'Studies the opponent\'s every move and repeats it in point-symmetric reflection, a beat late. When the mirror would crack, she quietly finds the biggest room.',
  factory: () => ({
    move(s) {
      const opts = options(s);
      if (!opts.length) return s.me.dir;
      const b = best(opts);
      const want = (s.opp.dir + 2) % 4;
      const o = opts.find(o => o.d === want);
      if (o && o.space >= b.space * 0.6) return o.d;
      return b.d;
    },
  }),
};
