// Replays the stored games from their seeds with the bots as they are now, and lists any that come out differently:
// a check after changing a bot's code, since the page says its bots are the code that played these games.
//   node replay.js                  every game (the round robin, the knockout and the postscript)
//   node replay.js chicken,spacey   only the games those bots played
'use strict';
const fs = require('fs');
const path = require('path');
const { playGame } = require('./engine');

const here = f => path.join(__dirname, f);
const read = f => JSON.parse(fs.readFileSync(here(f), 'utf8'));
const R = read('results.json'), CH = fs.existsSync(here('challenge.json')) ? read('challenge.json') : null;
const challenger = CH && CH.bot.slug;
const name = Object.fromEntries([...R.bots, ...(CH ? [CH.bot] : [])].map(b => [b.slug, b.name]));
const bot = s => require(here(s === challenger ? `challenger/${s}.js` : `bots/${s}.js`));
const enc = moves => moves.map(([a, b]) => String.fromCharCode(97 + a * 4 + b)).join('');
const only = process.argv[2] ? process.argv[2].split(',') : null;

// Numbered as on the page: the postscript's games come after the tournament's.
const games = R.games.concat(CH ? CH.games.map((g, k) => ({ ...g, i: R.games.length + k })) : [])
  .filter(g => !only || g.p.some(s => only.includes(s)));
const off = [];
for (const g of games) {
  const r = playGame(g.p.map(s => bot(s).factory), g.map, g.seed);
  if (enc(r.moves) === g.moves) continue;
  const was = g.winner ? name[g.winner] : 'a draw', now = r.winner === -1 ? 'a draw' : name[g.p[r.winner]];
  off.push(`  ${g.i}  ${g.stage}, ${g.p.map(s => name[s]).join(' v ')}, ${g.map}: ${now === was ? `still ${now}` : `${now}, was ${was}`}`);
}
const n = x => x.toLocaleString('en');
console.log(`${n(games.length - off.length)} of ${n(games.length)} games replay move for move.`);
if (off.length) console.log(`These come out differently (game, then who wins it now):\n${off.join('\n')}`);
