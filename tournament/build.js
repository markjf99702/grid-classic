// Writes the page's two generated files from the tournament:
//   ../js/data.js  every game (moves, starts, results), the tables, the bracket, the awards and the commentary;
//   ../js/bots.js  the engine and every bot, wrapped as CommonJS modules so the page can run them.
// node build.js
'use strict';
const fs = require('fs');
const path = require('path');
const { analyze } = require('./analyze');

const here = f => path.join(__dirname, f);
const R = JSON.parse(fs.readFileSync(here('results.json'), 'utf8'));
const readJson = f => { try { return JSON.parse(fs.readFileSync(here(f), 'utf8')); } catch (e) { console.error(`skipping ${f}: ${e.message}`); return null; } };

// Copy comes from story.json (headline, story, ticker...) and highlights.json (the reel).
const copy = Object.assign({}, readJson('story.json') || {});
const hl = readJson('highlights.json');
if (hl) copy.highlights = Array.isArray(hl) ? hl : hl.highlights;

// Bot names, colours and bios come from the bot files so cosmetic edits don't need a re-run.
const bots = R.bots.map(b => { const m = require(here(`bots/${b.slug}.js`)); return { slug: b.slug, name: m.name, tagline: m.tagline, color: m.color, style: m.style, bio: m.bio }; });
const slim = g => ({ i: g.i, stage: g.stage, p: g.p, map: g.map, winner: g.winner, ticks: g.ticks, reason: g.reason, s: g.s, moves: g.moves, gameNo: g.gameNo });
const data = { W: R.W, H: R.H, maps: R.maps, bots, standings: R.standings, h2h: R.h2h, bracket: R.bracket, champion: R.champion, games: R.games.map(slim) };

// ---- Postscript: a challenger's first-to-4 match against the champion (challenge.js), if it was played.
const CH = readJson('challenge.json');
if (CH) {
  data.bots.push(CH.bot);
  const idx = CH.games.map(g => { const i = data.games.length; data.games.push(slim({ ...g, i })); return i; });
  data.challenge = { a: CH.bot.slug, b: CH.champion, score: [CH.score.challenger, CH.score.champion], games: idx,
    winner: CH.score.challenger > CH.score.champion ? CH.bot.slug : CH.champion };
}

// ---- Awards, from the results plus a replay of every game (the sealing moment and the room each rider had).
{
  const A = Object.fromEntries(R.games.map(g => [g.i, analyze(g)]));
  const rank = Object.fromEntries(R.standings.map(t => [t.slug, t.rank]));
  const row = Object.fromEntries(R.standings.map(t => [t.slug, t]));
  const st = {}; R.bots.forEach(b => st[b.slug] = { comeback: 0, unused: 0, unusedN: 0, giant: 0 });
  let escape = null;
  for (const g of R.games) {
    const a = A[g.i]; if (!g.winner) continue;
    const wi = g.p.indexOf(g.winner), li = 1 - wi, L = g.p[li];
    if (a.sep) {
      const d = a.sep.cells[li] - a.sep.cells[wi];
      if (d > 0) { st[g.winner].comeback++; if (!escape || d > escape.d) escape = { d, g: g.i, w: g.winner, l: L, cells: [a.sep.cells[wi], a.sep.cells[li]] }; }
      st[L].unused += a.sep.cells[li] - (g.ticks - a.sep.tick - 1); st[L].unusedN++;
    }
    if (rank[g.winner] >= 9 && rank[L] <= 4) st[g.winner].giant++;
  }
  const best = (f, min = true) => Object.keys(st).sort((x, y) => min ? f(x) - f(y) : f(y) - f(x));
  const top = (f) => { const o = best(f, false); return o.filter(s => f(s) === f(o[0])); };
  const awards = [];
  const think = best(s => row[s].msPerMove, false)[0];
  awards.push({ award: 'The Overthinker', bots: [think], stat: `${row[think].msPerMove.toFixed(1)} ms of thought per move, the most in the field.` });
  const heads = top(s => row[s].headOn);
  awards.push({ award: 'Crash Test Dummy', bots: heads, stat: `${row[heads[0]].headOn} head-on collisions${heads.length > 1 ? ' each' : ''}.` });
  const giant = top(s => st[s].giant)[0];
  awards.push({ award: 'Giant Killer', bots: [giant], stat: `${st[giant].giant} wins over the top four seeds, from seed ${rank[giant]}.` });
  const cb = top(s => st[s].comeback);
  awards.push({ award: 'Comeback Kid', bots: cb, stat: `${st[cb[0]].comeback} wins after being sealed into the smaller room.` });
  awards.push({ award: 'The Great Escape', bots: [escape.w], g: escape.g, stat: `Walled into ${escape.cells[0]} cells against ${escape.cells[1]} and still outlasted ${R.bots.find(b => b.slug === escape.l).name}.` });
  const enough = Object.keys(st).filter(s => st[s].unusedN >= 20);
  const avgUnused = s => st[s].unused / st[s].unusedN;
  const neat = enough.sort((x, y) => avgUnused(x) - avgUnused(y))[0];
  awards.push({ award: 'Neatest Packer', bots: [neat], stat: `Left just ${avgUnused(neat).toFixed(1)} cells unused, on average, when it crashed after a seal.` });
  const messy = enough.sort((x, y) => avgUnused(y) - avgUnused(x))[0];
  awards.push({ award: 'Messiest Room', bots: [messy], stat: `Left ${avgUnused(messy).toFixed(0)} cells unused, on average, when it crashed after a seal.` });
  const mara = best(s => row[s].avgTicks, false)[0];
  awards.push({ award: 'Marathon Rider', bots: [mara], stat: `Longest average game in the round robin: ${row[mara].avgTicks} ticks.` });
  data.awards = awards;
}

// ---- The engine, its helpers and every bot, each wrapped as a CommonJS module:
// "bots/deep-cycle": function (module, exports, require, process) { ...the file... }
// The page's loader (req in js/app.js) resolves require() between them, and "Read the code" shows each function's body.
function bundle() {
  const files = ['engine.js', 'lib.js', 'bots/_shared/cycle-core.js', ...R.bots.map(b => `bots/${b.slug}.js`)];
  if (CH) files.push('challenger/the-challenger.js');
  return files.map(f => {
    const src = fs.readFileSync(here(f), 'utf8');
    if (/<\/script/i.test(src)) throw new Error('unexpected </script> in ' + f);
    return `${JSON.stringify(f.replace(/\.js$/, ''))}: function (module, exports, require, process) {\n${src}\n}`;
  }).join(',\n');
}

const json = v => JSON.stringify(v).replace(/</g, '\\u003c');
const note = '// Generated by tournament/build.js. Edit the tournament files and run `node tournament/build.js` instead.\n';
fs.writeFileSync(here('../js/data.js'), `${note}export const DATA = ${json(data)};\nexport const COPY = ${json(copy)};\n`);
fs.writeFileSync(here('../js/bots.js'), `${note}export const BOTS = {\n${bundle()}\n};\n`);
const kb = f => (fs.statSync(here(f)).size / 1024).toFixed(0);
console.log(`js/data.js ${kb('../js/data.js')} KB, ${data.games.length} games; js/bots.js ${kb('../js/bots.js')} KB`);
