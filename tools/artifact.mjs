// Bundles the page into one self-contained HTML file:  node tools/artifact.mjs
//   dist/grid-classic.html  the whole page in one file, for sharing as a single page;
//   dist/artifact.html      the same without the document wrapper, for hosts that supply their own <html>/<head>/<body>.
// The repo itself runs without this step.
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const root = new URL('..', import.meta.url);
const read = p => readFile(new URL(p, root), 'utf8');
const dataUri = async (path, type) => `data:${type};base64,${(await readFile(new URL(path, root))).toString('base64')}`;

// The three modules become one script in its own scope: the imports and exports come out.
// data-single tells the page it's the one-file copy, which has no service worker to register.
const strip = s => s.replace(/^import .*\n/gm, '').replace(/^export const /gm, 'const ');
const js = `document.documentElement.dataset.single = '';
(() => {
'use strict';
${strip(await read('js/data.js'))}${strip(await read('js/bots.js'))}${strip(await read('js/app.js'))}})();
`.replace(/<\/script/gi, '<\\/script');

// A single file can't point at other files, so the fonts and the icon go in as data: URIs,
// and the links that only make sense for the hosted site (manifest, home-screen icon, preloads) come out.
let css = await read('css/app.css');
for (const [, file] of css.matchAll(/url\(\.\.\/(fonts\/[^)]+\.woff2)\)/g)) css = css.replace(`url(../${file})`, `url(${await dataUri(file, 'font/woff2')})`);
const icon = await dataUri('icon.svg', 'image/svg+xml');
const swap = (s, from, to) => { if (!s.includes(from)) throw new Error(`index.html: ${from} not found`); return s.replace(from, () => to); };
let html = (await read('index.html')).replace(/ *<link rel="(manifest|apple-touch-icon|preload)"[^>]*>\n/g, '');
html = swap(html, '"icon.svg"', `"${icon}"`);
html = swap(html, '<link rel="stylesheet" href="css/app.css">', `<style>\n${css}</style>`);
html = swap(html, '  <script type="module" src="js/app.js"></script>\n', '');
html = swap(html, '</body>', `<script>\n${js}</script>\n</body>`);

const fragment = html
  .replace(/<!doctype html>\s*/i, '')
  .replace(/<\/?html[^>]*>\s*/gi, '')
  .replace(/<\/?head>\s*/gi, '')
  .replace(/<\/?body[^>]*>\s*/gi, '')
  .replace(/<meta charset[^>]*>\s*/i, '')
  .replace(/<meta name="viewport"[^>]*>\s*/i, '');

await mkdir(new URL('dist/', root), { recursive: true });
await writeFile(new URL('dist/grid-classic.html', root), html);
await writeFile(new URL('dist/artifact.html', root), fragment);
console.log(`dist/grid-classic.html ${(html.length / 1024).toFixed(0)} KB, dist/artifact.html ${(fragment.length / 1024).toFixed(0)} KB`);
