// Random Randy: picks uniformly among moves that don't crash this tick.
'use strict';
const { safeDirs } = require('../lib');

module.exports = {
  name: 'Random Randy',
  tagline: 'No plan. No regrets. No idea.',
  color: '#ff9f1c',
  style: 'Chaos',
  bio: 'Picks any move that won\'t kill him this instant, uniformly at random. The control group with a fan club.',
  factory: () => ({
    move(s) {
      const ok = safeDirs(s);
      return ok.length ? ok[Math.floor(s.rng() * ok.length)] : s.me.dir;
    },
  }),
};
