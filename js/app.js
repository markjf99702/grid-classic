// Grid Classic: the broadcast page for a light-cycle bot tournament.
// Replays any stored game with generated commentary, draws the bracket, tables and awards,
// lets you ride against any bot, and plays brand-new dream matches between any two.
// DATA and COPY come from js/data.js, the bots' code from js/bots.js; tournament/build.js writes both.
import { DATA, COPY } from './data.js';
import { BOTS } from './bots.js';

const { W, H } = DATA;
const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
const $ = id => document.getElementById(id);
const bot = Object.fromEntries(DATA.bots.map(b => [b.slug, b]));
const row = Object.fromEntries(DATA.standings.map(t => [t.slug, t]));
const games = DATA.games;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nameOf = s => bot[s].name;
const dot = s => `<span class="dot" style="background:${bot[s].color}"></span>`;
const hl = Object.fromEntries((COPY.highlights || []).map(h => [h.g, h]));

// ---------- map geometry (mirrors engine.js)
function mapCells(name) {
  const c = [];
  if (name === 'Pillars') for (const [px, py] of [[13, 8], [26, 8], [13, 21], [26, 21], [19, 14]])
    for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) c.push([px + dx, py + dy]);
  if (name === 'The Divide') for (let y = 0; y < H; y++) if (y < 11 || y > 18) { c.push([19, y]); c.push([20, y]); }
  if (name === 'Crossroads') {
    for (let x = 6; x < 34; x++) if (x < 16 || x > 23) { c.push([x, 6]); c.push([W - 1 - x, H - 1 - 6]); }
    for (let y = 4; y < 26; y++) if (y < 11 || y > 18) { c.push([6, y]); c.push([W - 1 - 6, H - 1 - y]); }
  }
  return c;
}

