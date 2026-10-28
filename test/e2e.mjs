// Uses the page in Chromium the way a person would:  node test/e2e.mjs  (needs Playwright)
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
let offline = false; // when set, the server hangs up on every request, like a phone with no signal
const server = createServer(async (req, res) => {
  if (offline) { req.socket.destroy(); return; }
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let body;
  try { body = await readFile(join(root, path === '/' ? 'index.html' : path)); } catch { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'text/html' });
  res.end(body);
}).listen(0);
const base = `http://localhost:${server.address().port}/`;

const browser = await pw.chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', e => problems.push(e.message));
page.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
page.on('console', m => { if (m.type() === 'warning' && m.text().startsWith('Canvas2D')) problems.push(m.text()); }); // the canvases are drawn the efficient way
page.on('requestfailed', r => problems.push('failed: ' + r.url()));
page.on('request', r => { if (!r.url().startsWith(base)) problems.push('left the site: ' + r.url()); });

await page.goto(base);
await page.evaluate(() => document.fonts.ready);
const count = sel => page.locator(sel).count();
// Starts a ride and steers for the nearest wall, so the bot wins; returns what the board says then.
const loseARide = async p => {
  await p.click('#exGo');
  const d = await p.evaluate(() => {
    const { x, y, dir } = window.__ride().pos[0], room = [y, 39 - x, 29 - y, x];
    return [0, 1, 2, 3].filter(k => k !== (dir + 2) % 4).sort((a, b) => room[a] - room[b])[0];
  });
  await p.keyboard.press(['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'][d]);
  await p.waitForFunction(() => window.__ride().state === 'over', null, { timeout: 30000 });
  const sub = await p.textContent('#exMsg small');
  return { title: (await p.textContent('#exMsg')).slice(0, -sub.length), sub };
};

// The broadcast is all there: the reel, the bracket, the table, the matrix, the riders and the awards.
assert.equal(await count('.clip'), 11, 'highlight reel');
assert.equal(await count('.tie'), 15, 'bracket ties');
assert.equal(await count('#table tbody tr'), 16, 'table rows');
assert.equal(await count('.matrix td[data-a]'), 16 * 15, 'head-to-head cells');
assert.equal(await count('.card'), 16, 'rider cards');
assert.equal(await count('.award'), 8, 'awards');
assert.equal(await page.locator('#challengeSection').isHidden(), false, 'the postscript challenge shows');
assert.match(await page.textContent('#champ'), /The Professor/, 'champion banner');
assert.equal(await page.evaluate(() => !!document.querySelector('#bracket svg.wires path.hot')?.getAttribute('d')), true, 'the champion\'s path is drawn through the bracket');
// The ticker's tape runs twice over so it can loop, but a screen reader reads it once.
assert.equal(((await page.locator('.ticker').ariaSnapshot()).match(/POSTSCRIPT/g) || []).length, 1, 'the ticker is read once');
// Numbers read the same way throughout: 1,023 like the rest of the page, and each table column to the same places.
assert.equal(await page.textContent('#fCount'), '1,023 games, showing the longest 300');
for (const [avg, ms] of await page.$$eval('#table tbody tr', rows => rows.map(r => [r.cells[8].textContent, r.cells[10].textContent]))) {
  assert.match(avg, /^\d+\.\d$/, 'average length');
  assert.match(ms, /^\d+\.\d{3}$/, 'ms per move');
}
assert.ok((await page.$$eval('.card .stats span:nth-child(2) b', bs => bs.map(b => b.textContent))).every(t => /^\d+\.\d$/.test(t)), 'average ticks on the rider cards');
// On a phone the head-to-head numbers keep clear of their cells' edges (0.5 and 7.5 used to touch them), and no
// number widens its cell, so the matrix scrolls sideways no further than its names make it.
const matrix = await page.evaluate(() => {
  const cells = [...document.querySelectorAll('.matrix td[data-a]')], text = document.createRange();
  const touching = cells.filter(td => { text.selectNodeContents(td); const t = text.getBoundingClientRect(), c = td.getBoundingClientRect(); return t.left - c.left < 1.5 || c.right - t.right < 1.5; });
  const widths = cells.map(td => td.getBoundingClientRect().width);
  return { touching: touching.map(td => td.textContent), spread: Math.max(...widths) - Math.min(...widths) };
});
assert.deepEqual(matrix.touching, [], 'numbers touching the edges of their cells');
assert.ok(matrix.spread < 0.5, `some numbers widen their cells (by up to ${matrix.spread} px)`);
// On a phone the replay's buttons are 40 px tall, the speed buttons 44 px wide, and the series chips 36 px tall.
const targets = await page.evaluate(() => {
  const size = sel => [...document.querySelectorAll(sel)].map(e => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height }; });
  return { controls: size('.controls button'), speeds: size('.controls [data-speed]'), chips: size('#series .chip, #chSeries .chip') };
});
assert.ok(targets.controls.length === 6 && targets.controls.every(b => b.h >= 40), 'the replay buttons are 40 px tall');
assert.ok(targets.speeds.length === 4 && targets.speeds.every(b => b.w >= 44), 'the speed buttons are 44 px wide');
assert.ok(targets.chips.length > 6 && targets.chips.every(c => c.h >= 36), 'the series chips are 36 px tall');

