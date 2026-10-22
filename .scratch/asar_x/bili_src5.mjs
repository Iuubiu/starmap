import fs from 'node:fs';
const F = 'C:/Users/Yhwhy/.dsh/profiles/desktop/node_modules/billion-context/dist/index.js';
const s = fs.readFileSync(F, 'utf8');
for (const k of ['so it was NOT forwarded even for evidence', 'payload core text alone']) {
  let i = -1, n = 0;
  while ((i = s.indexOf(k, i + 1)) >= 0 && n < 2) { n++; console.log('\n### ' + k + ' @' + i); console.log(s.slice(Math.max(0, i - 2200), i + 700)); }
  console.log('-- ' + k + ' count=' + n);
}