// Replays a game into per-tick frames: head positions + alive flags, and analysis.
function simulate(g) {
  const grid = new Uint8Array(W * H);
  for (const [x, y] of mapCells(g.map)) grid[y * W + x] = 3;
  let pos = [{ x: g.s[0], y: g.s[1], dir: g.s[2] }, { x: W - 1 - g.s[0], y: H - 1 - g.s[1], dir: (g.s[2] + 2) % 4 }];
  pos.forEach((p, i) => grid[p.y * W + p.x] = i + 1);
  const heads = [pos.map(p => ({ ...p }))], mom = [50], gaps = [99];
  let sep = null, death = null;
  for (let t = 0; t < g.moves.length; t++) {
    const c = g.moves.charCodeAt(t) - 97, d = [c >> 2, c & 3];
    const nx = pos.map((p, i) => ({ x: p.x + DX[d[i]], y: p.y + DY[d[i]], dir: d[i] }));
    const hit = nx.map(n => n.x < 0 || n.y < 0 || n.x >= W || n.y >= H ? 'wall' : grid[n.y * W + n.x]);
    const same = nx[0].x === nx[1].x && nx[0].y === nx[1].y;
    const alive = hit.map(h => h === 0 && !same);
    nx.forEach((n, i) => { if (alive[i]) grid[n.y * W + n.x] = i + 1; });
    heads.push(nx.map((n, i) => ({ ...n, alive: alive[i] })));
    pos = nx;
    if (!alive[0] || !alive[1]) { death = { tick: t + 1, hit, same, alive }; mom.push(mom[mom.length - 1]); gaps.push(0); break; }
    const v = voronoi(grid, pos);
    mom.push(v.a + v.b ? Math.round(100 * v.a / (v.a + v.b)) : 50);
    gaps.push(Math.abs(pos[0].x - pos[1].x) + Math.abs(pos[0].y - pos[1].y));
    if (!sep && v.separated) sep = { tick: t + 1, cells: [v.a, v.b] };
  }
  return { heads, mom, gaps, sep, death };
}
function bfs(grid, x, y) {
  const dist = new Int16Array(W * H).fill(-1), q = new Int32Array(W * H);
  let h = 0, t = 0; dist[y * W + x] = 0; q[t++] = y * W + x;
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
function voronoi(grid, pos) {
  const a = bfs(grid, pos[0].x, pos[0].y), b = bfs(grid, pos[1].x, pos[1].y);
  let na = 0, nb = 0, separated = true;
  for (let i = 0; i < W * H; i++) {
    if (grid[i] !== 0) continue;
    const x = a[i], y = b[i];
    if (x >= 0 && y >= 0) separated = false;
    if (x >= 0 && (y < 0 || x < y)) na++; else if (y >= 0 && (x < 0 || y < x)) nb++;
  }
  return { a: na, b: nb, separated };
}

// ---------- commentary generation
function hash(s) { let h = 2166136261; for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; }
const pickFrom = (arr, k) => arr[hash(k) % arr.length];
function commentary(g, sim) {
  const [A, B] = [0, 1].map(i => sideName(g, i)), out = [];
  const say = (tick, who, text, big) => out.push({ tick, who, text, big });
  const k = g.i, h = hl[g.i], scripted = !!(h && h.lines && h.lines.length);
  // The ticks a hand-written highlight has its own lines for: the generated call for the same moment would repeat it.
  const written = new Set(scripted ? h.lines.map(l => +l[0]) : []);
  // Cycle through phrase lists in order (from a per-game offset) so lines don't repeat back to back.
  const seq = {};
  const next = (key, list) => { seq[key] = seq[key] === undefined ? hash(key + k) % list.length : (seq[key] + 1) % list.length; return list[seq[key]]; };
  if (!written.has(0)) say(0, 'dash', pickFrom([
    `${A} and ${B} roll out on ${g.map}. Lights are green!`,
    `We are under way on ${g.map}: ${A} against ${B}.`,
    `${g.map} is the venue. ${A}, ${B}, engines hot, and they're off.`,
    `Here we go on ${g.map}! ${A} in one corner, ${B} in the other.`,
  ], k));
  const ra = (row[g.p[0]] || { rank: 17 }).rank, rb = (row[g.p[1]] || { rank: 17 }).rank;
  // A dream match can bring in the challenger, who has no seed or table place, or set a bot against itself.
  const seeded = !!(row[g.p[0]] && row[g.p[1]]), self = g.p[0] === g.p[1];
  if (g.stage === 'Challenge' && DATA.challenge) say(1, 'vera', `${nameOf(DATA.challenge.a)} was written after the final with one job: beat ${nameOf(DATA.challenge.b)}. First to four.`);
  else if (!scripted) say(1, 'vera', seeded && Math.abs(ra - rb) >= 6
    ? `On paper this is a mismatch: the number ${Math.min(ra, rb)} seed against the number ${Math.max(ra, rb)}. On paper.`
    : pickFrom([!self && `Two very different philosophies here: ${bot[g.p[0]].style} against ${bot[g.p[1]].style}.`,
      seeded && !self && `${A} finished ${ra}${ord(ra)} in the table, ${B} ${rb}${ord(rb)}. Should be tight.`,
      `Watch the middle of the grid early. Whoever owns it owns the game.`,
      `${A}'s motto: "${bot[g.p[0]].tagline}" We'll see.`].filter(Boolean), k + 1));
  // territory swings (hand-written highlight commentary covers these itself)
  let side = 0, lastSay = -99;
  if (!scripted) sim.mom.forEach((m, t) => {
    const s = m >= 62 ? 1 : m <= 38 ? -1 : 0;
    if (s && s !== side && t - lastSay > 25 && (!sim.sep || t < sim.sep.tick)) {
      const who = s === 1 ? A : B, pct = s === 1 ? m : 100 - m;
      if (side === 0) say(t, 'vera', next('edge', [`${who} is winning the land grab: ${pct}% of the open grid is closer to them.`,
        `Early edge to ${who}. They're nearest to ${pct}% of the free space.`,
        `${who} has the better angles. ${pct}% of the board belongs to them if it ended now.`]));
      else say(t, 'dash', next('swing', [`Big swing! ${who} takes the territory lead, ${pct}% now.`,
        `And the momentum flips to ${who}!`, `${who} claws back the space. ${pct}% and climbing.`,
        `Turnaround! ${who} cuts across and steals the middle.`, `${who} is back on top of the territory count.`]));
      side = s; lastSay = t;
    }
  });
  // near misses
  let lastClose = -99;
  if (!scripted) sim.gaps.forEach((gap, t) => {
    if (gap <= 2 && t > 3 && t - lastClose > 30 && (!sim.death || t < sim.death.tick - 1) && (!sim.sep || t < sim.sep.tick)) {
      say(t, 'dash', next('close', [`Ooh, close quarters! The heads are ${gap === 1 ? 'nose to nose' : 'two cells apart'}.`,
        `Paint is being traded out there!`, `Too close for comfort. Somebody blinks here.`,
        `They are bumper to bumper!`, `Neither one is giving an inch.`]));
      lastClose = t;
    }
  });
  // milestones in long games (Crossroads lists its four corner cells twice, so count each wall cell once)
  const walls = new Set(mapCells(g.map).map(([x, y]) => y * W + x)).size;
  if (!scripted) for (const t of [200, 400, 600]) if ((!sim.sep || t < sim.sep.tick) && t < g.ticks - 10)
    say(t, 'vera', `Tick ${t} and still no wall between them. ${W * H - walls - 2 * (t + 1)} open cells left on the grid.`);
  if (sim.sep) {
    const [a, b] = sim.sep.cells, lead = a > b ? A : B, diff = Math.abs(a - b);
    if (Math.min(a, b) <= 3) { if (!written.has(sim.sep.tick)) say(sim.sep.tick, 'dash', `BOXED IN! ${a <= 3 ? A : B} has ${Math.min(a, b) === 0 ? 'nowhere left to go' : `${Math.min(a, b)} cells left and no way out`}!`, true); }
    else {
    say(sim.sep.tick, 'dash', next('seal', [`SEALED OFF! ${A} has ${a} cells, ${B} has ${b}.`,
      `The door slams shut! ${A}: ${a} cells. ${B}: ${b}.`]), true);
    // The verdict on the two rooms; a hand-written highlight gives its own.
    if (!scripted) say(sim.sep.tick + 1, 'vera', diff === 0 ? `Dead level. This is a pure fill-off now, and every wasted cell counts.`
      : diff < 15 ? `Only ${diff} cells in it. ${lead} has the bigger room, but they still have to fill it without a mistake.`
      : `${lead} has ${diff} more cells to live in. Barring a meltdown, this is decided.`);
    }
    const endT = sim.death ? sim.death.tick : g.ticks;
    if (endT - sim.sep.tick > 80 && !scripted) {
      const t = Math.round((sim.sep.tick + endT) / 2), used = t - sim.sep.tick;
      say(t, 'vera', `Fill-off check: ${A} has at most ${Math.max(0, a - used)} cells of room left, ${B} at most ${Math.max(0, b - used)}. ${pickFrom(['Dead ends will eat into both.', 'Every wasted corner comes off that number.', 'Packing, not speed, decides it from here.'], k)}`);
    }
  }
  const scriptedEnd = scripted && h.lines.some(l => +l[0] >= (sim.death ? sim.death.tick : g.ticks));
  if (scriptedEnd) { /* the highlight's own lines call the finish */ }
  else if (sim.death) {
    const t = sim.death.tick, [h0, h1] = sim.death.hit;
    const what = (hh, i) => hh === 'wall' ? 'the arena wall' : hh === 3 ? 'a barrier' : hh === i + 1 ? 'their own trail' : 'the opponent\'s trail';
    let text;
    if (sim.death.same) text = `HEAD-ON! They hit the same cell at the same moment. Both riders out, it's a draw!`;
    else if (!sim.death.alive[0] && !sim.death.alive[1] && 2 * t + walls >= W * H) text = `THE GRID IS FULL! All ${W * H - walls} cells are painted and both riders run out of road on the same tick. A draw!`;
    else if (!sim.death.alive[0] && !sim.death.alive[1]) text = `Double crash! ${A} into ${what(h0, 0)}, ${B} into ${what(h1, 1)}. A draw!`;
    else { const i = sim.death.alive[0] ? 1 : 0; text = `${[A, B][i]} goes into ${what(sim.death.hit[i], i)}! ${[A, B][1 - i]} wins it at tick ${t}.`; }
    say(t, 'dash', text, true);
    if (g.winner && sim.sep) {
      const wi = sim.death.alive[0] ? 0 : 1, li = 1 - wi;
      const unused = sim.sep.cells[li] - (t - sim.sep.tick - 1);
      if (sim.sep.cells[wi] < sim.sep.cells[li]) say(t, 'vera', `What a turnaround. ${[A, B][wi]} had the smaller room and still outlasted them. Better packing wins.`);
      else if (unused > 3) say(t, 'vera', `${[A, B][li]} left ${unused} cells of their own room unused. That's the game in one number.`);
    } else if (g.winner && !sim.sep && t < 60) say(t, 'vera', next('quick', [`That's a short night's work. ${t} ticks.`, `Over before the popcorn. ${t} ticks.`]));
  } else say(g.ticks, 'dash', `Time! The grid is full and nobody crashed. A draw.`, true);
  if (scripted) for (const [t, who, text] of h.lines) say(+t, who, text, false);
  return out.sort((x, y) => x.tick - y.tick);
}
function ord(n) { return ['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) || n % 10 > 3 ? 0 : n % 10]; }

// ---------- player
const cv = $('arena'), ctx = cv.getContext('2d');
const mcv = $('mom'), mctx = mcv.getContext('2d', { willReadFrequently: true }); // the strip reads its chart back to draw the playhead over it
let cur = null, tick = 0, playing = true, speed = 1, acc = 0, lastT = 0, cell = 20;
function sizeCanvas() {
  const w = cv.clientWidth || 800, dpr = Math.min(2, window.devicePixelRatio || 1);
  cell = Math.max(4, Math.floor(w * dpr / W));
  cv.width = cell * W; cv.height = cell * H;
  mcv.width = Math.floor((mcv.clientWidth || 800) * dpr); mcv.height = 56 * dpr;
  if (cur) { drawMom(); drawUpTo(tick); } // the chart first: drawUpTo puts the playhead and the dimmed future over it
}
function load(gi, opts = {}) {
  const g = games[gi], sim = simulate(g);
  cur = { g, sim, lines: commentary(g, sim), shown: -1, from: opts.from || null };
  tick = 0; acc = 0; playing = opts.autoplay !== false;
  $('play').textContent = playing ? 'Pause' : 'Play';
  g.p.forEach((s, i) => {
    $('nm' + i).textContent = sideName(g, i);
    $('sw' + i).style.background = colorsOf(g)[i];
    $('sub' + i).textContent = `${row[s] ? '#' + row[s].rank + ' seed' : 'Challenger'} · ${bot[s].style}`;
  });
  cur.tie = findTie(g);
  $('stageName').textContent = g.stage + (g.gameNo ? ` · G${g.gameNo}` : '');
  $('mapName').textContent = g.map;
  const h = hl[g.i];
  $('clipKicker').textContent = h ? h.kicker || 'Highlight' : g.stage;
  // Knockout games: show the whole series as chips so you can hop between its games.
  const tieOf = allSeries().find(t => t.games.includes(g.i));
  $('series').hidden = !tieOf;
  if (tieOf) $('series').innerHTML = `<span class="sl">Series</span>` + tieOf.games.map((gi, n) => seriesChip(gi, n, gi === g.i)).join('');
  $('clipTitle').textContent = h ? h.title : `${sideName(g, 0)} vs ${sideName(g, 1)}`;
  $('clipBlurb').textContent = h ? h.blurb : g.stage === 'Challenge' ? `${g.map}. The champion against the challenger.` : row[g.p[0]] && row[g.p[1]] ? `${g.map}. Seed ${row[g.p[0]].rank} against seed ${row[g.p[1]].rank}.` : g.map + '.';
  $('scrub').max = sim.heads.length - 1; $('scrub').value = 0;
  $('feed').innerHTML = '';
  $('verdict').hidden = true;
  document.querySelectorAll('.clip').forEach(c => c.classList.toggle('now', +c.dataset.g === gi));
  drawUpTo(0); drawMom();
  if (opts.scroll) $('stage').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}
// What to offer when a game ends: the next reel clip, or the next game of a knockout series.
function nextUp() {
  const gi = cur.g.i;
  if (cur.from === 'reel') {
    const k = reel.findIndex(h => h.g === gi);
    if (k >= 0 && k + 1 < reel.length) return { g: reel[k + 1].g, label: `Next highlight: ${reel[k + 1].title} →` };
  }
  for (const t of allSeries()) {
    const k = t.games.indexOf(gi);
    if (k >= 0 && k + 1 < t.games.length) return { g: t.games[k + 1], label: `Game ${k + 2} of the series →` };
  }
  return null;
}
// A chip for one game of a series. Its tooltip and what a screen reader hears say which game, where, and who won.
function seriesChip(gi, n, on) {
  const w = games[gi].winner, about = `Game ${n + 1}, ${games[gi].map}: ${w ? `${nameOf(w)} won` : 'a draw'}`;
  return `<button class="chip${on ? ' on' : ''}" data-g="${gi}" title="${esc(about)}" aria-label="${esc(about)}">${w ? dot(w) : ''}G${n + 1}${w ? '' : ' ½'}</button>`;
}
// Knockout ties plus the postscript challenge, all as {a, b, games}.
function allSeries() { return DATA.bracket.flatMap(r => r.ties).concat(DATA.challenge ? [DATA.challenge] : []); }
function findTie(g) {
  if (g.stage === 'Round robin') return null;
  for (const t of allSeries()) {
    const k = t.games.indexOf(g.i);
    if (k < 0) continue;
    // Series score before this game and after it, from this game's left/right point of view.
    const score = n => { const sc = [0, 0]; for (const gi of t.games.slice(0, n)) { const w = games[gi].winner; if (w === t.a) sc[0]++; else if (w === t.b) sc[1]++; } return g.p[0] === t.a ? sc : [sc[1], sc[0]]; };
    return { before: score(k), after: score(k + 1) };
  }
  return null;
}
// Where a bot's code lives in the bundle: tournament bots under bots/, the postscript challenger on its own.
function modId(slug) { return DATA.challenge && slug === DATA.challenge.a ? 'challenger/' + slug : 'bots/' + slug; }
// A bot against itself (dream matches) gets numbered names and a second colour for the right-hand rider.
function sideName(g, i) { return g.p[0] === g.p[1] ? `${nameOf(g.p[i])} ${i ? 'II' : 'I'}` : nameOf(g.p[i]); }
function colorsOf(g) {
  const c = g.p.map(s => bot[s].color);
  if (g.p[0] === g.p[1]) c[1] = c[0].toLowerCase() === '#ffffff' ? '#ffc94d' : '#ffffff';
  return c;
}
function rgba(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; }
function drawUpTo(t) {
  const { g, sim } = cur, c = cell;
  ctx.fillStyle = '#050813'; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.strokeStyle = 'rgba(80,110,200,0.09)'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= W; x++) { ctx.moveTo(x * c + .5, 0); ctx.lineTo(x * c + .5, H * c); }
  for (let y = 0; y <= H; y++) { ctx.moveTo(0, y * c + .5); ctx.lineTo(W * c, y * c + .5); }
  ctx.stroke();
  ctx.fillStyle = '#2a355e';
  for (const [x, y] of mapCells(g.map)) ctx.fillRect(x * c + 1, y * c + 1, c - 2, c - 2);
  const cols = colorsOf(g);
  // trails as connected strokes
  for (let i = 0; i < 2; i++) {
    ctx.strokeStyle = rgba(cols[i], .85); ctx.lineWidth = Math.max(2, c * .42); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    let last = sim.heads[0][i]; ctx.moveTo((last.x + .5) * c, (last.y + .5) * c);
    for (let k = 1; k <= t && k < sim.heads.length; k++) {
      const p = sim.heads[k][i];
      if (p.alive === false) break;
      ctx.lineTo((p.x + .5) * c, (p.y + .5) * c);
    }
    ctx.stroke();
    ctx.strokeStyle = rgba(cols[i], .18); ctx.lineWidth = c * .95; ctx.stroke();
  }
  const hs = sim.heads[Math.min(t, sim.heads.length - 1)];
  for (let i = 0; i < 2; i++) {
    const p = hs[i], cx = (p.x + .5) * c, cy = (p.y + .5) * c;
    if (p.alive === false) {
      // crash burst
      ctx.save(); ctx.translate(cx, cy);
      for (let r = 0; r < 10; r++) {
        const a = r / 10 * Math.PI * 2;
        ctx.strokeStyle = r % 2 ? '#fff' : cols[i]; ctx.lineWidth = Math.max(1.5, c * .12);
        ctx.beginPath(); ctx.moveTo(Math.cos(a) * c * .3, Math.sin(a) * c * .3); ctx.lineTo(Math.cos(a) * c * 1.1, Math.sin(a) * c * 1.1); ctx.stroke();
      }
      ctx.restore();
    } else {
      ctx.fillStyle = rgba(cols[i], .25); ctx.beginPath(); ctx.arc(cx, cy, c * .95, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx, cy, c * .32, 0, 7); ctx.fill();
    }
  }
  $('tick').textContent = String(t).padStart(3, '0');
  $('scrub').value = t;
  // feed
  if (t < cur.shown) { $('feed').innerHTML = ''; cur.shown = -1; }
  const feed = $('feed');
  for (const l of cur.lines) {
    if (l.tick > t || l.tick <= cur.shown) continue;
    const d = document.createElement('div');
    d.className = `line ${l.who}${l.big ? ' big' : ''}`;
    d.innerHTML = `<span class="tk">t${l.tick}</span><div><span class="who">${l.who === 'dash' ? 'DASH KOWALSKI' : 'VERA VECTOR'}</span><p>${esc(l.text)}</p></div>`;
    feed.prepend(d);
  }
  cur.shown = t;
  const end = t >= sim.heads.length - 1;
  const sc = cur.tie ? (end ? cur.tie.after : cur.tie.before) : ['', ''];
  $('sc0').textContent = sc[0]; $('sc1').textContent = sc[1];
  $('verdict').hidden = !end;
  if (end) {
    const wi = sim.death && sim.death.alive[0] !== sim.death.alive[1] ? (sim.death.alive[0] ? 0 : 1) : -1;
    $('verdictText').textContent = wi >= 0 ? `${sideName(g, wi)} wins` : 'Draw';
    const nx = nextUp();
    $('nextBtn').hidden = !nx;
    if (nx) { $('nextBtn').textContent = nx.label; $('nextBtn').onclick = () => load(nx.g, { from: cur.from }); }
  }
  drawMomHead(t);
}
function drawMom() {
  const { sim, g } = cur, w = mcv.width, h = mcv.height, n = Math.max(1, sim.heads.length - 1);
  mctx.clearRect(0, 0, w, h);
  const [c0, c1] = colorsOf(g);
  mctx.fillStyle = rgba(c1, .35); mctx.fillRect(0, 0, w, h);
  mctx.fillStyle = rgba(c0, .55);
  mctx.beginPath(); mctx.moveTo(0, h);
  sim.mom.forEach((m, t) => mctx.lineTo(t / n * w, h - m / 100 * h));
  mctx.lineTo(w, h); mctx.closePath(); mctx.fill();
  mctx.strokeStyle = 'rgba(255,255,255,.25)'; mctx.setLineDash([4, 4]);
  mctx.beginPath(); mctx.moveTo(0, h / 2); mctx.lineTo(w, h / 2); mctx.stroke(); mctx.setLineDash([]);
  if (sim.sep) { mctx.fillStyle = '#ffc94d'; mctx.fillRect(sim.sep.tick / n * w - 1, 0, 2, h); }
  const fs = Math.round(h * .19);
  mctx.font = `700 ${fs}px Barlow, sans-serif`; mctx.fillStyle = 'rgba(255,255,255,.8)';
  mctx.textAlign = 'right';
  mctx.fillText(`TERRITORY · ${sideName(g, 1).toUpperCase()}`, w - fs * .6, fs * 1.2);
  mctx.fillText(sideName(g, 0).toUpperCase(), w - fs * .6, h - fs * .5);
  mctx.textAlign = 'left';
  cur.momImg = mctx.getImageData(0, 0, w, h);
}
function drawMomHead(t) {
  if (!cur.momImg) return;
  const w = mcv.width, h = mcv.height, n = Math.max(1, cur.sim.heads.length - 1);
  mctx.putImageData(cur.momImg, 0, 0);
  mctx.fillStyle = 'rgba(5,8,19,.55)'; mctx.fillRect(t / n * w, 0, w, h);
  mctx.fillStyle = '#fff'; mctx.fillRect(t / n * w - 1, 0, 2, h);
}
function slowMo(t) {
  if (!cur || speed > 3) return false;
  const n = cur.sim.heads.length - 1, sep = cur.sim.sep && cur.sim.sep.tick;
  return (sep && t >= sep - 6 && t < sep + 2) || (t >= n - 5 && t < n);
}
function frame(now) {
  const dt = Math.min(100, now - (lastT || now)); lastT = now;
  if (cur && playing) {
    // Broadcast slow-mo around the sealing moment and the final crash.
    const sm = slowMo(tick);
    acc += dt * speed * (sm ? .3 : 1) * 22 / 1000;
    let moved = false;
    while (acc >= 1) { acc -= 1; if (tick < cur.sim.heads.length - 1) { tick++; moved = true; } }
    if (moved) drawUpTo(tick);
    if (tick >= cur.sim.heads.length - 1) { playing = false; $('play').textContent = 'Replay'; }
  }
  // The SLOW-MO badge is up only while slow motion is playing: not on the final verdict, on a pause or after a scrub.
  const badge = !!(cur && playing && slowMo(tick));
  if ($('slowmo').hidden === badge) $('slowmo').hidden = !badge;
  requestAnimationFrame(frame);
}
$('series').addEventListener('click', e => { const c = e.target.closest('.chip'); if (c) load(+c.dataset.g, { from: cur.from }); });
window.__lines = gi => commentary(games[gi], simulate(games[gi]));
window.__sim = gi => simulate(games[gi]); // for tools/screenshots.mjs, which photographs the moment the final is sealed
$('play').onclick = () => {
  if (tick >= cur.sim.heads.length - 1) { tick = 0; drawUpTo(0); }
  playing = !playing; $('play').textContent = playing ? 'Pause' : 'Play';
};
$('restart').onclick = () => { tick = 0; drawUpTo(0); playing = true; $('play').textContent = 'Pause'; };
$('scrub').oninput = e => { tick = +e.target.value; drawUpTo(tick); };
mcv.onclick = e => { const r = mcv.getBoundingClientRect(); tick = Math.round((e.clientX - r.left) / r.width * (cur.sim.heads.length - 1)); drawUpTo(tick); };
document.querySelectorAll('[data-speed]').forEach(b => b.onclick = () => {
  speed = +b.dataset.speed; document.querySelectorAll('[data-speed]').forEach(x => x.classList.toggle('on', x === b));
});
// A focused button, link or summary keeps Space for itself, so the page's Space shortcuts only act from the page.
const onControl = e => !!(e.target.closest && e.target.closest('button, a, summary, [role=button]'));
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
  if (window.__exActive && window.__exActive()) return;
  // With the ride board on screen and no ride running, Space from the page is the board's: it starts a ride.
  if (e.code === 'Space' && !e.defaultPrevented && !onControl(e) && !(window.__exReady && window.__exReady())) { e.preventDefault(); $('play').click(); }
  if (e.code === 'ArrowRight') { tick = Math.min(cur.sim.heads.length - 1, tick + 10); drawUpTo(tick); }
  if (e.code === 'ArrowLeft') { tick = Math.max(0, tick - 10); drawUpTo(tick); }
});
window.addEventListener('resize', sizeCanvas);