// The first highlight plays; jumping to the end shows the verdict, its commentary and the next highlight.
assert.match(await page.textContent('#clipTitle'), /\S/, 'a game is loaded');
assert.equal(await page.textContent('#play'), 'Pause', 'and plays by itself');
await page.evaluate(() => { const s = document.getElementById('scrub'); s.value = s.max; s.dispatchEvent(new Event('input')); });
await page.waitForSelector('#verdict:not([hidden])');
assert.match(await page.textContent('#verdictText'), /wins|Draw/);
assert.ok(await count('#feed .line') >= 5, 'commentary lines in the booth');
const before = await page.textContent('#clipTitle');
await page.click('#nextBtn');
assert.notEqual(await page.textContent('#clipTitle'), before, 'Next highlight loads another game');

// Paused part way through, the territory strip keeps its white playhead when the phone turns or the window resizes.
await page.click('#play');
const playhead = () => page.evaluate(() => {
  const s = document.getElementById('scrub'), mom = document.getElementById('mom');
  const x = Math.floor(+s.value / +s.max * mom.width);
  return [...mom.getContext('2d').getImageData(x, mom.height >> 1, 1, 1).data].join();
});
await page.evaluate(() => { const s = document.getElementById('scrub'); s.value = Math.round(s.max / 2); s.dispatchEvent(new Event('input')); });
const nextFrame = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
assert.equal(await playhead(), '255,255,255,255', 'the playhead is on the strip');
await page.setViewportSize({ width: 390, height: 760 });
await nextFrame();
assert.equal(await playhead(), '255,255,255,255', 'the playhead is still there after a resize');
await page.setViewportSize({ width: 390, height: 844 });
await nextFrame();

// At the end of a highlight, the Next button stays inside the board on a small phone, on one line when it fits.
const nextButton = async (title, width) => {
  await page.setViewportSize({ width, height: 780 });
  return page.evaluate(t => {
    [...document.querySelectorAll('.clip')].find(c => c.querySelector('.ttl').textContent === t).click();
    const s = document.getElementById('scrub'); s.value = s.max; s.dispatchEvent(new Event('input'));
    const b = document.getElementById('nextBtn').getBoundingClientRect(), board = document.querySelector('.canvaswrap').getBoundingClientRect();
    return { inside: b.left >= board.left && b.right <= board.right, height: b.height };
  }, title);
};
assert.equal((await nextButton('The mirror blinks last', 360)).inside, true, 'the longest Next label fits a 360 px phone');
assert.ok((await nextButton('The mirror blinks last', 390)).height < 40, 'the longest Next label stays on one line on a 390 px phone');
await page.setViewportSize({ width: 390, height: 844 });

// The SLOW-MO badge is up only while slow motion plays: not after a pause and a scrub, and not on the final verdict.
const slowmoShown = () => page.evaluate(() => !document.getElementById('slowmo').hidden);
assert.equal(await page.evaluate(() => new Promise(done => {
  [...document.querySelectorAll('.clip')].find(c => c.querySelector('.ttl').textContent === 'Twenty-four ticks of trouble').click();
  const t0 = performance.now();
  (function pauseInSlowMo() { // pause on the first frame the badge shows
    if (!document.getElementById('slowmo').hidden) { document.getElementById('play').click(); done(true); }
    else if (performance.now() - t0 > 30000) done(false);
    else requestAnimationFrame(pauseInSlowMo);
  })();
})), true, 'the SLOW-MO badge shows while slow motion plays');
await page.evaluate(() => { const s = document.getElementById('scrub'); s.value = 3; s.dispatchEvent(new Event('input')); });
await nextFrame();
assert.equal(await slowmoShown(), false, 'no SLOW-MO badge once paused and scrubbed back');
await page.click('#play');
await page.waitForSelector('#verdict:not([hidden])', { timeout: 30000 });
await nextFrame();
assert.equal(await slowmoShown(), false, 'no SLOW-MO badge on the verdict');

// Commentary can be written for any game: every highlight and every ninth game besides.
// Its count of open cells is right on every arena. Crossroads lists four wall cells twice, but it has 64, not 68:
// game 23 there has 734 open cells at tick 200.
const written = await page.evaluate(async () => {
  const { DATA } = await import(new URL('js/data.js', location.href));
  const E = window.__botReq('', 'engine'), ids = [23], wrong = [];
  for (let i = 0; i < 1023; i += 9) ids.push(i);
  for (const b of document.querySelectorAll('.clip')) ids.push(+b.dataset.g);
  let milestones = 0;
  for (const i of ids) {
    const lines = window.__lines(i);
    if (!lines.length) throw new Error('no lines for game ' + i);
    const open = E.W * E.H - E.makeGrid(DATA.games[i].map).filter(v => v === 3).length;
    for (const { text } of lines) {
      const m = text.match(/^Tick (\d+) and still no wall between them\. (\d+) open cells/);
      if (m) { milestones++; if (+m[2] !== open - 2 * (+m[1] + 1)) wrong.push(`game ${i}: ${text}`); }
    }
  }
  return { n: ids.length, milestones, wrong };
});
assert.ok(written.n > 100);
assert.ok(written.milestones >= 10, 'the booth counts the open cells in long games');
assert.deepEqual(written.wrong, [], 'open cells left on the grid');
// A hand-written highlight speaks for itself: one opening line, its own verdict on the seal, and in "Twenty-four
// ticks of trouble" the booth says Bloodhound has nowhere left to go once, not twice.
const reelTalk = await page.evaluate(() => [...document.querySelectorAll('.clip')].map(b => ({ title: b.querySelector('.ttl').textContent, lines: window.__lines(+b.dataset.g) })));
for (const { title, lines } of reelTalk) {
  assert.equal(lines.filter(l => l.tick === 0).length, 1, `${title}: one opening line`);
  assert.ok(!lines.some(l => /Barring a meltdown|cells in it\. |pure fill-off now/.test(l.text)), `${title}: no generated verdict on the seal`);
}
assert.equal(reelTalk.find(r => r.title === 'Twenty-four ticks of trouble').lines.filter(l => /nowhere left to go/.test(l.text)).length, 1);

