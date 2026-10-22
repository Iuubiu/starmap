
import fs from 'node:fs';
const p = 'C:/Users/Yhwhy/.dsh/profiles/desktop/node_modules/billion-context/dist/index.js';
const s = fs.readFileSync(p, 'utf8');
function around(key, before = 600, after = 1400, n = 2) {
  let i = -1, c = 0;
  while ((i = s.indexOf(key, i + 1)) !== -1 && c < n) { c++; console.log('---[' + key + ' #' + c + ']---'); console.log(s.slice(Math.max(0,i-before), i+after)); }
}
around('isPluginFoldCallId', 500, 800, 2);
console.log('\n\n');
around('autoFoldTargetTokens:', 400, 900, 2);