// ---------- page sections
function vsLine(g) { return `${dot(g.p[0])}${esc(nameOf(g.p[0]))} vs ${dot(g.p[1])}${esc(nameOf(g.p[1]))}`; }
$('headline').innerHTML = COPY.headline || 'Sixteen bots. <em>One grid.</em>';
$('dek').textContent = COPY.dek || '';
$('story').innerHTML = (COPY.story || []).map(p => `<p>${esc(p)}</p>`).join('');
$('story').closest('section').hidden = !(COPY.story || []).length;

const reel = COPY.highlights || [];
$('reel').innerHTML = reel.map(h => {
  const g = games[h.g];
  return `<button class="clip" data-g="${h.g}"><span class="k">${esc(h.kicker || g.stage)}</span><span class="ttl">${esc(h.title)}</span><span class="vs">${vsLine(g)} · ${esc(g.map)}</span></button>`;
}).join('');
document.querySelectorAll('.clip').forEach(c => c.onclick = () => load(+c.dataset.g, { scroll: true, from: 'reel' }));
$('reel').closest('section').hidden = !reel.length;

// bracket
const champ = DATA.champion;
$('champ').innerHTML = `<div><div class="k">Grid Classic champion</div><div class="n">${esc(nameOf(champ))}</div></div><p>${esc(COPY.champion || bot[champ].tagline)}</p>`;
$('bracket').innerHTML = DATA.bracket.map(r => `<div class="round"><h3>${esc(r.round)}</h3><div class="ties">${r.ties.map((t, k) => {
  const decider = t.games[t.games.length - 1];
  const rowh = (s, sc) => `<div class="row ${t.winner === s ? 'win' : 'lose'}"><span class="sd">${row[s].rank}</span><span class="bn">${dot(s)}${esc(nameOf(s))}</span><span class="sc">${sc}</span></div>`;
  return `<button class="tie" data-g="${decider}" aria-label="${esc(nameOf(t.a))} ${t.score[0]}, ${esc(nameOf(t.b))} ${t.score[1]}">${rowh(t.a, t.score[0])}${rowh(t.b, t.score[1])}</button>`;
}).join('')}</div></div>`).join('');
document.querySelectorAll('.tie').forEach(b => b.onclick = () => load(+b.dataset.g, { scroll: true }));
// Wires between rounds: each pair of ties feeds the tie in the next column.
function drawWires() {
  const br = $('bracket'), box = br.getBoundingClientRect();
  const cols = [...br.querySelectorAll('.round')].map(r => [...r.querySelectorAll('.tie')]);
  let d = '', hot = '';
  for (let r = 0; r + 1 < cols.length; r++) cols[r + 1].forEach((t, k) => {
    const tr = t.getBoundingClientRect(), x2 = tr.left - box.left, y2 = tr.top + tr.height / 2 - box.top;
    [cols[r][2 * k], cols[r][2 * k + 1]].forEach(src => {
      if (!src) return;
      const sr = src.getBoundingClientRect(), x1 = sr.right - box.left, y1 = sr.top + sr.height / 2 - box.top, xm = (x1 + x2) / 2;
      const path = `M${x1},${y1}H${xm}V${y2}H${x2}`;
      const champPath = DATA.bracket[r].ties[cols[r].indexOf(src)].winner === champ;
      if (champPath) hot += path; else d += path;
    });
  });
  let svg = br.querySelector('svg.wires');
  if (!svg) { svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'wires'); br.prepend(svg); }
  svg.innerHTML = `<path d="${d}"/><path class="hot" d="${hot}"/>`;
}
drawWires();
window.addEventListener('resize', drawWires);
if (document.fonts) document.fonts.ready.then(drawWires);