// Dream matches: the challenger has no seed or table place to talk about, and a bot against itself isn't compared with itself.
const dreamTalk = await page.evaluate(async () => {
  const { DATA } = await import(new URL('js/data.js', location.href)); // the same module the page uses
  const n = DATA.games.length, base = DATA.games.find(g => g.stage === 'Round robin'), out = [];
  for (const p of [['the-challenger', 'deep-cycle'], ['random-randy', 'the-challenger'], ['the-professor', 'the-professor']])
    for (let k = 0; k < 4; k++) {
      DATA.games.push({ ...base, i: DATA.games.length, stage: 'Dream match', p, gameNo: k + 1 });
      out.push([p.join(' v '), window.__lines(DATA.games.length - 1).find(l => l.tick === 1 && l.who === 'vera').text]);
    }
  DATA.games.length = n;
  return out;
});
for (const [pair, line] of dreamTalk) {
  assert.doesNotMatch(line, /seed|in the table/, `${pair}: ${line}`);
  if (pair === 'the-professor v the-professor') assert.doesNotMatch(line, /different philosophies/, `${pair}: ${line}`);
}

// A knockout game shows its series; a chip loads that game of the series.
await page.locator('.tie').last().click();
await page.waitForSelector('#series:not([hidden]) .chip');
await page.locator('#series .chip').first().click();
assert.match(await page.textContent('#stageName'), /Final · G1/);
// Each chip says which game it is, where, and who won it, to a screen reader as in its tooltip.
const chipLabels = await page.$$eval('#series .chip', cs => cs.map(c => [c.getAttribute('aria-label'), c.title]));
assert.deepEqual(chipLabels.map(c => c[1]), chipLabels.map(c => c[0]), 'the tooltips say the same');
assert.match(chipLabels[0][0], /^Game 1, [A-Za-z ]+: a draw$/, 'the final opened with a draw');
assert.equal(chipLabels[5][0], 'Game 6, Pillars: The Professor won');
assert.match(await page.getAttribute('#chSeries .chip', 'aria-label'), /^Game 1, [A-Za-z ]+: .+ won$/, 'and so do the postscript\'s chips');
// On a phone the scorebug's names take two lines rather than being cut, beside the series score, down to 360 px:
// every game of every knockout tie and of the challenge, at its last tick.
for (const width of [360, 390]) {
  await page.setViewportSize({ width, height: 844 });
  const cut = await page.evaluate(() => {
    const out = new Set();
    const look = () => {
      const s = document.getElementById('scrub'); s.value = s.max; s.dispatchEvent(new Event('input'));
      for (const id of ['nm0', 'nm1']) { const n = document.getElementById(id); if (n.scrollWidth > n.clientWidth) out.add(n.textContent); }
    };
    for (const tie of document.querySelectorAll('.tie')) {
      tie.click();
      const games = document.querySelectorAll('#series .chip').length; // the chips are drawn again with each game
      for (let k = 0; k < games; k++) { document.querySelectorAll('#series .chip')[k].click(); look(); }
    }
    for (const chip of document.querySelectorAll('#chSeries .chip')) { chip.click(); look(); }
    return [...out];
  });
  assert.deepEqual(cut, [], `names cut short in the scorebug at ${width} px`);
}
await page.setViewportSize({ width: 390, height: 844 });

// Every bot runs in the browser and answers with a legal move.
const bots = await page.evaluate(() => {
  const req = window.__botReq, E = req('', 'engine'), out = [];
  for (const o of document.querySelectorAll('#exBot option')) {
    const grid = E.makeGrid('Pillars'), [me, opp] = E.startFor('Pillars', 7), rng = E.mulberry32(7);
    grid[me.y * E.W + me.x] = 1; grid[opp.y * E.W + opp.x] = 2;
    const d = req('', window.__modId(o.value)).factory({ W: E.W, H: E.H, me: 0, rng }).move({ grid: grid.slice(), W: E.W, H: E.H, tick: 0, me, opp, meId: 1, oppId: 2, rng });
    out.push([o.value, d]);
  }
  return out;
});
assert.equal(bots.length, 17);
for (const [slug, d] of bots) assert.ok([0, 1, 2, 3].includes(d), `${slug} answered ${d}`);

// Read the code: a rider card opens its bot's source (filled in when the card's toggle event arrives, just after the click).
await page.locator('.card details summary').first().click();
await page.waitForFunction(() => document.querySelector('.card details pre').textContent);
assert.match(await page.locator('.card details pre').first().textContent(), /module\.exports/);

