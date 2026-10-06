// Shared helpers for bots. All functions treat grid as Uint8Array(W*H), 0 = empty.
'use strict';
const { DX, DY } = require('./engine');

function free(s, x, y) {
  return x >= 0 && y >= 0 && x < s.W && y < s.H && s.grid[y * s.W + x] === 0;
}

// Directions that don't immediately crash (ignores the other bot's next move).
function safeDirs(s, p = s.me) {
  const out = [];
  for (let d = 0; d < 4; d++) {
    if ((d + 2) % 4 === p.dir) continue;
    if (free(s, p.x + DX[d], p.y + DY[d])) out.push(d);
  }
  return out;
}

// Number of empty cells reachable from (x,y) (not counting (x,y) itself unless empty).
function floodCount(grid, W, H, x, y, limit = Infinity) {
  if (x < 0 || y < 0 || x >= W || y >= H || grid[y * W + x] !== 0) return 0;
  const seen = new Uint8Array(W * H);
  const q = new Int32Array(W * H);
  let h = 0, t = 0;
  q[t++] = y * W + x; seen[y * W + x] = 1;
  while (h < t && t < limit) {
    const c = q[h++], cx = c % W, cy = (c / W) | 0;
    for (let d = 0; d < 4; d++) {
      const nx = cx + DX[d], ny = cy + DY[d];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = ny * W + nx;
      if (seen[n] || grid[n] !== 0) continue;
      seen[n] = 1; q[t++] = n;
    }
  }
  return t;
}

// BFS distance map from (x,y) through empty cells. Start cell gets 0 even if occupied.
function distMap(grid, W, H, x, y) {
  const dist = new Int32Array(W * H).fill(-1);
  const q = new Int32Array(W * H);
  let h = 0, t = 0;
  dist[y * W + x] = 0; q[t++] = y * W + x;
  while (h < t) {
    const c = q[h++], cx = c % W, cy = (c / W) | 0;
    for (let d = 0; d < 4; d++) {
      const nx = cx + DX[d], ny = cy + DY[d];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = ny * W + nx;
      if (dist[n] !== -1 || grid[n] !== 0) continue;
      dist[n] = dist[c] + 1; q[t++] = n;
    }
  }
  return dist;
}

// Voronoi split: cells strictly closer to a vs b. Returns {a, b, separated}.
function voronoi(grid, W, H, ax, ay, bx, by) {
  const da = distMap(grid, W, H, ax, ay), db = distMap(grid, W, H, bx, by);
  let a = 0, b = 0, separated = true;
  for (let i = 0; i < W * H; i++) {
    if (grid[i] !== 0) continue;
    const x = da[i], y = db[i];
    if (x >= 0 && y >= 0) separated = false;
    if (x >= 0 && (y < 0 || x < y)) a++;
    else if (y >= 0 && (x < 0 || y < x)) b++;
  }
  return { a, b, separated, da, db };
}

function manhattan(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }

module.exports = { DX, DY, free, safeDirs, floodCount, distMap, voronoi, manhattan };