// postscript challenge
if (DATA.challenge) {
  const c = DATA.challenge, cb = bot[c.a], won = c.winner === c.a;
  $('challengeSection').hidden = false;
  $('challenge').innerHTML = `<div style="min-width:0;display:grid;gap:8px">
      <span class="cn" style="color:${cb.color}">${esc(cb.name)}</span>
      <span class="tg">“${esc(cb.tagline)}”</span>
      <p>${esc(cb.bio)} After the final, it was written for one job: beat ${esc(nameOf(c.b))}, first to four wins. ${won ? `It did. The champion's reign lasted one series.` : `It couldn't. ${esc(nameOf(c.b))} keeps the belt.`}</p>
      <div class="series" id="chSeries">${c.games.map((gi, n) => seriesChip(gi, n, false)).join('')}</div>
    </div>
    <div class="sc"><span style="color:${cb.color}">${c.score[0]}</span> – <span style="color:${bot[c.b].color}">${c.score[1]}</span></div>`;
  $('chSeries').addEventListener('click', e => { const b = e.target.closest('.chip'); if (b) load(+b.dataset.g, { scroll: true }); });
}

// awards
$('awards').innerHTML = (DATA.awards || []).map(a => `<article class="award"><span class="k">${esc(a.award)}</span>
  <span class="who">${a.bots.map(s => `${dot(s)}${esc(nameOf(s))}`).join(' and ')}</span><p class="stat">${esc(a.stat)}</p>
  ${a.g !== undefined ? `<button class="btn" data-g="${a.g}">Watch it</button>` : ''}</article>`).join('');
