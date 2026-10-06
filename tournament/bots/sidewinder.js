// Sidewinder: zigzags (staircase of alternating turns) toward the most open quadrant.
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

// Pick a pair of perpendicular directions [a, b] pointing into the emptiest quadrant.
function pickQuadrant(s) {
  const c = [0, 0, 0, 0]; // quadrants: up-right, right-down, down-left, left-up (a = k, b = k+1)
  const { x: mx, y: my } = s.me;
  for (let y = 0; y < s.H; y++) for (let x = 0; x < s.W; x++) {
    if (s.grid[y * s.W + x] !== 0) continue;
    const up = y < my, rt = x > mx, dn = y > my, lt = x < mx;
    const w = 1 / (1 + Math.abs(x - mx) + Math.abs(y - my)) ** 0.5;
    if (up && rt) c[0] += w; if (rt && dn) c[1] += w; if (dn && lt) c[2] += w; if (lt && up) c[3] += w;
  }
  let k = 0;
  for (let i = 1; i < 4; i++) if (c[i] > c[k]) k = i;
  return [k, (k + 1) % 4];
}

module.exports = {
  name: 'Sidewinder',
  tagline: 'Never the straight answer. Always gets there.',
  color: '#f4a261',
  style: 'Zigzag',
  bio: 'Slithers across the grid in neat little staircases, hissing at anyone who suggests a straight line. Surprisingly hard to pin down.',
  factory: (ctx) => {
    let pair = null, leg = 0, legLen = 3, useA = true;
    return {
      move(s) {
        const opts = options(s);
        if (!opts.length) return s.me.dir;
        const b = best(opts);
        if (!pair) pair = pickQuadrant(s);
        if (leg >= legLen) { leg = 0; useA = !useA; legLen = 2 + Math.floor(s.rng() * 3); }
        let want = useA ? pair[0] : pair[1];
        if ((want + 2) % 4 === s.me.dir) want = useA ? pair[1] : pair[0];
        let o = opts.find(o => o.d === want);
        if (!o || o.space < b.space * 0.7) {
          // Hit something: re-aim and try the other leg first.
          pair = pickQuadrant(s); useA = !useA; leg = 0;
          want = useA ? pair[0] : pair[1];
          o = opts.find(o => o.d === want);
          if (!o || o.space < b.space * 0.7) {
            want = useA ? pair[1] : pair[0];
            o = opts.find(o => o.d === want);
            if (!o || o.space < b.space * 0.7) o = b;
          }
        }
        leg++;
        return o.d;
      },
    };
  },
};
