// Shared engine-room for the strategic bots (Spacey, The Professor, Bloodhound,
// The Guillotine, Gambler, Deep Cycle, The Architect). Not a bot itself: it
// lives in a subfolder so tournament loaders that scan bots/*.js skip it.
//
// Cells are flat indices c = y*W + x. NB[c*4+d] is the neighbour in direction d
// (0 up, 1 right, 2 down, 3 left) or -1 off-board. All searches mutate the
// grid in place and undo, and use stamp-based visited arrays (no clearing).
'use strict';

const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
const WIN = 1e6, LOSS = -1e6;

let G = null;
function geo(W, H) {
  if (G && G.W === W && G.H === H) return G;
  const N = W * H;
  const NB = new Int32Array(N * 4);
  const color = new Uint8Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = y * W + x;
    color[c] = (x + y) & 1;
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d], ny = y + DY[d];
      NB[c * 4 + d] = nx < 0 || ny < 0 || nx >= W || ny >= H ? -1 : ny * W + nx;
    }
  }
  G = {
    W, H, N, NB, color,
    mark: new Int32Array(N), stamp: 1,
    mark2: new Int32Array(N), stamp2: 1,
    owner: new Uint8Array(N), dist: new Int32Array(N),
    qa: new Int32Array(N), qb: new Int32Array(N),
    // Tarjan buffers
    num: new Int32Array(N), low: new Int32Array(N), isAP: new Int32Array(N),
    stC: new Int32Array(N), stD: new Int8Array(N), par: new Int32Array(N),
  };
  return G;
}
function nextStamp(g) { if (++g.stamp > 2e9) { g.mark.fill(0); g.stamp = 1; } return g.stamp; }
function nextStamp2(g) { if (++g.stamp2 > 2e9) { g.mark2.fill(0); g.stamp2 = 1; } return g.stamp2; }

// Free neighbours of c, optionally excluding reverse of dir.
function freeMoves(g, grid, c, dir = -1) {
  const out = [];
  for (let d = 0; d < 4; d++) {
    if (dir >= 0 && (d + 2) % 4 === dir) continue;
    const n = g.NB[c * 4 + d];
    if (n >= 0 && grid[n] === 0) out.push(d);
  }
  return out;
}

function freeNeighbours(g, grid, c) {
  let k = 0;
  for (let d = 0; d < 4; d++) { const n = g.NB[c * 4 + d]; if (n >= 0 && grid[n] === 0) k++; }
  return k;
}

// Count free cells reachable from start (start itself may be occupied: it is the
// BFS seed but not counted). Sets g.lastB / g.lastW colour counts.
function flood(g, grid, start, limit = 1e9) {
  const st = nextStamp(g), { NB, mark, qa, color } = g;
  let h = 0, t = 0, b = 0, w = 0;
  mark[start] = st; qa[t++] = start;
  while (h < t) {
    const c = qa[h++];
    for (let d = 0; d < 4; d++) {
      const n = NB[c * 4 + d];
      if (n < 0 || grid[n] !== 0 || mark[n] === st) continue;
      mark[n] = st; qa[t++] = n;
      if (color[n]) b++; else w++;
      if (b + w >= limit) { g.lastB = b; g.lastW = w; return b + w; }
    }
  }
  g.lastB = b; g.lastW = w;
  return b + w;
}

// Parity-aware upper bound on how many moves can be made in a region when the
// head (on colour headColor) enters it: you alternate colours each move.
function parityMoves(b, w, headColor) {
  // first cell entered has colour 1-headColor
  const first = headColor ? w : b, second = headColor ? b : w;
  if (first > second) return 2 * second + 1;
  return 2 * first;
}