$('awards').querySelectorAll('[data-g]').forEach(b => b.onclick = () => load(+b.dataset.g, { scroll: true }));
$('awardsSection').hidden = !(DATA.awards || []).length;

// table
const maps = DATA.maps;
$('tableNote').textContent = `Every bot played every other bot eight times: all four arenas, from both starting corners. Three points for a win, one for a draw. ${games.filter(g => g.stage === 'Round robin').length} games in all. Map bars show win rate per arena (${maps.join(', ')}).`;
$('table').innerHTML = `<thead><tr><th>#</th><th class="l">Bot</th><th>P</th><th>W</th><th>D</th><th>L</th><th>Pts</th><th>Head-ons</th><th>Avg length</th><th class="l">By arena</th><th>ms/move</th></tr></thead><tbody>` +
  DATA.standings.map(t => `<tr${t.rank === 8 ? ' class="cut"' : ''}><td>${t.rank}</td><td class="l bot">${dot(t.slug)}${esc(nameOf(t.slug))}<span class="tg">${esc(bot[t.slug].tagline)}</span></td><td>${t.P}</td><td>${t.W}</td><td>${t.D}</td><td>${t.L}</td><td class="pts">${t.pts}</td><td>${t.headOn}</td><td>${t.avgTicks.toFixed(1)}</td><td class="l"><span class="maps">${maps.map(m => {
    const r = t.byMap[m] || { W: 0, D: 0, L: 0 }, n = r.W + r.D + r.L || 1;
    return `<i title="${esc(m)}: ${r.W}-${r.D}-${r.L}"><b style="width:${(r.W / n * 100).toFixed(0)}%"></b></i>`;
  }).join('')}</span></td><td>${t.msPerMove.toFixed(3)}</td></tr>`).join('') + '</tbody>';

// matrix
const order = DATA.standings.map(t => t.slug);
function heat(v) { // 0..1 -> red..amber..green
  const stops = [[255, 77, 109], [255, 201, 77], [79, 227, 161]];
  const x = v * 2, i = Math.min(1, Math.floor(x)), f = x - i;
  const c = stops[i].map((a, k) => Math.round(a + (stops[i + 1][k] - a) * f));
  return `rgb(${c.join(',')})`;
}
$('ramp').style.background = `linear-gradient(90deg, ${heat(0)}, ${heat(.5)}, ${heat(1)})`;
$('matrix').innerHTML = `<thead><tr><th></th>${order.map(s => `<th class="colh">${esc(nameOf(s))}</th>`).join('')}</tr></thead><tbody>` +
  order.map(a => `<tr><th class="l">${dot(a)}${esc(nameOf(a))}</th>${order.map(b => {
    if (a === b) return '<td class="self"></td>';
    const r = DATA.h2h[a][b], n = r.W + r.D + r.L, s = r.W + r.D / 2;
    return `<td data-a="${a}" data-b="${b}" style="background:${heat(n ? s / n : .5)}" title="${esc(nameOf(a))} vs ${esc(nameOf(b))}: ${r.W}-${r.D}-${r.L}">${s % 1 ? s.toFixed(1) : s}</td>`;
  }).join('')}</tr>`).join('') + '</tbody>';
document.querySelectorAll('.matrix td[data-a]').forEach(td => td.onclick = () => {
  const a = td.dataset.a, b = td.dataset.b;
  const gs = games.filter(g => g.stage === 'Round robin' && g.p.includes(a) && g.p.includes(b)).sort((x, y) => y.ticks - x.ticks);
  if (gs.length) load(gs[0].i, { scroll: true });
});

// roster
$('roster').innerHTML = DATA.standings.map(t => {
  const b = bot[t.slug];
  const ko = DATA.bracket.findIndex(r => !r.ties.some(x => x.winner === t.slug));
  const fate = t.slug === champ ? 'Champion' : ko >= 0 ? `Out in the ${DATA.bracket[ko].round.toLowerCase()}` : '';
  return `<article class="card"><span class="stripe" style="background:${b.color}"></span>
    <div class="top"><span class="nm" style="color:${b.color}">${esc(b.name)}</span><span class="rk">#${t.rank} · ${t.pts} pts</span></div>
    <span class="style" style="color:${b.color}">${esc(b.style)}</span>
    <p class="tag">“${esc(b.tagline)}”</p><p class="bio">${esc(b.bio)}</p>
    <div class="stats"><span><b>${t.W}-${t.D}-${t.L}</b> W-D-L</span><span><b>${t.avgTicks.toFixed(1)}</b> avg ticks</span><span><b>${esc(fate)}</b></span></div>
    <div class="cardacts"><button class="btn" data-ride="${t.slug}">Ride against</button><details data-src="${t.slug}"><summary class="btn">Read the code</summary><pre class="src"></pre></details></div></article>`;
}).join('');
$('roster').querySelectorAll('[data-ride]').forEach(b => b.onclick = () => {
  $('exBot').value = b.dataset.ride;
  $('exBot').dispatchEvent(new Event('change'));
  $('exhibition').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
});
$('roster').querySelectorAll('details[data-src]').forEach(d => d.addEventListener('toggle', () => {
  const pre = d.querySelector('pre');
  if (!d.open || pre.textContent) return;
  const fn = BOTS['bots/' + d.dataset.src];
  if (!fn) { pre.textContent = 'Source not bundled.'; return; }
  const src = fn.toString();
  pre.textContent = src.slice(src.indexOf('{') + 1, src.lastIndexOf('}')).trim();
}));

