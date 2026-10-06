// Postscript: the challenger takes on the champion, first to 4 wins.
// node challenge.js  -> writes challenge.json (read by build.js)
'use strict';
const fs = require('fs');
const path = require('path');
const { MAPS, playGame } = require('./engine');

const R = JSON.parse(fs.readFileSync(path.join(__dirname, 'results.json'), 'utf8'));
const champ = R.champion;
const C = require('./challenger/the-challenger.js');
const P = require('./bots/' + champ + '.js');
const maps = Object.keys(MAPS);
const enc = moves => moves.map(([a, b]) => String.fromCharCode(97 + a * 4 + b)).join('');

const games = [], score = { challenger: 0, champion: 0 };
for (let n = 0; n < 12 && score.challenger < 4 && score.champion < 4; n++) {
  const map = maps[n % maps.length], seed = 777000 + n;
  const swap = n % 2 === 1;
  const p = swap ? [champ, 'the-challenger'] : ['the-challenger', champ];
  const f = swap ? [P.factory, C.factory] : [C.factory, P.factory];
  const r = playGame(f, map, seed);
  const winner = r.winner === -1 ? null : p[r.winner];
  if (winner === champ) score.champion++; else if (winner) score.challenger++;
  games.push({ stage: 'Challenge', gameNo: n + 1, p, map, seed, winner, ticks: r.ticks, reason: r.reason,
    s: [r.start[0].x, r.start[0].y, r.start[0].dir], moves: enc(r.moves) });
  console.log(`G${n + 1} ${map.padEnd(11)} ${p.join(' v ')} -> ${winner || 'draw'} (${r.ticks}t)  ${score.challenger}-${score.champion}`);
}
const bot = { slug: 'the-challenger', name: C.name, tagline: C.tagline, color: C.color, style: C.style, bio: C.bio };
fs.writeFileSync(path.join(__dirname, 'challenge.json'), JSON.stringify({ bot, champion: champ, score, games }));
console.log(`final: challenger ${score.challenger} - ${score.champion} ${champ}`);