// The archive filters by bot and arena.
await page.selectOption('#fBot', 'deep-cycle');
await page.selectOption('#fMap', 'Crossroads');
assert.match(await page.textContent('#fCount'), /^\d+ games?$/);
assert.ok(await count('#results .gr') > 0, 'filtered games listed');
assert.match(await page.locator('#results .gr').first().innerText(), /→ \S/, 'each game in the archive says who won, on a phone too');
// The same bot as bot and opponent finds its games against itself, and the tournament has none.
await page.selectOption('#fMap', '');
await page.selectOption('#fBot', 'chicken');
await page.selectOption('#fBot2', 'chicken');
assert.equal(await page.textContent('#fCount'), '0 games', 'Chicken against Chicken');
await page.selectOption('#fBot2', '');
// A search with no games says so.
await page.selectOption('#fBot', 'random-randy');
await page.selectOption('#fStage', 'Final');
assert.equal(await page.textContent('#results'), 'No games match those filters.');
await page.selectOption('#fStage', '');

// A dream match plays a brand-new game and puts it on the big screen.
await page.selectOption('#dA', 'spacey');
await page.selectOption('#dB', 'wallflower');
await page.click('#dGo');
await page.waitForFunction(() => /Dream match 1 is on the big screen/.test(document.getElementById('dStatus').textContent), null, { timeout: 30000 });
assert.match(await page.textContent('#stageName'), /Dream match/);
// A bot against itself: the territory strip tells the two sides apart, as the scorebug does.
await page.evaluate(() => {
  const fill = CanvasRenderingContext2D.prototype.fillText;
  window.__stripLabels = [];
  CanvasRenderingContext2D.prototype.fillText = function (text, ...rest) { if (this.canvas.id === 'mom') window.__stripLabels.push(text); return fill.call(this, text, ...rest); };
});
await page.selectOption('#dA', 'barry-straight');
await page.selectOption('#dB', 'barry-straight');
await page.click('#dGo');
await page.waitForFunction(() => /Dream match 2 is on the big screen/.test(document.getElementById('dStatus').textContent), null, { timeout: 30000 });
assert.equal(await page.textContent('#nm1'), 'Barry Straight II');
const stripLabels = await page.evaluate(() => window.__stripLabels.slice(-2));
assert.deepEqual(stripLabels, ['TERRITORY · BARRY STRAIGHT II', 'BARRY STRAIGHT I'], 'the territory strip names both sides');
// The archive keeps the dream matches, and once there is one its stage filter offers them.
await page.selectOption('#fBot', '');
await page.selectOption('#fStage', 'Dream match');
assert.equal(await page.textContent('#fCount'), '2 games');
assert.equal(await count('#results .gr'), 2, 'both dream matches are listed');
await page.selectOption('#fStage', '');

// A saved record mangled by hand can't stop the rides, and the other bots' records stay exactly as they were.
const chickenRecord = '"chicken":{"W":2,"D":0,"L":1}';
await page.evaluate(r => localStorage.setItem('grid-classic.record', `{"barry-straight":"abc",${r}}`), chickenRecord);
await page.reload();
await page.evaluate(() => document.fonts.ready);