// Simultaneous-BFS Voronoi. Returns my-territory minus opp-territory; sets
// g.vA, g.vB, g.sep (true when no shared reachable region).
function voronoi(g, grid, a, b) {
  const st = nextStamp(g), { NB, mark, owner, dist, qa, qb } = g;
  let ha = 0, ta = 0, hb = 0, tb = 0, ca = 0, cb = 0, sep = true, level = 0;
  mark[a] = st; owner[a] = 1; dist[a] = 0; qa[ta++] = a;
  mark[b] = st; owner[b] = 2; dist[b] = 0; qb[tb++] = b;
  while (ha < ta || hb < tb) {
    level++;
    const ea = ta;
    for (; ha < ea; ha++) {
      const c = qa[ha];
      if (owner[c] === 3) continue;
      const base = c * 4;
      for (let d = 0; d < 4; d++) {
        const n = NB[base + d];
        if (n < 0 || grid[n] !== 0) continue;
        if (mark[n] === st) { if (owner[n] !== 1) sep = false; continue; }
        mark[n] = st; owner[n] = 1; dist[n] = level; qa[ta++] = n; ca++;
      }
    }
    const eb = tb;
    for (; hb < eb; hb++) {
      const c = qb[hb];
      const base = c * 4;
      for (let d = 0; d < 4; d++) {
        const n = NB[base + d];
        if (n < 0 || grid[n] !== 0) continue;
        if (mark[n] === st) {
          if (owner[n] === 1) { sep = false; if (dist[n] === level) { owner[n] = 3; ca--; } }
          else if (owner[n] === 3) sep = false;
          continue;
        }
        mark[n] = st; owner[n] = 2; dist[n] = level; qb[tb++] = n; cb++;
      }
    }
  }
  g.vA = ca; g.vB = cb; g.sep = sep;
  return ca - cb;
}

// Is b's head reachable (adjacent to a cell reachable) from a? Cheap separation test.
function separated(g, grid, a, b) {
  const st = nextStamp(g), { NB, mark, qa } = g;
  let h = 0, t = 0;
  mark[a] = st; qa[t++] = a;
  while (h < t) {
    const c = qa[h++];
    for (let d = 0; d < 4; d++) {
      const n = NB[c * 4 + d];
      if (n === b) return false;
      if (n < 0 || grid[n] !== 0 || mark[n] === st) continue;
      mark[n] = st; qa[t++] = n;
    }
  }
  return true;
}