// finder
const opt = (v, l) => `<option value="${esc(v)}">${esc(l)}</option>`;
const byName = [...DATA.bots].sort((a, b) => a.name.localeCompare(b.name));
$('fBot').innerHTML = opt('', 'Any bot') + byName.map(b => opt(b.slug, b.name)).join('');
$('fBot2').innerHTML = opt('', 'Any opponent') + byName.map(b => opt(b.slug, b.name)).join('');
$('fMap').innerHTML = opt('', 'Any arena') + maps.map(m => opt(m, m)).join('');
const stages = [...new Set(games.map(g => g.stage))];
$('fStage').innerHTML = opt('', 'Any stage') + stages.map(s => opt(s, s)).join('');
function filterGames() {
  const a = $('fBot').value, b = $('fBot2').value, m = $('fMap').value, s = $('fStage').value;
  // The same bot as bot and opponent means its games against itself (only dream matches have those).
  const bots = g => a && a === b ? g.p[0] === a && g.p[1] === a : (!a || g.p.includes(a)) && (!b || g.p.includes(b));
  const list = games.filter(g => bots(g) && (!m || g.map === m) && (!s || g.stage === s));
  $('fCount').textContent = `${list.length.toLocaleString('en')} game${list.length === 1 ? '' : 's'}${list.length > 300 ? ', showing the longest 300' : ''}`;
  $('results').innerHTML = list.sort((x, y) => y.ticks - x.ticks).slice(0, 300).map(g =>
    `<div class="gr" data-g="${g.i}" role="button" tabindex="0"><span class="st">${esc(g.stage)}${g.gameNo ? ' G' + g.gameNo : ''}</span><span>${vsLine(g)} <span class="st">→ ${g.winner ? esc(nameOf(g.winner)) : 'draw'}</span></span><span class="mp">${esc(g.map)}</span><span class="num">${g.ticks}t</span></div>`).join('')
    || '<p class="none">No games match those filters.</p>';
}
['fBot', 'fBot2', 'fMap', 'fStage'].forEach(id => $(id).onchange = filterGames);
$('results').addEventListener('click', e => { const r = e.target.closest('.gr'); if (r) load(+r.dataset.g, { scroll: true }); });
$('results').addEventListener('keydown', e => { const r = e.target.closest('.gr'); if (r && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); load(+r.dataset.g, { scroll: true }); } });
filterGames();

// ticker
const tape = DATA.bracket.flatMap(r => r.ties.map(t => `<span>${esc(r.round.toUpperCase())}: <b>${esc(nameOf(t.winner))}</b> d. ${esc(nameOf(t.winner === t.a ? t.b : t.a))} ${Math.max(...t.score)}-${Math.min(...t.score)}</span>`))
  .concat(DATA.challenge ? [`<span>POSTSCRIPT: <b>${esc(nameOf(DATA.challenge.winner))}</b> wins the challenge match ${Math.max(...DATA.challenge.score)}-${Math.min(...DATA.challenge.score)}</span>`] : [])
  .concat((COPY.ticker || []).map(s => `<span>${esc(s)}</span>`));
// The tape runs twice over so it can loop without a gap; screen readers get it once.
$('tape').innerHTML = tape.join('') + `<span class="again" aria-hidden="true">${tape.join('')}</span>`;

$('credits').innerHTML = (COPY.footer || []).map(p => `<p>${esc(p)}</p>`).join('');