// Ride against a bot: go straight until something gives, and the result counts towards your record.
// Swipes on the board steer only during a ride; the rest of the time it scrolls the page like everything else.
const touchAction = () => page.$eval('#exBoard', b => getComputedStyle(b).touchAction);
assert.equal(await touchAction(), 'auto', 'the board scrolls the page before a ride');
assert.equal(await page.textContent('#exMsg small'), 'Swipe or use the turn buttons', 'a touch screen is told to swipe, not to use keys');
await page.selectOption('#exBot', 'barry-straight');
await page.selectOption('#exSpeed', '13');
await page.click('#exGo');
// The countdown is a small tab at the board's top edge, no more than two cells tall, so it can't cover either rider
// or the YOU label (riders start four or more rows down). The box in the middle is kept for results.
const countdown = await page.evaluate(() => new Promise(done => requestAnimationFrame(() => {
  const board = document.getElementById('exArena').getBoundingClientRect(), tab = document.getElementById('exCount'), r = tab?.getBoundingClientRect();
  done({ state: window.__ride().state, box: !document.getElementById('exMsg').hidden, tab: tab && !tab.hidden && tab.textContent, top: r && r.top - board.top, rows: r && (r.bottom - board.top) / (board.width / 40) });
})));
assert.equal(countdown.state, 'countdown');
assert.equal(countdown.box, false, 'no box in the middle of the board during the countdown');
assert.match(String(countdown.tab), /^[123]$/, 'the countdown shows in its tab');
assert.ok(countdown.top >= -0.5 && countdown.rows <= 2, `the countdown tab reaches ${countdown.rows} rows down the board`);
// A swipe turns as soon as the finger has moved 18 px, before it lifts, and the same drag carrying on turns again from
// there; lifting the finger then adds nothing. A flick with no move reported still turns when it lifts.
const swipes = await page.evaluate(() => {
  const ex = window.__ride(), board = document.getElementById('exBoard'), r = board.getBoundingClientRect();
  const send = (type, x, y) => {
    const t = new Touch({ identifier: 1, target: board, clientX: x, clientY: y });
    board.dispatchEvent(new TouchEvent(type, { touches: type === 'touchend' ? [] : [t], changedTouches: [t], bubbles: true, cancelable: true }));
  };
  const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0], from = ex.queue.length;
  const a = ((ex.queue.length ? ex.queue[ex.queue.length - 1] : ex.pos[0].dir) + 1) % 4, b = (a + 1) % 4;
  let x = r.left + r.width / 2, y = r.top + r.height / 2;
  send('touchstart', x, y);
  x += DX[a] * 24; y += DY[a] * 24; send('touchmove', x, y);
  const moved = ex.queue.slice(from);
  x += DX[b] * 24; y += DY[b] * 24; send('touchmove', x, y);
  const carriedOn = ex.queue.slice(from);
  send('touchend', x, y);
  const lifted = ex.queue.slice(from);
  send('touchstart', x, y); send('touchend', x + DX[a] * 30, y + DY[a] * 30);
  return { a, b, moved, carriedOn, lifted, flicked: ex.queue.slice(from) };
});
assert.deepEqual(swipes.moved, [swipes.a], 'a swipe turns once the finger has moved 18 px');
assert.deepEqual(swipes.carriedOn, [swipes.a, swipes.b], 'and the same drag carrying on turns again');
assert.deepEqual(swipes.lifted, [swipes.a, swipes.b], 'lifting the finger then adds nothing');
assert.deepEqual(swipes.flicked, [swipes.a, swipes.b, swipes.a], 'a flick turns when it lifts');
await page.waitForFunction(() => window.__exActive(), null, { timeout: 5000 });
assert.equal(await touchAction(), 'none', 'swipes on the board steer during a ride');
await page.waitForFunction(() => !window.__exActive(), null, { timeout: 30000 });
assert.equal(await touchAction(), 'auto', 'the board scrolls the page again once the ride is over');
assert.match(await page.textContent('#exMsg'), /You win!|Barry Straight wins|Draw/);
assert.match(await page.textContent('#exRec'), /^Your record against Barry Straight: \d won, \d drawn, \d lost$/);
// A new arena between rides clears the last result away.
await page.selectOption('#exMap', 'Pillars');
assert.match(await page.textContent('#exMsg'), /^Ready when you are/, 'a new arena clears the last result');
assert.equal(await page.textContent('#exGo'), 'Start');
// The turn buttons (shown on touch screens) steer too.
await page.click('#exGo');
await page.waitForFunction(() => window.__exActive(), null, { timeout: 5000 });
await page.locator('#exRight').dispatchEvent('click');
await page.waitForFunction(() => !window.__exActive(), null, { timeout: 30000 });
const rec = await page.textContent('#exRec');
await page.selectOption('#exBot', 'random-randy');
assert.match(await page.textContent('#exMsg'), /^Ready when you are/, 'so does a new opponent');
// The record is still there after a reload.
await page.reload();
await page.evaluate(() => document.fonts.ready);
await page.selectOption('#exBot', 'barry-straight');
assert.equal(await page.textContent('#exRec'), rec, 'record kept after a reload');
assert.match(rec, /: \d won, \d drawn, \d lost$/);
const total = rec.match(/\d+/g).map(Number).reduce((a, b) => a + b, 0);
assert.equal(total, 2, 'two rides counted');
assert.ok((await page.evaluate(() => localStorage.getItem('grid-classic.record'))).includes(chickenRecord), 'another bot\'s record is untouched');
await page.selectOption('#exBot', 'chicken');
assert.equal(await page.textContent('#exRec'), 'Your record against Chicken: 2 won, 0 drawn, 1 lost');

// You ride the white cycle, and gold against Chicken, who rides white: the help names the colour for the bot picked,
// and the board draws it so.
const helpFor = async slug => { await page.selectOption('#exBot', slug); return page.textContent('.expanel .help'); };
assert.match(await helpFor('chicken'), /^You ride the gold cycle\. /);
assert.match(await helpFor('the-professor'), /^You ride the white cycle\. /);
const yourTrail = async slug => {
  await page.selectOption('#exBot', slug);
  await page.click('#exGo');
  await page.waitForFunction(() => window.__ride().state === 'live' && window.__ride().tick >= 3, null, { timeout: 15000 });
  return page.evaluate(() => { // the cell after your start, copied out so the board's own canvas isn't read back
    const board = document.getElementById('exArena'), c = board.width / 40, p = window.__ride().trails[0][1];
    const px = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true });
    px.drawImage(board, Math.floor((p.x + .5) * c), Math.floor((p.y + .5) * c), 1, 1, 0, 0, 1, 1);
    return [...px.getImageData(0, 0, 1, 1).data].slice(0, 3);
  });
};
const [againstChicken, againstProfessor] = [await yourTrail('chicken'), await yourTrail('the-professor')];
assert.ok(againstChicken[2] < 120 && againstChicken[1] < 200, `your trail is gold against Chicken: ${againstChicken}`);
assert.ok(againstProfessor.every(v => v > 200), `your trail is white against The Professor: ${againstProfessor}`);
// Lose a ride on a touch screen and the board says to tap Start, not to press Space.
const lostOnPhone = await loseARide(page);
assert.equal(lostOnPhone.title, 'The Professor wins');
assert.match(lostOnPhone.sub, /^You lasted \d+ ticks\. Tap Start to go again\.$/);

// Fits a phone: nothing scrolls sideways.
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'the page scrolls sideways on a phone');

// Works offline once it has been opened. Playwright's offline switch doesn't reach the service worker's own
// requests, so the server stops answering too: the page, its code and its fonts all have to come from the worker's copy.
await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 15000 });
offline = true;
await ctx.setOffline(true);
await page.reload();
await page.evaluate(() => document.fonts.ready);
assert.ok(await page.title(), 'the page did not load offline');
assert.equal(await count('.clip'), 11, 'the reel is there offline');
assert.equal(await page.evaluate(() => [...document.fonts].some(f => f.family.includes('Big Shoulders') && f.status === 'loaded')), true, 'the fonts are there offline');
await ctx.setOffline(false);
offline = false;

