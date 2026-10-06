// Light-cycle arena engine. Two bots move simultaneously on a grid; any
// move into a wall, a trail, or the same cell as the other bot crashes.
'use strict';

const W = 40, H = 30;
const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0]; // 0 up, 1 right, 2 down, 3 left

// Cell values: 0 empty, 1 trail of p0, 2 trail of p1, 3 wall.
const MAPS = {
  'Open Grid': () => [],
  'Pillars': () => {
    const c = [];
    for (const [px, py] of [[13, 8], [26, 8], [13, 21], [26, 21], [19, 14]])
      for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) c.push([px + dx, py + dy]);
    return c;
  },
  'The Divide': () => {
    const c = [];
    for (let y = 0; y < H; y++) if (y < 11 || y > 18) { c.push([19, y]); c.push([20, y]); }
    return c;
  },
  'Crossroads': () => {
    const c = [];
    for (let x = 6; x < 34; x++) if (x < 16 || x > 23) { c.push([x, 6]); c.push([W - 1 - x, H - 1 - 6]); }
    for (let y = 4; y < 26; y++) if (y < 11 || y > 18) { c.push([6, y]); c.push([W - 1 - 6, H - 1 - y]); }
    return c;
  },
};

// Classic starting positions; startFor() varies them per seed so repeated
// meetings between deterministic bots aren't carbon copies.
const START = [{ x: 9, y: 14, dir: 1 }, { x: W - 1 - 9, y: H - 1 - 14, dir: 3 }];

// Starts are always 180° rotations of each other, so every game is fair.
function startFor(mapName, seed) {
  const grid = makeGrid(mapName);
  const rng = mulberry32(Math.imul(seed + 0x5bd1e995, 2654435761) >>> 0); rng(); rng();
  const ok = (x, y) => x >= 0 && y >= 0 && x < W && y < H && grid[y * W + x] === 0 && grid[(H - 1 - y) * W + (W - 1 - x)] === 0;
  for (let tries = 0; tries < 500; tries++) {
    const x = 4 + Math.floor(rng() * 13), y = 4 + Math.floor(rng() * (H - 8));
    const dir = Math.floor(rng() * 4);
    let clear = ok(x, y);
    for (let k = 1; k <= 4 && clear; k++) clear = ok(x + DX[dir] * k, y + DY[dir] * k) && x + DX[dir] * k < W / 2 - 1;
    if (clear) return [{ x, y, dir }, { x: W - 1 - x, y: H - 1 - y, dir: (dir + 2) % 4 }];
  }
  return START.map(s => ({ ...s }));
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeGrid(mapName) {
  const g = new Uint8Array(W * H);
  for (const [x, y] of MAPS[mapName]()) g[y * W + x] = 3;
  return g;
}

// Play one game. bots = [factoryA, factoryB]; each factory returns {move(state)}.
// Returns {winner: 0|1|-1 (draw), ticks, moves: [[d0,d1],...], reason}.
function playGame(botFactories, mapName, seed) {
  const grid = makeGrid(mapName);
  const pos = startFor(mapName, seed);
  const start = pos.map(p => ({ ...p }));
  pos.forEach((p, i) => { grid[p.y * W + p.x] = i + 1; });
  const rngs = [mulberry32(seed * 2 + 1), mulberry32(seed * 2 + 2)];
  const bots = botFactories.map((f, i) => f({ W, H, me: i, rng: rngs[i] }));
  const moves = [];
  const timeUsed = [0, 0];
  for (let tick = 0; tick < W * H; tick++) {
    const dirs = [0, 1].map(i => {
      const me = pos[i], opp = pos[1 - i];
      const view = grid.slice();
      const t0 = process.hrtime.bigint();
      let d;
      try {
        d = bots[i].move({
          grid: view, W, H, tick,
          me: { x: me.x, y: me.y, dir: me.dir }, opp: { x: opp.x, y: opp.y, dir: opp.dir },
          meId: i + 1, oppId: 2 - i, rng: rngs[i],
        });
      } catch (e) { d = me.dir; }
      timeUsed[i] += Number(process.hrtime.bigint() - t0) / 1e6;
      if (!(d >= 0 && d <= 3) || (d + 2) % 4 === me.dir) d = me.dir; // illegal or reverse: keep going
      return d | 0;
    });
    moves.push(dirs);
    const nx = pos.map((p, i) => ({ x: p.x + DX[dirs[i]], y: p.y + DY[dirs[i]], dir: dirs[i] }));
    const dead = nx.map(n => n.x < 0 || n.y < 0 || n.x >= W || n.y >= H || grid[n.y * W + n.x] !== 0);
    if (nx[0].x === nx[1].x && nx[0].y === nx[1].y) { dead[0] = dead[1] = true; }
    nx.forEach((n, i) => { if (!dead[i]) grid[n.y * W + n.x] = i + 1; });
    pos[0] = nx[0]; pos[1] = nx[1];
    if (dead[0] || dead[1]) {
      const winner = dead[0] && dead[1] ? -1 : dead[0] ? 1 : 0;
      const headOn = nx[0].x === nx[1].x && nx[0].y === nx[1].y;
      return { winner, ticks: tick + 1, moves, reason: headOn ? 'head-on' : 'crash', timeUsed, start };
    }
  }
  return { winner: -1, ticks: W * H, moves, reason: 'timeout', timeUsed, start };
}

module.exports = { W, H, DX, DY, MAPS, START, startFor, playGame, makeGrid, mulberry32 };
