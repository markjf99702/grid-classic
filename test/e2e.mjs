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
page.on('requestfailed', r => problems.push('failed: ' + r.url()));
page.on('request', r => { if (!r.url().startsWith(base)) problems.push('left the site: ' + r.url()); });

await page.goto(base);
await page.evaluate(() => document.fonts.ready);
const count = sel => page.locator(sel).count();

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

// The first highlight plays; jumping to the end shows the verdict, its commentary and the next highlight.
assert.match(await page.textContent('#clipTitle'), /\S/, 'a game is loaded');
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
assert.ok((await nextButton('Twenty-four ticks of trouble', 390)).height < 40, 'a Next label that fits stays on one line');
await page.setViewportSize({ width: 390, height: 844 });

// Commentary can be written for any game: every highlight and every ninth game besides.
const written = await page.evaluate(() => {
  let n = 0;
  for (let i = 0; i < 1023; i += 9) { if (!window.__lines(i).length) throw new Error('no lines for game ' + i); n++; }
  for (const b of document.querySelectorAll('.clip')) { window.__lines(+b.dataset.g); n++; }
  return n;
});
assert.ok(written > 100);

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

// A dream match plays a brand-new game and puts it on the big screen.
await page.selectOption('#dA', 'spacey');
await page.selectOption('#dB', 'wallflower');
await page.click('#dGo');
await page.waitForFunction(() => /Dream match 1 is on the big screen/.test(document.getElementById('dStatus').textContent), null, { timeout: 30000 });
assert.match(await page.textContent('#stageName'), /Dream match/);

// A saved record mangled by hand can't stop the rides, and the other bots' records stay exactly as they were.
const chickenRecord = '"chicken":{"W":2,"D":0,"L":1}';
await page.evaluate(r => localStorage.setItem('grid-classic.record', `{"barry-straight":"abc",${r}}`), chickenRecord);
await page.reload();
await page.evaluate(() => document.fonts.ready);

// Ride against a bot: go straight until something gives, and the result counts towards your record.
// Swipes on the board steer only during a ride; the rest of the time it scrolls the page like everything else.
const touchAction = () => page.$eval('#exBoard', b => getComputedStyle(b).touchAction);
assert.equal(await touchAction(), 'auto', 'the board scrolls the page before a ride');
await page.selectOption('#exBot', 'barry-straight');
await page.selectOption('#exSpeed', '13');
await page.click('#exGo');
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
  const press = async (sel, key = 'Space') => { await desk.focus(sel); await desk.keyboard.press(key); };
  const riding = () => desk.evaluate(() => window.__exActive());
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
  await desk.selectOption('#exSpeed', '13');
  await press('#exGo');
  assert.equal(await riding(), true, 'Space on Start starts a ride');
  await desk.waitForFunction(() => !window.__exActive(), null, { timeout: 30000 });
  await press('.clip:nth-child(4)');
  assert.equal(await desk.textContent('#clipTitle'), await desk.textContent('.clip:nth-child(4) .ttl'), 'after a ride, Space on a highlight loads it');
  assert.equal(await riding(), false, 'and leaves the finished ride alone');
  await desk.selectOption('#exSpeed', '6');
  await desk.evaluate(() => document.activeElement.blur());
  await desk.keyboard.press('Space');
  assert.equal(await riding(), true, 'Space from the page starts the next ride');
  // Mid-ride, Space from the page leaves the board where it is; on the focused Restart button it still restarts.
  await desk.evaluate(() => { window.scrollTo(0, document.getElementById('exhibition').getBoundingClientRect().top + scrollY - 44); window.__thisRide = window.__ride(); });
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
  await desk.context().close();
}

assert.deepEqual(problems.filter(p => !p.startsWith('failed:')), [], 'problems while using it');
await browser.close();
server.close();
console.log('all good');