// On a desktop, Space presses whichever button has focus; it works the replay and the rides only from the page itself.
{
  // Reduced motion makes the page's jumps to the big screen instant, so a smooth scroll can't race the checks below.
  const desk = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce', serviceWorkers: 'block' })).newPage();
  desk.on('pageerror', e => problems.push(e.message));
  await desk.goto(base);
  await desk.evaluate(() => document.fonts.ready);
  // With reduced motion the first replay waits for Play, and the booth's lines don't slide in.
  assert.equal(await desk.textContent('#play'), 'Play', 'the first replay waits for Play');
  await desk.waitForTimeout(300);
  assert.equal(await desk.textContent('#tick'), '000', 'at its start');
  assert.equal(await desk.$eval('#feed .line', l => getComputedStyle(l).animationName), 'none', 'the commentary doesn\'t slide in');
  // The head-to-head matrix is one tab stop. The arrows move between its cells, over each bot's own empty cell, without
  // working the replay, and Enter or Space opens the pair's longest game, as a click does.
  const rows = await desk.$$eval('.matrix tbody tr', trs => trs.map(tr => [tr.querySelector('td[data-a]').dataset.a, tr.querySelector('th').textContent]));
  const stops = () => desk.$$eval('.matrix td[data-a]', tds => tds.filter(td => td.tabIndex === 0).length);
  const focused = () => desk.evaluate(() => { const td = document.activeElement; return td.dataset.a ? `${td.dataset.a} v ${td.dataset.b}` : td.tagName; });
  const onScreen = async () => [await desk.textContent('#nm0'), await desk.textContent('#nm1')].sort();
  assert.equal(await stops(), 1, 'the matrix is one tab stop');
  await desk.focus('.matrix td[tabindex="0"]');
  assert.equal(await focused(), `${rows[0][0]} v ${rows[1][0]}`);
  for (const key of ['ArrowRight', 'ArrowDown', 'ArrowLeft']) await desk.keyboard.press(key);
  assert.equal(await focused(), `${rows[1][0]} v ${rows[0][0]}`, 'the arrows move between the cells, over the empty diagonal');
  assert.equal(await desk.textContent('#tick'), '000', 'and leave the replay alone');
  assert.equal(await stops(), 1, 'still one tab stop');
  await desk.keyboard.press('Enter');
  assert.deepEqual(await onScreen(), [rows[0][1], rows[1][1]].sort(), 'Enter opens their game');
  await desk.keyboard.press('ArrowRight');
  await desk.keyboard.press('Space');
  assert.deepEqual(await onScreen(), [rows[1][1], rows[2][1]].sort(), 'and so does Space');
  assert.equal(await desk.textContent('#play'), 'Pause', 'which plays, not paused by the page\'s own Space');
  // A click on a cell opens its game and lets go of the cell, so the page's keys work that game: Space pauses it, and
  // the arrows skip through it rather than taking the page back down to the matrix.
  await desk.click('.matrix td[data-a] >> nth=20');
  assert.equal(await desk.evaluate(() => !!document.activeElement.closest('.matrix')), false, 'a click on a cell lets go of it');
  await desk.keyboard.press('Space');
  assert.equal(await desk.textContent('#play'), 'Play', 'so Space pauses the game it opened');
  const pausedAt = +(await desk.textContent('#tick'));
  await desk.keyboard.press('ArrowRight');
  assert.equal(+(await desk.textContent('#tick')), pausedAt + 10, 'and the arrows skip through it');
  const press = async (sel, key = 'Space') => { await desk.focus(sel); await desk.keyboard.press(key); };
  const riding = () => desk.evaluate(() => !!window.__exActive());
  await press('.clip:nth-child(3)');
  assert.equal(await desk.textContent('#clipTitle'), await desk.textContent('.clip:nth-child(3) .ttl'), 'Space on a highlight loads it');
  assert.equal(await desk.textContent('#play'), 'Pause', 'and plays it');
  await press('[data-speed="0.5"]');
  assert.equal(await desk.getAttribute('[data-speed="0.5"]', 'class'), 'btn on', 'Space on a speed button picks that speed');
  await press('.card details summary');
  assert.equal(await desk.locator('.card details').first().evaluate(d => d.open), true, 'Space on Read the code opens it');
  await desk.click('#play');
  assert.equal(await desk.textContent('#play'), 'Play');
  const t0 = +await desk.textContent('#tick');
  await desk.keyboard.press('ArrowRight');
  assert.equal(+await desk.textContent('#tick'), t0 + 10, 'the arrows still skip ahead after clicking Pause');
  await press('#results .gr');
  assert.equal(await desk.textContent('#play'), 'Pause', 'Space on an archive game plays it, like Enter');
  await desk.evaluate(() => document.activeElement.blur());
  await desk.keyboard.press('Space');
  assert.equal(await desk.textContent('#play'), 'Play', 'Space from the page pauses the replay');
  assert.equal(await riding(), false, 'and starts no ride while the ride board is off screen');
  // With the ride board on screen and no ride running, Space from the page starts one, the first ride included.
  const toBoard = () => desk.evaluate(() => { document.activeElement.blur(); window.scrollTo(0, document.getElementById('exhibition').getBoundingClientRect().top + scrollY - 44); });
  await desk.selectOption('#exSpeed', '13');
  await toBoard();
  await desk.keyboard.press('Space');
  assert.equal(await riding(), true, 'Space from the page starts the first ride');
  await desk.waitForFunction(() => !window.__exActive(), null, { timeout: 30000 });
  await press('#exGo');
  assert.equal(await riding(), true, 'Space on Start starts a ride');
  await desk.waitForFunction(() => !window.__exActive(), null, { timeout: 30000 });
  await press('.clip:nth-child(4)');
  assert.equal(await desk.textContent('#clipTitle'), await desk.textContent('.clip:nth-child(4) .ttl'), 'after a ride, Space on a highlight loads it');
  assert.equal(await riding(), false, 'and leaves the finished ride alone');
  await desk.selectOption('#exSpeed', '6');
  await desk.evaluate(() => document.activeElement.blur());
  await desk.keyboard.press('Space');
  assert.equal(await desk.textContent('#play'), 'Play', 'with the ride board off screen, Space from the page works the replay');
  assert.equal(await riding(), false, 'and doesn\'t start a ride out of sight');
  await toBoard();
  await desk.keyboard.press('Space');
  assert.equal(await riding(), true, 'Space from the page starts the next ride');
  // Mid-ride, Space from the page leaves the board where it is; on the focused Restart button it still restarts.
  await desk.evaluate(() => { window.__thisRide = window.__ride(); });
  const y = await desk.evaluate(() => scrollY);
  await desk.keyboard.press('Space');
  await desk.waitForTimeout(300);
  assert.equal(await desk.evaluate(() => scrollY), y, 'Space mid-ride doesn\'t scroll the board away');
  assert.equal(await desk.evaluate(() => window.__ride() === window.__thisRide && window.__exActive()), true, 'and the ride carries on');
  await press('#exGo');
  assert.equal(await desk.evaluate(() => window.__ride() !== window.__thisRide && window.__ride().state), 'countdown', 'Space on Restart restarts the ride');
  // A new opponent picked mid-ride waits for the next ride; the record shown at the end is for the bot you rode against.
  await desk.selectOption('#exBot', 'chicken');
  assert.equal(await riding(), true, 'the ride carries on');
  await desk.waitForFunction(() => !window.__exActive(), null, { timeout: 30000 });
  assert.match(await desk.textContent('#exRec'), /^Your record against The Professor: /);
  // With a mouse and keyboard, the board talks about the keys: before a ride, and after one you lose.
  await desk.selectOption('#exBot', 'the-professor');
  assert.equal(await desk.textContent('#exMsg small'), 'Arrow keys or WASD to steer');
  const lostOnDesk = await loseARide(desk);
  assert.equal(lostOnDesk.title, 'The Professor wins');
  assert.match(lostOnDesk.sub, /^You lasted \d+ ticks\. Space or Start to go again\.$/);
  await desk.context().close();
}

