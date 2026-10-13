# Grid Classic

**Play it: [grid-classic.junkdrawer.works](https://grid-classic.junkdrawer.works/)**

**Sixteen light-cycle bots played a tournament, and this is the broadcast.** Each bot is a small JavaScript program with its own way of playing: hug the walls, chase, cut the other rider off, or search moves ahead. They played a 960-game round robin and a first-to-three knockout, then a seventeenth bot challenged the champion. You can watch any of the 1,023 games with commentary, ride against any bot yourself, or set two of them loose in a game nobody has seen before.

<p align="center">
  <img src="docs/phone-replay.png" alt="The deciding game of the final on the big screen: The Guillotine's lime trail and The Professor's purple one on a dark grid, the series at 2-2, a territory chart, and the commentators saying The Professor has 119 more cells to live in" width="250">
  &nbsp;
  <img src="docs/phone-ride.png" alt="A ride against The Professor on the open grid: your white trail and its purple one, with the opponent, arena and speed menus and the Left and Right turn buttons below" width="250">
  &nbsp;
  <img src="docs/phone-riders.png" alt="Deep Cycle's rider card: number one seed, 341 points, its style and bio, with its code open underneath" width="250">
</p>

## How it plays

- **Watch any game.** Every game is stored move by move and replayed in the page, with two commentators, a territory chart you can tap to jump, and slow motion around the moment the riders are walled apart and around the final crash.
- **The highlight reel** has eleven games with hand-written commentary, from the final to the biggest upsets.
- **Your turn.** Ride against any bot on any of the four arenas. Steer with the arrow keys or WASD, or on a phone swipe on the board or use the turn buttons. Your record against each bot is kept.
- **Dream matches.** Pick any two bots, or one against itself, and an arena. The page plays a new game on the spot and puts it on the big screen with commentary.
- **The rest of the broadcast:** the bracket, the round-robin table, who beat whom, the awards, and an archive of every game you can filter by bot, opponent, arena and stage. Each rider's card has its code.
- No account and no server. Your record stays in your browser. It works offline and installs to a phone's home screen.

## The tournament

- **The arena** is 40 by 30 cells, in four layouts: Open Grid, Pillars, The Divide and Crossroads. Both riders choose a direction, then both move. Running into a wall, a barrier or any trail puts you out, and two riders reaching the same cell at the same moment is a draw.
- **The round robin:** every pair played eight games, on all four arenas from both corners, starting from mirrored random positions. A win was worth three points and a draw one.
- **The knockout:** all sixteen bots, seeded by the table (1 against 16 down to 8 against 9), first to three wins in each tie.
- **The postscript:** The Challenger was written after the final with one job, beating the champion, and won 4-2 in a first-to-four match.
- The bots, the engine and the commentary were written by Claude.

## Running it

It's a static site: plain HTML, CSS and JavaScript, with no build step.

```sh
npx serve .                   # or any static file server, then open the printed address
npm test                      # replays every stored game through the engine, then uses the page in Chromium (needs Playwright)
node tools/screenshots.mjs    # redraws docs/*.png and og.png
node tools/make-icons.mjs     # redraws the PNG icons from icon.svg
node tools/artifact.mjs       # writes dist/grid-classic.html, the whole page in one file
```

To put it online with GitHub Pages: **Settings → Pages → Build and deployment → Deploy from a branch**, then pick `main` and `/ (root)`.

### Running the tournament again

The engine and the bots are plain Node.js, in `tournament/`:

```sh
node tournament/quick.js deep-cycle the-professor 2   # a quick head-to-head on every arena
node tournament/tournament.js                          # plays everything on every CPU core, writes results.json
node tournament/challenge.js                           # the postscript match, writes challenge.json
node tournament/build.js                               # writes js/data.js and js/bots.js for the page
node tournament/replay.js                              # npm run sim: replays the stored games, lists any that come out differently
```

A new run plays every game the same way on any machine (only the thinking times change), but not quite as the stored tournament went. The bots take their randomness from each game's seed, and in Node, Deep Cycle always searches to its full budget (on the page it also stops after 18 ms, so a ride never stalls). The stored tournament was played with that 18 ms limit on, so 19 of Deep Cycle's 131 games go differently in a new run: 32, 148, 151, 248, 350, 351, 521, 526, 534, 550, 555, 563, 568, 573, 575, 578, 591, 598 and 998, as `node tournament/replay.js deep-cycle` shows. Two of them change winner, Bloodhound taking 148 and The Architect 573, which leaves Deep Cycle on 111-2-7 and 335 points, The Architect on 312 and Bloodhound on 209, with the same seeding, bracket and champion. A new run also numbers the knockout games in bracket order (round, tie, then game), where the stored one numbered them in the order they finished, so the knockout games in `highlights.json` (960, 962, 1006 and 1010) would get new numbers. The written commentary in `story.json` and `highlights.json` would then need updating to match, starting with Deep Cycle's 113-2-5, 341 points, 32 clear and five defeats. Changing a bot's colour or bio only needs `node tournament/build.js`.

### Files

- `index.html`, `css/app.css`: the page.
- `js/app.js`: replays and their commentary, the bracket and tables, rides against the bots, and dream matches.
- `js/data.js`, `js/bots.js`: written by `tournament/build.js`. Every game's moves and result, the tables, the awards and the commentary; and the engine and bots wrapped so the page can run them.
- `tournament/engine.js`: the arena, its four layouts and the rules. `tournament/lib.js`: the flood fill, distances and territory split the simpler bots share.
- `tournament/bots/`: one file per bot, with its name, motto, colour, bio and code. `bots/_shared/cycle-core.js` is the search code the stronger bots share, and `tournament/challenger/` holds the postscript's bot.
- `tournament/results.json`, `tournament/challenge.json`: the recorded games. `tournament/story.json`, `tournament/highlights.json`: the written commentary.
- `tournament/analyze.js`, `tournament/inspect.js`: replay tools for writing commentary (`node tournament/inspect.js 1016` draws the final's last game in the terminal). `tournament/replay.js` plays every stored game again with the bots as they are now, to show which games a change to a bot's code would alter (`node tournament/replay.js chicken` for just Chicken's).
- `fonts/`: Big Shoulders Display, Barlow and JetBrains Mono (SIL Open Font License), served from here so nothing loads from elsewhere.
- `sw.js`: keeps a copy for using offline.
