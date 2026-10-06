// Cinnamon Roll: traces a clockwise rectangle that tightens into an inward spiral.
// First heads for the nearest wall, then goes straight until blocked and turns right.
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
  name: 'Cinnamon Roll',
  tagline: 'Round and round, tighter and tighter, sweeter and sweeter.',
  color: '#d4a373',
  style: 'Spiral',
  bio: 'Believes the arena is a pastry and it is her job to roll it up. When the swirl breaks she sulks into whatever open space is left.',
  factory: () => {
    let reachedWall = false;
    return {
      move(s) {
        const opts = options(s);
        if (!opts.length) return s.me.dir;
        const b = best(opts);
        const ok = d => { const o = opts.find(o => o.d === d); return o && o.space >= b.space * 0.7 ? o : null; };
        const d = s.me.dir;
        let want;
        if (!reachedWall) {
          // Head for the nearest wall (excluding the way we came), then start rolling.
          const { x, y, } = s.me;
          const dist = [y, s.W - 1 - x, s.H - 1 - y, x];
          let bd = -1;
          for (let k = 0; k < 4; k++) if ((k + 2) % 4 !== d && (bd < 0 || dist[k] < dist[bd])) bd = k;
          want = bd;
          const nx = x + DX[d], ny = y + DY[d];
          if (!free(s, nx, ny) && want === d) reachedWall = true;
          if (!free(s, x + DX[want], y + DY[want])) { reachedWall = true; want = (want + 1) % 4; }
        }
        if (reachedWall) {
          // Straight until blocked, then clockwise.
          want = free(s, s.me.x + DX[d], s.me.y + DY[d]) ? d : (d + 1) % 4;
        }
        const o = ok(want) || (want === d ? ok((d + 1) % 4) : null);
        return o ? o.d : b.d;
      },
    };
  },
};