// ---------- exhibition: play live against any bot
(() => {
  const cache = {};
  const shimProcess = { hrtime: { bigint: () => BigInt(Math.round(performance.now() * 1e6)) } };
  function req(from, name) {
    const parts = from.includes('/') ? from.slice(0, from.lastIndexOf('/')).split('/') : [];
    for (const seg of name.split('/')) { if (seg === '.' || seg === '') continue; if (seg === '..') parts.pop(); else parts.push(seg); }
    const id = parts.join('/').replace(/\.js$/, '');
    if (cache[id]) return cache[id].exports;
    if (!BOTS[id]) throw new Error('missing module ' + id);
    const module = { exports: {} }; cache[id] = module;
    BOTS[id](module, module.exports, n => req(id, n), shimProcess);
    return module.exports;
  }
  const E = req('', 'engine');
  window.__botReq = req;
  window.__modId = modId;
  const cv2 = $('exArena'), c2 = cv2.getContext('2d');
  let ex = null, cellX = 20, acc2 = 0, last2 = 0;
  // Your record against each bot, kept in this browser.
  const RECORD = 'grid-classic.record';
  let record = {};
  try { record = JSON.parse(localStorage.getItem(RECORD)) || {}; } catch (e) { /* storage refused or unreadable */ }
  if (typeof record !== 'object' || Array.isArray(record)) record = {};
  // Each bot's entry is { W, D, L }. Anything else, which only editing storage by hand can leave, counts as no games yet.
  const entry = slug => { const r = record[slug]; return r && typeof r === 'object' && !Array.isArray(r) ? r : null; };
  const num = v => Number(v) || 0;
  function showRecord(slug = $('exBot').value) {
    const r = entry(slug);
    $('exRec').textContent = r ? `Your record against ${nameOf(slug)}: ${num(r.W)} won, ${num(r.D)} drawn, ${num(r.L)} lost` : '';
  }
  function tally(slug, k) {
    const r = entry(slug) || (record[slug] = { W: 0, D: 0, L: 0 });
    r[k] = num(r[k]) + 1;
    try { localStorage.setItem(RECORD, JSON.stringify(record)); } catch (e) { /* storage refused: keep it for this visit */ }
    showRecord(slug); // the bot you just rode against, even if the menu changed mid-ride
  }
  $('exBot').innerHTML = DATA.standings.map(t => `<option value="${t.slug}">${esc(nameOf(t.slug))} (#${t.rank})</option>`).join('')
    + (DATA.challenge ? `<option value="${DATA.challenge.a}">${esc(nameOf(DATA.challenge.a))} (challenger)</option>` : '');
  $('exBot').value = DATA.champion;
  $('exMap').innerHTML = DATA.maps.map(m => `<option>${esc(m)}</option>`).join('');
  window.__exActive = () => ex && (ex.state === 'live' || ex.state === 'countdown');
  window.__ride = () => ex; // for tools/screenshots.mjs, which steers a ride to photograph
  // No ride running, and at least half the board in the window: Space from the page starts a ride rather than working the replay.
  window.__exReady = () => {
    if (window.__exActive()) return false;
    const r = $('exBoard').getBoundingClientRect();
    return Math.min(r.bottom, innerHeight) - Math.max(r.top, 0) >= r.height / 2;
  };

  // You ride white, or gold against a bot that rides white itself (Chicken), and the help names the colour.
  const yours = slug => bot[slug].color.toLowerCase() === '#ffffff' ? '#ffc94d' : '#ffffff';
  const showColour = () => { $('exYou').textContent = yours($('exBot').value) === '#ffffff' ? 'white' : 'gold'; };

  // Touch screens, the ones that show the turn buttons, are told to swipe and tap; the rest, to use the keys.
  const touchFirst = () => matchMedia('(hover: none)').matches;
  const ready = () => `Ready when you are<small>${touchFirst() ? 'Swipe or use the turn buttons' : 'Arrow keys or WASD to steer'}</small>`;
  $('exMsg').innerHTML = ready();

  function size2() {
    // The board is 4:3, and a phone held sideways is shorter than that under the 44 px top bar, so the board takes the
    // width of its column or of the screen's height, whichever is less, and sits in the middle. The width is set here
    // from the column, never from the board itself, so it can't feed back into the next measurement.
    const room = $('exBoard').clientWidth || 800, fit = Math.floor((innerHeight - 44) * W / H);
    const w = Math.max(160, Math.min(room, fit)), dpr = Math.min(2, window.devicePixelRatio || 1);
    cv2.style.width = w + 'px';
    $('exBoard').style.setProperty('--cell', w / W + 'px'); // the countdown tab is sized in cells
    cellX = Math.max(4, Math.floor(w * dpr / W));
    cv2.width = cellX * W; cv2.height = cellX * H;
    draw2();
  }
  function start() {
    const slug = $('exBot').value, map = $('exMap').value;
    // Humans need a moment to react, so pick a start with a long clear run ahead.
    let seed, pos, grid = E.makeGrid(map);
    for (let tries = 0; tries < 50; tries++) {
      seed = (Math.random() * 2 ** 31) | 0; pos = E.startFor(map, seed);
      let run = 0, x = pos[0].x, y = pos[0].y;
      while (run < 12) { x += DX[pos[0].dir]; y += DY[pos[0].dir]; if (x < 0 || y < 0 || x >= W || y >= H || grid[y * W + x]) break; run++; }
      if (run >= 10) break;
    }
    pos.forEach((p, i) => grid[p.y * W + p.x] = i + 1);
    const rng = E.mulberry32(seed);
    let ai;
    try { ai = req('', modId(slug)).factory({ W, H, me: 1, rng }); } catch (e) { $('exMsg').innerHTML = 'That bot failed to load'; return; }
    ex = { slug, map, grid, pos, ai, rng, tick: 0, queue: [], state: 'countdown', t0: performance.now(), trails: [[{ ...pos[0] }], [{ ...pos[1] }]], dead: [false, false], rate: +$('exSpeed').value };
    $('exMsg').hidden = true; // the last result goes; the countdown has its own tab
    if (typeof playing !== 'undefined') { playing = false; $('play').textContent = 'Play'; }
    showRecord(slug);
    $('exGo').textContent = 'Restart';
    $('exBoard').classList.add('riding');
    draw2();
  }
  function steer(d) {
    if (!ex || (ex.state !== 'live' && ex.state !== 'countdown')) return;
    const lastDir = ex.queue.length ? ex.queue[ex.queue.length - 1] : ex.pos[0].dir;
    if (d === lastDir || d === (lastDir + 2) % 4 || ex.queue.length >= 3) return;
    ex.queue.push(d);
  }
  function turn(rel) {
    if (!ex) return;
    const lastDir = ex.queue.length ? ex.queue[ex.queue.length - 1] : ex.pos[0].dir;
    steer((lastDir + (rel > 0 ? 1 : 3)) % 4);
  }
  function step() {
    const g = ex.grid, me = ex.pos[1], you = ex.pos[0];
    const d0 = ex.queue.length ? ex.queue.shift() : you.dir;
    let d1 = me.dir;
    try {
      d1 = ex.ai.move({ grid: g.slice(), W, H, tick: ex.tick, me: { x: me.x, y: me.y, dir: me.dir }, opp: { x: you.x, y: you.y, dir: you.dir }, meId: 2, oppId: 1, rng: ex.rng });
    } catch (e) { d1 = me.dir; }
    if (!(d1 >= 0 && d1 <= 3) || (d1 + 2) % 4 === me.dir) d1 = me.dir;
    const dirs = [d0, d1 | 0];
    const nx = ex.pos.map((p, i) => ({ x: p.x + DX[dirs[i]], y: p.y + DY[dirs[i]], dir: dirs[i] }));
    const dead = nx.map(n => n.x < 0 || n.y < 0 || n.x >= W || n.y >= H || g[n.y * W + n.x] !== 0);
    if (nx[0].x === nx[1].x && nx[0].y === nx[1].y) dead[0] = dead[1] = true;
    nx.forEach((n, i) => { if (!dead[i]) { g[n.y * W + n.x] = i + 1; } ex.trails[i].push(n); });
    ex.pos = nx; ex.tick++; ex.dead = dead;
    if (dead[0] || dead[1]) {
      ex.state = 'over';
      $('exBoard').classList.remove('riding');
      const name = nameOf(ex.slug);
      let title, sub;
      if (dead[0] && dead[1]) { tally(ex.slug, 'D'); title = 'Draw'; sub = `You and ${name} went down together after ${ex.tick} ticks.`; }
      else if (dead[1]) { tally(ex.slug, 'W'); title = 'You win!'; sub = `${name} crashed first, at tick ${ex.tick}.`; }
      else { tally(ex.slug, 'L'); title = `${name} wins`; sub = `You lasted ${ex.tick} ticks. ${touchFirst() ? 'Tap Start' : 'Space or Start'} to go again.`; }
      $('exMsg').innerHTML = `${esc(title)}<small>${esc(sub)}</small>`;
      $('exMsg').hidden = false;
    }
  }
  function draw2() {
    const c = cellX;
    c2.fillStyle = '#050813'; c2.fillRect(0, 0, cv2.width, cv2.height);
    c2.strokeStyle = 'rgba(80,110,200,0.09)'; c2.lineWidth = 1; c2.beginPath();
    for (let x = 0; x <= W; x++) { c2.moveTo(x * c + .5, 0); c2.lineTo(x * c + .5, H * c); }
    for (let y = 0; y <= H; y++) { c2.moveTo(0, y * c + .5); c2.lineTo(W * c, y * c + .5); }
    c2.stroke();
    const map = ex ? ex.map : $('exMap').value;
    c2.fillStyle = '#2a355e';
    for (const [x, y] of mapCells(map)) c2.fillRect(x * c + 1, y * c + 1, c - 2, c - 2);
    if (!ex) return;
    const oc = bot[ex.slug].color, yc = yours(ex.slug);
    [yc, oc].forEach((col, i) => {
      const tr = ex.trails[i], n = ex.dead[i] ? tr.length - 1 : tr.length;
      c2.strokeStyle = rgba(col, .85); c2.lineWidth = Math.max(2, c * .42); c2.lineCap = 'round'; c2.lineJoin = 'round';
      c2.beginPath(); c2.moveTo((tr[0].x + .5) * c, (tr[0].y + .5) * c);
      for (let k = 1; k < n; k++) c2.lineTo((tr[k].x + .5) * c, (tr[k].y + .5) * c);
      c2.stroke(); c2.strokeStyle = rgba(col, .18); c2.lineWidth = c * .95; c2.stroke();
      const p = tr[tr.length - 1], cx = (p.x + .5) * c, cy = (p.y + .5) * c;
      if (ex.dead[i]) {
        for (let r = 0; r < 10; r++) {
          const a = r / 10 * Math.PI * 2; c2.strokeStyle = r % 2 ? '#fff' : col; c2.lineWidth = Math.max(1.5, c * .12);
          c2.beginPath(); c2.moveTo(cx + Math.cos(a) * c * .3, cy + Math.sin(a) * c * .3); c2.lineTo(cx + Math.cos(a) * c * 1.1, cy + Math.sin(a) * c * 1.1); c2.stroke();
        }
      } else {
        c2.fillStyle = rgba(col, .25); c2.beginPath(); c2.arc(cx, cy, c * .95, 0, 7); c2.fill();
        c2.fillStyle = i === 0 ? '#ffc94d' : '#fff'; c2.beginPath(); c2.arc(cx, cy, c * .32, 0, 7); c2.fill();
      }
    });
    if (ex.state === 'countdown') {
      // show which way you're facing
      const p = ex.pos[0];
      c2.fillStyle = '#ffc94d'; c2.font = `700 ${Math.round(c * 1.1)}px Barlow, sans-serif`; c2.textAlign = 'center';
      c2.fillText('YOU', (p.x + .5) * c, (p.y - .9) * c);
    }
  }
  function loop(now) {
    requestAnimationFrame(loop); // first, so one bad frame can't stop the board for good
    const dt = Math.min(100, now - (last2 || now)); last2 = now;
    if (ex && ex.state === 'countdown') {
      const left = 3 - Math.floor(Math.max(0, now - ex.t0) / 600); // a frame stamped just before Start still counts from 3
      if (left <= 0) { ex.state = 'live'; $('exCount').hidden = true; acc2 = 0; }
      else { $('exCount').hidden = false; $('exCount').textContent = left; }
    }
    if (ex && ex.state === 'live') {
      acc2 += dt * ex.rate / 1000;
      let moved = false;
      while (acc2 >= 1 && ex.state === 'live') { acc2 -= 1; step(); moved = true; }
      if (moved) draw2();
    }
  }
  const keyDir = { ArrowUp: 0, KeyW: 0, ArrowRight: 1, KeyD: 1, ArrowDown: 2, KeyS: 2, ArrowLeft: 3, KeyA: 3 };
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
    // Space from the page starts a ride when none is running and the board is on screen (the first ride too),
    // and mid-ride it doesn't scroll the board away. With the board off screen it stays with the replay.
    if (e.code === 'Space' && !onControl(e)) {
      if (window.__exActive()) e.preventDefault();
      else if (window.__exReady()) { e.preventDefault(); start(); }
    } else if (e.code in keyDir && window.__exActive()) { e.preventDefault(); steer(keyDir[e.code]); }
  });
  // A swipe turns as soon as the finger has moved 18 px, not when it lifts, and a drag that carries on can turn again
  // from there. Lifting the finger still turns for a flick too quick for a move to be reported.
  let touch = null;
  const swipe = t => {
    const dx = t.clientX - touch.x, dy = t.clientY - touch.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) return;
    steer(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0));
    touch = { x: t.clientX, y: t.clientY };
  };
  $('exBoard').addEventListener('touchstart', e => { const t = e.touches[0]; touch = { x: t.clientX, y: t.clientY }; }, { passive: true });
  $('exBoard').addEventListener('touchmove', e => {
    if (!window.__exActive()) return;
    e.preventDefault();
    if (touch) swipe(e.touches[0]);
  }, { passive: false });
  $('exBoard').addEventListener('touchend', e => { if (touch) swipe(e.changedTouches[0]); touch = null; });
  $('exLeft').onclick = () => turn(-1);
  $('exRight').onclick = () => turn(1);
  $('exGo').onclick = start;
  // A new arena or opponent between rides clears the last result away, back to how the board starts.
  function clearBoard() {
    if (ex && ex.state !== 'over') return; // mid-ride, the ride carries on
    ex = null; draw2();
    $('exMsg').innerHTML = ready(); $('exMsg').hidden = false;
    $('exGo').textContent = 'Start';
  }
  $('exBot').addEventListener('change', () => { clearBoard(); showRecord(); showColour(); });
  showRecord(); showColour();
  $('exMap').onchange = clearBoard;
  window.addEventListener('resize', size2);
  size2();
  requestAnimationFrame(loop);
})();

