
import fs from 'node:fs';
const p = 'C:/Users/Yhwhy/.dsh/profiles/desktop/node_modules/billion-context/dist/index.js';
const s = fs.readFileSync(p, 'utf8');
function body(name, len = 2600) {
  const i = s.indexOf('function ' + name + '(');
  if (i < 0) { console.log('NOTFOUND', name); return; }
  console.log('=== ' + name + ' @' + i + ' ===');
  console.log(s.slice(i, i + len));
}
body('withExternalSummaryTools', 2000);
console.log('\n\n');
body('autoFoldActive', 200);