// A phone turned sideways shows the whole ride board under the top bar, in the middle, and the page still fits.
{
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' })).newPage();
  phone.on('pageerror', e => problems.push(e.message));
  await phone.goto(base);
  await phone.evaluate(() => document.fonts.ready);
  const board = () => phone.evaluate(() => {
    const b = document.getElementById('exArena').getBoundingClientRect(), col = document.getElementById('exBoard').getBoundingClientRect();
    return { width: b.width, height: b.height, column: col.width, left: b.left - col.left, right: col.right - b.right, room: innerHeight - 44, fits: document.documentElement.scrollWidth <= innerWidth };
  });
  const upright = await board();
  assert.ok(Math.abs(upright.width - upright.column) <= 1, 'held upright, the board is as wide as its column');
  await phone.setViewportSize({ width: 844, height: 390 });
  await phone.waitForFunction(w => document.getElementById('exArena').getBoundingClientRect().width !== w, upright.width, { timeout: 5000 });
  const sideways = await board();
  assert.ok(sideways.height <= sideways.room, `held sideways, the board is ${sideways.height} px tall with ${sideways.room} px under the top bar`);
  assert.ok(Math.abs(sideways.left - sideways.right) <= 1, 'and in the middle of its column');
  assert.equal(sideways.fits, true, 'the page scrolls sideways on a phone held sideways');
  await phone.context().close();
}

// A dream match that finishes during a ride waits on the big screen, paused, and the ride board stays where it is.
{
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, reducedMotion: 'reduce', serviceWorkers: 'block' })).newPage();
  phone.on('pageerror', e => problems.push(e.message));
  await phone.goto(base);
  await phone.evaluate(() => document.fonts.ready);
  await phone.selectOption('#dA', 'spacey');
  await phone.selectOption('#dB', 'wallflower');
  const boardTop = () => phone.evaluate(() => document.getElementById('exBoard').getBoundingClientRect().top);
  await phone.evaluate(() => {
    document.documentElement.style.overflowAnchor = 'none'; // as in Safari, which doesn't hold the page still by itself
    window.scrollTo(0, document.getElementById('exBoard').getBoundingClientRect().top + scrollY - 44);
    document.getElementById('exGo').click();
    window.__ride().t0 = Infinity; // the countdown holds, so the ride is still on when the match ends
    document.getElementById('dGo').click();
  });
  const top = await boardTop();
  await phone.waitForFunction(() => /^Dream match 1 is/.test(document.getElementById('dStatus').textContent), null, { timeout: 30000 });
  assert.equal(await phone.textContent('#dStatus'), 'Dream match 1 is ready on the big screen.');
  assert.match(await phone.textContent('#stageName'), /Dream match/, 'the match is on the big screen');
  assert.equal(await phone.textContent('#play'), 'Play', 'paused');
  assert.ok(Math.abs(await boardTop() - top) < 1, 'and the ride board stays where it was on screen');
  assert.equal(await phone.evaluate(() => window.__exActive()), true, 'with the ride still on');
  await phone.context().close();
}

