// Renders the README screenshots (docs/*.png) and the link preview (og.png):  node tools/screenshots.mjs
// Math.random is seeded and the ride runs on Playwright's clock, so the same pictures come out every time.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let body;
  try { body = await readFile(join(root, path === '/' ? 'index.html' : path)); } catch { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'text/html' });
  res.end(body);
}).listen(0);
const base = `http://localhost:${server.address().port}/`;
const SEED = 11;
const FINAL = 1016; // the final's deciding game
const browser = await pw.chromium.launch();
await mkdir(join(root, 'docs'), { recursive: true });

async function open(viewport, deviceScaleFactor, mobile) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor, hasTouch: mobile, isMobile: mobile, reducedMotion: 'reduce', serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await page.clock.install();
  await page.addInitScript(seed => {
    let a = seed; // mulberry32
    Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }, SEED);
  await page.goto(base);
  await page.evaluate(() => document.fonts.ready);
  await page.clock.runFor(100);
  return page;
}

// Puts a stored game on the big screen, paused at a tick, with the booth's commentary up to then.
async function showGame(page, gi, tick) {
  await page.evaluate(([gi, tick]) => {
    document.querySelector(`.clip[data-g="${gi}"]`).click();
    document.getElementById('play').click(); // pause
    const s = document.getElementById('scrub');
    s.value = tick; s.dispatchEvent(new Event('input'));
  }, [gi, tick]);
  await page.clock.runFor(100);
}
// Scrolls an element to just under the sticky top bar.
const scrollTo = (page, sel) => page.evaluate(sel => { const el = document.querySelector(sel); window.scrollTo(0, el.getBoundingClientRect().top + scrollY - 44); }, sel);

// The tick the final is sealed on, from the replay itself, so it doesn't depend on what the booth says then.
async function sealTick(page) {
  return page.evaluate(gi => window.__sim(gi).sep.tick, FINAL);
}

// Rides against a bot on the clock, steering towards the most open space and turning often,
// and stops after `ticks` ticks (or just before a crash).
async function ride(page, slug, map, ticks) {
  await page.selectOption('#exBot', slug);
  await page.selectOption('#exMap', map);
  await page.click('#exGo');
  await page.clock.runFor(1900); // the countdown
  const keys = ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'];
  for (let t = 0; t < ticks; t++) {
    const d = await page.evaluate(t => {
      const ex = window.__ride(), W = 40, H = 30, DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
      if (ex.state !== 'live') return -2;
      const you = ex.pos[0];
      const room = d => { // cells reachable after moving one step in direction d
        const x0 = you.x + DX[d], y0 = you.y + DY[d];
        if (x0 < 0 || y0 < 0 || x0 >= W || y0 >= H || ex.grid[y0 * W + x0]) return -1;
        const seen = new Uint8Array(W * H), q = [y0 * W + x0]; seen[q[0]] = 1;
        for (let h = 0; h < q.length && q.length < 400; h++) for (let k = 0; k < 4; k++) {
          const x = q[h] % W + DX[k], y = (q[h] / W | 0) + DY[k], c = y * W + x;
          if (x >= 0 && y >= 0 && x < W && y < H && !ex.grid[c] && !seen[c]) { seen[c] = 1; q.push(c); }
        }
        return q.length;
      };
      const opts = [you.dir, (you.dir + 1) % 4, (you.dir + 3) % 4].map(d => [d, room(d)]);
      const best = Math.max(...opts.map(o => o[1]));
      if (best < 0) return -2;
      // Turn every eight ticks or so when it costs nothing, like a person weaving.
      const wantTurn = t % 8 === 7;
      const pick = opts.filter(o => o[1] >= best - 2 && (wantTurn ? o[0] !== you.dir : true))[0] || opts.find(o => o[1] === best);
      return pick[0] === you.dir ? -1 : pick[0];
    }, t);
    if (d === -2) break;
    if (d >= 0) await page.keyboard.press(keys[d]);
    // Run the clock until the ride moves on one tick.
    const at = await page.evaluate(() => window.__ride().tick);
    for (let k = 0; k < 40 && await page.evaluate(at => window.__ride().tick === at, at); k++) await page.clock.runFor(16);
  }
}

