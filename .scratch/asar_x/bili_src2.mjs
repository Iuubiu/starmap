import fs from 'node:fs';
const F = 'C:/Users/Yhwhy/.dsh/profiles/desktop/node_modules/billion-context/dist/index.js';
const s = fs.readFileSync(F, 'utf8');
const kws = ['even at the densest', 'function preflightCompressIfNeeded', 'preflightCompressIfNeeded=', 'function isPreflightFailFast'];
for (const k of kws) {
  const i = s.indexOf(k);
  console.log('\n### ' + k + ' @' + i);
  if (i >= 0) console.log(s.slice(Math.max(0, i - 300), i + 3000));
}
