
import fs from 'node:fs';
const p = 'C:/Users/Yhwhy/.dsh/profiles/desktop/node_modules/billion-context/dist/index.js';
const s = fs.readFileSync(p, 'utf8');
function around(key, before = 400, after = 900, n = 3) {
  let i = -1, c = 0;
  while ((i = s.indexOf(key, i + 1)) !== -1 && c < n) {
    c++;
    console.log('---[' + key + ' #' + c + ' @' + i + ']---');
    console.log(s.slice(Math.max(0, i - before), i + after));
  }
}
around('growthFoldingArmed(', 300, 700, 3);
around('autoFoldOnce', 200, 900, 2);
around('function parseAutoFold', 0, 700, 1);