// BFS distances from c through free cells into g.dist-like caller array.
function distMap(g, grid, start, out) {
  out.fill(-1);
  const { NB, qa } = g;
  let h = 0, t = 0;
  out[start] = 0; qa[t++] = start;
  while (h < t) {
    const c = qa[h++];
    for (let d = 0; d < 4; d++) {
      const n = NB[c * 4 + d];
      if (n < 0 || grid[n] !== 0 || out[n] !== -1) continue;
      out[n] = out[c] + 1; qa[t++] = n;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Chamber heuristic: estimate how many moves a lone bot at `start` can make.
// Find articulation points of the free region (Tarjan, rooted at the head),
// then walk "chambers" (regions bounded by articulation points): value =
// parity-capped chamber size + best value among the chambers beyond its exits.
function fillEstimate(g, grid, start) {
  const { NB, num, low, isAP, stC, stD, par, mark } = g;
  const st = nextStamp(g);
  // iterative Tarjan
  let counter = 0, sp = 0;
  mark[start] = st; num[start] = low[start] = ++counter; isAP[start] = 0; par[start] = -1;
  stC[sp] = start; stD[sp] = 0; sp++;
  while (sp > 0) {
    const c = stC[sp - 1], d = stD[sp - 1];
    if (d < 4) {
      stD[sp - 1] = d + 1;
      const n = NB[c * 4 + d];
      if (n < 0 || grid[n] !== 0) continue;
      if (mark[n] !== st) {
        mark[n] = st; num[n] = low[n] = ++counter; isAP[n] = 0; par[n] = c;
        stC[sp] = n; stD[sp] = 0; sp++;
      } else if (n !== par[c]) {
        if (num[n] < low[c]) low[c] = num[n];
      }
    } else {
      sp--;
      const p = par[c];
      if (p >= 0) {
        if (low[c] < low[p]) low[p] = low[c];
        if (p !== start && low[c] >= num[p]) isAP[p] = st;
      }
    }
  }
  // chamber walk with second stamp
  const st2 = nextStamp2(g);
  g._st = st; g._st2 = st2;
  g.mark2[start] = st2;
  let best = 0;
  for (let d = 0; d < 4; d++) {
    const n = NB[start * 4 + d];
    if (n < 0 || grid[n] !== 0 || g.mark2[n] === st2) continue;
    const v = chamberFrom(g, grid, n, g.color[start]);
    if (v > best) best = v;
  }
  return best;
}

// Value of entering cell `entry` (counted) when the previous cell had colour pc.
// Uses g.qb as a stack-allocated queue: each call floods into [qp, ...).
function chamberFrom(g, grid, entry, pc, qp = 0) {
  const { NB, mark2, isAP, color, qb } = g;
  const st = g._st, st2 = g._st2;
  if (isAP[entry] === st) {
    // a doorway: step on it, then pick the best side
    mark2[entry] = st2;
    let best = 0;
    for (let d = 0; d < 4; d++) {
      const n = NB[entry * 4 + d];
      if (n < 0 || grid[n] !== 0 || mark2[n] === st2) continue;
      const v = chamberFrom(g, grid, n, color[entry], qp);
      if (v > best) best = v;
    }
    return 1 + best;
  }
  // flood the chamber without crossing articulation points
  let h = qp, t = qp;
  qb[t++] = entry;
  mark2[entry] = st2;
  let b = 0, w = 0, doors = null;
  while (h < t) {
    const c = qb[h++];
    if (color[c]) b++; else w++;
    const base = c * 4;
    for (let d = 0; d < 4; d++) {
      const n = NB[base + d];
      if (n < 0 || grid[n] !== 0 || mark2[n] === st2) continue;
      mark2[n] = st2;
      if (isAP[n] === st) { (doors || (doors = [])).push(n); continue; }
      qb[t++] = n;
    }
  }
  const size = parityMoves(b, w, pc);
  if (!doors) return size;
  let bestDoor = 0;
  for (const dc of doors) {
    let bd = 0;
    for (let d = 0; d < 4; d++) {
      const n = NB[dc * 4 + d];
      if (n < 0 || grid[n] !== 0 || mark2[n] === st2) continue;
      const v = chamberFrom(g, grid, n, color[dc], t);
      if (v > bd) bd = v;
    }
    if (1 + bd > bestDoor) bestDoor = 1 + bd;
  }
  // Either fill this chamber completely, or pass through it into a door
  // (a1k0n-style: assume most of the chamber can still be used on the way).
  return Math.max(size, size - 1 + bestDoor);
}

// ---------------------------------------------------------------------------
// Separated endgame: maximise moves survived. DFS over my own moves with a
// leaf-evaluation budget, chamber heuristic at the leaves, wall-hug tie-break.
function fillerMove(g, grid, head, dir, opts = {}) {
  const leafBudget = opts.leafBudget || 60;
  const maxDepth = opts.maxDepth || 12;
  const useChamber = opts.chamber !== false;
  const moves = freeMoves(g, grid, head, dir);
  if (moves.length === 0) return dir;
  if (moves.length === 1) return moves[0];
  let leaves = 0;
  const leafEval = c => { leaves++; return useChamber ? fillEstimate(g, grid, c) : (flood(g, grid, c), parityMoves(g.lastB, g.lastW, g.color[c])); };
  function dfs(c, depth) {
    if (depth === 0 || leaves >= leafBudget) return leafEval(c);
    let best = 0, any = false;
    for (let d = 0; d < 4; d++) {
      const n = g.NB[c * 4 + d];
      if (n < 0 || grid[n] !== 0) continue;
      any = true;
      grid[n] = 9;
      const v = 1 + dfs(n, depth - 1);
      grid[n] = 0;
      if (v > best) best = v;
    }
    return any ? best : 0;
  }
  let bestMove = moves[0], scores = null;
  for (let depth = 0; depth <= maxDepth; depth++) {
    const startLeaves = leaves;
    const sc = [];
    let aborted = false;
    for (const d of moves) {
      const n = g.NB[head * 4 + d];
      grid[n] = 9;
      const v = dfs(n, depth);
      grid[n] = 0;
      sc.push(v);
      if (leaves >= leafBudget && depth > 0) { aborted = true; break; }
    }
    if (aborted) break;
    scores = sc;
    if (leaves - startLeaves === 0) break;
    if (leaves >= leafBudget) break;
  }
  // pick best, tie-break: hug walls (fewest free neighbours), then straight
  let bestV = -1, bestHug = 9;
  for (let i = 0; i < moves.length; i++) {
    const d = moves[i], n = g.NB[head * 4 + d];
    const v = scores[i];
    grid[n] = 9;
    const hug = freeNeighbours(g, grid, n) + (d === dir ? -0.5 : 0);
    grid[n] = 0;
    if (v > bestV || (v === bestV && hug < bestHug)) { bestV = v; bestHug = hug; bestMove = d; }
  }
  return bestMove;
}

// Simple greedy filler (for weaker bots): most reachable space, hug walls.
function greedyFill(g, grid, head, dir) {
  const moves = freeMoves(g, grid, head, dir);
  if (!moves.length) return dir;
  let best = moves[0], bv = -1, bh = 9;
  for (const d of moves) {
    const n = g.NB[head * 4 + d];
    grid[n] = 9;
    const v = flood(g, grid, n);
    const hug = freeNeighbours(g, grid, n) + (d === dir ? -0.5 : 0);
    grid[n] = 0;
    if (v > bv || (v === bv && hug < bh)) { bv = v; bh = hug; best = d; }
  }
  return best;
}

// 2-ply (simultaneous) Voronoi minimax: maximise over my moves the worst case
// over opponent replies. evalFn(myCell, oppCell) defaults to Voronoi diff.
function voronoiMinimax(g, grid, me, opp, meDir, oppDir, evalFn) {
  const ev = evalFn || ((a, b) => {
    const v = voronoi(g, grid, a, b);
    if (g.sep) { // separated: compare fill sizes
      const fa = flood(g, grid, a), fb = flood(g, grid, b);
      return fa > fb ? 5000 + fa - fb : fa < fb ? -5000 + fa - fb : -50;
    }
    return v;
  });
  const myMoves = freeMoves(g, grid, me, meDir);
  const opMoves = freeMoves(g, grid, opp, oppDir);
  if (!myMoves.length) return { move: meDir, score: LOSS };
  let best = myMoves[0], bestV = -Infinity;
  for (const md of myMoves) {
    const mc = g.NB[me * 4 + md];
    let worst = Infinity;
    if (!opMoves.length) worst = WIN;
    for (const od of opMoves) {
      const oc = g.NB[opp * 4 + od];
      let v;
      if (oc === mc) v = -400;
      else {
        grid[mc] = 7; grid[oc] = 8;
        const myOut = freeNeighbours(g, grid, mc), opOut = freeNeighbours(g, grid, oc);
        if (myOut === 0 && opOut === 0) v = -400;
        else if (myOut === 0) v = LOSS / 2;
        else if (opOut === 0) v = WIN / 2;
        else v = ev(mc, oc, md, od);
        grid[mc] = 0; grid[oc] = 0;
      }
      if (v < worst) worst = v;
      if (worst < bestV) break;
    }
    if (worst > bestV || (worst === bestV && md === meDir)) { bestV = worst; best = md; }
  }
  return { move: best, score: bestV };
}

// Chamber-aware Voronoi: after the territory split, estimate how many moves
// each bot can really make inside its own territory (articulation points mean
// you cannot use both sides of a corridor). Returns estA - estB, sets g.sep.
let maskA = null, maskB = null;
function voronoiChamber(g, grid, a, b) {
  const diff = voronoi(g, grid, a, b);
  const sep = g.sep, vA = g.vA, vB = g.vB;
  if (!maskA || maskA.length !== g.N) { maskA = new Uint8Array(g.N); maskB = new Uint8Array(g.N); }
  const st = g.stamp, { mark, owner } = g, N = g.N;
  for (let i = 0; i < N; i++) {
    if (grid[i] !== 0 || mark[i] !== st) { maskA[i] = 1; maskB[i] = 1; continue; }
    const o = owner[i];
    maskA[i] = o === 2 ? 1 : 0; maskB[i] = o === 1 ? 1 : 0;
  }
  const ea = fillEstimate(g, maskA, a), eb = fillEstimate(g, maskB, b);
  g.sep = sep; g.vA = vA; g.vB = vB; g.chA = ea; g.chB = eb;
  return ea - eb;
}

function cellOf(s, p) { return p.y * s.W + p.x; }

module.exports = {
  DX, DY, WIN, LOSS, geo, freeMoves, freeNeighbours, flood, parityMoves, voronoi,
  separated, distMap, fillEstimate, voronoiChamber, fillerMove, greedyFill, voronoiMinimax, cellOf,
};