// Phone screenshots for the README.
{
  const page = await open({ width: 390, height: 844 }, 2, true);
  const tick = await sealTick(page);
  await showGame(page, FINAL, tick + 1);
  await scrollTo(page, '#stage');
  await page.screenshot({ path: join(root, 'docs/phone-replay.png') });

  await scrollTo(page, '#exhibition');
  await ride(page, 'the-professor', 'Open Grid', 64);
  await scrollTo(page, '#exhibition');
  await page.screenshot({ path: join(root, 'docs/phone-ride.png') });

  await page.evaluate(() => document.querySelector('.card details summary').click());
  await scrollTo(page, '#roster');
  await page.evaluate(() => window.scrollBy(0, -56));
  await page.screenshot({ path: join(root, 'docs/phone-riders.png') });
  await page.context().close();
}

// Link preview, 1200 x 630: the name, one line and the riders' colours on the left,
// the final's sealing moment from the big screen on the right.
{
  const page = await open({ width: 1280, height: 900 }, 2, false);
  const tick = await sealTick(page);
  await showGame(page, FINAL, tick + 1);
  await scrollTo(page, '#stage');
  const bug = await page.locator('.bug').boundingBox(), board = await page.locator('.canvaswrap').boundingBox();
  const shot = await page.screenshot({ clip: { x: bug.x, y: bug.y, width: board.width, height: board.y + board.height - bug.y } });
  const colors = await page.evaluate(() => [...document.querySelectorAll('.card .stripe')].map(s => s.style.background));
  const font = async f => `data:font/woff2;base64,${(await readFile(join(root, 'fonts', f))).toString('base64')}`;
  await page.context().close();
  const card = await (await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })).newPage();
  await card.setContent(`<!doctype html><style>
    @font-face { font-family: Display; font-weight: 100 900; src: url(${await font('big-shoulders-display.woff2')}); }
    @font-face { font-family: Barlow; font-weight: 500; src: url(${await font('barlow-500.woff2')}); }
    @font-face { font-family: Barlow; font-weight: 700; src: url(${await font('barlow-700.woff2')}); }
    body { margin: 0; width: 1200px; height: 630px; overflow: hidden; position: relative; color: #e9edf9; font-family: Barlow;
      background: linear-gradient(rgba(80,110,200,.07) 1px, transparent 1px) 0 0 / 30px 30px, linear-gradient(90deg, rgba(80,110,200,.07) 1px, transparent 1px) 0 0 / 30px 30px, #070b16; }
    .text { position: absolute; left: 64px; top: 0; bottom: 0; width: 410px; display: flex; flex-direction: column; justify-content: center; gap: 22px; }
    .pill { align-self: flex-start; background: #ff4d6d; color: #fff; font: 700 17px/1 Barlow; letter-spacing: .16em; padding: 8px 11px 6px; border-radius: 3px; }
    h1 { margin: 0; font: 900 118px/.86 Display; text-transform: uppercase; letter-spacing: .01em; }
    h1 b { color: #ffc94d; font-weight: 900; }
    p { margin: 0; font-size: 28px; line-height: 1.3; font-weight: 500; color: #a9b2d4; }
    .dots { display: flex; gap: 8px; }
    .dots i { width: 16px; height: 16px; border-radius: 50%; box-shadow: 0 0 10px var(--c); background: var(--c); }
    .screen { position: absolute; left: 530px; top: 50%; transform: translateY(-50%); width: 616px; border: 1px solid #24305a;
      box-shadow: 0 30px 80px -20px #000, 0 0 0 6px rgba(255,201,77,.06); }
    .screen img { display: block; width: 100%; }
  </style>
  <div class="text">
    <span class="pill">REPLAY</span>
    <h1>Grid<br><b>Classic</b></h1>
    <p>Sixteen light-cycle bots, one tournament. Watch the replays, then ride against them.</p>
    <div class="dots">${colors.map(c => `<i style="--c:${c}"></i>`).join('')}</div>
  </div>
  <div class="screen"><img src="data:image/png;base64,${shot.toString('base64')}"></div>`);
  await card.evaluate(() => document.fonts.ready);
  await card.screenshot({ path: join(root, 'og.png') });
  await card.context().close();
}

await browser.close();
server.close();
console.log('screenshots written');
