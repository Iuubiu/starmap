
import fs from 'node:fs';
const p = 'C:/Users/Yhwhy/.dsh/profiles/desktop/node_modules/billion-context/dist/index.js';
const s = fs.readFileSync(p, 'utf8');
function around(key, before = 200, after = 1200, n = 1) {
  let i = -1, c = 0;
  while ((i = s.indexOf(key, i + 1)) !== -1 && c < n) {
    c++;
    console.log('---[' + key + ' @' + i + ']---');
    console.log(s.slice(Math.max(0, i - before), i + after));
  }
}
around('function parseExternalSummaryChain', 0, 2200);
around('SUMMARY_DEFAULT_BUDGET', 100, 200, 2);