// ---------- dream match: simulate a brand-new game in the browser, then replay it
(() => {
  const opts = DATA.standings.map(t => `<option value="${t.slug}">${esc(nameOf(t.slug))}</option>`).join('')
    + (DATA.challenge ? `<option value="${DATA.challenge.a}">${esc(nameOf(DATA.challenge.a))}</option>` : '');
  $('dA').innerHTML = opts; $('dB').innerHTML = opts;
  $('dA').value = 'deep-cycle'; $('dB').value = DATA.champion === 'deep-cycle' ? 'the-architect' : DATA.champion;
  $('dMap').innerHTML = DATA.maps.map(m => `<option>${esc(m)}</option>`).join('');
  let busy = false, count = 0;
  $('dGo').onclick = () => {
    if (busy) return;
    const req = window.__botReq, E = req('', 'engine');
    const a = $('dA').value, b = $('dB').value, map = $('dMap').value, seed = (Math.random() * 2 ** 31) | 0;
    const grid = E.makeGrid(map), pos = E.startFor(map, seed), start = pos.map(p => ({ ...p }));
    pos.forEach((p, i) => grid[p.y * W + p.x] = i + 1);
    const rngs = [E.mulberry32(seed * 2 + 1), E.mulberry32(seed * 2 + 2)];
    const ais = [a, b].map((s, i) => req('', window.__modId(s)).factory({ W, H, me: i, rng: rngs[i] }));
    let moves = '', tick = 0, winner = null, reason = 'timeout';
    busy = true; $('dGo').disabled = true;
    const chunk = () => {
      const t0 = performance.now();
      while (performance.now() - t0 < 30) {
        const dirs = [0, 1].map(i => {
          const me = pos[i], opp = pos[1 - i];
          let d = me.dir;
          try { d = ais[i].move({ grid: grid.slice(), W, H, tick, me: { ...me }, opp: { ...opp }, meId: i + 1, oppId: 2 - i, rng: rngs[i] }); } catch (e) { d = me.dir; }
          if (!(d >= 0 && d <= 3) || (d + 2) % 4 === me.dir) d = me.dir;
          return d | 0;
        });
        moves += String.fromCharCode(97 + dirs[0] * 4 + dirs[1]);
        const nx = pos.map((p, i) => ({ x: p.x + DX[dirs[i]], y: p.y + DY[dirs[i]], dir: dirs[i] }));
        const dead = nx.map(n => n.x < 0 || n.y < 0 || n.x >= W || n.y >= H || grid[n.y * W + n.x] !== 0);
        const same = nx[0].x === nx[1].x && nx[0].y === nx[1].y;
        if (same) dead[0] = dead[1] = true;
        nx.forEach((n, i) => { if (!dead[i]) grid[n.y * W + n.x] = i + 1; });
        pos[0] = nx[0]; pos[1] = nx[1]; tick++;
        if (dead[0] || dead[1] || tick >= W * H) {
          winner = dead[0] && dead[1] ? null : dead[0] ? b : dead[1] ? a : null;
          reason = same ? 'head-on' : dead[0] || dead[1] ? 'crash' : 'timeout';
          const g = { i: games.length, stage: 'Dream match', p: [a, b], map, winner, ticks: tick, reason, s: [start[0].x, start[0].y, start[0].dir], moves, gameNo: ++count };
          games.push(g);
          // The archive keeps dream matches, so from the first one on its stage filter offers them too.
          if (![...$('fStage').options].some(o => o.value === g.stage)) $('fStage').insertAdjacentHTML('beforeend', opt(g.stage, g.stage));
          filterGames();
          busy = false; $('dGo').disabled = false;
          if (window.__exActive()) {
            // During a ride it waits on the big screen, paused, rather than pulling the page away from the ride. The big
            // screen above can change height as it loads, so the ride board is put back where it was on screen (Chrome
            // would do that itself; Safari wouldn't).
            const board = $('exBoard'), top = board.getBoundingClientRect().top;
            load(g.i, { autoplay: false });
            window.scrollBy(0, board.getBoundingClientRect().top - top);
            $('dStatus').textContent = `Dream match ${count} is ready on the big screen.`;
          } else {
            $('dStatus').textContent = `Dream match ${count} is on the big screen.`;
            load(g.i, { scroll: true });
          }
          return;
        }
      }
      $('dStatus').textContent = `Simulating… tick ${tick}`;
      setTimeout(chunk, 0);
    };
    $('dStatus').textContent = 'Simulating…';
    setTimeout(chunk, 0);
  };
})();

sizeCanvas();
const first = reel.length ? reel[0].g : DATA.bracket[DATA.bracket.length - 1].ties[0].games.slice(-1)[0];
// With reduced motion the first replay waits for Play; a game you pick still plays straight away.
load(first, { from: 'reel', autoplay: !matchMedia('(prefers-reduced-motion: reduce)').matches });
requestAnimationFrame(frame);
// The territory strip's labels are drawn on a canvas, so draw it again once the fonts have arrived.
if (document.fonts) document.fonts.ready.then(() => { if (cur) { drawMom(); drawMomHead(tick); } });

// Offline copy (sw.js). The one-file copy (tools/artifact.mjs) has no files to keep.
if ('serviceWorker' in navigator && !('single' in document.documentElement.dataset) && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