// With JavaScript off, a phone shows what the page needs it for on the first screen, and the page still fits.
{
  const nojs = await (await browser.newContext({ viewport: { width: 390, height: 844 }, javaScriptEnabled: false, serviceWorkers: 'block' })).newPage();
  await nojs.goto(base);
  const note = await nojs.locator('.noscript').boundingBox();
  assert.ok(note && note.y + note.height < 844, 'the note about JavaScript is on the first screen');
  assert.equal(await nojs.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'the page scrolls sideways without JavaScript');
  await nojs.context().close();
}

assert.deepEqual(problems.filter(p => !p.startsWith('failed:')), [], 'problems while using it');
// Offline, checked the junkdrawer house kit's way, from a server that answers like GitHub Pages: a browser may keep
// each file for ten minutes, and asks again by its ETag. `net` is the connection: 'up', 'down' (the server drops every
// connection) or 'stalled' (a plane's or a train's wifi: it takes each request and holds on to it). With `release`
// set it serves the next release. The server's own switches are needed because the browser's offline switch can't
// make a stall, and in some Chromium builds it doesn't stop the service worker's own requests.
{
  const { createServer } = await import('node:http');
  const { readFile } = await import('node:fs/promises');
  const { join, extname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { createHash } = await import('node:crypto');
  const root = fileURLToPath(new URL('..', import.meta.url));
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
  let net = 'up', release = false;
  const held = [];
  const server = createServer((req, res) => {
    if (net === 'down') { req.socket.destroy(); return; }
    if (net === 'stalled') { held.push([req, res]); return; }
    serve(req, res);
  }).listen(0);
  async function serve(req, res) {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    let body;
    try { body = await readFile(join(root, path)); } catch { res.writeHead(404); res.end(); return; }
    if (release && path === '/sw.js') body = Buffer.from(String(body).replace(/const FILES = '[0-9a-f]*'/, "const FILES = 'next'"));
    if (release && path === '/index.html') body = Buffer.concat([body, Buffer.from('<!-- the next release -->\n')]);
    const etag = `"${createHash('sha1').update(body).digest('hex').slice(0, 16)}"`;
    const head = { etag, 'cache-control': 'max-age=600', 'content-type': TYPES[extname(path)] || 'text/html' };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, head); res.end(); return; }
    res.writeHead(200, head);
    res.end(body);
  }
  const base = `http://localhost:${server.address().port}/`;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', e => problems.push(e.message));
  await page.goto(base);
  await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 15000 });
  const title = await page.title();

  // Works offline once it has been opened.
  net = 'down';
  await ctx.setOffline(true);
  await page.reload();
  assert.equal(await page.title(), title, 'the page did not open offline');
  await ctx.setOffline(false);

  // On a connection that's up but not answering, it opens from the copy too, after the worker's few seconds' wait for
  // the network: the page and every file it loads (were any of them left waiting on the network, it wouldn't open).
  net = 'stalled';
  const t0 = Date.now();
  await page.reload({ timeout: 10000 }).catch(() => {});
  const took = Date.now() - t0;
  assert.ok(took < 8000, `the page took ${took} ms to open on a stalled connection`);
  assert.equal(await page.title(), title, 'the page did not open on a stalled connection');
  net = 'up';
  for (const [req, res] of held.splice(0)) serve(req, res);

  // A new release: every file in the new copy comes from the server, though the browser still has its own copies of
  // the old ones for ten minutes. (The next release changes index.html, and so FILES in sw.js, as a real one does.)
  release = true;
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  for (const end = Date.now() + 10000; !(await page.evaluate(async () => !!(await (await caches.match('index.html'))?.text())?.includes('<!-- the next release -->')));) {
    assert.ok(Date.now() < end, "the new release's offline copy kept the old index.html");
    await new Promise(r => setTimeout(r, 100));
  }
  assert.deepEqual(problems, [], 'problems while offline or on a stalled connection');
  await ctx.close();
  server.close();

  // sw.js changes whenever a file it keeps does, so a release replaces the whole offline copy at once: FILES in sw.js
  // is a fingerprint of every file in SHELL (sha1 of each, in the list's order, an address like './' read as its
  // index.html; the first 8 hex of the sha1 of those).
  const sw = await readFile(join(root, 'sw.js'), 'utf8');
  const shell = [...sw.match(/SHELL = \[([^\]]*)\]/)[1].replace(/\/\/.*/g, '').matchAll(/'([^']*)'/g)].map(m => m[1]);
  const all = createHash('sha1');
  for (const f of shell) all.update(createHash('sha1').update(await readFile(join(root, f.endsWith('/') ? f + 'index.html' : f))).digest());
  const files = all.digest('hex').slice(0, 8);
  assert.equal(sw.match(/const FILES = '([0-9a-f]*)'/)?.[1], files, `a file sw.js keeps for offline has changed: set FILES in sw.js to '${files}'`);
}

await browser.close();
server.close();
console.log('all good');
