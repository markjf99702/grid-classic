// Lefty Lucy: left-hand wall follower. Left if possible, else straight, else right.
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
  name: 'Lefty Lucy',
  tagline: 'Always left. Never right. Rarely wrong.',
  color: '#ff4fd8',
  style: 'Southpaw',
  bio: 'Keeps her left hand on the wall like she\'s escaping a hedge maze at a county fair. She will turn right, but only under protest.',
  factory: () => ({
    move(s) {
      const opts = options(s);
      if (!opts.length) return s.me.dir;
      const b = best(opts);
      const d = s.me.dir;
      for (const want of [(d + 3) % 4, d, (d + 1) % 4]) {
        const o = opts.find(o => o.d === want);
        if (o && o.space >= b.space * 0.6) return o.d;
      }
      return b.d;
    },
  }),
};
